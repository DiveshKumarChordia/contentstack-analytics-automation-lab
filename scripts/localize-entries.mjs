#!/usr/bin/env node
/**
 * localize-entries.mjs
 *
 * For each content type, picks the N newest entries in the master locale and
 * creates localized versions in the target non-master locales (default:
 * fr-fr, de-de, en-gb). Idempotent — entries already localized in a given
 * locale are skipped.
 *
 * Why: drives `entry_created` meter events keyed by non-master `locale`
 * values, which is the only path to populating the dashboard's "Locale"
 * filter axis with real variation. Without localized entries, every event
 * carries the master locale and the locale filter shows one option.
 *
 * Token: stack-level CONTENTSTACK_MANAGEMENT_TOKEN.
 *
 * Env knobs:
 *   CONTENTSTACK_LOCALIZE_TARGETS         — CSV; default fr-fr,de-de,en-gb
 *   CONTENTSTACK_LOCALIZE_MAX_PER_CT      — newest N entries per CT (default 10)
 *   CONTENTSTACK_LOCALIZE_CONCURRENCY     — parallel PUTs (default 4)
 *   CONTENTSTACK_LOCALIZE_CONTENT_TYPES   — CSV; default = content-types manifest
 *
 * Usage:
 *   node --env-file=.env scripts/localize-entries.mjs
 *   node --env-file=.env scripts/localize-entries.mjs --dry-run
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listEntries,
  localizeEntry,
  getEntryLocales,
  listLocales,
  createLocale,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import { createProgress, runWithConcurrency } from './lib/progress.mjs'
import { writeStepReport } from './lib/report.mjs'
import { StructuredLogger } from './lib/structured-logger.mjs'
import { OperationMetrics } from './lib/operation-metrics.mjs'
import { CircuitBreakerManager } from './lib/circuit-breaker.mjs'
import { RetryableOperation } from './lib/retry-strategy.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')

function csv(name, fallback) {
  const v = optionalEnv(name)
  if (!v) return fallback
  return v.split(',').map((s) => s.trim()).filter(Boolean)
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

// Single source of truth for target locales: every non-master locale declared
// in locales-branches.manifest.json. Adding a locale there automatically widens
// localization (no need to also touch CONTENTSTACK_LOCALIZE_TARGETS).
function deriveLocalesFromManifest() {
  try {
    const path = resolve(__dirname, 'locales-branches.manifest.json')
    const manifest = JSON.parse(readFileSync(path, 'utf-8'))
    return (manifest.locales || []).map((l) => l.code).filter(Boolean)
  } catch {
    return ['fr-fr', 'de-de', 'en-gb']
  }
}

/**
 * Generate a localized title for an entry given a target locale code.
 * Keeps the original title as the trunk and prefixes with a locale tag so
 * dashboards rendering the title still show recognizable provenance.
 */
function localizedTitle(originalTitle, localeCode, entryUid) {
  // tag like "[fr-FR]" — uppercases the region for readability
  const parts = localeCode.split('-')
  const tag = parts.length === 2 ? `${parts[0]}-${parts[1].toUpperCase()}` : localeCode
  // `title` is unique per stack — suffix with the entry uid tail so two entries
  // that share a master title don't collide on the localized title (a 422 cause).
  const suffix = entryUid ? ` · ${String(entryUid).slice(-6)}` : ''
  return `[${tag}] ${originalTitle || 'Untitled'}${suffix}`
}

// Ensure all target locales exist; create missing ones with fallback from manifest
async function ensureLocalesExist(base, headers, targets, manifest) {
  const { ok, body } = await listLocales(base, headers)
  if (!ok) {
    console.warn('  ⚠ could not list locales — skipping creation')
    return targets
  }

  const existing = new Set((body.locales || []).map((l) => l.code))
  const localeManifest = manifest.locales || []
  const localeMap = Object.fromEntries(localeManifest.map((l) => [l.code, l]))

  for (const code of targets) {
    if (existing.has(code)) continue

    const localeInfo = localeMap[code] || {}
    console.log(`  📍 creating locale ${code}${localeInfo.fallback ? ` (fallback: ${localeInfo.fallback})` : ''}`)

    const { ok: cOk, status, body: cBody } = await createLocale(base, headers, {
      code,
      name: localeInfo.name || code,
      fallbackLocale: localeInfo.fallback || undefined,
    })

    if (cOk) {
      console.log(`    ✓ created ${code}`)
      existing.add(code)
    } else {
      console.warn(`    ✗ failed (${status}): ${cBody?.error_message || ''}`)
    }

    await sleep(100)
  }

  // Return only locales that now exist
  return targets.filter((c) => existing.has(c))
}

async function localizeForContentType(base, headers, ctUid, targets, opts, logger, metrics, cbManager) {
  const { maxPerCt, concurrency } = opts
  const ctLogger = new StructuredLogger(`localize:${ctUid}`, { requestId: logger.requestId })
  const { ok, body } = await listEntries(base, headers, ctUid, {
    limit: maxPerCt,
    desc: 'created_at',
    // Master locale read — we explicitly do NOT pass `locale` so we get the
    // entry as it exists in the stack's master.
  })
  if (!ok) {
    console.warn(`  ${ctUid}: listEntries failed — skipping`)
    return { localized: 0, already: 0, failed: 0 }
  }
  const entries = body.entries || []
  if (entries.length === 0) {
    console.log(`  ${ctUid}: 0 entries`)
    return { localized: 0, already: 0, failed: 0 }
  }

  // PRE-CHECK which target locales each entry already has, via
  // GET /entries/{uid}/locales (every stack locale + a `localized` flag). This
  // makes "already localized" a REAL signal rather than a guessed 422 — so a
  // genuine localize failure surfaces as an actual error instead of being
  // silently bucketed as a skip (which is why every run read "0 localized").
  let already = 0
  const work = []
  await runWithConcurrency(
    entries,
    async (entry) => {
      const { ok: gOk, body: gBody } = await getEntryLocales(base, headers, {
        contentTypeUid: ctUid,
        entryUid: entry.uid,
      })
      const localizedCodes = new Set(
        gOk ? (gBody.locales || []).filter((l) => l && l.localized).map((l) => l.code) : [],
      )
      for (const target of targets) {
        if (localizedCodes.has(target)) already++
        else work.push({ entry, target })
      }
    },
    { concurrency },
  )

  console.log(
    `  ${ctUid}: ${entries.length} entries — ${already} (entry,locale) already localized, ${work.length} to create`,
  )
  if (work.length === 0) return { localized: 0, already, failed: 0 }

  const progress = createProgress({
    label: `${ctUid} localize`,
    total: work.length,
    everyN: 20,
  })

  let localized = 0
  let failed = 0
  await runWithConcurrency(
    work,
    async ({ entry, target }) => {
      const title = localizedTitle(entry.title, target, entry.uid)
      if (DRY_RUN) {
        console.log(`    [dry-run] ${ctUid}/${entry.uid} → ${target}  "${title}"`)
        localized++
        metrics.recordOperation('entry:localize', 'localize', 0, true)
        progress.tick({ ok: true })
        return
      }

      // Use RetryableOperation for smart retry on transient errors
      const localizeOp = new RetryableOperation(
        `localize:${ctUid}:${entry.uid}:${target}`,
        async () => {
          const result = await cbManager.executeWithBreaker(
            'localizeEntry',
            async () => {
              return await localizeEntry(base, headers, {
                contentTypeUid: ctUid,
                entryUid: entry.uid,
                locale: target,
                fields: { title },
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
          logger: ctLogger,
          metrics,
        },
      )

      try {
        const result = await localizeOp.execute()
        const { ok: lOk, status, body: lBody } = result.result

        if (lOk) {
          localized++
          metrics.recordOperation('entry:localize', 'localize', 0, true, { entryUid: entry.uid, locale: target })
          progress.tick({ ok: true })
        } else {
          failed++
          metrics.recordOperation('entry:localize', 'localize', 0, false, { entryUid: entry.uid, locale: target })
          progress.tick({ ok: false })
          const reason =
            lBody?.error_message ||
            (lBody?.errors && JSON.stringify(lBody.errors)) ||
            JSON.stringify(lBody).slice(0, 160)
          ctLogger.warn(`Localization failed after retries`, { entryUid: entry.uid, locale: target, status, reason })
          console.warn(`    ✗ ${ctUid}/${entry.uid} → ${target} (${status}): ${reason}`)
        }
      } catch (error) {
        failed++
        metrics.recordOperation('entry:localize', 'localize', 0, false, { entryUid: entry.uid, locale: target, error: error.message })
        ctLogger.error(`Failed to localize entry after retries`, error, { entryUid: entry.uid, locale: target })
        progress.tick({ ok: false })
        console.warn(`    ✗ ${ctUid}/${entry.uid} → ${target}: ${error.message}`)
      }

      await sleep(50)
    },
    { concurrency },
  )
  progress.done()
  return { localized, already, failed }
}

async function main() {
  const logger = new StructuredLogger('localize-entries')
  const metrics = new OperationMetrics()
  const cbManager = new CircuitBreakerManager({ logger, metrics })

  logger.info('Script started', {
    apiKey: process.env.CONTENTSTACK_API_KEY?.slice(0, 10) + '…',
  })

  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  const headers = headersForToken(apiKey, tokens[0], branch)

  const targets = csv('CONTENTSTACK_LOCALIZE_TARGETS', deriveLocalesFromManifest())
  const contentTypes = csv(
    'CONTENTSTACK_LOCALIZE_CONTENT_TYPES',
    deriveContentTypesFromManifest(),
  )
  const maxPerCt = parseInt(optionalEnv('CONTENTSTACK_LOCALIZE_MAX_PER_CT', '10'), 10)
  const concurrency = parseInt(optionalEnv('CONTENTSTACK_LOCALIZE_CONCURRENCY', '4'), 10)

  if (contentTypes.length === 0) {
    console.error('No content types. Set CONTENTSTACK_LOCALIZE_CONTENT_TYPES.')
    process.exit(1)
  }

  // Load locale manifest for fallback chains
  let localeManifest = {}
  try {
    const path = resolve(__dirname, 'locales-branches.manifest.json')
    localeManifest = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    console.warn('  ⚠ could not load locales-branches.manifest.json')
  }

  console.log(`localize-entries`)
  console.log(`  stack:    api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  targets:  ${targets.join(', ')}`)
  console.log(`  CTs:      ${contentTypes.join(', ')}`)
  console.log(`  maxPerCt: ${maxPerCt}   concurrency: ${concurrency}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  // Ensure all target locales exist on the stack (create if missing)
  console.log(`\n→ Ensuring locales exist…`)
  const validTargets = DRY_RUN
    ? targets
    : await ensureLocalesExist(base, headers, targets, localeManifest)

  if (validTargets.length === 0) {
    console.log(`  ⚠ no valid target locales — skipping localization`)
    writeStepReport({ planned: contentTypes.length * targets.length, actual: 0, failed: 0, kpis: { localized: 0, already: 0, localizeFailed: 0 } })
    return
  }

  // SNAPSHOT: Entry counts BEFORE localization (master locale only)
  console.log(`\n→ Capturing entry counts (BEFORE localization)…`)
  const entryCountBefore = {}
  for (const ct of contentTypes) {
    const { ok, body } = await listEntries(base, headers, ct, { includeCount: true })
    entryCountBefore[ct] = ok ? (body?.entries_count || 0) : 0
  }
  const totalBefore = Object.values(entryCountBefore).reduce((a, b) => a + b, 0)
  console.log(`  Total entries (master) before: ${totalBefore}`)

  let totalL = 0
  let totalA = 0
  let totalF = 0
  for (const ctUid of contentTypes) {
    const { localized, already, failed } = await localizeForContentType(
      base,
      headers,
      ctUid,
      validTargets,
      { maxPerCt, concurrency },
      logger,
      metrics,
      cbManager,
    )
    totalL += localized
    totalA += already
    totalF += failed
  }

  // SNAPSHOT: Entry counts AFTER localization (master locale only — localized entries are in target locales)
  console.log(`\n→ Capturing entry counts (AFTER localization)…`)
  const entryCountAfter = {}
  for (const ct of contentTypes) {
    const { ok, body } = await listEntries(base, headers, ct, { includeCount: true })
    entryCountAfter[ct] = ok ? (body?.entries_count || 0) : 0
  }
  const totalAfter = Object.values(entryCountAfter).reduce((a, b) => a + b, 0)
  console.log(`  Total entries (master) after: ${totalAfter}`)
  console.log(`  Total localization pairs created: ${totalL}`)

  console.log(
    `\n✓ done — ${totalL} localized, ${totalA} already localized, ${totalF} failed`,
  )

  const metricsSummary = metrics.getSummary()
  const cbStatus = cbManager.getAllStatuses()

  logger.info('Script completed successfully', {
    totalLocalized: totalL,
    totalAlready: totalA,
    totalFailed: totalF,
    metricsSummary: {
      operationCount: metricsSummary.operations.count,
      operationSuccess: metricsSummary.operations.success,
      operationFailure: metricsSummary.operations.failed,
    },
    circuitBreakerStatus: cbStatus,
  })

  writeStepReport({
    planned: totalL + totalF,
    actual: totalL,
    failed: totalF,
    entryCountBefore,
    entryCountAfter,
    logTrail: logger.getLogTrail().slice(0, 5000),
    kpis: {
      localized: totalL,
      already: totalA,
      localizeFailed: totalF,
      localeTargets: validTargets.length,
      totalBefore,
      totalAfter,
      operationMetrics: {
        totalOperations: metricsSummary.operations.count,
        successRate: metricsSummary.operations.successRate,
        avgDurationMs: metricsSummary.operations.avgMs,
      },
    },
  })
  // Surface real failures (previously hidden as "skipped"): non-zero exit makes
  // drive-all flag this step so the genuine error is visible in the run summary.
  if (totalF > 0) process.exitCode = 1
}

main().catch((err) => {
  const logger = new StructuredLogger('localize-entries')
  logger.error('Script failed', err, { fatal: true })
  console.error('localize-entries failed:', err)
  process.exit(1)
})
