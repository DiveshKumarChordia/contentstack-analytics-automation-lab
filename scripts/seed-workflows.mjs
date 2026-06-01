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
  listWorkflows,
  findWorkflowByName,
  createWorkflow,
  transitionEntryWorkflow,
  listEntries,
  sleep,
} from './lib/cma.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')

function pickStagePolicy(distribution, rng) {
  const r = rng()
  let acc = 0
  for (const [key, weight] of Object.entries(distribution)) {
    acc += weight
    if (r <= acc) return key
  }
  return 'firstOnly'
}

// Deterministic per-run RNG so re-running with the same content set produces
// the same stage assignments (avoids drift between runs that would noisily
// re-transit every entry).
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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

  let transitioned = 0
  let skipped = 0

  for (const ctUid of manifestEntry.contentTypes) {
    const { ok, body } = await listEntries(base, headers, ctUid, { locale, limit: 100 })
    if (!ok) {
      console.warn(`    skipped ${ctUid} — list entries failed`)
      continue
    }
    const entries = body.entries || []
    if (entries.length === 0) {
      console.log(`    ${ctUid}: 0 entries to transition`)
      continue
    }

    for (const entry of entries) {
      const choice = pickStagePolicy(policy.distribution, rng)
      let stageIdx
      if (choice === 'firstOnly') stageIdx = 0
      else if (choice === 'stallMiddle') {
        stageIdx = Math.min(Math.floor(stages.length / 2), stages.length - 1)
      } else {
        // finish — last terminal stage
        stageIdx = stages.length - 1
      }
      // Walk up to perEntryMaxStages stages so we emit multiple transit events
      // on entries that "finish" (drives the audit log + per-stage counts).
      const stops = []
      for (let i = 0; i <= stageIdx && i < policy.perEntryMaxStages; i++) {
        stops.push(stages[i])
      }

      for (const stage of stops) {
        if (DRY_RUN) {
          console.log(`    [dry-run] ${ctUid}/${entry.uid} → ${stage.name}`)
          transitioned++
          continue
        }
        // Stage transitions REQUIRE a user authtoken (mgmt tokens are
        // rejected at this endpoint). transitHeaders is built from
        // CONTENTSTACK_USER_EMAIL/_PASSWORD via /v3/user-session.
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
        } else {
          // Common: 422 if the workflow doesn't accept the stage as next-from-current.
          // Not fatal — it just means we hit a non-allowed transit; skip.
          skipped++
          if (status !== 422) {
            console.warn(
              `    ${ctUid}/${entry.uid} → ${stage.name} failed (${status}): ${tBody?.error_message || JSON.stringify(tBody).slice(0, 120)}`,
            )
          }
        }
        // Light throttle so we don't blow past cma-api rate limits during a
        // large transition pass.
        await sleep(50)
      }
    }
    console.log(`    ${ctUid}: ${entries.length} entries processed`)
  }

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
}

main().catch((err) => {
  console.error('seed-workflows failed:', err)
  process.exit(1)
})
