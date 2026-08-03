#!/usr/bin/env node
/**
 * top-url-drive.mjs — TRACK 1 of two independent automation tracks.
 *
 *   Track 1 (this file)  npm run automate:top-url
 *     The top-URL site + Launch warming. Auth = stack API key + MANAGEMENT TOKEN
 *     + DELIVERY TOKEN. Nothing else. Runs standalone, cannot be broken by a
 *     stale password / expired TOTP / rotated authtoken.
 *
 *   Track 2             npm run automate:drive   (scripts/drive-all.mjs)
 *     The heavy data-generation pipeline: locales, branches, workflow
 *     transitions, org invites, meter-coverage scenarios. Several of those steps
 *     genuinely need a USER SESSION (Contentstack does not let a management
 *     token change workflow stages, create stacks, or invite org users), so that
 *     track keeps CONTENTSTACK_USER_EMAIL / _PASSWORD / _TOTP_SECRET.
 *
 * Launch warming runs in BOTH tracks, on purpose:
 *   - Track 2 warms right after it generates, so freshly published entries get
 *     hit while they are new (the original behaviour, kept).
 *   - Track 1 (this file) warms on its own cron, so the site keeps being warmed
 *     when the heavy pipeline is failing — previously those warm steps were
 *     guarded by `if: success()` inside Track 2, so one broken generation step
 *     meant the site went un-warmed entirely. That was the bug.
 *
 * To make "token-only" a guarantee rather than a convention, every CONTENTSTACK_USER_*
 * variable is stripped from the child environment below. If a step in this track
 * ever tries to open a user session it will fail loudly instead of silently
 * re-coupling the two tracks.
 *
 * Steps:
 *   1. top-url-entries.mjs   — ensure `top_url_lines`, create + publish rows,
 *                              read them back over the Delivery API. Required.
 *   2. warm-launch-urls.mjs  — GET every top-URL entry page on the Launch site.
 *                              Optional: self-skips when LAUNCH_SITE_URL is unset.
 *
 * Run: npm run automate:top-url            (local, reads .env)
 *      npm run automate:top-url:ci         (CI, env comes from the workflow)
 *      npm run automate:top-url -- --dry-run
 */

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import process from 'node:process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')

const RUN_REPORT_DIR = mkdtempSync(resolve(tmpdir(), 'top-url-report-'))
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * Base env for every child: the parent env minus the user-session family.
 * Deleting rather than blanking matters — the helpers in lib/cma.mjs treat an
 * empty string as unset anyway, but deleting also keeps the values out of any
 * child that shells out further.
 */
function tokenOnlyEnv() {
  const env = { ...process.env }
  const stripped = Object.keys(env).filter((k) => k.startsWith('CONTENTSTACK_USER_'))
  for (const k of stripped) delete env[k]
  return { env, stripped }
}

const { env: BASE_ENV, stripped: STRIPPED_KEYS } = tokenOnlyEnv()

/**
 * Content types whose entry pages get warmed: the top-URL one first, then the
 * ones the site lists, de-duplicated and order-preserving.
 */
function defaultWarmUids() {
  const topUid = process.env.TOP_URL_CONTENT_TYPE_UID?.trim() || 'top_url_lines'
  const siteUids = (process.env.VITE_CONTENTSTACK_CONTENT_TYPE_UIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set([topUid, ...siteUids])].join(',')
}

function runStep(name, script, extraArgs = [], extraEnv = {}) {
  const stepSlug = slug(name)
  return new Promise((resolveStep) => {
    const start = Date.now()
    console.log(`\n${'━'.repeat(60)}\n▶ ${name}\n${'━'.repeat(60)}`)
    const child = spawn(
      'node',
      [resolve(__dirname, script), ...extraArgs, ...(DRY_RUN ? ['--dry-run'] : [])],
      {
        stdio: 'inherit',
        env: { ...BASE_ENV, ...extraEnv, RUN_REPORT_DIR, RUN_STEP_SLUG: stepSlug },
      },
    )
    child.on('close', (code) => {
      const ms = Date.now() - start
      console.log(`${code === 0 ? '✓' : '✗'} ${name} → ${code === 0 ? 'ok' : `exit ${code}`} (${(ms / 1000).toFixed(1)}s)`)
      let report = null
      const f = resolve(RUN_REPORT_DIR, `${stepSlug}.json`)
      if (existsSync(f)) {
        try { report = JSON.parse(readFileSync(f, 'utf-8')) } catch { /* ignore */ }
      }
      resolveStep({ name, code, ms, report })
    })
    child.on('error', (err) => {
      console.error(`✗ ${name} → spawn error: ${err.message}`)
      resolveStep({ name, code: 1, ms: Date.now() - start, report: null })
    })
  })
}

async function main() {
  const startedAt = new Date().toISOString()
  console.log('━'.repeat(60))
  console.log('top-url-drive — token-only track (management + delivery token)')
  console.log('━'.repeat(60))
  console.log(
    STRIPPED_KEYS.length
      ? `user-session env stripped from all steps: ${STRIPPED_KEYS.join(', ')}`
      : 'user-session env: none present (nothing to strip)',
  )
  if (DRY_RUN) console.log('mode: --dry-run')

  const results = []

  // 1. Content — required. Ensures the CT exists, so a fresh stack works with
  //    no bootstrap run and no manifest edit.
  results.push(await runStep('top url entries', 'top-url-entries.mjs'))

  // 2. Launch warming — one GET per PUBLISHED entry page. The app is a
  //    HashRouter, so every entry is its own page at
  //    /#/entry/:contentTypeUid/:entryUid; warm-launch-urls.mjs enumerates
  //    entries over the Delivery API and hits each one.
  //
  //    Default coverage is the top-URL content type PLUS whatever the site
  //    itself lists (VITE_CONTENTSTACK_CONTENT_TYPE_UIDS), so this standalone
  //    run hits every published entry page even when the Track 2 data-gen
  //    workflow — which also warms, right after it generates — is failing.
  //    The overlap between the two tracks is intentional.
  const warmUids =
    process.env.TOP_URL_WARM_CONTENT_TYPE_UIDS || defaultWarmUids()
  results.push(
    await runStep('warm launch urls', 'warm-launch-urls.mjs', [], {
      VITE_CONTENTSTACK_CONTENT_TYPE_UIDS: warmUids,
    }),
  )

  // ── Summary ───────────────────────────────────────────────────────────────
  const finishedAt = new Date().toISOString()
  const kpis = {}
  for (const r of results) {
    for (const [k, v] of Object.entries(r.report?.kpis ?? {})) {
      if (typeof v === 'number') kpis[k] = (kpis[k] || 0) + v
    }
  }
  const okCount = results.filter((r) => r.code === 0).length

  console.log(`\n${'━'.repeat(60)}`)
  console.log(`top-url-drive: ${okCount}/${results.length} steps ok · ${((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000).toFixed(1)}s`)
  for (const r of results) {
    console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.name} (${(r.ms / 1000).toFixed(1)}s)`)
  }
  if (Object.keys(kpis).length) {
    console.log('  KPIs: ' + Object.entries(kpis).map(([k, v]) => `${k}=${v}`).join('  '))
  }
  if (!process.env.LAUNCH_SITE_URL) {
    console.log('  note: LAUNCH_SITE_URL unset — Launch warming was skipped.')
  }
  console.log('━'.repeat(60))

  // Step 1 is required; step 2 self-skips when unconfigured, so only step 1 gates.
  if (results[0].code !== 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
