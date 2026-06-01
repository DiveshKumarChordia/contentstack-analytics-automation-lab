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

async function gatherCandidates(base, headers, contentTypes, locale) {
  const candidates = []
  for (const ctUid of contentTypes) {
    const { ok, body } = await listEntries(base, headers, ctUid, { locale, limit: 50 })
    if (!ok) {
      console.warn(`  skip ${ctUid} — listEntries failed`)
      continue
    }
    for (const e of body.entries || []) {
      candidates.push({ uid: e.uid, content_type: ctUid, locale })
    }
  }
  return candidates
}

async function main() {
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

  const publishSample = parseInt(optionalEnv('CONTENTSTACK_BULK_PUBLISH_SAMPLE', '10'), 10)
  const unpublishSample = parseInt(optionalEnv('CONTENTSTACK_BULK_UNPUBLISH_SAMPLE', '2'), 10)
  const locales = csv('CONTENTSTACK_BULK_PUBLISH_LOCALES', [locale])
  const environments = csv('CONTENTSTACK_BULK_PUBLISH_ENVIRONMENTS', [publishEnv])

  console.log(`bulk-publish-cycle`)
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  content_types: ${contentTypes.join(', ')}`)
  console.log(`  publish sample: ${publishSample}   unpublish sample: ${unpublishSample}`)
  console.log(`  locales: ${locales.join(', ')}`)
  console.log(`  environments: ${environments.join(', ')}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  console.log('\n→ Gathering entry candidates…')
  const candidates = await gatherCandidates(base, headers, contentTypes, locale)
  console.log(`  ${candidates.length} candidate entries`)
  if (candidates.length === 0) {
    console.log('Nothing to do.')
    return
  }

  const rng = makeRng()
  const shuffled = shuffle(candidates, rng)
  const toPublish = shuffled.slice(0, Math.min(publishSample, shuffled.length))
  const toUnpublish = shuffled.slice(0, Math.min(unpublishSample, shuffled.length))

  console.log(`\n→ Bulk publish (${toPublish.length} entries)`)
  if (DRY_RUN) {
    toPublish.forEach((e) => console.log(`  [dry-run] publish ${e.content_type}/${e.uid}`))
  } else {
    const { ok, status, body } = await bulkPublish(base, headers, {
      entries: toPublish,
      locales,
      environments,
    })
    if (ok) {
      console.log(`  ✓ enqueued: ${body?.notice || JSON.stringify(body).slice(0, 200)}`)
    } else {
      console.error(`  ✗ failed (${status}):`, body?.error_message || body?.errors || body)
    }
  }

  // Small pause so the publish task starts draining before we throw unpublish
  // requests at the same entries. Avoids a "publish-pending + unpublish
  // requested" race that cma-api occasionally rejects with 409.
  await sleep(2000)

  if (toUnpublish.length > 0) {
    console.log(`\n→ Bulk unpublish (${toUnpublish.length} entries)`)
    if (DRY_RUN) {
      toUnpublish.forEach((e) => console.log(`  [dry-run] unpublish ${e.content_type}/${e.uid}`))
    } else {
      const { ok, status, body } = await bulkUnpublish(base, headers, {
        entries: toUnpublish,
        locales,
        environments,
      })
      if (ok) {
        console.log(`  ✓ enqueued: ${body?.notice || JSON.stringify(body).slice(0, 200)}`)
      } else {
        // 422 / 409 are common if those entries weren't published yet —
        // not fatal for a periodic cycle.
        console.warn(`  ⚠ unpublish failed (${status}):`, body?.error_message || body?.errors || body)
      }
    }
  }

  console.log('\n✓ done')
}

main().catch((err) => {
  console.error('bulk-publish-cycle failed:', err)
  process.exit(1)
})
