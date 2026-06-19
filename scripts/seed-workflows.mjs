#!/usr/bin/env node
/**
 * seed-workflows.mjs
 *
 * Reads scripts/workflows.manifest.json and:
 *   1. Creates each workflow on the stack (idempotent — skips if a workflow with
 *      the same name already exists).
 *   2. Iterates entries in each workflow's content types and assigns them
 *      stages per the manifest's transitionPolicy.
 *
 * Why this exists: the CMS analytics pipeline emits two metering events on
 * stage changes — entry_workflow_stage_added (first assignment) and
 * entry_workflow_stage_updated (every subsequent transit). The downstream
 * snapshot meter `entry_workflow_state` is materialized from these events by
 * analytics-data-sync's nightly cron. Without traffic on these endpoints, the
 * Workflow Health dashboard renders empty regardless of how many entries exist.
 *
 * Token: stack-level CONTENTSTACK_MANAGEMENT_TOKEN (or first of plural
 * CONTENTSTACK_MANAGEMENT_TOKENS for multi-user simulation).
 *
 * Usage:
 *   node --env-file=.env scripts/seed-workflows.mjs
 *   node --env-file=.env scripts/seed-workflows.mjs --dry-run
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  tryLoadUserSessionHeaders,
  findWorkflowByName,
  createWorkflow,
  transitionEntryWorkflow,
  listEntries,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import { createProgress, runWithConcurrency } from './lib/progress.mjs'
import { writeStepReport } from './lib/report.mjs'
import {
  planWalkIndices,
  DEFAULT_PATTERN_WEIGHTS,
  pickWeighted,
  mulberry32,
} from './lib/workflow-patterns.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')

/**
 * Map the LEGACY 3-bucket distribution (finish/stallMiddle/firstOnly) to the
 * new 5-pattern distribution so existing workflows.manifest.json files keep
 * working. `finish` becomes `linear`; `stallMiddle` becomes `partialStall`;
 * `firstOnly` stays. The new patterns (skip, rework) default to 0 weight.
 */
function resolvePatternWeights(transitionPolicy) {
  if (transitionPolicy?.patterns) return transitionPolicy.patterns
  if (transitionPolicy?.distribution) {
    const d = transitionPolicy.distribution
    return {
      linear: d.finish ?? 0,
      skip: 0,
      rework: 0,
      partialStall: d.stallMiddle ?? 0,
      firstOnly: d.firstOnly ?? 0,
    }
  }
  return DEFAULT_PATTERN_WEIGHTS
}

/** Format a CMA error body for human reading — surfaces validation detail
 *  hidden inside body.errors (often the actually-useful part). */
function fmtCmaError(body) {
  if (!body || typeof body !== 'object') return String(body)
  const parts = []
  if (body.error_message) parts.push(body.error_message)
  if (body.error_code != null) parts.push(`code=${body.error_code}`)
  if (body.errors) {
    // body.errors can be an array of strings, an object {field: ['msg', ...]},
    // or a nested mix. Stringify the lot.
    parts.push(`errors=${JSON.stringify(body.errors)}`)
  }
  if (parts.length === 0) parts.push(JSON.stringify(body).slice(0, 400))
  return parts.join('  ')
}

async function ensureWorkflow(base, headers, wfManifest) {
  const existing = await findWorkflowByName(base, headers, wfManifest.name)
  if (existing) {
    console.log(`  workflow "${wfManifest.name}" already exists (uid=${existing.uid}) — skipping create`)
    return existing
  }
  if (DRY_RUN) {
    console.log(`  [dry-run] would create workflow "${wfManifest.name}" with ${wfManifest.stages.length} stages`)
    return null
  }
  const { ok, status, body } = await createWorkflow(base, headers, {
    name: wfManifest.name,
    contentTypes: wfManifest.contentTypes,
    stages: wfManifest.stages,
    branches: wfManifest.branches,
    enabled: wfManifest.enabled !== false,
  })
  if (!ok) {
    console.error(`  ✗ create workflow "${wfManifest.name}" failed (${status}): ${fmtCmaError(body)}`)
    return null
  }
  console.log(`  ✓ created workflow "${wfManifest.name}" (uid=${body.workflow?.uid})`)
  return body.workflow
}

async function transitionEntriesForWorkflow(base, headers, transitHeaders, workflow, manifestEntry, rng, locale) {
  const policy = manifestEntry.transitionPolicy
  if (!policy?.enabled) return { transitioned: 0, skipped: 0 }

  const stages = workflow.workflow_stages || []
  if (stages.length === 0) {
    console.log(`  workflow "${workflow.name}" has no stages — skipping transitions`)
    return { transitioned: 0, skipped: 0 }
  }

  const weights = resolvePatternWeights(policy)
  const concurrency = parseInt(optionalEnv('CONTENTSTACK_TRANSITION_CONCURRENCY', '8'), 10)
  const perCallSleepMs = parseInt(optionalEnv('CONTENTSTACK_TRANSITION_SLEEP_MS', '50'), 10)
  const perEntryMax = policy.perEntryMaxStages ?? 99 // legacy cap
  // Cap entries-per-CT-per-run so we don't waste API calls re-transitioning
  // already-terminal entries. periodic-entries creates new ones each run, so
  // capping + sorting by created_at desc keeps the seeder focused on fresh
  // entries that genuinely need transitions. The `rework` pattern still hits
  // older entries when picked (it walks back from terminal stages).
  const maxEntriesPerCt = policy.maxEntriesPerCt
    ?? parseInt(optionalEnv('CONTENTSTACK_TRANSITION_MAX_ENTRIES_PER_CT', '30'), 10)

  // 1) Gather all (entry, ct, plannedStops) work items across this workflow's CTs.
  const workItems = []
  for (const ctUid of manifestEntry.contentTypes) {
    const { ok, body } = await listEntries(base, headers, ctUid, {
      locale,
      limit: maxEntriesPerCt,
      desc: 'created_at', // freshest first → highest chance of meaningful transitions
    })
    if (!ok) {
      console.warn(`    skipped ${ctUid} — list entries failed`)
      continue
    }
    const entries = body.entries || []
    console.log(`    ${ctUid}: ${entries.length} entries (sampling ${maxEntriesPerCt} newest)`)
    for (const entry of entries) {
      const pattern = pickWeighted(weights, rng)
      const idxSequence = planWalkIndices(stages.length, pattern).slice(0, perEntryMax)
      const stops = idxSequence.map((i) => stages[i])
      if (stops.length === 0) continue
      workItems.push({ ctUid, entry, stops, pattern })
    }
  }

  if (workItems.length === 0) {
    console.log(`    (no entries to transition)`)
    return { transitioned: 0, skipped: 0 }
  }

  const totalTransitions = workItems.reduce((a, w) => a + w.stops.length, 0)
  console.log(
    `    plan: ${workItems.length} entries × avg ${(totalTransitions / workItems.length).toFixed(1)} stops = ${totalTransitions} transitions; concurrency=${concurrency}`,
  )

  let transitioned = 0
  let skipped = 0
  const progress = createProgress({
    label: `${workflow.name} transit`,
    total: totalTransitions,
    everyN: 50,
  })

  // 2) Each work item (entry) runs serially through its stops; entries run in
  //    a pool of N concurrent lanes. Serial-per-entry is REQUIRED — racing
  //    two transit calls for the same entry confuses cma-api's stage state.
  await runWithConcurrency(
    workItems,
    async ({ ctUid, entry, stops, pattern }) => {
      for (const stage of stops) {
        if (DRY_RUN) {
          console.log(`    [dry-run] ${ctUid}/${entry.uid} (${pattern}) → ${stage.name}`)
          transitioned++
          progress.tick({ ok: true })
          continue
        }
        const { ok: tOk, status, body: tBody } = await transitionEntryWorkflow(
          base,
          transitHeaders,
          {
            contentTypeUid: ctUid,
            entryUid: entry.uid,
            stageUid: stage.uid,
            locale,
          },
        )
        if (tOk) {
          transitioned++
          progress.tick({ ok: true })
        } else {
          // 422 = transit not allowed from current stage. Common with the
          // `rework` and `skip` patterns where the stage ACL doesn't allow
          // certain jumps. Non-fatal — just record and continue.
          skipped++
          progress.tick({ ok: false })
          if (status !== 422) {
            console.warn(
              `    ${ctUid}/${entry.uid} → ${stage.name} failed (${status}): ${tBody?.error_message || JSON.stringify(tBody).slice(0, 120)}`,
            )
          }
        }
        if (perCallSleepMs > 0) await sleep(perCallSleepMs)
      }
    },
    { concurrency },
  )
  progress.done()

  return { transitioned, skipped }
}

async function main() {
  const { apiKey, base, branch, locale } = loadStackAuth()
  const tokens = loadManagementTokens()
  const headers = headersForToken(apiKey, tokens[0], branch)

  const manifestPath =
    process.env.CONTENTSTACK_WORKFLOWS_MANIFEST_PATH ||
    resolve(__dirname, 'workflows.manifest.json')

  console.log(`workflows manifest: ${manifestPath}`)
  console.log(`stack: api_key=${apiKey.slice(0, 10)}…  host=${base}  branch=${branch || '(none)'}  locale=${locale}`)
  console.log(`tokens available: ${tokens.length}${tokens.length > 1 ? ' (multi-user mode)' : ''}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const workflows = manifest.workflows || []
  const transitionPolicy = manifest.transitionPolicy

  console.log(`\n→ ${workflows.length} workflow(s) declared`)

  const created = []
  for (const wf of workflows) {
    console.log(`\n• ${wf.name}`)
    const result = await ensureWorkflow(base, headers, wf)
    if (result) created.push({ workflow: result, manifestEntry: wf })
  }

  if (!transitionPolicy?.enabled) {
    console.log('\ntransition policy disabled — done.')
    return
  }

  // Stage transitions require user-session auth (mgmt tokens can create/update
  // workflow definitions but not change an entry's stage). Look for
  // CONTENTSTACK_USER_EMAIL / _PASSWORD; on success, use the authtoken-based
  // headers for the transit calls. If unset, skip the transition phase with a
  // clear note rather than spinning per-entry 401s.
  console.log('\n→ Authenticating user session for stage transitions…')
  const transitHeaders = await tryLoadUserSessionHeaders(base, apiKey, branch)
  if (!transitHeaders) {
    console.log(
      '  Skipping transitions — set CONTENTSTACK_USER_EMAIL + CONTENTSTACK_USER_PASSWORD\n' +
        '  in .env to enable. (Management tokens cannot change workflow stages.)',
    )
    return
  }
  console.log('  ✓ logged in')

  console.log('\n→ Transitioning entries through stages')
  const rng = mulberry32(0xdeadbeef) // deterministic across runs
  let totalT = 0
  let totalS = 0
  for (const { workflow, manifestEntry } of created) {
    console.log(`\n• ${workflow.name}`)
    const { transitioned, skipped } = await transitionEntriesForWorkflow(
      base,
      headers,
      transitHeaders,
      workflow,
      { ...manifestEntry, transitionPolicy },
      rng,
      locale,
    )
    console.log(`  → ${transitioned} transitions, ${skipped} skipped`)
    totalT += transitioned
    totalS += skipped
  }

  console.log(`\n✓ done — ${totalT} transitions, ${totalS} skipped`)
  writeStepReport({
    planned: totalT + totalS,
    actual: totalT,
    kpis: { transitions: totalT, transitionsSkipped: totalS },
  })
}

main().catch((err) => {
  console.error('seed-workflows failed:', err)
  process.exit(1)
})
