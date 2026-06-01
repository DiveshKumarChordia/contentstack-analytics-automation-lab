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
 * Strategy: list each content type's entries sorted desc by `updated_at`, skip
 * ahead until we find ones older than the cutoff, then DELETE up to a per-run
 * cap. A floor (`keepNewest`) ensures we never empty a content type — useful
 * so the bulk-publish + workflow-transition phases have something to operate
 * on.
 *
 * Token: stack-level CONTENTSTACK_MANAGEMENT_TOKEN — DELETE /v3/entries is
 * within the management token's scope per Contentstack docs.
 *
 * Env knobs:
 *   CONTENTSTACK_DELETE_OLDER_THAN_DAYS  — cutoff (default 7)
 *   CONTENTSTACK_DELETE_MAX_PER_RUN      — cap deletes per run (default 50)
 *   CONTENTSTACK_DELETE_KEEP_NEWEST      — floor per content type (default 10)
 *   CONTENTSTACK_DELETE_CONTENT_TYPES    — CSV; default = content-types manifest
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
  const { cutoffMs, perRunCap, keepNewest, remaining } = opts
  const { ok, body } = await listEntries(base, headers, ctUid, {
    locale,
    limit: 100,
    desc: 'updated_at',
  })
  if (!ok) {
    console.warn(`  ${ctUid}: listEntries failed — skipping`)
    return { deleted: 0, scanned: 0, kept: 0 }
  }
  const entries = body.entries || []
  if (entries.length <= keepNewest) {
    console.log(`  ${ctUid}: ${entries.length} entries (≤ keep floor ${keepNewest}) — skip`)
    return { deleted: 0, scanned: entries.length, kept: entries.length }
  }
  const candidates = entries.slice(keepNewest) // older than the freshest N

  let deleted = 0
  let scanned = candidates.length
  for (const e of candidates) {
    if (deleted >= remaining) break
    const updated = e.updated_at ? Date.parse(e.updated_at) : NaN
    if (!Number.isFinite(updated) || updated >= cutoffMs) continue // not old enough
    if (DRY_RUN) {
      console.log(`  [dry-run] DELETE ${ctUid}/${e.uid}  updated_at=${e.updated_at}`)
      deleted++
      continue
    }
    const { ok: dOk, status, body: dBody } = await deleteEntry(base, headers, {
      contentTypeUid: ctUid,
      entryUid: e.uid,
      locale,
    })
    if (dOk) {
      deleted++
    } else {
      console.warn(
        `  ✗ ${ctUid}/${e.uid} delete failed (${status}): ${dBody?.error_message || JSON.stringify(dBody).slice(0, 160)}`,
      )
    }
    await sleep(100) // light throttle — DELETE is heavier than read
  }
  const kept = entries.length - deleted
  console.log(`  ${ctUid}: scanned=${scanned} deleted=${deleted} kept=${kept}`)
  return { deleted, scanned, kept }
}

async function main() {
  const { apiKey, base, branch, locale } = loadStackAuth()
  const tokens = loadManagementTokens()
  const headers = headersForToken(apiKey, tokens[0], branch)

  const days = parseInt(optionalEnv('CONTENTSTACK_DELETE_OLDER_THAN_DAYS', '7'), 10)
  const perRunCap = parseInt(optionalEnv('CONTENTSTACK_DELETE_MAX_PER_RUN', '50'), 10)
  const keepNewest = parseInt(optionalEnv('CONTENTSTACK_DELETE_KEEP_NEWEST', '10'), 10)
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
  console.log(`  cutoff:  > ${days} days old  (before ${new Date(cutoffMs).toISOString()})`)
  console.log(`  caps:    perRunCap=${perRunCap}  keepNewest=${keepNewest}`)
  console.log(`  scope:   ${contentTypes.join(', ')}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  let remaining = perRunCap
  let totalDeleted = 0
  let totalKept = 0
  for (const ctUid of contentTypes) {
    if (remaining <= 0) {
      console.log(`  (per-run cap of ${perRunCap} reached — stopping)`)
      break
    }
    const { deleted, kept } = await deleteFromContentType(base, headers, ctUid, locale, {
      cutoffMs,
      perRunCap,
      keepNewest,
      remaining,
    })
    remaining -= deleted
    totalDeleted += deleted
    totalKept += kept
  }

  console.log(`\n✓ done — ${totalDeleted} deleted, ${totalKept} retained across ${contentTypes.length} content type(s)`)
}

main().catch((err) => {
  console.error('delete-old-entries failed:', err)
  process.exit(1)
})
