#!/usr/bin/env node
/**
 * branch-lifecycle.mjs — exercise the full multi-branch content lifecycle in one
 * ephemeral pass, then tear it all down so nothing accumulates on the stack.
 *
 * Covers, one branch at a time:
 *   1. A 3-branch LINEAGE — create branch L1 from the base, add entries, then
 *      create L2 *from L1* (inherits its entries), add entries, then L3 from L2.
 *   2. Entries in each branch, localized into a DIFFERENT locale combination.
 *   3. updateWorkflow to ADD the lineage branches to a workflow.
 *   4. A dynamic NEW content type → entries → localize → attach it to the workflow.
 *   5. Workflow stage transitions with `assigned_to` set to the acting user.
 *   6. A publishing rule spanning MULTIPLE branches (base + the lineage).
 *   + Teardown: delete the publishing rule, restore the workflow to its original
 *     branches/content_types, delete the lineage branches and the dynamic CT.
 *
 * This is COVERAGE, not volume — it creates a handful of entries per branch.
 * The heavy 10k creation is the separate periodic-entries step.
 *
 * Auth: management token for CRUD; a USER session (CONTENTSTACK_USER_AUTHTOKEN or
 * EMAIL+PASSWORD/TOTP) for stage transitions (mgmt tokens cannot change stages).
 *
 * Env knobs:
 *   CONTENTSTACK_BRANCH_LINEAGE_COUNT     — branches in the lineage (default 3)
 *   CONTENTSTACK_BRANCH_LINEAGE_SOURCE    — root the lineage forks from (default = stack branch or main)
 *   CONTENTSTACK_BRANCH_ENTRIES_PER_CT    — entries created per branch (default 5)
 *   CONTENTSTACK_BRANCH_LIFECYCLE_WORKFLOW— workflow name to extend (default "Editorial Review")
 *   CONTENTSTACK_BRANCH_LIFECYCLE_CONTENT_TYPE — CT used for branch entries (default demo_plain_text)
 *   CONTENTSTACK_BRANCH_LIFECYCLE_CLEANUP — "false" leaves everything in place (default true)
 *
 * Usage:
 *   node --env-file=.env scripts/branch-lifecycle.mjs
 *   node --env-file=.env scripts/branch-lifecycle.mjs --dry-run
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  listEntries,
  findWorkflowByName,
  getWorkflow,
  updateWorkflow,
  createPublishingRule,
  deletePublishingRule,
  transitionEntryWorkflow,
  publishEntry,
  unpublishEntry,
  tryLoadUserSessionHeaders,
  userSessionHeaders,
  getCurrentUser,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import {
  planWalkIndices,
  pickWeighted,
  mulberry32,
  DEFAULT_PATTERN_WEIGHTS,
  isApprovedStageName,
} from './lib/workflow-patterns.mjs'
import { writeStepReport } from './lib/report.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DRY_RUN = process.argv.slice(2).includes('--dry-run')

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v != null && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

function uniqueTitle(prefix) {
  return `${prefix} ${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

function uniq(arr) {
  return [...new Set(arr)]
}

function deriveLocales() {
  try {
    const m = JSON.parse(readFileSync(resolve(__dirname, 'locales-branches.manifest.json'), 'utf-8'))
    return (m.locales || []).map((l) => l.code).filter(Boolean)
  } catch {
    return ['fr-fr', 'de-de', 'en-gb']
  }
}

// Spread the available locales across the branches so each branch gets a
// distinct combination (branch 0 → [l0], branch 1 → [l1,l2], branch 2 → [l3,l4]).
function localeComboFor(index, locales) {
  if (locales.length === 0) return []
  if (index === 0) return locales.slice(0, 1)
  if (index === 1) return locales.slice(1, 3)
  return locales.slice(3)
}

const results = []
function record(step, ok, detail = '') {
  results.push({ step, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const { apiKey, base, branch: baseBranch, locale, publishEnv } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmt = (br) => headersForToken(apiKey, tokens[0], br)

  const lineageCount = intEnv('CONTENTSTACK_BRANCH_LINEAGE_COUNT', 3)
  const entriesPerCt = intEnv('CONTENTSTACK_BRANCH_ENTRIES_PER_CT', 5)
  const wfName = optionalEnv('CONTENTSTACK_BRANCH_LIFECYCLE_WORKFLOW') || 'Editorial Review'
  const CT = optionalEnv('CONTENTSTACK_BRANCH_LIFECYCLE_CONTENT_TYPE') || 'demo_plain_text'
  const cleanup = optionalEnv('CONTENTSTACK_BRANCH_LIFECYCLE_CLEANUP') !== 'false'
  const source = optionalEnv('CONTENTSTACK_BRANCH_LINEAGE_SOURCE') || baseBranch || 'main'
  const locales = deriveLocales()
  const stamp = Date.now().toString(36)

  // User session (once) for transitions + assigned_to.
  const baseUserHeaders = DRY_RUN ? null : await tryLoadUserSessionHeaders(base, apiKey, baseBranch)
  const authtoken = baseUserHeaders?.authtoken
  const userHeadersFor = (br) => (authtoken ? userSessionHeaders(apiKey, authtoken, br) : null)
  let assignedTo = null
  if (baseUserHeaders) {
    const u = (await getCurrentUser(base, baseUserHeaders)).body?.user
    if (u?.uid) {
      assignedTo = [{ uid: u.uid, name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email, email: u.email }]
    }
  }

  console.log('branch-lifecycle')
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  root=${source}  workflow="${wfName}"  CT=${CT}`)
  console.log(`  lineage: ${lineageCount} branches · ${entriesPerCt} entries/branch · locales [${locales.join(', ')}]`)
  console.log(`  user session: ${authtoken ? 'yes (transitions enabled)' : 'no (transitions will be skipped)'}  cleanup: ${cleanup}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  const kpis = {
    branchesCreated: 0, branchEntries: 0, branchLocalized: 0,
    dynCtCreated: 0, dynCtEntries: 0, workflowBranchAdds: 0,
    secondWaveEntries: 0, transitions: 0, published: 0, unpublished: 0,
    publishRules: 0, branchesDeleted: 0, ctsDeleted: 0,
  }

  // ── PHASE 1+2: lineage of branches, each with entries + a locale combo ──────
  console.log('\n→ Branch lineage (one at a time)')
  const lineage = []
  let src = source
  for (let i = 0; i < lineageCount; i += 1) {
    const uid = `bl-${stamp}-${i + 1}`
    if (DRY_RUN) {
      record(`branch ${uid} ← ${src}`, true, '[dry-run]')
      lineage.push(uid); src = uid; continue
    }
    const created = await createBranch(base, mgmt(source), { uid, source: src })
    if (!created.ok) {
      record(`branch ${uid} ← ${src}`, false, `create ${created.status}: ${created.body?.error_message || ''}`)
      break
    }
    const ready = await pollBranchReady(base, mgmt(source), uid)
    if (!ready) {
      record(`branch ${uid} ← ${src}`, false, 'not ready in time')
      break
    }
    kpis.branchesCreated += 1
    lineage.push(uid)

    const bh = mgmt(uid)
    const combo = localeComboFor(i, locales)
    let made = 0
    let loc = 0
    for (let j = 0; j < entriesPerCt; j += 1) {
      const title = uniqueTitle(`branch ${uid}`)
      const e = await createEntry(base, bh, CT, { title, single_line: `seed on ${uid}` })
      if (!e.ok) continue
      made += 1
      kpis.branchEntries += 1
      const euid = e.body?.entry?.uid
      for (const code of combo) {
        const lz = await localizeEntry(base, bh, {
          contentTypeUid: CT, entryUid: euid, locale: code,
          fields: { title: `[${code}] ${title}`, single_line: `localized on ${uid}` },
        })
        if (lz.ok) { kpis.branchLocalized += 1; loc += 1 }
      }
    }
    record(`branch ${uid} ← ${src}`, true, `${made} entries, ${loc} localizations [${combo.join(',') || 'none'}]`)
    src = uid // next branch forks from this one (inherits its entries)
  }

  // ── PHASE 3+4+5+6: extend the workflow, dynamic CT, transitions, publish rule ─
  let wf = null
  let originalWf = null
  let dynCt = null
  let ruleUid = null
  if (!DRY_RUN && lineage.length > 0) {
    wf = await findWorkflowByName(base, mgmt(baseBranch), wfName)
  }
  if (wf) {
    const full = (await getWorkflow(base, mgmt(baseBranch), wf.uid)).body?.workflow || wf
    originalWf = { branches: [...(full.branches || [])], content_types: [...(full.content_types || [])] }
    const hasAllCts = (full.content_types || []).includes('$all')

    // PHASE 4: dynamic content type → entries → localize → (attach below)
    dynCt = `demo_dyn_${stamp}`
    const schema = [
      ...defaultTitleOnlySchema(),
      { data_type: 'text', display_name: 'Body', uid: 'body', field_metadata: {}, multiple: false, mandatory: false, unique: false, non_localizable: false },
    ]
    const ctRes = await createContentType(base, mgmt(baseBranch), { uid: dynCt, title: `Demo Dynamic ${stamp}`, schema })
    if (ctRes.ok) {
      kpis.dynCtCreated = 1
      record(`dynamic CT ${dynCt}`, true)
      const combo = localeComboFor(0, locales)
      for (let j = 0; j < entriesPerCt; j += 1) {
        const title = uniqueTitle(`dyn ${dynCt}`)
        const e = await createEntry(base, mgmt(baseBranch), dynCt, { title, body: 'dynamic entry' })
        if (!e.ok) continue
        kpis.dynCtEntries += 1
        for (const code of combo) {
          await localizeEntry(base, mgmt(baseBranch), {
            contentTypeUid: dynCt, entryUid: e.body?.entry?.uid, locale: code,
            fields: { title: `[${code}] ${title}`, body: 'dynamic localized' },
          })
        }
      }
    } else {
      record(`dynamic CT ${dynCt}`, false, `${ctRes.status}: ${ctRes.body?.error_message || ''}`)
      dynCt = null
    }

    // PHASE 3 (+attach dyn CT): add lineage branches + dyn CT to the workflow
    const newBranches = uniq([...(full.branches || []), ...lineage])
    const newCts = hasAllCts
      ? full.content_types
      : uniq([...(full.content_types || []), ...(dynCt ? [dynCt] : [])])
    const upd = await updateWorkflow(base, mgmt(baseBranch), wf.uid, {
      ...full, branches: newBranches, content_types: newCts,
    })
    if (upd.ok) kpis.workflowBranchAdds = lineage.length
    record(`workflow "${wfName}" + ${lineage.length} branch(es)${dynCt ? ' + dyn CT' : ''}`, upd.ok, `branches ${newBranches.length}`)

    const refreshed = (await getWorkflow(base, mgmt(baseBranch), wf.uid)).body?.workflow || full
    const stages = refreshed.workflow_stages || []
    const approved = stages.find((s) => isApprovedStageName(s.name)) || stages[stages.length - 1]
    const ruleCts = (newCts || []).filter((c) => c !== '$all')

    // PHASE 6: publishing rule across base + lineage branches — created BEFORE we
    // publish so it governs the entries we create + transition next.
    if (approved) {
      const pr = await createPublishingRule(base, mgmt(baseBranch), {
        workflow: wf.uid, workflow_stage: approved.uid,
        content_types: ruleCts.length ? ruleCts.slice(0, 10) : [CT],
        environment: publishEnv, branches: newBranches,
      })
      if (pr.ok) { ruleUid = pr.body?.publishing_rule?.uid; kpis.publishRules = 1 }
      record(`publishing rule (${newBranches.length} branches @ ${approved?.name})`, pr.ok, pr.ok ? '' : `${pr.status}: ${pr.body?.error_message || ''}`)
    }

    // PHASE 4b: SECOND WAVE — entries created + localized AFTER the workflow + CT
    // + branch + publish rule exist, so they're workflow-governed from birth.
    const bh0 = mgmt(lineage[0])
    const combo0 = localeComboFor(0, locales)
    let secondWave = 0
    for (let j = 0; j < entriesPerCt; j += 1) {
      const title = uniqueTitle(`post-attach ${lineage[0]}`)
      const e = await createEntry(base, bh0, CT, { title, single_line: `created after workflow attach on ${lineage[0]}` })
      if (!e.ok) continue
      secondWave += 1
      kpis.secondWaveEntries += 1
      for (const code of combo0) {
        const lz = await localizeEntry(base, bh0, {
          contentTypeUid: CT, entryUid: e.body?.entry?.uid, locale: code,
          fields: { title: `[${code}] ${title}`, single_line: 'post-attach localized' },
        })
        if (lz.ok) kpis.branchLocalized += 1
      }
    }
    record(`second-wave entries on ${lineage[0]} (workflow-governed)`, secondWave > 0, `${secondWave} entries, combo [${combo0.join(',') || 'none'}]`)

    // PHASE 5: patterned stage transitions (linear / skip / rework / partialStall /
    // firstOnly) on lineage[0] entries — both waves — assigned_to the acting user.
    // Record which entries the walk leaves at the approved stage.
    const ujh = userHeadersFor(lineage[0])
    const reachedApproved = []
    if (ujh && assignedTo && stages.length > 0) {
      const seed = Number.parseInt(stamp.replace(/[^0-9]/g, '').slice(0, 9) || '1', 10) >>> 0
      const rng = mulberry32(seed || 1)
      const { body: lb } = await listEntries(base, mgmt(lineage[0]), CT, { limit: 20, desc: 'created_at' })
      const patternCounts = {}
      let n = 0
      for (const e of lb?.entries || []) {
        const pattern = pickWeighted(DEFAULT_PATTERN_WEIGHTS, rng)
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1
        const stops = planWalkIndices(stages.length, pattern).map((i) => stages[i]).filter(Boolean)
        let landed = null
        for (const st of stops) {
          const t = await transitionEntryWorkflow(base, ujh, {
            contentTypeUid: CT, entryUid: e.uid, stageUid: st.uid, locale,
            assignedTo, comment: `auto:${pattern}:${st.name}`,
          })
          if (t.ok) { kpis.transitions += 1; n += 1; landed = st }
        }
        if (landed && isApprovedStageName(landed.name)) reachedApproved.push(e.uid)
      }
      const mix = Object.entries(patternCounts).map(([p, c]) => `${p}:${c}`).join(' ')
      record(`patterned transitions on ${lineage[0]} (assigned_to ${assignedTo[0].email})`, n > 0, `${n} transitions [${mix}]`)
    } else if (!ujh) {
      record('transitions + publish/unpublish', false, 'no user session — skipped')
    }

    // PHASE 7a: publish → unpublish, one after another, for the entries the
    // patterns walked to the approved stage (what the publish rule gates on).
    // Publish all, let the async jobs drain, then unpublish every other one.
    if (reachedApproved.length > 0) {
      for (const uid of reachedApproved) {
        const p = await publishEntry(base, bh0, CT, uid, locale, publishEnv)
        if (p.ok) kpis.published += 1
        await sleep(150)
      }
      await sleep(2000) // let publish jobs start draining before unpublishing
      // Unpublish only a MINORITY so most approved entries stay published
      // (CONTENTSTACK_BRANCH_UNPUBLISH_FRACTION, default 1/3).
      const fracRaw = Number(optionalEnv('CONTENTSTACK_BRANCH_UNPUBLISH_FRACTION'))
      const unpubFrac = Number.isFinite(fracRaw) && fracRaw >= 0 && fracRaw <= 1 ? fracRaw : 1 / 3
      const unpubCount = Math.round(reachedApproved.length * unpubFrac)
      for (let i = 0; i < unpubCount; i += 1) {
        const u = await unpublishEntry(base, bh0, CT, reachedApproved[i], locale, publishEnv)
        if (u.ok) kpis.unpublished += 1
        await sleep(150)
      }
      record(`publish→unpublish on ${lineage[0]}`, kpis.published > 0, `${kpis.published} published, ${kpis.unpublished} unpublished (of ${reachedApproved.length} approved, kept ${kpis.published - kpis.unpublished})`)
    }
  } else if (!DRY_RUN && lineage.length > 0) {
    record(`workflow "${wfName}"`, false, 'not found — skipped workflow/CT/transition/rule phases')
  }

  // ── PHASE 7: teardown (ephemeral) ───────────────────────────────────────────
  if (cleanup && !DRY_RUN) {
    console.log('\n→ Teardown')
    if (ruleUid) {
      const d = await deletePublishingRule(base, mgmt(baseBranch), ruleUid)
      record('delete publishing rule', d.ok)
    }
    if (wf && originalWf) {
      const restore = await updateWorkflow(base, mgmt(baseBranch), wf.uid, {
        ...(await getWorkflow(base, mgmt(baseBranch), wf.uid)).body?.workflow,
        branches: originalWf.branches,
        content_types: originalWf.content_types,
      })
      record('restore workflow branches/CTs', restore.ok)
    }
    for (const uid of [...lineage].reverse()) {
      const d = await deleteBranch(base, mgmt(baseBranch), uid)
      if (d.ok) kpis.branchesDeleted += 1
      record(`delete branch ${uid}`, d.ok, d.ok ? '' : `${d.status}`)
    }
    if (dynCt) {
      const d = await deleteContentType(base, mgmt(baseBranch), dynCt, { force: true })
      if (d.ok) kpis.ctsDeleted = 1
      record(`delete dynamic CT ${dynCt}`, d.ok, d.ok ? '' : `${d.status}`)
    }
  } else if (!cleanup) {
    console.log(`\n(skipping teardown — lineage ${lineage.join(', ')} and CT ${dynCt || '(none)'} left in place)`)
  }

  const okCount = results.filter((r) => r.ok).length
  console.log(`\n✓ branch-lifecycle done — ${okCount}/${results.length} steps ok`)
  writeStepReport({
    planned: lineageCount,
    actual: kpis.branchesCreated,
    failed: results.filter((r) => !r.ok).length,
    kpis,
  })
}

main().catch((err) => {
  console.error('branch-lifecycle failed:', err)
  process.exit(1)
})
