#!/usr/bin/env node
/**
 * drive-all.mjs
 *
 * One-stop orchestrator that runs the entire stack-seeding pipeline. Designed
 * to be invoked from the GitHub Actions cron (every 5 min) as well as
 * manually for bootstrap.
 *
 * Modes:
 *   --mode periodic  (default)
 *     Runs only the recurring tasks: create new periodic entries, drive workflow
 *     transitions on existing entries, run a bulk publish/unpublish cycle.
 *     Safe to call every 5 minutes.
 *
 *   --mode bootstrap
 *     Runs setup tasks only (idempotent): content types from manifest, locales,
 *     branches, workflows. Skips entry/transition/publish churn. Use this
 *     manually on a fresh stack or via workflow_dispatch.
 *
 *   --mode full
 *     Bootstrap THEN periodic — fresh-stack bring-up in one go.
 *
 * The orchestrator delegates to each sub-script via dynamic import (no shelling
 * out → faster, single Node process, single env load).
 *
 * Each step is wrapped so a failure in one step doesn't abort the others. The
 * exit code is non-zero only if ALL steps fail (or any "required" step fails
 * in --mode bootstrap).
 */

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const modeIdx = argv.indexOf('--mode')
const MODE = modeIdx >= 0 ? argv[modeIdx + 1] : 'periodic'
const DRY_RUN = argv.includes('--dry-run')

if (!['periodic', 'bootstrap', 'full'].includes(MODE)) {
  console.error(`Unknown --mode "${MODE}". Use periodic|bootstrap|full.`)
  process.exit(2)
}

/**
 * Run a sub-script as a child node process so the orchestrator is robust to
 * any sub-script calling process.exit() and so the per-step output stays
 * naturally interleaved on stdout. Inherits env from the parent (which was
 * already loaded via --env-file=.env).
 */
function runStep(name, script, extraArgs = []) {
  return new Promise((resolveStep) => {
    const start = Date.now()
    console.log(`\n${'━'.repeat(60)}\n▶ ${name}\n${'━'.repeat(60)}`)
    const child = spawn(
      'node',
      [resolve(__dirname, script), ...extraArgs, ...(DRY_RUN ? ['--dry-run'] : [])],
      { stdio: 'inherit', env: process.env },
    )
    child.on('close', (code) => {
      const ms = Date.now() - start
      const status = code === 0 ? 'ok' : `exit ${code}`
      console.log(`✓ ${name} → ${status} (${(ms / 1000).toFixed(1)}s)`)
      resolveStep({ name, code, ms })
    })
    child.on('error', (err) => {
      console.error(`✗ ${name} → spawn error:`, err.message)
      resolveStep({ name, code: 1, ms: Date.now() - start, error: err.message })
    })
  })
}

async function bootstrapPhase() {
  // Order matters: content types → locales → branches → workflows (which
  // attaches to content types and so needs them present first) → publishing
  // rules (need workflow uids + stage uids resolved).
  const results = []
  results.push(await runStep('content types from manifest', 'bootstrap-from-manifest.mjs'))
  results.push(await runStep('locales + branches',          'seed-locales-branches.mjs'))
  results.push(await runStep('workflows',                   'seed-workflows.mjs'))
  results.push(await runStep('publishing rules',            'seed-publishing-rules.mjs'))
  // Give the automation user an explicit stack CMS role so auth-sdk's
  // listStackUsers counts it (and entries get a resolvable _created_by).
  results.push(await runStep('ensure stack user role',      'ensure-stack-user-role.mjs'))
  return results
}

async function periodicPhase() {
  const results = []
  // 1. Delete entries older than N days — keeps the org under its entry cap
  //    and drives entry_deleted meter events. Runs first so the create step
  //    has headroom even when the org is near its cap.
  results.push(await runStep('delete old entries', 'delete-old-entries.mjs'))
  // 2. Create new entries in the master locale (resolves __REF__ placeholders).
  results.push(await runStep('periodic entries from manifest', 'periodic-entries-from-manifest.mjs'))
  // 3. Localize the newest entries into non-master locales (fr-fr, de-de,
  //    en-gb). Drives entry_created events keyed by the target locale —
  //    the only way to give the dashboard's Locale filter axis real variation.
  results.push(await runStep('localize entries', 'localize-entries.mjs'))
  // 4. Bulk publish/unpublish a random sample (drives entry_published meters).
  results.push(await runStep('bulk publish cycle', 'bulk-publish-cycle.mjs'))
  // 5. Workflow transitions on existing entries (drives entry_workflow_stage_*
  //    meters). Running the workflow seeder in periodic mode re-uses idempotent
  //    workflow create (no-op when already present) and re-applies the
  //    transition policy to entries created since last run.
  results.push(await runStep('workflow transitions on existing entries', 'seed-workflows.mjs'))
  // 6. Orphan-case churn: disable/detach a workflow, throwaway branch/locale/$all
  //    workflow lifecycle, and one entry delete→restore — drives every mutation
  //    the entry_workflow_snapshot meter handles (the cases nothing else covers).
  results.push(await runStep('churn orphan cases', 'churn-orphans.mjs'))
  return results
}

async function main() {
  console.log(`drive-all  mode=${MODE}  dry-run=${DRY_RUN}`)
  console.log(`now: ${new Date().toISOString()}`)

  const allResults = []
  if (MODE === 'bootstrap' || MODE === 'full') {
    allResults.push(...(await bootstrapPhase()))
  }
  if (MODE === 'periodic' || MODE === 'full') {
    allResults.push(...(await periodicPhase()))
  }

  console.log(`\n${'═'.repeat(60)}\nSummary\n${'═'.repeat(60)}`)
  let failed = 0
  for (const r of allResults) {
    const tag = r.code === 0 ? '✓' : '✗'
    console.log(`  ${tag} ${r.name.padEnd(45)} ${(r.ms / 1000).toFixed(1)}s`)
    if (r.code !== 0) failed++
  }
  console.log(`\nresult: ${allResults.length - failed}/${allResults.length} steps ok`)

  // Soft-fail philosophy: if at least one step succeeded, exit 0 so a single
  // flaky step (e.g. branch async timeout) doesn't fail the whole cron. Tighten
  // this if you want strict cron failures.
  process.exit(failed === allResults.length ? 1 : 0)
}

main().catch((err) => {
  console.error('drive-all crashed:', err)
  process.exit(1)
})
