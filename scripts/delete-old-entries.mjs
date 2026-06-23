#!/usr/bin/env node
/**
 * delete-old-entries.mjs  —  tiered age-band retention
 *
 * Instead of "delete everything older than N days", each age band has a target
 * population and we delete the OLDEST excess beyond that target. This keeps the
 * stack at a stable, shaped size (so it stays under the org entry cap) while
 * still driving plenty of `entry_deleted` meter events for the dashboard.
 *
 * Bands (by `created_at` — immutable true age, not updated_at):
 *   age > 30 days        → keep newest 5 000   (CONTENTSTACK_RETAIN_OVER_30D)
 *   age 15–30 days       → keep newest 10 000  (CONTENTSTACK_RETAIN_15_30D)
 *   age 7–15 days        → keep newest 20 000  (CONTENTSTACK_RETAIN_7_15D)
 *   age < 7 days         → keep everything (the create step's fresh window)
 *
 * Caps are TOTALS across all scanned content types; each content type gets an
 * even share (cap / #contentTypes). Within a band we list ASC by created_at,
 * collect the oldest `count - cap` entries, and delete them concurrently.
 *
 * Token: stack-level CONTENTSTACK_MANAGEMENT_TOKEN — DELETE /v3/entries is in scope.
 *
 * Env knobs:
 *   CONTENTSTACK_RETAIN_OVER_30D        — keep target for age > 30d  (default 5000)
 *   CONTENTSTACK_RETAIN_15_30D          — keep target for 15–30d     (default 10000)
 *   CONTENTSTACK_RETAIN_7_15D           — keep target for 7–15d      (default 20000)
 *   CONTENTSTACK_RETAIN_DAYS_SHORT/_MID/_LONG — band boundaries (default 7/15/30)
 *   CONTENTSTACK_DELETE_CONCURRENCY     — parallel deletes           (default 10)
 *   CONTENTSTACK_DELETE_MAX_PER_RUN     — global safety cap, 0 = unlimited (default 0)
 *   CONTENTSTACK_DELETE_CONTENT_TYPES   — CSV; default = content-types manifest
 *
 * Usage:
 *   node --env-file=.env scripts/delete-old-entries.mjs
 *   node --env-file=.env scripts/delete-old-entries.mjs --dry-run
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listEntries,
  deleteEntry,
  optionalEnv,
} from './lib/cma.mjs'
import { createProgress } from './lib/progress.mjs'
import { writeStepReport } from './lib/report.mjs'
import { StructuredLogger } from './lib/structured-logger.mjs'
import { OperationMetrics } from './lib/operation-metrics.mjs'
import { CircuitBreakerManager } from './lib/circuit-breaker.mjs'
import { RetryableOperation } from './lib/retry-strategy.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const DAY_MS = 24 * 60 * 60 * 1000

function csv(name, fallback = []) {
  const v = optionalEnv(name)
  if (!v) return fallback
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  if (v != null && /^\d+$/.test(v.trim())) return Number.parseInt(v.trim(), 10)
  return dflt
}

function deriveContentTypesFromManifest() {
  try {
    const path = resolve(__dirname, 'content-types.manifest.json')
    const manifest = JSON.parse(readFileSync(path, 'utf-8'))
    return (manifest.contentTypes || []).map((ct) => ct.uid).filter(Boolean)
  } catch {
    return []
  }
}

/** Run `worker` over `items` with at most `concurrency` in flight. */
async function poolForEach(items, concurrency, worker) {
  let next = 0
  const lanes = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const i = next
        next += 1
        if (i >= items.length) break
        await worker(items[i])
      }
    },
  )
  await Promise.all(lanes)
}

/** created_at filter for a band (open-ended on either side via null). */
function bandQuery(band) {
  const created_at = {}
  if (band.gteMs != null) created_at.$gte = new Date(band.gteMs).toISOString()
  if (band.ltMs != null) created_at.$lt = new Date(band.ltMs).toISOString()
  return { created_at }
}

/** Trim one content type's band down to `perCtCap`, deleting the oldest excess. */
async function trimBand(base, headers, ctUid, locale, band, perCtCap, ctx, logger, metrics, cbManager) {
  const query = bandQuery(band)
  const bandLogger = new StructuredLogger(`trimBand:${ctUid}:${band.name}`, { requestId: logger.requestId })

  // 1. How many entries are in this band right now?
  const head = await listEntries(base, headers, ctUid, {
    locale,
    limit: 1,
    skip: 0,
    includeCount: true,
    query,
  })
  if (!head.ok) {
    console.warn(`  ${ctUid} [${band.name}]: count query failed — skipping band`)
    return { count: 0, deleted: 0 }
  }
  const count = head.body.count ?? 0
  if (count <= perCtCap) {
    console.log(`  ${ctUid} [${band.name}]: ${count} ≤ keep ${perCtCap} — nothing to trim`)
    return { count, deleted: 0 }
  }

  let excess = count - perCtCap
  if (ctx.maxPerRun > 0) {
    const remaining = ctx.maxPerRun - ctx.deletedTotal
    if (remaining <= 0) {
      console.warn(`  ${ctUid} [${band.name}]: per-run cap (${ctx.maxPerRun}) reached — deferring ${excess} to next run`)
      ctx.deferred += excess
      return { count, deleted: 0 }
    }
    if (excess > remaining) {
      ctx.deferred += excess - remaining
      excess = remaining
    }
  }

  // 2. Collect the oldest `excess` uids (ASC by created_at). Reads only — we
  //    collect before deleting so pagination is not disturbed by deletes.
  const uids = []
  let skip = 0
  while (uids.length < excess) {
    const page = await listEntries(base, headers, ctUid, {
      locale,
      limit: 100,
      skip,
      asc: 'created_at',
      query,
    })
    if (!page.ok) {
      console.warn(`  ${ctUid} [${band.name}]: list failed at skip=${skip} — deleting what we have`)
      break
    }
    const entries = page.body.entries || []
    if (entries.length === 0) break
    for (const e of entries) {
      uids.push(e.uid)
      if (uids.length >= excess) break
    }
    skip += entries.length
  }

  // 3. Delete them, concurrently with retries.
  console.log(`  ${ctUid} [${band.name}]: ${count} in band, keep ${perCtCap} → deleting ${uids.length} oldest`)
  const progress = createProgress({ label: `${ctUid} [${band.name}]`, total: uids.length, everyN: 50 })
  let deleted = 0
  await poolForEach(uids, ctx.concurrency, async (uid) => {
    if (DRY_RUN) {
      deleted += 1
      metrics.recordOperation('entry:delete', 'delete', 0, true)
      progress.tick({ ok: true })
      return
    }

    // Use RetryableOperation for smart retry with backoff
    const deleteOp = new RetryableOperation(
      `delete:${ctUid}:${uid}`,
      async () => {
        const start = Date.now()
        const { ok } = await cbManager.executeWithBreaker(
          'deleteEntry',
          async () => {
            return await deleteEntry(base, headers, {
              contentTypeUid: ctUid,
              entryUid: uid,
              locale,
            })
          },
          { failureThreshold: 10, timeout: 30000 },
        )
        return ok
      },
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        logger: bandLogger,
        metrics,
      },
    )

    try {
      const success = await deleteOp.execute()
      if (success.result) deleted += 1
      progress.tick({ ok: success.result })
    } catch (error) {
      bandLogger.error(`Failed to delete entry after retries`, error, { entryUid: uid })
      metrics.recordOperation('entry:delete', 'delete', 0, false, { entryUid: uid, error: error.message })
      progress.tick({ ok: false })
    }
  })
  progress.done()
  ctx.deletedTotal += deleted
  return { count, deleted }
}

async function main() {
  const logger = new StructuredLogger('delete-old-entries')
  const metrics = new OperationMetrics()
  const cbManager = new CircuitBreakerManager({ logger, metrics })

  const { apiKey, base, branch, locale } = loadStackAuth()
  const tokens = loadManagementTokens()
  const headers = headersForToken(apiKey, tokens[0], branch)

  logger.info('Script started', {
    apiKey: apiKey.slice(0, 10) + '…',
    branch: branch || '(none)',
    dryRun: DRY_RUN,
  })

  const contentTypes = csv(
    'CONTENTSTACK_DELETE_CONTENT_TYPES',
    deriveContentTypesFromManifest(),
  )
  if (contentTypes.length === 0) {
    console.error('No content types to scan. Set CONTENTSTACK_DELETE_CONTENT_TYPES or include a content-types manifest.')
    process.exit(1)
  }

  const dShort = intEnv('CONTENTSTACK_RETAIN_DAYS_SHORT', 7)
  const dMid = intEnv('CONTENTSTACK_RETAIN_DAYS_MID', 15)
  const dLong = intEnv('CONTENTSTACK_RETAIN_DAYS_LONG', 30)
  const capLong = intEnv('CONTENTSTACK_RETAIN_OVER_30D', 5000)
  const capMid = intEnv('CONTENTSTACK_RETAIN_15_30D', 10000)
  const capShort = intEnv('CONTENTSTACK_RETAIN_7_15D', 20000)

  const now = Date.now()
  // Newest band first does not matter; older-first is clearer in logs.
  const bands = [
    { name: `>${dLong}d`, gteMs: null, ltMs: now - dLong * DAY_MS, cap: capLong },
    { name: `${dMid}-${dLong}d`, gteMs: now - dLong * DAY_MS, ltMs: now - dMid * DAY_MS, cap: capMid },
    { name: `${dShort}-${dMid}d`, gteMs: now - dMid * DAY_MS, ltMs: now - dShort * DAY_MS, cap: capShort },
  ]

  const ctx = {
    concurrency: intEnv('CONTENTSTACK_DELETE_CONCURRENCY', 5),
    // Bound per-run work so a large backlog drains over several cron runs instead
    // of one multi-hour job that overruns the 5-min schedule. Set 0 = unlimited.
    maxPerRun: intEnv('CONTENTSTACK_DELETE_MAX_PER_RUN', 6000),
    deletedTotal: 0,
    deferred: 0,
  }

  console.log('delete-old-entries — tiered retention')
  console.log(`  stack:   api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  scope:   ${contentTypes.join(', ')}  (caps split evenly per CT)`)
  for (const b of bands) {
    console.log(`  band:    ${b.name} → keep ${b.cap} total (~${Math.ceil(b.cap / contentTypes.length)}/CT)`)
  }
  console.log(`  delete:  concurrency=${ctx.concurrency}  max-per-run=${ctx.maxPerRun || 'unlimited'}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  // SNAPSHOT: Entry counts BEFORE tiered retention
  console.log('\n→ Capturing entry counts (BEFORE deletion)…')
  const entryCountBefore = {}
  for (const ct of contentTypes) {
    const { ok, body } = await listEntries(base, headers, ct, { includeCount: true })
    entryCountBefore[ct] = ok ? (body?.entries_count || 0) : 0
  }
  const totalBefore = Object.values(entryCountBefore).reduce((a, b) => a + b, 0)
  console.log(`  Total entries before: ${totalBefore}`)

  // Per-band running totals for the dashboard.
  const perBand = {}
  for (const b of bands) perBand[b.name] = { inBand: 0, deleted: 0 }

  for (const ctUid of contentTypes) {
    for (const band of bands) {
      const perCtCap = Math.ceil(band.cap / contentTypes.length)
      const { count, deleted } = await trimBand(base, headers, ctUid, locale, band, perCtCap, ctx, logger, metrics, cbManager)
      perBand[band.name].inBand += count
      perBand[band.name].deleted += deleted
    }
  }

  // SNAPSHOT: Entry counts AFTER tiered retention
  console.log('\n→ Capturing entry counts (AFTER deletion)…')
  const entryCountAfter = {}
  for (const ct of contentTypes) {
    const { ok, body } = await listEntries(base, headers, ct, { includeCount: true })
    entryCountAfter[ct] = ok ? (body?.entries_count || 0) : 0
  }
  const totalAfter = Object.values(entryCountAfter).reduce((a, b) => a + b, 0)
  console.log(`  Total entries after: ${totalAfter}`)
  console.log(`  Net change: ${totalAfter - totalBefore} entries`)

  const totalDeleted = ctx.deletedTotal
  console.log(`\n✓ done — ${totalDeleted} deleted across ${contentTypes.length} content type(s)`)
  for (const b of bands) {
    console.log(`    ${b.name}: ${perBand[b.name].deleted} deleted (band size ${perBand[b.name].inBand})`)
  }
  if (ctx.deferred > 0) {
    console.log(`    (deferred ${ctx.deferred} to next run — per-run cap)`) // not silent: surfaced
  }

  const metricsSummary = metrics.getSummary()
  const cbStatus = cbManager.getAllStatuses()

  logger.info('Script completed successfully', {
    totalDeleted,
    metricsSummary: {
      operationCount: metricsSummary.operations.count,
      operationSuccess: metricsSummary.operations.success,
      operationFailure: metricsSummary.operations.failed,
    },
    circuitBreakerStatus: cbStatus,
  })

  writeStepReport({
    planned: totalDeleted + ctx.deferred, // what we intended to remove this run
    actual: totalDeleted,
    entryCountBefore,  // snapshot before tiered retention
    entryCountAfter,   // snapshot after tiered retention
    logTrail: logger.getLogTrail().slice(0, 5000), // Last 5000 chars of logs
    kpis: {
      deleted: totalDeleted,
      deferred: ctx.deferred,
      deletedOver30d: perBand[bands[0].name].deleted,
      deleted15to30d: perBand[bands[1].name].deleted,
      deleted7to15d: perBand[bands[2].name].deleted,
      totalBefore,
      totalAfter,
      operationMetrics: {
        totalOperations: metricsSummary.operations.count,
        successRate: metricsSummary.operations.successRate,
        avgDurationMs: metricsSummary.operations.avgMs,
      },
    },
  })
}

main().catch((err) => {
  const logger = new StructuredLogger('delete-old-entries')
  logger.error('Script failed', err, { fatal: true })
  process.exit(1)
})
