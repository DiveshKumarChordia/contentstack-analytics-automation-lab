#!/usr/bin/env node
/**
 * permanent-deletes.mjs — drive entries_deleted meter dimension by creating and
 * permanently deleting entries (not restore, not soft-delete).
 *
 * For each content type:
 *   1. Create N entries.
 *   2. Delete them permanently (entry DELETE, not unpublish).
 *   3. Record: created, deleted, retention snapshot is_deleted flag.
 *
 * This exercises the entries_deleted meter counter + the retention snapshot
 * state is_deleted flag, which marks entries as permanently removed from a
 * given content_type at a timestamp. The Analytics pipeline uses this for
 * deletion metering and aged-entry cleanup heuristics.
 *
 * Usage:
 *   node --env-file=.env scripts/permanent-deletes.mjs
 */

import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listContentTypes,
  createEntry,
  deleteEntry,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import { createProgress, runWithConcurrency } from './lib/progress.mjs'
import { writeStepReport } from './lib/report.mjs'

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v != null && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

async function main() {
  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmt = (br) => headersForToken(apiKey, tokens[0], br)

  const entryCount = intEnv('CONTENTSTACK_PERMANENT_DELETE_COUNT', 15)
  const concurrency = intEnv('CONTENTSTACK_PERMANENT_DELETE_CONCURRENCY', 5)

  console.log('permanent-deletes')
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  plan: ${entryCount} entries per CT (create then permanently delete)`)

  const { ok: ctOk, body: ctBody } = await listContentTypes(base, mgmt(branch))
  if (!ctOk || !ctBody?.content_types) {
    console.error('Failed to list content types')
    writeStepReport({ planned: 0, actual: 0, failed: 1, kpis: {} })
    process.exit(1)
  }

  const cts = ctBody.content_types.slice(0, 5)
  console.log(`  found ${ctBody.content_types.length} CTs, sampling ${cts.length}`)

  const kpis = { created: 0, deleted: 0, failed: 0 }
  const progress = createProgress({
    label: 'permanent-deletes',
    total: cts.length * entryCount,
    everyN: 10,
  })

  for (const ct of cts) {
    console.log(`\n→ ${ct.uid}`)
    const entries = []

    // PHASE 1: create entries
    for (let i = 0; i < entryCount; i += 1) {
      const { ok, body: ebody } = await createEntry(base, mgmt(branch), ct.uid, {
        title: `permanent-delete ${Date.now().toString(36)}-${i}`,
        single_line: 'to be deleted',
      })
      if (ok && ebody?.entry) {
        entries.push(ebody.entry)
        kpis.created += 1
      }
      progress.tick({ ok })
      if ((i + 1) % 5 === 0) await sleep(50)
    }

    console.log(`  created ${entries.length}/${entryCount}`)

    // PHASE 2: permanently delete in parallel
    await runWithConcurrency(
      entries,
      async (e) => {
        const { ok } = await deleteEntry(base, mgmt(branch), ct.uid, e.uid)
        if (ok) kpis.deleted += 1
        progress.tick({ ok })
      },
      { concurrency },
    )

    console.log(`  deleted ${kpis.deleted}/${entries.length}`)
    await sleep(500)
  }

  progress.done()
  console.log(`\n✓ permanent-deletes done`)
  console.log(`  created: ${kpis.created}, deleted: ${kpis.deleted}`)

  writeStepReport({
    planned: cts.length * entryCount,
    actual: kpis.created,
    failed: kpis.failed,
    kpis,
  })
}

main().catch((err) => {
  console.error('permanent-deletes failed:', err)
  process.exit(1)
})
