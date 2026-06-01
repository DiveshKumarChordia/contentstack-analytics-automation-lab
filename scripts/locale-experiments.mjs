#!/usr/bin/env node
/**
 * locale-experiments.mjs
 *
 * Runs locale fallback-chain experiments declared in
 * scripts/locale-experiments.manifest.json. Designed to be destructive — it
 * creates, populates, and DELETES locales. Gated behind
 * CONTENTSTACK_RUN_LOCALE_EXPERIMENTS=1 so it never fires accidentally from
 * the periodic cron.
 *
 * Drives:
 *   - entry_created keyed by non-master locale (when scenario populates entries)
 *   - entries_orphaned_by_locale_deleted (when scenario deletes a locale)
 *
 * Each scenario:
 *   1. Creates declared locales (idempotent)
 *   2. Picks the newest entries in each content type (master locale) and
 *      localizes them to each new locale (capped at entriesPerLocale)
 *   3. Executes deletePlan in declared order, recording the outcome
 *   4. Optionally recreates the locales (recreateAfterDelete=true)
 *
 * Token: stack-level CONTENTSTACK_MANAGEMENT_TOKEN.
 *
 * Usage:
 *   CONTENTSTACK_RUN_LOCALE_EXPERIMENTS=1 npm run automate:locale-experiments
 *   CONTENTSTACK_RUN_LOCALE_EXPERIMENTS=1 npm run automate:locale-experiments -- --dry-run
 *   CONTENTSTACK_RUN_LOCALE_EXPERIMENTS=1 npm run automate:locale-experiments -- --only S2-leaf-delete
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listLocales,
  localeExists,
  createLocale,
  deleteLocale,
  listEntries,
  localizeEntry,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const onlyIdx = argv.indexOf('--only')
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1] : null

if (optionalEnv('CONTENTSTACK_RUN_LOCALE_EXPERIMENTS', '0') !== '1') {
  console.log(
    'locale-experiments is gated. Set CONTENTSTACK_RUN_LOCALE_EXPERIMENTS=1 to run.\n' +
      '(These scenarios CREATE and DELETE locales — destructive. Make sure the stack is OK with that.)',
  )
  process.exit(0)
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

async function ensureLocale(base, headers, l) {
  if (await localeExists(base, headers, l.code)) {
    console.log(`    locale ${l.code} already exists — skipping`)
    return { ok: true, skipped: true }
  }
  if (DRY_RUN) {
    console.log(`    [dry-run] create locale ${l.code} (fallback=${l.fallbackLocale || 'master'})`)
    return { ok: true, skipped: false }
  }
  const { ok, status, body } = await createLocale(base, headers, l)
  if (ok) {
    console.log(`    ✓ created ${l.code}`)
    return { ok: true, skipped: false }
  }
  console.error(`    ✗ create ${l.code} failed (${status}): ${body?.error_message || JSON.stringify(body).slice(0, 200)}`)
  return { ok: false, skipped: false }
}

async function populateEntriesIntoLocale(base, headers, contentTypes, localeCode, perLocale) {
  let localized = 0
  let skipped = 0
  for (const ctUid of contentTypes) {
    const { ok, body } = await listEntries(base, headers, ctUid, {
      limit: perLocale,
      desc: 'created_at',
    })
    if (!ok) {
      console.warn(`    ${ctUid}: listEntries failed`)
      continue
    }
    const entries = body.entries || []
    for (const entry of entries) {
      if (DRY_RUN) {
        console.log(`    [dry-run] localize ${ctUid}/${entry.uid} → ${localeCode}`)
        localized++
        continue
      }
      const parts = localeCode.split('-')
      const tag = parts.length === 2 ? `${parts[0]}-${parts[1].toUpperCase()}` : localeCode
      const title = `[${tag}] ${entry.title || 'Untitled'}`
      const { ok: lOk, status, body: lBody } = await localizeEntry(base, headers, {
        contentTypeUid: ctUid,
        entryUid: entry.uid,
        locale: localeCode,
        fields: { title },
      })
      if (lOk) {
        localized++
      } else {
        skipped++
        // 422 "entry already localized" is expected on re-runs; suppress noise.
        if (status !== 422) {
          console.warn(`    ${ctUid}/${entry.uid} → ${localeCode} failed (${status}): ${lBody?.error_message || ''}`)
        }
      }
      await sleep(50)
    }
  }
  return { localized, skipped }
}

async function executeDeletePlan(base, headers, plan) {
  const results = []
  for (const step of plan) {
    if (DRY_RUN) {
      console.log(`    [dry-run] DELETE locale ${step.code}`)
      results.push({ code: step.code, status: 'dry-run', ok: true })
      continue
    }
    const { ok, status, body } = await deleteLocale(base, headers, step.code)
    const detail = body?.error_message || (ok ? body?.notice : JSON.stringify(body).slice(0, 200))
    console.log(`    DELETE ${step.code} → ${status}  ${detail || ''}`)
    results.push({ code: step.code, status, ok, body })
    await sleep(200)
  }
  return results
}

async function runScenario(base, headers, scenario, contentTypes) {
  console.log(`\n━━━ scenario: ${scenario.id} ━━━`)
  console.log(`  ${scenario.description}`)

  console.log(`\n  → ensuring locales`)
  for (const l of scenario.locales) {
    await ensureLocale(base, headers, l)
  }

  if (scenario.entriesPerLocale && scenario.entriesPerLocale > 0) {
    console.log(`\n  → populating each locale with up to ${scenario.entriesPerLocale} entries per content type`)
    for (const l of scenario.locales) {
      console.log(`    locale: ${l.code}`)
      const { localized, skipped } = await populateEntriesIntoLocale(
        base, headers, contentTypes, l.code, scenario.entriesPerLocale,
      )
      console.log(`      ${l.code}: ${localized} localized, ${skipped} skipped`)
    }
  }

  if (scenario.deletePlan && scenario.deletePlan.length > 0) {
    console.log(`\n  → executing delete plan (${scenario.deletePlan.length} step(s))`)
    const results = await executeDeletePlan(base, headers, scenario.deletePlan)
    // Compare against expectations and surface any drift
    for (let i = 0; i < scenario.deletePlan.length; i++) {
      const step = scenario.deletePlan[i]
      const result = results[i]
      if (step.expectedResult === 'ok' && !result.ok) {
        console.warn(`    ⚠ unexpected: ${step.code} expected ok, got ${result.status}`)
      }
      if (step.expectedResult === 'tbd') {
        console.log(`    (TBD outcome for ${step.code}: ${result.ok ? 'succeeded' : 'failed'} with ${result.status})`)
      }
    }
  }

  if (scenario.recreateAfterDelete) {
    console.log(`\n  → recreating locales (recreateAfterDelete=true)`)
    for (const l of scenario.locales) {
      await ensureLocale(base, headers, l)
    }
  }
}

async function main() {
  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  // Branch header deliberately omitted — locale ops are stack-level.
  const headers = headersForToken(apiKey, tokens[0])

  const manifestPath =
    optionalEnv('CONTENTSTACK_LOCALE_EXPERIMENTS_MANIFEST_PATH') ||
    resolve(__dirname, 'locale-experiments.manifest.json')

  const contentTypes = deriveContentTypesFromManifest()

  console.log(`locale-experiments`)
  console.log(`  stack:    api_key=${apiKey.slice(0, 10)}…  host=${base}`)
  console.log(`  manifest: ${manifestPath}`)
  console.log(`  CTs:      ${contentTypes.join(', ') || '(none)'}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')
  if (ONLY) console.log(`** --only ${ONLY} **`)

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const scenarios = manifest.scenarios || []

  const filtered = ONLY ? scenarios.filter((s) => s.id === ONLY) : scenarios
  if (filtered.length === 0) {
    console.error(`No scenarios match --only ${ONLY}`)
    process.exit(1)
  }

  for (const s of filtered) {
    await runScenario(base, headers, s, contentTypes)
  }

  console.log(`\n✓ all ${filtered.length} scenario(s) done`)
}

main().catch((err) => {
  console.error('locale-experiments failed:', err)
  process.exit(1)
})
