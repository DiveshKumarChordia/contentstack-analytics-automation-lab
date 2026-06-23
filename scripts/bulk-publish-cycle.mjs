#!/usr/bin/env node
/**
 * bulk-publish-cycle.mjs
 *
 * Picks N random entries across the configured content types and:
 *   1. Bulk-publishes a sample to the configured environment(s) and locale(s)
 *   2. (Optionally) bulk-unpublishes a smaller subset
 *
 * Why: drives `entry_published` and `entry_unpublished` meter events that
 * power the Content Lifecycle dashboard's "Created vs Published" chart and
 * Publish Completion Rate KPI. Without periodic bulk activity these meters
 * stay flat regardless of how many entries exist.
 *
 * Token: stack-level CONTENTSTACK_MANAGEMENT_TOKEN.
 *
 * Env knobs:
 *   CONTENTSTACK_BULK_PUBLISH_CONTENT_TYPES  — CSV; default = derived from
 *                                              content-types manifest
 *   CONTENTSTACK_BULK_PUBLISH_SAMPLE         — entries to publish per run (def 10)
 *   CONTENTSTACK_BULK_UNPUBLISH_SAMPLE       — entries to unpublish per run (def 2)
 *   CONTENTSTACK_BULK_PUBLISH_LOCALES        — CSV; default = [CONTENTSTACK_LOCALE]
 *   CONTENTSTACK_BULK_PUBLISH_ENVIRONMENTS   — CSV; default = [CONTENTSTACK_PUBLISH_ENVIRONMENT]
 *
 * Usage:
 *   node --env-file=.env scripts/bulk-publish-cycle.mjs
 *   node --env-file=.env scripts/bulk-publish-cycle.mjs --dry-run
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listEntries,
  bulkPublish,
  bulkUnpublish,
  listWorkflows,
  transitionEntryWorkflow,
  tryLoadUserSessionHeaders,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import { writeStepReport } from './lib/report.mjs'
import { StructuredLogger } from './lib/structured-logger.mjs'
import { OperationMetrics } from './lib/operation-metrics.mjs'
import { CircuitBreakerManager } from './lib/circuit-breaker.mjs'
import { RetryableOperation } from './lib/retry-strategy.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')

function csv(name, fallback = []) {
  const v = optionalEnv(name)
  if (!v) return fallback
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Lightweight LCG so a single run produces deterministic-ish sampling without
// being identical across runs (re-uses Date.now to vary across invocations).
function makeRng() {
  let s = (Date.now() ^ 0x9e3779b9) >>> 0
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
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

// When run inside drive-all, the periodic step writes its created-entry count to
// RUN_REPORT_DIR. We publish/unpublish a RATIO of that, so activity scales with
// creation volume instead of a fixed sample. Returns null on a standalone run.
function readCreatedThisRun() {
  const dir = process.env.RUN_REPORT_DIR
  if (!dir) return null
  try {
    const r = JSON.parse(readFileSync(resolve(dir, 'periodic-entries-from-manifest.json'), 'utf-8'))
    const c = Number(r?.kpis?.created)
    return Number.isFinite(c) ? c : null
  } catch {
    return null
  }
}

function ratioEnv(name, dflt) {
  const v = optionalEnv(name)
  const n = v == null ? NaN : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : dflt
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

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

/**
 * Map each content type → the workflow stage its Publish Rule approves, e.g.
 * demo_plain_text → "Approved". Reads the declared rule stage from
 * workflows.manifest.json, then resolves its live stage UID from the stack
 * (UIDs are slugged on create, so we match by name to be safe). Returns
 * { [ctUid]: { workflowName, stageUid, stageName } }.
 */
async function buildApprovedStageMap(base, headers) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(resolve(__dirname, 'workflows.manifest.json'), 'utf-8'))
  } catch {
    return {}
  }
  const { ok, body } = await listWorkflows(base, headers)
  if (!ok || !Array.isArray(body.workflows)) return {}
  const liveByName = Object.fromEntries(body.workflows.map((w) => [w.name, w]))

  const map = {}
  for (const wf of manifest.workflows || []) {
    const ruleStageName = wf.publishingRules?.[0]?.stage
    if (!ruleStageName) continue
    const live = liveByName[wf.name]
    if (!live) continue
    const stage = (live.workflow_stages || []).find((s) => s.name === ruleStageName)
    if (!stage) continue
    for (const ct of wf.contentTypes || []) {
      map[ct] = { workflowName: wf.name, stageUid: stage.uid, stageName: ruleStageName }
    }
  }
  return map
}

// Paginate each content type until we have up to `maxPerCt` entries — enough to
// satisfy a large publish ratio (the old fixed 50/CT capped publishing at ~250).
async function gatherCandidates(base, headers, contentTypes, locale, maxPerCt) {
  const candidates = []
  for (const ctUid of contentTypes) {
    let skip = 0
    let got = 0
    while (got < maxPerCt) {
      const limit = Math.min(100, maxPerCt - got)
      const { ok, body } = await listEntries(base, headers, ctUid, { locale, limit, skip })
      if (!ok) {
        console.warn(`  skip ${ctUid} — listEntries failed (skip=${skip})`)
        break
      }
      const es = body.entries || []
      if (es.length === 0) break
      for (const e of es) candidates.push({ uid: e.uid, content_type: ctUid, locale })
      got += es.length
      skip += es.length
    }
  }
  return candidates
}

async function main() {
  const logger = new StructuredLogger('bulk-publish-cycle')
  const metrics = new OperationMetrics()
  const cbManager = new CircuitBreakerManager({ logger, metrics })

  logger.info('Script started', {
    apiKey: process.env.CONTENTSTACK_API_KEY?.slice(0, 10) + '…',
  })

  const { apiKey, base, branch, locale, publishEnv } = loadStackAuth()
  const tokens = loadManagementTokens()
  const headers = headersForToken(apiKey, tokens[0], branch)

  const contentTypes = csv(
    'CONTENTSTACK_BULK_PUBLISH_CONTENT_TYPES',
    deriveContentTypesFromManifest(),
  )
  if (contentTypes.length === 0) {
    console.error('No content types to scan. Set CONTENTSTACK_BULK_PUBLISH_CONTENT_TYPES or run from a repo with content-types.manifest.json.')
    process.exit(1)
  }

  // Publish/unpublish a RATIO of the entries created this run (when known);
  // fall back to a fixed sample on a standalone run.
  const created = readCreatedThisRun()
  const publishRatio = ratioEnv('CONTENTSTACK_PUBLISH_RATIO', 0.6)
  const unpublishRatio = ratioEnv('CONTENTSTACK_UNPUBLISH_RATIO', 0.15)
  const fixedPublish = parseInt(optionalEnv('CONTENTSTACK_BULK_PUBLISH_SAMPLE', '10'), 10)
  const fixedUnpublish = parseInt(optionalEnv('CONTENTSTACK_BULK_UNPUBLISH_SAMPLE', '2'), 10)
  const batchSize = Math.max(1, parseInt(optionalEnv('CONTENTSTACK_BULK_BATCH', '100'), 10))
  const publishSample = created != null ? Math.round(publishRatio * created) : fixedPublish
  const unpublishSample = created != null ? Math.round(unpublishRatio * created) : fixedUnpublish
  const locales = csv('CONTENTSTACK_BULK_PUBLISH_LOCALES', [locale])
  const environments = csv('CONTENTSTACK_BULK_PUBLISH_ENVIRONMENTS', [publishEnv])

  console.log(`bulk-publish-cycle`)
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  content_types: ${contentTypes.join(', ')}`)
  console.log(
    `  basis: ${created != null ? `${created} created → publish ${Math.round(publishRatio * 100)}% / unpublish ${Math.round(unpublishRatio * 100)}%` : 'fixed sample (no run report)'}`,
  )
  console.log(`  publish: ${publishSample}   unpublish: ${unpublishSample}   batch: ${batchSize}`)
  console.log(`  locales: ${locales.join(', ')}`)
  console.log(`  environments: ${environments.join(', ')}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  console.log('\n→ Gathering entry candidates…')
  const maxPerCt = Math.ceil(Math.max(publishSample, unpublishSample) / contentTypes.length) + 5
  const candidates = await gatherCandidates(base, headers, contentTypes, locale, maxPerCt)
  console.log(`  ${candidates.length} candidate entries`)
  if (candidates.length === 0) {
    console.log('Nothing to do.')
    return
  }

  const rng = makeRng()
  const shuffled = shuffle(candidates, rng)
  const toPublish = shuffled.slice(0, Math.min(publishSample, shuffled.length))
  // Prefer entries NOT in the publish set, so unpublish exercises real entries
  // instead of publish-then-immediately-unpublish of the same uids.
  const rest = shuffled.slice(toPublish.length)
  const toUnpublish = (rest.length >= unpublishSample ? rest : shuffled).slice(
    0,
    Math.min(unpublishSample, shuffled.length),
  )

  let published = 0
  let unpublished = 0
  let publishFailed = 0
  let transitioned = 0
  let transitionFailed = 0

  // Workflow Publish Rules gate publishing: an entry can only be published once
  // it sits in the rule's approved stage. So before publishing we transition the
  // publish set into that stage. Stage transitions require a USER session
  // (management tokens cannot change workflow stages), so this needs
  // CONTENTSTACK_USER_AUTHTOKEN (preferred — dodges the flaky /user-session 500)
  // or CONTENTSTACK_USER_EMAIL + _PASSWORD / _TOTP_SECRET.
  const approvedMap = await buildApprovedStageMap(base, headers)
  if (Object.keys(approvedMap).length > 0 && toPublish.length > 0) {
    const transitHeaders = DRY_RUN
      ? null
      : await tryLoadUserSessionHeaders(base, apiKey, branch)
    const transitionConc = Math.max(
      1,
      parseInt(optionalEnv('CONTENTSTACK_PUBLISH_TRANSITION_CONCURRENCY', '4'), 10),
    )
    if (DRY_RUN) {
      console.log(`\n→ [dry-run] would transition ${toPublish.length} entries to their approved stage`)
    } else if (!transitHeaders) {
      console.warn(
        '\n  ⚠ No user session available — cannot move entries to their approved stage.\n' +
          '    Publishing will be blocked by the Publish Rule (422). Set CONTENTSTACK_USER_AUTHTOKEN\n' +
          '    (a logged-in user authtoken) or CONTENTSTACK_USER_EMAIL + _PASSWORD / _TOTP_SECRET.',
      )
    } else {
      console.log(`\n→ Transitioning ${toPublish.length} entries to their approved stage (concurrency ${transitionConc})…`)
      await poolForEach(toPublish, transitionConc, async (e) => {
        const m = approvedMap[e.content_type]
        if (!m) return // CT has no publish-rule gate → already publishable
        const { ok } = await transitionEntryWorkflow(base, transitHeaders, {
          contentTypeUid: e.content_type,
          entryUid: e.uid,
          stageUid: m.stageUid,
          locale,
        })
        if (ok) transitioned += 1
        else transitionFailed += 1
      })
      console.log(`  ✓ ${transitioned} transitioned to approved stage` + (transitionFailed ? `, ${transitionFailed} failed` : ''))
    }
  }

  const publishBatches = chunk(toPublish, batchSize)
  console.log(`\n→ Bulk publish (${toPublish.length} entries in ${publishBatches.length} batch(es))`)
  for (let i = 0; i < publishBatches.length; i++) {
    const batch = publishBatches[i]
    if (DRY_RUN) {
      published += batch.length
      metrics.recordOperation('entries:publish', 'publish', 0, true, { batchIndex: i, batchSize: batch.length })
      continue
    }

    // Use RetryableOperation for smart retry on transient errors
    const publishOp = new RetryableOperation(
      `publish-batch:${i}:${batch.length}`,
      async () => {
        const result = await cbManager.executeWithBreaker(
          'bulkPublish',
          async () => {
            return await bulkPublish(base, headers, {
              entries: batch,
              locales,
              environments,
            })
          },
          { failureThreshold: 5, timeout: 60000 },
        )
        return result
      },
      {
        maxAttempts: 3,
        baseDelay: 2000,
        maxDelay: 10000,
        logger,
        metrics,
      },
    )

    try {
      const result = await publishOp.execute()
      const { ok, status, body } = result.result

      if (ok) {
        published += batch.length
        metrics.recordOperation('entries:publish', 'publish', 0, true, { batchIndex: i, batchSize: batch.length })
        logger.info(`Batch ${i + 1} published successfully`, { entriesCount: batch.length })
      } else {
        publishFailed += 1
        metrics.recordOperation('entries:publish', 'publish', 0, false, { batchIndex: i, status })
        logger.warn(`Publish batch failed`, { batchIndex: i, status, errorMessage: body?.error_message })
        console.error(`  ✗ batch ${i + 1} failed (${status}):`, body?.error_message || body?.errors || body)
        // A 422 here is almost always the workflow Publish Rule (entries are not
        // in an approved stage). It is systemic — every batch will fail the same
        // way — so stop hammering the API after the first one.
        if (status === 422) {
          logger.warn('Publish rule not satisfied, stopping batch processing', {})
          console.error('  → publish rule not satisfied; skipping remaining publish batches this run.')
          break
        }
      }
    } catch (error) {
      publishFailed += 1
      metrics.recordOperation('entries:publish', 'publish', 0, false, { batchIndex: i, error: error.message })
      logger.error(`Failed to publish batch after retries`, error, { batchIndex: i, batchSize: batch.length })
      console.error(`  ✗ batch ${i + 1} failed:`, error.message)
    }

    if (i < publishBatches.length - 1) await sleep(500)
  }
  if (!DRY_RUN && published > 0) console.log(`  ✓ enqueued ${published} entries`)

  // Small pause so the publish task starts draining before we throw unpublish
  // requests at the same entries. Avoids a "publish-pending + unpublish
  // requested" race that cma-api occasionally rejects with 409.
  await sleep(2000)

  if (toUnpublish.length > 0) {
    const unpublishBatches = chunk(toUnpublish, batchSize)
    console.log(`\n→ Bulk unpublish (${toUnpublish.length} entries in ${unpublishBatches.length} batch(es))`)
    for (let i = 0; i < unpublishBatches.length; i++) {
      const batch = unpublishBatches[i]
      if (DRY_RUN) {
        unpublished += batch.length
        metrics.recordOperation('entries:unpublish', 'unpublish', 0, true, { batchIndex: i, batchSize: batch.length })
        continue
      }

      // Use RetryableOperation for smart retry on transient errors
      const unpublishOp = new RetryableOperation(
        `unpublish-batch:${i}:${batch.length}`,
        async () => {
          const result = await cbManager.executeWithBreaker(
            'bulkUnpublish',
            async () => {
              return await bulkUnpublish(base, headers, {
                entries: batch,
                locales,
                environments,
              })
            },
            { failureThreshold: 5, timeout: 60000 },
          )
          return result
        },
        {
          maxAttempts: 3,
          baseDelay: 2000,
          maxDelay: 10000,
          logger,
          metrics,
        },
      )

      try {
        const result = await unpublishOp.execute()
        const { ok, status, body } = result.result

        if (ok) {
          unpublished += batch.length
          metrics.recordOperation('entries:unpublish', 'unpublish', 0, true, { batchIndex: i, batchSize: batch.length })
          logger.info(`Batch ${i + 1} unpublished successfully`, { entriesCount: batch.length })
        } else {
          metrics.recordOperation('entries:unpublish', 'unpublish', 0, false, { batchIndex: i, status })
          logger.warn(`Unpublish batch failed`, { batchIndex: i, status, errorMessage: body?.error_message })
          // 422 / 409 are common if those entries weren't published yet —
          // not fatal for a periodic cycle. Systemic 422 → stop early.
          console.warn(`  ⚠ batch ${i + 1} unpublish failed (${status}):`, body?.error_message || body?.errors || body)
          if (status === 422) break
        }
      } catch (error) {
        metrics.recordOperation('entries:unpublish', 'unpublish', 0, false, { batchIndex: i, error: error.message })
        logger.error(`Failed to unpublish batch after retries`, error, { batchIndex: i, batchSize: batch.length })
        console.warn(`  ⚠ batch ${i + 1} unpublish failed:`, error.message)
      }

      if (i < unpublishBatches.length - 1) await sleep(500)
    }
    if (!DRY_RUN && unpublished > 0) console.log(`  ✓ enqueued ${unpublished} entries`)
  }

  const metricsSummary = metrics.getSummary()
  const cbStatus = cbManager.getAllStatuses()

  logger.info('Script completed successfully', {
    published,
    unpublished,
    publishFailed,
    transitioned,
    transitionFailed,
    metricsSummary: {
      operationCount: metricsSummary.operations.count,
      operationSuccess: metricsSummary.operations.success,
      operationFailure: metricsSummary.operations.failed,
    },
    circuitBreakerStatus: cbStatus,
  })

  writeStepReport({
    planned: toPublish.length + toUnpublish.length,
    actual: published + unpublished,
    failed: publishFailed,
    logTrail: logger.getLogTrail().slice(0, 5000),
    kpis: {
      published,
      unpublished,
      publishFailed,
      transitioned,
      transitionFailed,
      operationMetrics: {
        totalOperations: metricsSummary.operations.count,
        successRate: metricsSummary.operations.successRate,
        avgDurationMs: metricsSummary.operations.avgMs,
      },
    },
  })
  console.log('\n✓ done')
}

main().catch((err) => {
  const logger = new StructuredLogger('bulk-publish-cycle')
  logger.error('Script failed', err, { fatal: true })
  console.error('bulk-publish-cycle failed:', err)
  process.exit(1)
})
