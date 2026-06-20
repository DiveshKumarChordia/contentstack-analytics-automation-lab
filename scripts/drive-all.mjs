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
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const modeIdx = argv.indexOf('--mode')
const MODE = modeIdx >= 0 ? argv[modeIdx + 1] : 'periodic'
const DRY_RUN = argv.includes('--dry-run')

if (!['periodic', 'bootstrap', 'full'].includes(MODE)) {
  console.error(`Unknown --mode "${MODE}". Use periodic|bootstrap|full.`)
  process.exit(2)
}

// Per-step KPI reports: each child writes ${RUN_REPORT_DIR}/${slug}.json via
// lib/report.mjs; runStep reads it back on close.
const RUN_REPORT_DIR = mkdtempSync(resolve(tmpdir(), 'drive-report-'))
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const MAX_HISTORY = parseInt(process.env.RUN_HISTORY_MAX || '300', 10)

/**
 * Run a sub-script as a child node process so the orchestrator is robust to
 * any sub-script calling process.exit() and so the per-step output stays
 * naturally interleaved on stdout. Inherits env from the parent (which was
 * already loaded via --env-file=.env).
 */
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
        env: { ...process.env, ...extraEnv, RUN_REPORT_DIR, RUN_STEP_SLUG: stepSlug },
      },
    )
    child.on('close', (code) => {
      const ms = Date.now() - start
      const status = code === 0 ? 'ok' : `exit ${code}`
      console.log(`✓ ${name} → ${status} (${(ms / 1000).toFixed(1)}s)`)
      // Pick up the step's KPI report if it wrote one.
      let report = null
      const f = resolve(RUN_REPORT_DIR, `${stepSlug}.json`)
      if (existsSync(f)) {
        try { report = JSON.parse(readFileSync(f, 'utf-8')) } catch { /* ignore */ }
      }
      resolveStep({ name, code, ms, report })
    })
    child.on('error', (err) => {
      console.error(`✗ ${name} → spawn error:`, err.message)
      resolveStep({ name, code: 1, ms: Date.now() - start, error: err.message, report: null })
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
  // 0. Ensure the content types exist (idempotent — skips ones already present,
  //    skips re-seeding). Without this, a stack that was never bootstrapped fails
  //    every create/localize/publish/workflow step with "Content Type not found".
  //    (Run `--mode full` once for locales/branches/workflows too.)
  results.push(
    await runStep('ensure content types', 'bootstrap-from-manifest.mjs', [], {
      CONTENTSTACK_MANIFEST_SKIP_SEEDS: 'true',
    }),
  )
  // 1. Tiered retention — trim each age band to its target population (keeps the
  //    org under its entry cap and drives entry_deleted meter events). Runs first
  //    so the create step has headroom.
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
  // 7. Branch-lifecycle: a 30-branch lineage exercising multi-branch entries+locales,
  //    workflow branch/CT extension, a dynamic content type, assigned-to transitions,
  //    and a multi-branch publish rule. No teardown (analytics-data-sync needs Mongo data).
  //    Heavy (async branch create/poll ×30) so it's opt-out via env.
  if (process.env.CONTENTSTACK_BRANCH_LIFECYCLE_ENABLED !== 'false') {
    results.push(await runStep('branch lifecycle', 'branch-lifecycle.mjs'))
  }
  // 8. Meter-coverage scenarios: drive unmeasured dimensions from analytics pipeline.
  //    Each scenario is opt-in via env.
  if (process.env.CONTENTSTACK_EDIT_AFTER_PUBLISH_ENABLED !== 'false') {
    results.push(await runStep('edit after publish (entries_in_progress)', 'edit-after-publish.mjs'))
  }
  if (process.env.CONTENTSTACK_PERMANENT_DELETE_ENABLED !== 'false') {
    results.push(await runStep('permanent deletes (entries_deleted)', 'permanent-deletes.mjs'))
  }
  if (process.env.CONTENTSTACK_AGED_STALL_ENABLED !== 'false') {
    results.push(await runStep('aged stalls (stalled_by_stage)', 'aged-stalls.mjs'))
  }
  if (process.env.CONTENTSTACK_NO_WORKFLOW_ENABLED !== 'false') {
    results.push(await runStep('no-workflow CT (entries_without_workflow)', 'no-workflow-ct.mjs'))
  }
  if (process.env.CONTENTSTACK_MULTI_ACTOR_ENABLED !== 'false') {
    results.push(await runStep('multi-actor create/publish (user_uid)', 'multi-actor-create-publish.mjs'))
  }
  if (process.env.CONTENTSTACK_BRANCH_LOCALE_DELETE_ENABLED !== 'false') {
    results.push(await runStep('branch/locale deletion (orphan cleanup)', 'branch-locale-deletion.mjs'))
  }
  // 9. User invitation: invite 10 new users per run (org-level metering).
  //    Opt-out via env; requires CONTENTSTACK_USER_EMAIL + PASSWORD (UI automation).
  if (process.env.CONTENTSTACK_USER_INVITER_ENABLED !== 'false') {
    results.push(await runStep('invite 10 users', 'invite-users.mjs'))
  }
  return results
}

// ── Run-report assembly ──────────────────────────────────────────────────────

/** Flatten per-step reports into one run record + aggregate KPIs + error audit. */
function buildRecord(results, startedAt, finishedAt) {
  const steps = results.map((r) => ({
    name: r.name,
    ok: r.code === 0,
    ms: r.ms,
    planned: r.report?.planned ?? null,
    actual: r.report?.actual ?? null,
    failed: r.report?.failed ?? 0,
    kpis: r.report?.kpis ?? {},
    errors: r.report?.errors ?? [],
  }))
  const kpis = {}
  for (const s of steps) {
    for (const [k, v] of Object.entries(s.kpis)) {
      if (typeof v === 'number') kpis[k] = (kpis[k] || 0) + v
    }
  }
  const errors = []
  for (const s of steps) {
    if (!s.ok && !(s.errors && s.errors.length)) {
      errors.push({ step: s.name, label: null, message: 'step exited non-zero' })
    }
    for (const e of s.errors || []) {
      errors.push({ step: s.name, label: e.label || null, message: e.message })
    }
  }
  const stepsOk = steps.filter((s) => s.ok).length
  return {
    runId: process.env.GITHUB_RUN_ID || `local-${startedAt}`,
    runNumber: process.env.GITHUB_RUN_NUMBER ? Number(process.env.GITHUB_RUN_NUMBER) : null,
    instance: process.env.INSTANCE || 'local',
    mode: MODE,
    dryRun: DRY_RUN,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    stepsOk,
    stepsTotal: steps.length,
    kpis,
    steps,
    errors,
  }
}

/** GitHub Actions job-summary markdown — rendered on the run page. */
function renderMarkdown(rec) {
  const esc = (s) => String(s).replace(/\|/g, '\\|')
  const L = []
  L.push(`## 🤖 Automation run — ${rec.mode}${rec.dryRun ? ' (dry-run)' : ''}`)
  L.push('')
  L.push(
    `**${rec.stepsOk}/${rec.stepsTotal} steps ok** · ${(rec.durationMs / 1000).toFixed(1)}s · ` +
      `instance \`${rec.instance}\` · run \`${rec.runId}\``,
  )
  L.push('')
  const kpiEntries = Object.entries(rec.kpis)
  if (kpiEntries.length) {
    L.push('### KPIs')
    L.push('| Metric | Count |')
    L.push('|---|--:|')
    for (const [k, v] of kpiEntries) L.push(`| ${k} | ${v} |`)
    L.push('')
  }
  L.push('### Steps — planned vs actual')
  L.push('| Step | Result | Planned | Actual | Failed | Time |')
  L.push('|---|:--:|--:|--:|--:|--:|')
  for (const s of rec.steps) {
    L.push(
      `| ${esc(s.name)} | ${s.ok ? '✅' : '❌'} | ${s.planned ?? '–'} | ${s.actual ?? '–'} | ${s.failed || 0} | ${(s.ms / 1000).toFixed(1)}s |`,
    )
  }
  L.push('')
  if (rec.errors.length) {
    L.push('### ⚠️ Error audit log')
    L.push('| Step | Case | Message |')
    L.push('|---|---|---|')
    for (const e of rec.errors.slice(0, 40)) {
      L.push(`| ${esc(e.step)} | ${esc(e.label || '–')} | ${esc(String(e.message).slice(0, 200))} |`)
    }
  } else {
    L.push('_No errors this run._ ✅')
  }
  return L.join('\n')
}

/** Append the record to the rolling run-history JSON the /runs dashboard reads. */
function appendHistory(rec) {
  try {
    const dir = resolve(repoRoot, 'public')
    mkdirSync(dir, { recursive: true })
    const file = resolve(dir, 'run-history.json')
    let history = []
    if (existsSync(file)) {
      try { history = JSON.parse(readFileSync(file, 'utf-8')) } catch { history = [] }
    }
    if (!Array.isArray(history)) history = []
    history.push(rec)
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY)
    writeFileSync(file, JSON.stringify(history, null, 2), 'utf-8')
    console.log(`run-history: ${history.length} runs → public/run-history.json`)
  } catch (e) {
    console.warn('run-history append failed:', e.message)
  }
}

async function main() {
  const startedAt = new Date().toISOString()
  console.log(`drive-all  mode=${MODE}  dry-run=${DRY_RUN}`)
  console.log(`now: ${startedAt}`)

  const allResults = []
  if (MODE === 'bootstrap' || MODE === 'full') {
    allResults.push(...(await bootstrapPhase()))
  }
  if (MODE === 'periodic' || MODE === 'full') {
    allResults.push(...(await periodicPhase()))
  }

  const record = buildRecord(allResults, startedAt, new Date().toISOString())

  console.log(`\n${'═'.repeat(60)}\nSummary\n${'═'.repeat(60)}`)
  for (const s of record.steps) {
    const tag = s.ok ? '✓' : '✗'
    const pa = s.actual != null ? `  (${s.actual}${s.planned != null ? `/${s.planned}` : ''})` : ''
    console.log(`  ${tag} ${s.name.padEnd(42)} ${(s.ms / 1000).toFixed(1)}s${pa}`)
  }
  console.log(`\nresult: ${record.stepsOk}/${record.stepsTotal} steps ok`)

  // 1) Per-run analytics on the GitHub Actions run page.
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderMarkdown(record) + '\n')
    } catch (e) {
      console.warn('step summary write failed:', e.message)
    }
  }
  // 2) Rolling history for the /runs dashboard.
  appendHistory(record)

  // Soft-fail: exit non-zero only if EVERY step failed.
  process.exit(record.stepsOk === 0 && record.stepsTotal > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('drive-all crashed:', err)
  process.exit(1)
})
