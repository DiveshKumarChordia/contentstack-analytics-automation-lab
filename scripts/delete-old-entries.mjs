#!/usr/bin/env node
/**
 * delete-old-entries.mjs
 *
 * Deletes entries older than N days across the configured content types.
 *
 * Why: the org-level entry cap (cma-api error code 133) makes endless
 * `periodic-entries-from-manifest.mjs` runs eventually choke. This script
 * keeps the steady-state roughly stable by removing old entries — which has
 * the bonus of driving `entry_deleted` meter events that feed the dashboard's
 * `entries_removed` series and Net Entries trend.
 *
 * Strategy: for each content type, paginate ASC by `updated_at` (oldest first)
 * and DELETE *every* entry older than the cutoff — no keep-floor, no per-run
 * cap. "Delete all entries older than N days" means all of them, every run.
 * The create step (which runs after delete in the periodic pipeline) repopulates
 * the < N-day window, so the bulk-publish / workflow phases still have entries.
 *
 * Token: stack-level CONTENTSTACK_MANAGEMENT_TOKEN — DELETE /v3/entries is
 * within the management token's scope per Contentstack docs.
 *
 * Env knobs:
 *   CONTENTSTACK_DELETE_OLDER_THAN_DAYS  — cutoff in days (default 7)
 *   CONTENTSTACK_DELETE_CONTENT_TYPES    — CSV; default = content-types manifest
 *   (CONTENTSTACK_DELETE_MAX_PER_RUN / _KEEP_NEWEST are no longer used — we now
 *    delete everything older than the cutoff.)
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
  sleep,
} from './lib/cma.mjs'
import { createProgress } from './lib/progress.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')

function csv(name, fallback = []) {
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

async function deleteFromContentType(base, headers, ctUid, locale, opts) {
  const { cutoffMs } = opts

  // Phase 1 — paginate ASC by updated_at (oldest first) and collect EVERY entry
  // older than the cutoff. No keep-floor, no per-run cap: "delete all older than
  // N days" means all of them. Because the sort is ascending, every entry older
  // than the cutoff is contiguous at the front — the first entry we hit that is
  // >= cutoff means all remaining are newer, so we can stop. We collect first,
  // then delete (so deletions never shift the pages we're still reading).
  const toDelete = []
  let skip = 0
  let scanned = 0
  for (;;) {
    const { ok, body } = await listEntries(base, headers, ctUid, {
      locale,
      limit: 100,
      skip,
      asc: 'updated_at',
    })
    if (!ok) {
      console.warn(`  ${ctUid}: listEntries failed (skip=${skip}) — stopping this CT`)
      break
    }
    const entries = body.entries || []
    if (entries.length === 0) break
    scanned += entries.length
    let hitNewer = false
    for (const e of entries) {
      const t = e.updated_at ? Date.parse(e.updated_at) : NaN
      if (Number.isFinite(t) && t < cutoffMs) {
        toDelete.push(e)
      } else {
        hitNewer = true // ascending → first one at/after cutoff ends the old run
        break
      }
    }
    if (hitNewer) break
    skip += entries.length
  }

  if (toDelete.length === 0) {
    console.log(`  ${ctUid}: scanned=${scanned} deleted=0 (nothing older than cutoff)`)
    return { deleted: 0, scanned }
  }

  // Phase 2 — delete every collected entry.
  console.log(`  ${ctUid}: ${toDelete.length} entries older than cutoff → deleting all`)
  const progress = createProgress({
    label: `${ctUid} delete`,
    total: toDelete.length,
    everyN: 25,
  })
  let deleted = 0
  for (const e of toDelete) {
    if (DRY_RUN) {
      console.log(`  [dry-run] DELETE ${ctUid}/${e.uid}  updated_at=${e.updated_at}`)
      deleted++
      progress.tick({ ok: true })
      continue
    }
    const { ok: dOk, status, body: dBody } = await deleteEntry(base, headers, {
      contentTypeUid: ctUid,
      entryUid: e.uid,
      locale,
    })
    if (dOk) {
      deleted++
      progress.tick({ ok: true })
    } else {
      console.warn(
        `  ✗ ${ctUid}/${e.uid} delete failed (${status}): ${dBody?.error_message || JSON.stringify(dBody).slice(0, 160)}`,
      )
      progress.tick({ ok: false })
    }
    await sleep(80) // light throttle — DELETE is heavier than read
  }
  progress.done()
  return { deleted, scanned }
}

async function main() {
  const { apiKey, base, branch, locale } = loadStackAuth()
  const tokens = loadManagementTokens()
  const headers = headersForToken(apiKey, tokens[0], branch)

  const days = parseInt(optionalEnv('CONTENTSTACK_DELETE_OLDER_THAN_DAYS', '7'), 10)
  const contentTypes = csv(
    'CONTENTSTACK_DELETE_CONTENT_TYPES',
    deriveContentTypesFromManifest(),
  )

  if (contentTypes.length === 0) {
    console.error('No content types to scan. Set CONTENTSTACK_DELETE_CONTENT_TYPES or include a content-types manifest.')
    process.exit(1)
  }

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000

  console.log(`delete-old-entries`)
  console.log(`  stack:   api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  policy:  delete ALL entries > ${days} days old (no floor, no cap)`)
  console.log(`  cutoff:  before ${new Date(cutoffMs).toISOString()}  (by updated_at)`)
  console.log(`  scope:   ${contentTypes.join(', ')}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  let totalDeleted = 0
  let totalScanned = 0
  for (const ctUid of contentTypes) {
    const { deleted, scanned } = await deleteFromContentType(base, headers, ctUid, locale, {
      cutoffMs,
    })
    totalDeleted += deleted
    totalScanned += scanned
  }

  console.log(`\n✓ done — ${totalDeleted} deleted (scanned ${totalScanned}) across ${contentTypes.length} content type(s)`)
}

main().catch((err) => {
  console.error('delete-old-entries failed:', err)
  process.exit(1)
})
