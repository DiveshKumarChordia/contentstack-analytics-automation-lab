#!/usr/bin/env node
/**
 * edit-after-publish.mjs — drive entries_in_progress meter dimension.
 *
 * For each content type in the manifest:
 *   1. Create entries + publish them to an environment.
 *   2. Edit each entry after publish (save without re-publishing).
 *   3. Record: created, published, in-progress (edited post-publish).
 *
 * This exercises the entries_in_progress meter, which counts entries that have
 * been published but have unsaved edits. The Analytics metering pipeline emits
 * entry.status_change events when an entry moves from published → in_progress.
 *
 * Usage:
 *   node --env-file=.env scripts/edit-after-publish.mjs
 */

import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listContentTypes,
  createEntry,
  publishEntry,
  updateEntry,
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
  const { apiKey, base, branch, locale, publishEnv } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmt = (br) => headersForToken(apiKey, tokens[0], br)

  const entryCount = intEnv('CONTENTSTACK_EDIT_AFTER_PUBLISH_COUNT', 10)
  const concurrency = intEnv('CONTENTSTACK_EDIT_AFTER_PUBLISH_CONCURRENCY', 5)

  console.log('edit-after-publish')
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}  env=${publishEnv}`)
  console.log(`  plan: ${entryCount} entries per CT (publish then edit in-place)`)

  const { ok: ctOk, body: ctBody } = await listContentTypes(base, mgmt(branch))
  if (!ctOk || !ctBody?.content_types) {
    console.error('Failed to list content types')
    writeStepReport({ planned: 0, actual: 0, failed: 1, kpis: {} })
    process.exit(1)
  }

  const cts = ctBody.content_types.slice(0, 5) // limit to first 5 CTs
  console.log(`  found ${ctBody.content_types.length} CTs, sampling ${cts.length}`)

  const kpis = { created: 0, published: 0, editedPostPublish: 0, failed: 0 }
  const progress = createProgress({
    label: 'edit-after-publish',
    total: cts.length * entryCount,
    everyN: 10,
  })

  for (const ct of cts) {
    console.log(`\n→ ${ct.uid}`)
    const entries = []

    // PHASE 1: create entries
    for (let i = 0; i < entryCount; i += 1) {
      const { ok, body: ebody } = await createEntry(base, mgmt(branch), ct.uid, {
        title: `edit-after-publish ${Date.now().toString(36)}-${i}`,
        single_line: 'test entry',
      })
      if (ok && ebody?.entry) {
        entries.push(ebody.entry)
        kpis.created += 1
      }
      progress.tick({ ok })
      if ((i + 1) % 5 === 0) await sleep(100)
    }

    console.log(`  created ${entries.length}/${entryCount}`)

    // PHASE 2: publish all
    const toEdit = []
    for (const e of entries) {
      const { ok } = await publishEntry(base, mgmt(branch), ct.uid, e.uid, locale, publishEnv)
      if (ok) {
        kpis.published += 1
        toEdit.push(e)
      }
      progress.tick({ ok })
      await sleep(50)
    }

    console.log(`  published ${toEdit.length}/${entries.length}`)

    // PHASE 3: edit post-publish (in parallel)
    await runWithConcurrency(
      toEdit,
      async (e) => {
        const { ok } = await updateEntry(base, mgmt(branch), ct.uid, e.uid, {
          title: `${e.title} [edited post-publish]`,
          single_line: 'edited without re-publish',
        })
        if (ok) kpis.editedPostPublish += 1
        progress.tick({ ok })
      },
      { concurrency },
    )

    await sleep(500)
  }

  progress.done()
  console.log(`\n✓ edit-after-publish done`)
  console.log(`  created: ${kpis.created}, published: ${kpis.published}, edited in-progress: ${kpis.editedPostPublish}`)

  writeStepReport({
    planned: cts.length * entryCount,
    actual: kpis.created,
    failed: kpis.failed,
    kpis,
  })
}

main().catch((err) => {
  console.error('edit-after-publish failed:', err)
  process.exit(1)
})
