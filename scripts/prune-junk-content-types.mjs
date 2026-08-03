#!/usr/bin/env node
/**
 * prune-junk-content-types.mjs — reclaim organization content-type quota.
 *
 * Why this exists: scripts/no-workflow-ct.mjs (a Track 2 / drive-all step) mints
 * a brand-new throwaway content type named `no_wf_<base36 stamp>` on every run
 * and never removes one. At a 5-minute cron that is ~288 new content types a
 * day. Once the organization hits its content-type limit, EVERY create fails
 * with error_code 133 — including unrelated tracks. That is what stopped
 * `top_url_lines` from being creatable.
 *
 * DESTRUCTIVE: deleting a content type with force=true also deletes its entries.
 * That is the intent here (these are per-run throwaways), but it is why this
 * script is dry-run by default and needs an explicit --yes.
 *
 * Auth: stack API key + management token only. No user session.
 *
 * Usage:
 *   npm run automate:prune-cts                  # dry run — prints the plan
 *   npm run automate:prune-cts -- --yes         # actually delete
 *   npm run automate:prune-cts -- --keep 5      # keep the 5 newest matches
 *   npm run automate:prune-cts -- --pattern '^tmp_' --yes
 *   npm run automate:prune-cts -- --max 10 --yes   # delete at most 10 this run
 */

import process from 'node:process'
import {
  loadStackAuth,
  managementHeaders,
  listContentTypes,
  deleteContentType,
  sleep,
} from './lib/cma.mjs'

const argv = process.argv.slice(2)

function flag(name) {
  return argv.includes(`--${name}`)
}
function value(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  if (i < 0 || i + 1 >= argv.length) return fallback
  return argv[i + 1]
}
function intFlag(name, fallback) {
  const raw = value(name, null)
  if (raw == null || !/^\d+$/.test(raw)) return fallback
  return Number.parseInt(raw, 10)
}

// --dry-run is accepted (drive-style orchestrators append it) but redundant:
// dry run is the default and only --yes opts out of it.
const APPLY = flag('yes') && !flag('dry-run')
const KEEP = intFlag('keep', 2)
const MAX = intFlag('max', 0) // 0 = no cap
const PATTERN = value('pattern', '^no_wf_')

async function main() {
  const { apiKey, token, base, branch } = loadStackAuth()
  const headers = managementHeaders(apiKey, token, branch)

  let re
  try {
    re = new RegExp(PATTERN)
  } catch (e) {
    console.error(`Invalid --pattern ${PATTERN}: ${e.message}`)
    process.exit(2)
  }

  const { ok, status, body } = await listContentTypes(base, headers, { limit: 100 })
  if (!ok) {
    console.error(`Could not list content types (HTTP ${status}).`)
    process.exit(1)
  }
  const all = Array.isArray(body.content_types) ? body.content_types : []

  const matches = all
    .filter((c) => re.test(String(c?.uid ?? '')))
    // Oldest first, so --keep retains the most recent (still-interesting) ones.
    .sort((a, b) => Date.parse(a.created_at ?? 0) - Date.parse(b.created_at ?? 0))

  console.log(`prune-junk-content-types  ${APPLY ? '(APPLY)' : '(dry run)'}`)
  console.log(`  stack:   ${base}  branch=${branch || '(default)'}`)
  console.log(`  total content types on stack: ${body.count ?? all.length}`)
  console.log(`  pattern /${PATTERN}/ matched: ${matches.length}`)
  console.log(`  keeping newest: ${KEEP}${MAX ? `   deleting at most: ${MAX}` : ''}`)

  let doomed = KEEP > 0 ? matches.slice(0, Math.max(0, matches.length - KEEP)) : matches
  if (MAX > 0) doomed = doomed.slice(0, MAX)

  if (doomed.length === 0) {
    console.log('\nNothing to prune.')
    return
  }

  console.log(`\n${doomed.length} content type(s) would be deleted (with their entries):`)
  for (const c of doomed) {
    console.log(`  - ${c.uid}   created ${c.created_at ?? '?'}`)
  }

  if (!APPLY) {
    console.log(
      '\nDry run — nothing was deleted. Re-run with --yes to apply:\n' +
        `  npm run automate:prune-cts -- --keep ${KEEP}${MAX ? ` --max ${MAX}` : ''} --yes`,
    )
    return
  }

  let deleted = 0
  const failures = []
  for (const c of doomed) {
    const res = await deleteContentType(base, headers, c.uid, { force: true })
    if (res.ok) {
      deleted += 1
      console.log(`  ✓ deleted ${c.uid}`)
    } else {
      const msg = res.body?.error_message ?? `HTTP ${res.status}`
      failures.push({ uid: c.uid, msg })
      console.warn(`  ✗ ${c.uid} → ${msg}`)
    }
    await sleep(200)
  }

  console.log(`\nDeleted ${deleted}/${doomed.length}. Freed ${deleted} organization content-type slot(s).`)
  if (failures.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
