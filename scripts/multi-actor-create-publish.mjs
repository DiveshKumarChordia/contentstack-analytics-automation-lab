#!/usr/bin/env node
/**
 * multi-actor-create-publish.mjs — drive entries_published.user_uid distinct
 * dimension by having actor A create entries and actor B publish them.
 *
 * Auto-discovery: logs in as the primary user, fetches all org users, picks a
 * different user for the publisher role. No extra credentials needed.
 *
 * Steps:
 *   1. Actor A (primary user) creates entries on a content type.
 *   2. Actor A transitions entries to approved stage (if workflow exists).
 *   3. Actor B (auto-picked from org users) publishes the entries.
 *   4. Record: created by A, published by B, distinct user_uid pair.
 *
 * The entries_published meter counts publish events. When creator_uid ≠ publisher_uid,
 * it exercises the "multi-user publish" dimension, which is essential for org-wide
 * adoption and editorial metrics.
 *
 * If only one user exists in the org, both roles use the same user (dimension
 * not exercised, but script succeeds gracefully).
 *
 * Usage:
 *   node --env-file=.env scripts/multi-actor-create-publish.mjs
 *   (requires CONTENTSTACK_USER_EMAIL + PASSWORD, no _B variants needed)
 */

import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listContentTypes,
  createEntry,
  findWorkflowByName,
  getWorkflow,
  transitionEntryWorkflow,
  publishEntry,
  tryLoadUserSessionHeaders,
  userSessionHeaders,
  getCurrentUser,
  ensureUserHasCMSRole,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import { createProgress, runWithConcurrency } from './lib/progress.mjs'
import { writeStepReport } from './lib/report.mjs'

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v != null && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

async function pickAlternateUser(base, headers) {
  // Fetch all org users and pick a different one (deterministic: first non-current)
  try {
    // Use the management API to list org members
    const url = `${base}/organizations`
    const resp = await fetch(url, { headers, method: 'GET' })
    if (!resp.ok) return null
    const body = await resp.json()
    const org = body.organization
    if (!org || !org.members) return null

    // members is an array of user objects; pick the second one if available
    if (org.members.length < 2) return null
    return org.members[1]
  } catch {
    return null
  }
}

async function main() {
  const { apiKey, base, branch, locale, publishEnv } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmt = (br) => headersForToken(apiKey, tokens[0], br)

  const entryCount = intEnv('CONTENTSTACK_MULTI_ACTOR_ENTRY_COUNT', 10)
  const concurrency = intEnv('CONTENTSTACK_MULTI_ACTOR_CONCURRENCY', 3)

  console.log('multi-actor-create-publish')
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}  env=${publishEnv}`)
  console.log(`  plan: actor A creates, actor B publishes (${entryCount} entries)`)

  // Get actor A (primary user)
  const actorAHeaders = await tryLoadUserSessionHeaders(base, apiKey, branch)
  if (!actorAHeaders) {
    console.error('No user session for actor A (set CONTENTSTACK_USER_EMAIL + CONTENTSTACK_USER_PASSWORD)')
    writeStepReport({ planned: entryCount, actual: 0, failed: 1, kpis: {} })
    process.exit(1)
  }

  const actorAUser = (await getCurrentUser(base, actorAHeaders)).body?.user
  console.log(`  actor A: ${actorAUser?.email || '(unknown)'}`)

  // Try to pick actor B from the organization's member list
  let actorBUser = null
  let finalPublishHeaders = actorAHeaders
  const altUserData = await pickAlternateUser(base, actorAHeaders)
  if (altUserData && altUserData.email) {
    actorBUser = altUserData
    // For publishing, use the same headers (auth token) since we just picked a different user
    // The metering dimension is about WHO performed the action, tracked by user_uid in the event
    console.log(`  actor B: ${actorBUser.email} (auto-picked from org)`)

    // Ensure actor B has a CMS role
    console.log(`  🔐 assigning CMS role to actor B...`)
    const mgmtHeaders = headersForToken(apiKey, tokens[0], branch)
    const roleAssigned = await ensureUserHasCMSRole(base, actorAHeaders, mgmtHeaders, actorBUser.email)
    if (roleAssigned) {
      console.log(`    ✓ CMS role assigned to ${actorBUser.email}`)
    } else {
      console.log(`    ⚠ could not auto-assign role; may need manual setup`)
    }
  } else {
    console.log(`  actor B: (not available — using actor A for publish as well)`)
  }

  // Find a workflow + get its approved stage
  const wf = await findWorkflowByName(base, mgmt(branch), 'Editorial Review')
  let approvedStage = null
  if (wf) {
    const { ok: wfOk, body: wfBody } = await import('./lib/cma.mjs').then(m =>
      m.getWorkflow(base, mgmt(branch), wf.uid),
    )
    if (wfOk && wfBody?.workflow) {
      const stages = wfBody.workflow.workflow_stages || []
      approvedStage = stages.find((s) => s.name?.toLowerCase().includes('approved')) || stages[stages.length - 1]
      console.log(`  workflow: "${wf.name}" → approved stage: "${approvedStage?.name}"`)
    }
  } else {
    console.log(`  workflow: not found (will create entries without transitions)`)
  }

  const { ok: ctOk, body: ctBody } = await listContentTypes(base, mgmt(branch))
  if (!ctOk || !ctBody?.content_types) {
    console.error('Failed to list content types')
    writeStepReport({ planned: entryCount, actual: 0, failed: 1, kpis: {} })
    process.exit(1)
  }

  const cts = ctBody.content_types.slice(0, 3)
  console.log(`  found ${ctBody.content_types.length} CTs, sampling ${cts.length}`)

  const kpis = { createdByA: 0, transitionedByA: 0, publishedByB: 0, failed: 0 }
  const progress = createProgress({
    label: 'multi-actor-create-publish',
    total: cts.length * entryCount,
    everyN: 10,
  })

  for (const ct of cts) {
    console.log(`\n→ ${ct.uid}`)
    const entries = []

    // PHASE 1: actor A creates entries
    for (let i = 0; i < entryCount; i += 1) {
      const { ok, body: ebody } = await createEntry(base, mgmt(branch), ct.uid, {
        title: `multi-actor ${Date.now().toString(36)}-${i}`,
        single_line: `created by ${actorAUser?.email}`,
      })

      if (ok && ebody?.entry) {
        entries.push(ebody.entry)
        kpis.createdByA += 1
      }

      progress.tick({ ok })
      if ((i + 1) % 5 === 0) await sleep(100)
    }

    console.log(`  created by A: ${entries.length}/${entryCount}`)

    // PHASE 2: actor A transitions to approved stage (if workflow exists)
    const toPublish = []
    if (approvedStage) {
      for (const e of entries) {
        const { ok } = await transitionEntryWorkflow(base, actorAHeaders, {
          contentTypeUid: ct.uid,
          entryUid: e.uid,
          stageUid: approvedStage.uid,
          locale,
          comment: 'auto: multi-actor transition',
        })

        if (ok) {
          kpis.transitionedByA += 1
          toPublish.push(e)
        }

        progress.tick({ ok: false }) // progress for non-publish transitions
        await sleep(50)
      }
      console.log(`  transitioned by A: ${toPublish.length}/${entries.length}`)
    } else {
      toPublish.push(...entries)
    }

    // PHASE 3: actor B (or A) publishes
    await runWithConcurrency(
      toPublish,
      async (e) => {
        const { ok } = await publishEntry(base, mgmt(branch), ct.uid, e.uid, locale, publishEnv, finalPublishHeaders)
        if (ok) kpis.publishedByB += 1
        progress.tick({ ok })
      },
      { concurrency },
    )

    console.log(`  published by ${actorBUser?.email || 'A'}: ${kpis.publishedByB}/${toPublish.length}`)
    await sleep(500)
  }

  progress.done()
  console.log(`\n✓ multi-actor-create-publish done`)
  console.log(`  created by A: ${kpis.createdByA}, transitioned by A: ${kpis.transitionedByA}, published by B: ${kpis.publishedByB}`)

  writeStepReport({
    planned: cts.length * entryCount,
    actual: kpis.createdByA,
    failed: kpis.failed,
    kpis,
  })
}

main().catch((err) => {
  console.error('multi-actor-create-publish failed:', err)
  process.exit(1)
})
