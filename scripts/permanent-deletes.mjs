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
  listEntries,
  createEntry,
  deleteEntry,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import { createProgress, runWithConcurrency } from './lib/progress.mjs'
import { writeStepReport } from './lib/report.mjs'
import { StructuredLogger } from './lib/structured-logger.mjs'
import { OperationMetrics } from './lib/operation-metrics.mjs'
import { CircuitBreakerManager } from './lib/circuit-breaker.mjs'
import { RetryableOperation } from './lib/retry-strategy.mjs'

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v != null && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

async function main() {
  const logger = new StructuredLogger('permanent-deletes')
  const metrics = new OperationMetrics()
  const cbManager = new CircuitBreakerManager({ logger, metrics })

  logger.info('Script started', {
    apiKey: process.env.CONTENTSTACK_API_KEY?.slice(0, 10) + '…',
  })

  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmt = (br) => headersForToken(apiKey, tokens[0], br)

  const entryCount = intEnv('CONTENTSTACK_PERMANENT_DELETE_COUNT', 15)
  const concurrency = intEnv('CONTENTSTACK_PERMANENT_DELETE_CONCURRENCY', 3)

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

  // SNAPSHOT: Entry counts BEFORE create/delete cycle
  console.log(`\n→ Capturing entry counts (BEFORE create/delete)…`)
  const entryCountBefore = {}
  for (const ct of cts) {
    const { ok, body } = await listEntries(base, mgmt(branch), ct.uid, { includeCount: true })
    entryCountBefore[ct.uid] = ok ? (body?.entries_count || 0) : 0
  }
  const totalBefore = Object.values(entryCountBefore).reduce((a, b) => a + b, 0)
  console.log(`  Total entries before: ${totalBefore}`)

  for (const ct of cts) {
    console.log(`\n→ ${ct.uid}`)
    const entries = []

    // PHASE 1: create entries
    for (let i = 0; i < entryCount; i += 1) {
      const createOp = new RetryableOperation(
        `create:${ct.uid}:${i}`,
        async () => {
          const result = await cbManager.executeWithBreaker(
            'createEntry',
            async () => {
              return await createEntry(base, mgmt(branch), ct.uid, {
                title: `permanent-delete ${Date.now().toString(36)}-${i}`,
                single_line: 'to be deleted',
              })
            },
            { failureThreshold: 10, timeout: 30000 },
          )
          return result
        },
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 5000,
          logger,
          metrics,
        },
      )

      try {
        const result = await createOp.execute()
        const { ok, body: ebody } = result.result
        if (ok && ebody?.entry) {
          entries.push(ebody.entry)
          kpis.created += 1
          metrics.recordOperation('entry:create', 'create', 0, true)
        } else {
          metrics.recordOperation('entry:create', 'create', 0, false)
        }
        progress.tick({ ok })
      } catch (error) {
        logger.warn(`Failed to create entry`, { error: error.message })
        metrics.recordOperation('entry:create', 'create', 0, false, { error: error.message })
        progress.tick({ ok: false })
      }

      if ((i + 1) % 5 === 0) await sleep(50)
    }

    console.log(`  created ${entries.length}/${entryCount}`)

    // PHASE 2: permanently delete in parallel with retries
    await runWithConcurrency(
      entries,
      async (e) => {
        const deleteOp = new RetryableOperation(
          `delete:${ct.uid}:${e.uid}`,
          async () => {
            const result = await cbManager.executeWithBreaker(
              'deleteEntry',
              async () => {
                return await deleteEntry(base, mgmt(branch), {
                  contentTypeUid: ct.uid,
                  entryUid: e.uid,
                })
              },
              { failureThreshold: 10, timeout: 30000 },
            )
            return result
          },
          {
            maxAttempts: 3,
            baseDelay: 1000,
            maxDelay: 5000,
            logger,
            metrics,
          },
        )

        try {
          const success = await deleteOp.execute()
          if (success.result.ok) {
            kpis.deleted += 1
            metrics.recordOperation('entry:delete', 'delete', 0, true)
          }
          progress.tick({ ok: success.result.ok })
        } catch (error) {
          logger.error(`Failed to delete entry after retries`, error, { contentTypeUid: ct.uid, entryUid: e.uid })
          metrics.recordOperation('entry:delete', 'delete', 0, false, { error: error.message })
          progress.tick({ ok: false })
        }
      },
      { concurrency },
    )

    console.log(`  deleted ${kpis.deleted}/${entries.length}`)
    await sleep(500)
  }

  // SNAPSHOT: Entry counts AFTER create/delete cycle
  console.log(`\n→ Capturing entry counts (AFTER create/delete)…`)
  const entryCountAfter = {}
  for (const ct of cts) {
    const { ok, body } = await listEntries(base, mgmt(branch), ct.uid, { includeCount: true })
    entryCountAfter[ct.uid] = ok ? (body?.entries_count || 0) : 0
  }
  const totalAfter = Object.values(entryCountAfter).reduce((a, b) => a + b, 0)
  console.log(`  Total entries after: ${totalAfter}`)
  console.log(`  Net change: ${totalAfter - totalBefore} entries (should be ~0 since we create then delete)`)

  progress.done()
  console.log(`\n✓ permanent-deletes done`)
  console.log(`  created: ${kpis.created}, deleted: ${kpis.deleted}`)

  const metricsSummary = metrics.getSummary()
  const cbStatus = cbManager.getAllStatuses()

  logger.info('Script completed successfully', {
    created: kpis.created,
    deleted: kpis.deleted,
    failed: kpis.failed,
    metricsSummary: {
      operationCount: metricsSummary.operations.count,
      operationSuccess: metricsSummary.operations.success,
      operationFailure: metricsSummary.operations.failed,
    },
    circuitBreakerStatus: cbStatus,
  })

  writeStepReport({
    planned: cts.length * entryCount,
    actual: kpis.created,
    failed: kpis.failed,
    entryCountBefore,
    entryCountAfter,
    logTrail: logger.getLogTrail().slice(0, 5000),
    kpis: {
      ...kpis,
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
  const logger = new StructuredLogger('permanent-deletes')
  logger.error('Script failed', err, { fatal: true })
  console.error('permanent-deletes failed:', err)
  process.exit(1)
})
