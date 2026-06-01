#!/usr/bin/env node
/**
 * seed-locales-branches.mjs
 *
 * Ensures the locales and branches declared in scripts/locales-branches.manifest.json
 * exist on the stack. Idempotent — anything already present is skipped.
 *
 * Why:
 *   - Locales widen the (entry, locale) cardinality so the dashboard's per-locale
 *     filters bite on real variation. Locale CREATE itself is silent on the
 *     metering side; the value is downstream — publishing/transit operations
 *     into multiple locales emit extra meter docs keyed by `dimensions.locale`.
 *   - Branches do the same for `dimensions.branch_uid`. Branch creation is async
 *     so the script polls until the branch shows up in listBranches.
 *
 * Token: stack-level CONTENTSTACK_MANAGEMENT_TOKEN.
 *
 * Usage:
 *   node --env-file=.env scripts/seed-locales-branches.mjs
 *   node --env-file=.env scripts/seed-locales-branches.mjs --dry-run
 *   node --env-file=.env scripts/seed-locales-branches.mjs --only locales
 *   node --env-file=.env scripts/seed-locales-branches.mjs --only branches
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
  listBranches,
  branchExists,
  createBranch,
  pollBranchReady,
} from './lib/cma.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const onlyIdx = argv.indexOf('--only')
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1] : null

async function seedLocales(base, headers, locales) {
  if (ONLY && ONLY !== 'locales') return { created: 0, skipped: 0 }
  console.log(`\n→ ${locales.length} locale(s) declared`)
  let created = 0
  let skipped = 0
  for (const l of locales) {
    const exists = await localeExists(base, headers, l.code)
    if (exists) {
      console.log(`  ${l.code} already exists — skipping`)
      skipped++
      continue
    }
    if (DRY_RUN) {
      console.log(`  [dry-run] would create ${l.code} (${l.name})`)
      created++
      continue
    }
    const { ok, status, body } = await createLocale(base, headers, l)
    if (ok) {
      console.log(`  ✓ ${l.code} created`)
      created++
    } else {
      console.error(`  ✗ ${l.code} failed (${status}):`, body?.error_message || body?.errors || body)
    }
  }
  return { created, skipped }
}

async function seedBranches(base, headers, branches) {
  if (ONLY && ONLY !== 'branches') return { created: 0, skipped: 0 }
  console.log(`\n→ ${branches.length} branch(es) declared`)
  let created = 0
  let skipped = 0
  for (const b of branches) {
    const exists = await branchExists(base, headers, b.uid)
    if (exists) {
      console.log(`  branch "${b.uid}" already exists — skipping`)
      skipped++
      continue
    }
    if (DRY_RUN) {
      console.log(`  [dry-run] would create branch "${b.uid}" from "${b.source}"`)
      created++
      continue
    }
    const { ok, status, body } = await createBranch(base, headers, b)
    if (!ok) {
      // 401 = plan or token doesn't include Branches feature. Not actionable
      // from this script — print a clear hint and move on without failing
      // the whole pipeline.
      if (status === 401) {
        console.warn(
          `  ⚠ branch "${b.uid}" — 401 Access denied. Either the stack's plan doesn't include Branches, or this management token wasn't issued with branch permissions. Skipping (non-fatal).`,
        )
      } else {
        console.error(`  ✗ branch "${b.uid}" failed (${status}):`, body?.error_message || body?.errors || body)
      }
      continue
    }
    console.log(`  ✓ branch "${b.uid}" create accepted — polling for readiness…`)
    const ready = await pollBranchReady(base, headers, b.uid, { timeoutMs: 90_000 })
    if (ready) {
      console.log(`  ✓ branch "${b.uid}" is ready`)
      created++
    } else {
      console.warn(`  ⚠ branch "${b.uid}" not visible after 90s — check the org bulk task queue`)
    }
  }
  return { created, skipped }
}

async function main() {
  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  // Don't set the `branch` header when listing/creating branches — we want the
  // stack-level view, not branch-scoped.
  const headers = headersForToken(apiKey, tokens[0]) // branch deliberately omitted

  const manifestPath =
    process.env.CONTENTSTACK_LOCALES_BRANCHES_MANIFEST_PATH ||
    resolve(__dirname, 'locales-branches.manifest.json')

  console.log(`locales+branches manifest: ${manifestPath}`)
  console.log(`stack: api_key=${apiKey.slice(0, 10)}…  host=${base}  active branch (entries scope)=${branch || '(none)'}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')
  if (ONLY) console.log(`** --only ${ONLY} **`)

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const locales = manifest.locales || []
  const branches = manifest.branches || []

  const localeResult = await seedLocales(base, headers, locales)
  const branchResult = await seedBranches(base, headers, branches)

  console.log(
    `\n✓ done — locales: ${localeResult.created} created, ${localeResult.skipped} skipped; branches: ${branchResult.created} created, ${branchResult.skipped} skipped`,
  )
}

main().catch((err) => {
  console.error('seed-locales-branches failed:', err)
  process.exit(1)
})
