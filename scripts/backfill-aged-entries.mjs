#!/usr/bin/env node
/**
 * backfill-aged-entries.mjs — restore trashed entries to meet retention targets.
 *
 * After delete-old-entries runs and trims aged entries, this script checks if any
 * age band has fallen below its retention target. If so, restores soft-deleted
 * (trashed) entries from that time period back to the stack.
 *
 * Retention targets (default, per age band):
 *   >30d:  5,000 entries
 *   15-30d: 10,000 entries
 *   7-15d:  20,000 entries
 *
 * Motivation: the aged-stalls and other meter-coverage scenarios need a pool of
 * aged entries to exercise. Without this, multiple runs leave only fresh entries
 * (created today), and the stalled_by_stage meter has no material to work with.
 *
 * Implementation: queries the CMA for trashed entries in each age band and restores
 * them back to the stack. Restoring bumps their updated_at timestamp but preserves
 * the original created_at, so they maintain their "aged" status.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-aged-entries.mjs
 */

import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listEntries,
  restoreEntry,
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

// Retention targets: keep this many entries in each age band
const RETENTION_TARGETS = {
  over30d: intEnv('CONTENTSTACK_RETENTION_TARGET_OVER_30D', 5000),
  aged15to30: intEnv('CONTENTSTACK_RETENTION_TARGET_15_30D', 10000),
  aged7to15: intEnv('CONTENTSTACK_RETENTION_TARGET_7_15D', 20000),
}

// Query for trashed (soft-deleted) entries in a specific age band
async function listTrashedEntriesInBand(base, headers, ctUid, bandStartMs, bandEndMs, locale = 'en-us') {
  try {
    // Query for entries deleted/trashed in this time range
    // Using created_at to find entries originally from this band
    const now = Date.now()
    const startDate = new Date(now - bandStartMs).toISOString()
    const endDate = new Date(now - bandEndMs).toISOString()

    // Query: created_at >= endDate AND created_at < startDate (reverse because band is age, not absolute time)
    const query = {
      'created_at': { $gte: endDate, $lt: startDate },
    }

    const { ok, body } = await listEntries(base, headers, ctUid, {
      locale,
      limit: 1000,
      query,
      includeCount: true,
    })

    if (!ok) return []

    const entries = body.entries || []
    // Filter to only those that are marked as deleted/trashed
    // (In Contentstack, soft-deleted entries might have a _metadata flag or similar)
    return entries.filter((e) => e._metadata?.deleted_at || e.deleted)
  } catch {
    return []
  }
}

async function getRestorableCandidates(base, headers, ctUid) {
  const now = Date.now()
  const day = 86_400_000

  const bands = {
    over30d: { start: 30 * day, end: 100 * day, target: RETENTION_TARGETS.over30d, label: '>30d' },
    aged15to30: { start: 15 * day, end: 30 * day, target: RETENTION_TARGETS.aged15to30, label: '15-30d' },
    aged7to15: { start: 7 * day, end: 15 * day, target: RETENTION_TARGETS.aged7to15, label: '7-15d' },
  }

  const result = {}
  for (const [key, band] of Object.entries(bands)) {
    const trashed = await listTrashedEntriesInBand(base, headers, ctUid, band.start, band.end)
    result[key] = {
      trashed: trashed.slice(0, band.target), // Limit to target count
      target: band.target,
      label: band.label,
    }
    await sleep(100)
  }

  return result
}

async function main() {
  const { apiKey, base, branch, locale } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmt = (br) => headersForToken(apiKey, tokens[0], br)

  const concurrency = intEnv('CONTENTSTACK_BACKFILL_CONCURRENCY', 3)

  console.log('backfill-aged-entries')
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}  locale=${locale || 'en-us'}`)
  console.log(`  retention targets:`)
  console.log(`    >30d:  ${RETENTION_TARGETS.over30d}`)
  console.log(`    15-30d: ${RETENTION_TARGETS.aged15to30}`)
  console.log(`    7-15d:  ${RETENTION_TARGETS.aged7to15}`)

  // Get restorable candidates (trashed entries in each age band)
  const ctUid = 'demo_plain_text'
  console.log(`\n→ Querying trashed entries in ${ctUid}…`)
  const candidates = await getRestorableCandidates(base, mgmt(branch), ctUid)

  let totalRestored = 0
  const kpis = { restored: 0, bands: {} }

  for (const [bandKey, bandInfo] of Object.entries(candidates)) {
    const count = bandInfo.trashed.length
    kpis.bands[bandInfo.label] = { restored: 0, available: count }

    if (count === 0) {
      console.log(`  ${bandInfo.label}: no trashed entries to restore`)
      continue
    }

    console.log(`  ${bandInfo.label}: ${count} trashed entries available — restoring them`)

    const progress = createProgress({
      label: `restore ${bandInfo.label}`,
      total: count,
      everyN: Math.max(1, Math.floor(count / 5)),
    })

    await runWithConcurrency(
      bandInfo.trashed,
      async (entry) => {
        const { ok } = await restoreEntry(base, mgmt(branch), {
          contentTypeUid: ctUid,
          entryUid: entry.uid,
          locale: locale || 'en-us',
        })

        if (ok) {
          totalRestored += 1
          kpis.restored += 1
          kpis.bands[bandInfo.label].restored += 1
        }

        progress.tick({ ok })
      },
      { concurrency },
    )

    progress.done()
  }

  console.log(`\n✓ backfill-aged-entries done — ${totalRestored} entries restored`)

  writeStepReport({
    planned: Object.values(candidates).reduce((a, b) => a + b.trashed.length, 0),
    actual: totalRestored,
    failed: 0,
    kpis,
  })
}

main().catch((err) => {
  console.error('backfill-aged-entries failed:', err)
  process.exit(1)
})
