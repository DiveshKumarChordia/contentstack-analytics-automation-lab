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
 *   CONTENTSTACK_LOCALIZE_CONCURRENCY     — parallel PUTs (default 6)
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
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import { createProgress, runWithConcurrency } from './lib/progress.mjs'

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

/**
 * Generate a localized title for an entry given a target locale code.
 * Keeps the original title as the trunk and prefixes with a locale tag so
 * dashboards rendering the title still show recognizable provenance.
 */
function localizedTitle(originalTitle, localeCode) {
  // tag like "[fr-FR]" — uppercases the region for readability
  const parts = localeCode.split('-')
  const tag = parts.length === 2 ? `${parts[0]}-${parts[1].toUpperCase()}` : localeCode
  return `[${tag}] ${originalTitle || 'Untitled'}`
}

async function localizeForContentType(base, headers, ctUid, targets, opts) {
  const { maxPerCt, concurrency } = opts
  const { ok, body } = await listEntries(base, headers, ctUid, {
    limit: maxPerCt,
    desc: 'created_at',
    // Master locale read — we explicitly do NOT pass `locale` so we get the
    // entry as it exists in the stack's master.
  })
  if (!ok) {
    console.warn(`  ${ctUid}: listEntries failed — skipping`)
    return { localized: 0, skipped: 0 }
  }
  const entries = body.entries || []
  if (entries.length === 0) {
    console.log(`  ${ctUid}: 0 entries`)
    return { localized: 0, skipped: 0 }
  }

  // Work items = full (entry × target locale) cross-product. We DON'T
  // pre-check via getEntryLocales because that endpoint returns ALL stack
  // locales with a `localized:true/false` flag, and parsing it correctly
  // doubles the API call count. Instead, we issue the localizeEntry PUT
  // and let cma-api's 422 "already localized" response be the natural
  // idempotency signal. The progress logger counts those as fail=N so you
  // can see the existing-vs-new ratio at a glance.
  const workItems = []
  for (const entry of entries) {
    for (const target of targets) {
      workItems.push({ entry, target })
    }
  }

  console.log(
    `  ${ctUid}: ${entries.length} entries × ${targets.length} targets = ${workItems.length} localize attempts (422s on already-localized are expected)`,
  )

  const progress = createProgress({
    label: `${ctUid} localize`,
    total: workItems.length,
    everyN: 20,
  })

  let localized = 0
  let skipped = 0
  await runWithConcurrency(
    workItems,
    async ({ entry, target }) => {
      const title = localizedTitle(entry.title, target)
      const fields = { title }
      if (DRY_RUN) {
        console.log(`    [dry-run] ${ctUid}/${entry.uid} → ${target}  "${title}"`)
        localized++
        progress.tick({ ok: true })
        return
      }
      const { ok: lOk, status, body: lBody } = await localizeEntry(base, headers, {
        contentTypeUid: ctUid,
        entryUid: entry.uid,
        locale: target,
        fields,
      })
      if (lOk) {
        localized++
        progress.tick({ ok: true })
      } else {
        skipped++
        progress.tick({ ok: false })
        if (status !== 422) {
          console.warn(
            `    ${ctUid}/${entry.uid} → ${target} failed (${status}): ${lBody?.error_message || JSON.stringify(lBody).slice(0, 120)}`,
          )
        }
      }
      await sleep(50)
    },
    { concurrency },
  )
  progress.done()
  return { localized, skipped }
}

async function main() {
  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  const headers = headersForToken(apiKey, tokens[0], branch)

  const targets = csv('CONTENTSTACK_LOCALIZE_TARGETS', ['fr-fr', 'de-de', 'en-gb'])
  const contentTypes = csv(
    'CONTENTSTACK_LOCALIZE_CONTENT_TYPES',
    deriveContentTypesFromManifest(),
  )
  const maxPerCt = parseInt(optionalEnv('CONTENTSTACK_LOCALIZE_MAX_PER_CT', '10'), 10)
  const concurrency = parseInt(optionalEnv('CONTENTSTACK_LOCALIZE_CONCURRENCY', '6'), 10)

  if (contentTypes.length === 0) {
    console.error('No content types. Set CONTENTSTACK_LOCALIZE_CONTENT_TYPES.')
    process.exit(1)
  }

  console.log(`localize-entries`)
  console.log(`  stack:    api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  targets:  ${targets.join(', ')}`)
  console.log(`  CTs:      ${contentTypes.join(', ')}`)
  console.log(`  maxPerCt: ${maxPerCt}   concurrency: ${concurrency}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  let totalL = 0
  let totalS = 0
  for (const ctUid of contentTypes) {
    const { localized, skipped } = await localizeForContentType(
      base,
      headers,
      ctUid,
      targets,
      { maxPerCt, concurrency },
    )
    totalL += localized
    totalS += skipped
  }
  console.log(`\n✓ done — ${totalL} localized, ${totalS} skipped`)
}

main().catch((err) => {
  console.error('localize-entries failed:', err)
  process.exit(1)
})
