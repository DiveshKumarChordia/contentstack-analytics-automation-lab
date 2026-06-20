#!/usr/bin/env node
/**
 * aged-stalls.mjs — drive stalled_by_stage meter dimension by creating entries
 * in mid-stages and backdating their updated_at timestamp to simulate aged stalls.
 *
 * For each workflow:
 *   1. Create entries across different workflows.
 *   2. Transition entries to various stages (not terminal).
 *   3. Backdate the workflow stage-transition timestamp to 8-35 days ago.
 *   4. Record: created, transitioned, aged-stalls per stage.
 *
 * The stalled_by_stage meter counts entries that have been in a non-terminal
 * stage for >= 8/15/30 days (depending on threshold). By backdating the
 * stage transitions, we simulate aged stalls without waiting days for data.
 *
 * Note: The Contentstack Management API does not expose a way to backdate the
 * workflow stage transition timestamp directly. This script creates entries,
 * transitions them to mid-stages (creating fresh workflow history), then depends
 * on the analytics-data-sync cron to age the snapshots based on created_at or
 * backfill logic. For immediate aging, modify the entry's created_at timestamp
 * if the CMA allows (usually not). Alternatively, use the MongoDB direct write
 * if you have access to analytics-data-sync's Mongo backend.
 *
 * Usage:
 *   node --env-file=.env scripts/aged-stalls.mjs
 */

import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listContentTypes,
  createEntry,
  findWorkflowByName,
  transitionEntryWorkflow,
  tryLoadUserSessionHeaders,
  userSessionHeaders,
  getCurrentUser,
  listEntries,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import { createProgress, runWithConcurrency } from './lib/progress.mjs'
import { writeStepReport } from './lib/report.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v != null && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

async function main() {
  const { apiKey, base, branch, locale } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmt = (br) => headersForToken(apiKey, tokens[0], br)

  const entryCount = intEnv('CONTENTSTACK_AGED_STALL_ENTRY_COUNT', 20)

  console.log('aged-stalls')
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  plan: create ${entryCount} entries per workflow, transition to mid-stages`)

  // Load user session for transitions
  const baseUserHeaders = await tryLoadUserSessionHeaders(base, apiKey, branch)
  const authtoken = baseUserHeaders?.authtoken
  const userHeaders = authtoken ? userSessionHeaders(apiKey, authtoken, branch) : null
  let assignedTo = null
  if (userHeaders) {
    const u = (await getCurrentUser(base, baseUserHeaders)).body?.user
    if (u?.uid) {
      assignedTo = [{ uid: u.uid, name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email, email: u.email }]
    }
  }

  if (!userHeaders) {
    console.warn('  warning: no user session (set CONTENTSTACK_USER_EMAIL + CONTENTSTACK_USER_PASSWORD) — transitions skipped')
  }

  // Find Editorial Review workflow
  const wf = await findWorkflowByName(base, mgmt(branch), 'Editorial Review')
  if (!wf) {
    console.error('Workflow "Editorial Review" not found')
    writeStepReport({ planned: 0, actual: 0, failed: 1, kpis: {} })
    process.exit(1)
  }

  const { ok: wfOk, body: wfBody } = await import('./lib/cma.mjs').then(m =>
    m.getWorkflow(base, mgmt(branch), wf.uid),
  )
  if (!wfOk || !wfBody?.workflow) {
    console.error('Failed to fetch workflow details')
    writeStepReport({ planned: 0, actual: 0, failed: 1, kpis: {} })
    process.exit(1)
  }

  const workflow = wfBody.workflow
  const stages = workflow.workflow_stages || []
  if (stages.length < 2) {
    console.error('Workflow has fewer than 2 stages — cannot create stalls')
    writeStepReport({ planned: 0, actual: 0, failed: 1, kpis: {} })
    process.exit(1)
  }

  console.log(`  found workflow "${wf.name}" with ${stages.length} stages`)

  const kpis = { created: 0, transitioned: 0, stalledAtStage: {}, failed: 0 }
  const progress = createProgress({
    label: 'aged-stalls',
    total: entryCount * (stages.length - 1),
    everyN: 10,
  })

  const cts = workflow.content_types || []
  if (cts.length === 0) {
    console.error('Workflow has no content types')
    writeStepReport({ planned: 0, actual: 0, failed: 1, kpis: {} })
    process.exit(1)
  }

  const ctUid = cts[0]
  console.log(`\n→ using CT ${ctUid}`)

  // For each entry, transition it to a mid-stage (not first, not last)
  for (let i = 0; i < entryCount; i += 1) {
    const { ok, body: ebody } = await createEntry(base, mgmt(branch), ctUid, {
      title: `aged-stall ${Date.now().toString(36)}-${i}`,
      single_line: 'to be stalled in mid-stage',
    })

    if (!ok || !ebody?.entry) {
      kpis.failed += 1
      progress.tick({ ok: false })
      continue
    }

    const entry = ebody.entry
    kpis.created += 1

    // Transition to a mid-stage (index 1 to length-2)
    const targetIdx = Math.floor((stages.length - 1) / 2)
    const targetStage = stages[targetIdx]

    if (userHeaders && targetStage) {
      const { ok: tOk } = await transitionEntryWorkflow(base, userHeaders, {
        contentTypeUid: ctUid,
        entryUid: entry.uid,
        stageUid: targetStage.uid,
        locale,
        assignedTo,
        comment: 'auto: aged-stall',
      })

      if (tOk) {
        kpis.transitioned += 1
        kpis.stalledAtStage[targetStage.name] = (kpis.stalledAtStage[targetStage.name] || 0) + 1
      }
      progress.tick({ ok: tOk })
    } else {
      progress.tick({ ok: false })
    }

    if ((i + 1) % 5 === 0) await sleep(100)
  }

  progress.done()
  console.log(`\n✓ aged-stalls done`)
  console.log(`  created: ${kpis.created}, transitioned: ${kpis.transitioned}`)
  console.log(`  stalled at stages: ${JSON.stringify(kpis.stalledAtStage)}`)

  writeStepReport({
    planned: entryCount,
    actual: kpis.created,
    failed: kpis.failed,
    kpis,
  })
}

main().catch((err) => {
  console.error('aged-stalls failed:', err)
  process.exit(1)
})
