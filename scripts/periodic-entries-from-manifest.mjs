/**
 * Create entries in bulk (no content types). For cron / GitHub Actions every N minutes.
 *
 * Volume:
 *   - CONTENTSTACK_PERIODIC_COUNT — if set, every enabled content type creates
 *     exactly this many (legacy per-CT behavior).
 *   - otherwise CONTENTSTACK_PERIODIC_TOTAL (default 10000) is the total per run,
 *     split evenly across the content types whose manifest entry has
 *     periodic.enabled. A manifest `periodic.count` always overrides for that CT.
 *
 * Throughput: CONTENTSTACK_PERIODIC_CONCURRENCY (default 12) creates run in
 *   parallel. Entries are created (not published) here — the separate
 *   bulk-publish step publishes a sample, which keeps the per-run API load to
 *   one call per entry instead of two.
 *
 * The org entry cap (error_code 133) is org-wide, so the first time we hit it we
 * stop creating for the rest of the run (non-fatal — downstream steps still run).
 *
 * Run: npm run automate:entries:periodic
 */

import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  loadStackAuth,
  managementHeaders,
  createEntry,
  getLatestEntryUid,
  getFirstEntryUid,
  optionalEnv,
} from './lib/cma.mjs'
import {
  EntryUidRegistry,
  resolveEntryPlaceholdersAsync,
  deepClone,
} from './lib/entry-placeholders.mjs'
import { writeStepReport } from './lib/report.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_TOTAL = 10000
const DEFAULT_CONCURRENCY = 12

async function loadManifest(manifestPath) {
  const raw = await readFile(manifestPath, 'utf8')
  const data = JSON.parse(raw)
  if (!data.contentTypes || !Array.isArray(data.contentTypes)) {
    throw new Error('Manifest must contain a contentTypes array')
  }
  return data
}

function uniqueTitle() {
  const iso = new Date().toISOString().replace(/[:.]/g, '-')
  const rnd = randomBytes(4).toString('hex')
  return `auto ${iso} ${rnd}`
}

function intEnv(name) {
  const v = optionalEnv(name)
  if (v && /^\d+$/.test(v)) return Number.parseInt(v, 10)
  return null
}

/**
 * Run `total` tasks with at most `concurrency` in flight. `worker(index)` is
 * awaited for each; it may inspect shared state to bail out early (org cap).
 */
async function runPool(total, concurrency, worker) {
  let next = 0
  const lanes = Array.from(
    { length: Math.max(1, Math.min(concurrency, total)) },
    async () => {
      for (;;) {
        const i = next
        next += 1
        if (i >= total) break
        await worker(i)
      }
    },
  )
  await Promise.all(lanes)
}

async function main() {
  const { apiKey, token, base, branch, locale, publishEnv } = loadStackAuth()
  const headers = managementHeaders(apiKey, token, branch)

  const manifestRelative =
    process.env.CONTENTSTACK_MANIFEST_PATH ||
    path.join(__dirname, 'content-types.manifest.json')
  const manifestPath = path.isAbsolute(manifestRelative)
    ? manifestRelative
    : path.resolve(process.cwd(), manifestRelative)

  console.log('Periodic entries — manifest:', manifestPath)
  const manifest = await loadManifest(manifestPath)

  // Resolve the set of content types we will create for, plus their templates.
  const enabled = []
  for (const ct of manifest.contentTypes) {
    const p = ct.periodic
    if (!p || !p.enabled) continue
    const template =
      p.entryTemplate ??
      (Array.isArray(ct.entries) && ct.entries.length > 0
        ? ct.entries[ct.entries.length - 1]
        : null)
    if (!template) {
      console.warn(
        `Skipping periodic for ${ct.uid}: set periodic.entryTemplate or seed entries[]`,
      )
      continue
    }
    enabled.push({ uid: ct.uid, count: p.count, template })
  }

  if (enabled.length === 0) {
    console.log(
      'No content types with periodic.enabled; set periodic in the manifest or use automate:manifest for bootstrap.',
    )
    writeStepReport({ planned: 0, actual: 0, kpis: { created: 0 } })
    return
  }

  // Decide per-CT counts.
  const perCtEnv = intEnv('CONTENTSTACK_PERIODIC_COUNT')
  const total = intEnv('CONTENTSTACK_PERIODIC_TOTAL') ?? DEFAULT_TOTAL
  const evenSplit = Math.ceil(total / enabled.length)
  const concurrency = intEnv('CONTENTSTACK_PERIODIC_CONCURRENCY') ?? DEFAULT_CONCURRENCY

  function countFor(ct) {
    if (typeof ct.count === 'number') return ct.count // explicit manifest override
    if (perCtEnv != null) return perCtEnv // legacy per-CT env
    return evenSplit
  }

  console.log(
    `Plan: ${enabled.length} content type(s), ${
      perCtEnv != null ? `${perCtEnv}/CT (legacy)` : `${total} total → ~${evenSplit}/CT`
    }, concurrency ${concurrency}.`,
  )

  const registry = new EntryUidRegistry()

  async function fetchRef(ctUid, which) {
    if (which === 'latest') {
      return getLatestEntryUid(base, headers, ctUid, locale, publishEnv)
    }
    return getFirstEntryUid(base, headers, ctUid, locale, publishEnv)
  }

  let created = 0
  let planned = 0
  let failed = 0
  let capHit = false

  // SNAPSHOT: Entry counts BEFORE creation
  console.log('\n→ Capturing entry counts (BEFORE creation)…')
  const entryCountBefore = {}
  for (const ct of enabled) {
    const { ok, body } = await listEntries(base, headers, ct.uid, { includeCount: true })
    entryCountBefore[ct.uid] = ok ? (body?.entries_count || 0) : 0
  }
  const totalBefore = Object.values(entryCountBefore).reduce((a, b) => a + b, 0)
  console.log(`  Total entries before: ${totalBefore}`)

  // Content types are processed in order (so reference targets exist before the
  // types that reference them); creation within a content type runs concurrently.
  for (const ct of enabled) {
    if (capHit) break
    const count = countFor(ct)
    planned += count
    let stopped = false

    await runPool(count, concurrency, async () => {
      if (stopped) return
      const merged = deepClone(ct.template)
      merged.title = uniqueTitle()

      let fields
      try {
        fields = await resolveEntryPlaceholdersAsync(merged, registry, fetchRef)
      } catch (e) {
        failed += 1
        if (failed <= 10) console.error(`Placeholder resolve failed for ${ct.uid}:`, e.message)
        return
      }

      const result = await createEntry(base, headers, ct.uid, fields, locale)
      if (!result.ok) {
        // Org-level entry cap (error_code 133) is org-wide: once hit, every
        // further create fails too, so stop the whole run (non-fatal).
        if (result.status === 422 && result.body?.error_code === 133) {
          if (!capHit) {
            console.warn(
              `Org entry cap reached (code 133) — stopping creation for this run.`,
            )
          }
          stopped = true
          capHit = true
          return
        }
        failed += 1
        if (failed <= 10) {
          console.error(
            `Create failed for ${ct.uid}:`,
            result.status,
            result.body?.error_message || result.body,
          )
        }
        return
      }

      const uid = result.body?.entry?.uid
      if (uid) registry.record(ct.uid, uid)
      created += 1
      if (created % 500 === 0) console.log(`...created ${created}`)
    })
  }

  // SNAPSHOT: Entry counts AFTER creation
  console.log('\n→ Capturing entry counts (AFTER creation)…')
  const entryCountAfter = {}
  for (const ct of enabled) {
    const { ok, body } = await listEntries(base, headers, ct.uid, { includeCount: true })
    entryCountAfter[ct.uid] = ok ? (body?.entries_count || 0) : 0
  }
  const totalAfter = Object.values(entryCountAfter).reduce((a, b) => a + b, 0)
  console.log(`  Total entries after: ${totalAfter}`)
  console.log(`  Net created: ${totalAfter - totalBefore} entries`)

  console.log(
    `Periodic run complete — created ${created}/${planned}` +
      (failed ? `, ${failed} failed` : '') +
      (capHit ? ' (org entry cap reached)' : '') +
      '.',
  )

  writeStepReport({
    planned,
    actual: created,
    failed,
    entryCountBefore,  // NEW: snapshot before creation
    entryCountAfter,   // NEW: snapshot after creation
    kpis: {
      created,
      failed,
      capHit: capHit ? 1 : 0,
      totalBefore,
      totalAfter,
    },
  })

  // Only treat the run as failed if nothing at all was created despite trying
  // and it was not simply the org cap (transient/auth problem worth surfacing).
  if (created === 0 && planned > 0 && !capHit) {
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
