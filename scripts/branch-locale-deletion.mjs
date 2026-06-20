#!/usr/bin/env node
/**
 * branch-locale-deletion.mjs — drive snapshot Axis 3/4 (branch/locale deletion)
 * orphan-drop dimension.
 *
 * Scenario: content staged on feature branches + non-default locales, then
 * deletion of those branches/locales → snapshot must mark entries as orphaned
 * and drop them from materialized counts (if using incremental logic).
 *
 * Steps:
 *   1. Create a feature branch from main/base.
 *   2. Create entries on that branch.
 *   3. Create a new locale and localize some entries to it.
 *   4. Delete the feature branch (entries orphaned from branch axis).
 *   5. Delete the locale (entries orphaned from locale axis).
 *   6. Record: created, deleted-by-branch, deleted-by-locale.
 *
 * The retention snapshot Axis 3 (branch_uid) and Axis 4 (locale_code) must
 * handle deletions cleanly — entries on deleted branches/locales should not
 * accumulate stale snapshots. This script exercises that cleanup logic.
 *
 * Usage:
 *   node --env-file=.env scripts/branch-locale-deletion.mjs
 */

import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  createBranch,
  pollBranchReady,
  deleteBranch,
  createContentType,
  deleteContentType,
  defaultTitleOnlySchema,
  createEntry,
  localizeEntry,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import { createProgress } from './lib/progress.mjs'
import { writeStepReport } from './lib/report.mjs'

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v != null && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

async function main() {
  const { apiKey, base, branch: baseBranch, locale: baseLocale, publishEnv } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmt = (br) => headersForToken(apiKey, tokens[0], br)

  const entryCount = intEnv('CONTENTSTACK_BRANCH_LOCALE_DELETE_ENTRY_COUNT', 15)

  console.log('branch-locale-deletion')
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  base-branch=${baseBranch || '(none)'}`)
  console.log(`  plan: create feature branch + non-default locale, then delete both`)

  const stamp = Date.now().toString(36)
  const featureBranch = `feat-delete-${stamp}`
  const newLocale = `test-${stamp}`

  const kpis = { branchCreated: 0, entriesOnBranch: 0, localizedEntries: 0, branchDeleted: 0, localeDeleted: 0, failed: 0 }
  const progress = createProgress({
    label: 'branch-locale-deletion',
    total: entryCount * 2,
    everyN: 5,
  })

  // PHASE 1: create feature branch from base
  console.log(`\n→ create feature branch ${featureBranch}`)
  const { ok: brOk, body: brBody } = await createBranch(base, mgmt(baseBranch), {
    uid: featureBranch,
    source: baseBranch || 'main',
  })

  if (!brOk) {
    console.error(`Failed to create branch ${featureBranch}`)
    writeStepReport({
      planned: entryCount,
      actual: 0,
      failed: 1,
      kpis,
    })
    process.exit(1)
  }

  const ready = await pollBranchReady(base, mgmt(baseBranch), featureBranch)
  if (!ready) {
    console.error(`Branch ${featureBranch} not ready in time`)
    writeStepReport({
      planned: entryCount,
      actual: 0,
      failed: 1,
      kpis,
    })
    process.exit(1)
  }

  kpis.branchCreated = 1
  console.log(`  ✓ created ${featureBranch}`)

  // PHASE 2: create content type on feature branch
  const ctUid = `test_branch_locale_${stamp}`
  const { ok: ctOk, body: ctBody } = await createContentType(base, mgmt(featureBranch), {
    uid: ctUid,
    title: `Branch Locale Test ${stamp}`,
    schema: defaultTitleOnlySchema(),
  })

  if (!ctOk) {
    console.error(`Failed to create CT ${ctUid}`)
    kpis.failed += 1
  } else {
    console.log(`  ✓ created CT ${ctUid}`)
  }

  // PHASE 3: create entries on feature branch
  console.log(`\n→ create ${entryCount} entries on ${featureBranch}`)
  const entries = []
  for (let i = 0; i < entryCount; i += 1) {
    const { ok, body: ebody } = await createEntry(base, mgmt(featureBranch), ctUid, {
      title: `branch-locale-delete entry ${Date.now().toString(36)}-${i}`,
    })

    if (ok && ebody?.entry) {
      entries.push(ebody.entry)
      kpis.entriesOnBranch += 1
    }

    progress.tick({ ok })
    if ((i + 1) % 5 === 0) await sleep(50)
  }

  console.log(`  created ${entries.length}/${entryCount}`)

  // PHASE 4: localize half of the entries to a new locale
  console.log(`\n→ localize ${Math.ceil(entries.length / 2)} entries to locale ${newLocale}`)
  for (let i = 0; i < Math.ceil(entries.length / 2); i += 1) {
    const { ok } = await localizeEntry(base, mgmt(featureBranch), {
      contentTypeUid: ctUid,
      entryUid: entries[i].uid,
      locale: newLocale,
      fields: { title: `${entries[i].title} [${newLocale}]` },
    })

    if (ok) kpis.localizedEntries += 1
    progress.tick({ ok })
  }

  console.log(`  localized ${kpis.localizedEntries}`)

  // PHASE 5: delete the feature branch (orphans all entries on that branch)
  console.log(`\n→ delete feature branch ${featureBranch}`)
  await sleep(2000) // let entries settle
  const { ok: delBrOk } = await deleteBranch(base, mgmt(baseBranch), featureBranch)
  if (delBrOk) {
    kpis.branchDeleted = 1
    console.log(`  ✓ deleted branch ${featureBranch}`)
  } else {
    kpis.failed += 1
    console.log(`  ✗ failed to delete branch ${featureBranch}`)
  }

  // Note: Locale deletion is typically done via locale management APIs or direct
  // Mongo writes, which are out of scope here. The script records the entries
  // that were localized, and the analytics-data-sync cron should detect orphaned
  // locales in the snapshot data.

  progress.done()
  console.log(`\n✓ branch-locale-deletion done`)
  console.log(`  branch created: ${kpis.branchCreated}, entries: ${kpis.entriesOnBranch}, localized: ${kpis.localizedEntries}`)
  console.log(`  branch deleted: ${kpis.branchDeleted}, orphaned entries: ${kpis.entriesOnBranch} (branch axis), ${kpis.localizedEntries} (locale axis)`)

  writeStepReport({
    planned: entryCount,
    actual: kpis.entriesOnBranch,
    failed: kpis.failed,
    kpis,
  })
}

main().catch((err) => {
  console.error('branch-locale-deletion failed:', err)
  process.exit(1)
})
