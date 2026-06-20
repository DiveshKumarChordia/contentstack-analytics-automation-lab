#!/usr/bin/env node
/**
 * no-workflow-ct.mjs — drive entries_without_workflow meter dimension by
 * creating entries on a content type with no workflow attached.
 *
 * Steps:
 *   1. Create a new content type (with no workflow).
 *   2. Create N entries on it.
 *   3. Record: created, CT name, no-workflow entries.
 *
 * The entries_without_workflow meter counts entries that have never been
 * assigned to any workflow stage. This script exercises that dimension by
 * creating entries on a bare content type (no workflow) and verifying they
 * are counted as unworkflowed.
 *
 * Usage:
 *   node --env-file=.env scripts/no-workflow-ct.mjs
 */

import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  createContentType,
  defaultTitleOnlySchema,
  createEntry,
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
  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmt = (br) => headersForToken(apiKey, tokens[0], br)

  const entryCount = intEnv('CONTENTSTACK_NO_WORKFLOW_ENTRY_COUNT', 25)

  console.log('no-workflow-ct')
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  plan: create CT with no workflow, add ${entryCount} entries`)

  const stamp = Date.now().toString(36)
  const ctUid = `no_wf_${stamp}`
  const ctTitle = `No Workflow Demo ${stamp}`

  // PHASE 1: create content type (no workflow attachment)
  const schema = defaultTitleOnlySchema()
  const { ok: ctOk, body: ctBody } = await createContentType(base, mgmt(branch), {
    uid: ctUid,
    title: ctTitle,
    schema,
  })

  if (!ctOk || !ctBody?.content_type) {
    console.error(`Failed to create CT ${ctUid}`)
    writeStepReport({
      planned: entryCount,
      actual: 0,
      failed: 1,
      kpis: { ctCreated: 0, entriesCreated: 0 },
    })
    process.exit(1)
  }

  console.log(`  ✓ created CT ${ctUid}`)

  // PHASE 2: create entries on the no-workflow CT
  const kpis = { ctCreated: 1, entriesCreated: 0, failed: 0 }
  const progress = createProgress({
    label: 'no-workflow-ct',
    total: entryCount,
    everyN: 5,
  })

  for (let i = 0; i < entryCount; i += 1) {
    const { ok, body: ebody } = await createEntry(base, mgmt(branch), ctUid, {
      title: `no-workflow entry ${Date.now().toString(36)}-${i}`,
    })

    if (ok && ebody?.entry) {
      kpis.entriesCreated += 1
    } else {
      kpis.failed += 1
    }

    progress.tick({ ok })

    if ((i + 1) % 5 === 0) await sleep(50)
  }

  progress.done()
  console.log(`\n✓ no-workflow-ct done`)
  console.log(`  created: ${kpis.entriesCreated}/${entryCount} entries on CT ${ctUid}`)

  writeStepReport({
    planned: entryCount,
    actual: kpis.entriesCreated,
    failed: kpis.failed,
    kpis,
  })
}

main().catch((err) => {
  console.error('no-workflow-ct failed:', err)
  process.exit(1)
})
