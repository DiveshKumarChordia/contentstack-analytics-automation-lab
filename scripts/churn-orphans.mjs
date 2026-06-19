#!/usr/bin/env node
/**
 * churn-orphans.mjs
 *
 * Exercises the "orphan-creating" CMS mutations that the entry_workflow_snapshot
 * analytics meter is built to handle — the cases the rest of the pipeline
 * (create / localize / publish / transition) never produce. Each case is small
 * and (where it touches production) reversible, so blast radius stays tiny while
 * still driving every relevant event/state change.
 *
 * Cases (each toggleable; all wrapped so one failure never aborts the rest):
 *   1. workflow DISABLE → ENABLE   (reversible)         — workflow enabled toggle
 *   2. workflow CT DETACH → RE-ATTACH (reversible)      — scope-removal orphan + re-govern (Axis 2)
 *   3. throwaway BRANCH create → delete                 — branch-delete path (Axis 3)
 *   4. throwaway LOCALE create → delete                 — locale-delete path (Axis 4)
 *   5. throwaway $all WORKFLOW create → delete          — $all CT/branch governance + workflow delete
 *   6. one ENTRY delete → restore                       — entry soft-delete + restore (Axis 1)
 *
 * Workflow DEFINITION edits (create/update/delete/disable/detach) are within a
 * management token's scope; only entry STAGE transitions need a user session, so
 * this script runs entirely on the stack management token.
 *
 * Env knobs (all optional):
 *   CONTENTSTACK_CHURN_CASES   — CSV subset of: disable,detach,branch,locale,allwf,entry
 *                                (default: all)
 *   CONTENTSTACK_CHURN_CONTENT_TYPES — CSV; default = content-types manifest
 *
 * Usage:
 *   node --env-file=.env scripts/churn-orphans.mjs
 *   node --env-file=.env scripts/churn-orphans.mjs --dry-run
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  createBranch,
  deleteBranch,
  createLocale,
  deleteLocale,
  listEntries,
  deleteEntry,
  restoreEntry,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DRY_RUN = process.argv.slice(2).includes('--dry-run')

function csv(name, fallback) {
  const v = optionalEnv(name)
  if (!v) return fallback
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

function manifestContentTypes() {
  try {
    const m = JSON.parse(
      readFileSync(resolve(__dirname, 'content-types.manifest.json'), 'utf-8'),
    )
    return (m.contentTypes || []).map((ct) => ct.uid).filter(Boolean)
  } catch {
    return []
  }
}

// Short, sortable-ish suffix without Date.now collisions across CTs.
function stamp() {
  return new Date().toISOString().replace(/[^0-9]/g, '').slice(2, 14)
}

const results = []
function record(name, ok, note = '') {
  results.push({ name, ok, note })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`)
}

// ── Case 1: disable → enable a production workflow ──────────────────────────
async function caseDisableEnable(base, headers) {
  const { ok, body } = await listWorkflows(base, headers)
  const wf = (body.workflows || []).find((w) => !w.deleted_at)
  if (!ok || !wf) return record('disable→enable', false, 'no workflow found')
  if (DRY_RUN) return record('disable→enable', true, `[dry-run] ${wf.name}`)
  const off = await updateWorkflow(base, headers, wf.uid, { ...wf, enabled: false })
  await sleep(400)
  const on = await updateWorkflow(base, headers, wf.uid, { ...wf, enabled: true })
  record('disable→enable', off.ok && on.ok, `${wf.name} (off ${off.status}, on ${on.status})`)
}

// ── Case 2: detach a content_type from a workflow, then re-attach ───────────
async function caseDetachReattach(base, headers, contentTypes) {
  const { ok, body } = await listWorkflows(base, headers)
  const wf = (body.workflows || []).find(
    (w) => !w.deleted_at && (w.content_types || []).some((c) => c !== '$all'),
  )
  if (!ok || !wf) return record('detach→reattach CT', false, 'no scoped workflow')
  const full = (await getWorkflow(base, headers, wf.uid)).body?.workflow || wf
  const cts = (full.content_types || []).filter((c) => c !== '$all')
  const drop = cts[0]
  if (!drop) return record('detach→reattach CT', false, 'workflow has no specific CT')
  if (DRY_RUN) return record('detach→reattach CT', true, `[dry-run] ${full.name} ⟂ ${drop}`)
  const detached = await updateWorkflow(base, headers, wf.uid, {
    ...full,
    content_types: full.content_types.filter((c) => c !== drop),
  })
  await sleep(600) // brief orphan window for the hourly meter to observe
  const reattached = await updateWorkflow(base, headers, wf.uid, full)
  record(
    'detach→reattach CT',
    detached.ok && reattached.ok,
    `${full.name} ⟂ ${drop} (detach ${detached.status}, reattach ${reattached.status})`,
  )
}

// ── Case 3: throwaway branch create → delete ────────────────────────────────
async function caseBranchLifecycle(base, headers) {
  const uid = `churn-${stamp()}`
  if (DRY_RUN) return record('branch create→delete', true, `[dry-run] ${uid}`)
  const created = await createBranch(base, headers, { uid, source: 'main' })
  if (!created.ok) return record('branch create→delete', false, `create ${created.status}`)
  await sleep(1500) // branch create is async; give the job a moment
  const deleted = await deleteBranch(base, headers, uid)
  record('branch create→delete', deleted.ok, `${uid} (delete ${deleted.status})`)
}

// ── Case 4: throwaway locale create → delete ────────────────────────────────
async function caseLocaleLifecycle(base, headers) {
  // Use an uncommon code unlikely to clash with the seeded targets.
  const code = 'cy-gb' // Welsh — not in fr-fr/de-de/en-gb churn targets
  if (DRY_RUN) return record('locale create→delete', true, `[dry-run] ${code}`)
  const created = await createLocale(base, headers, {
    code,
    name: 'Welsh (churn)',
    fallbackLocale: 'en-us',
  })
  // 422 = already exists → fine, proceed to delete it.
  await sleep(400)
  const deleted = await deleteLocale(base, headers, code)
  record(
    'locale create→delete',
    deleted.ok || created.status === 422,
    `${code} (create ${created.status}, delete ${deleted.status})`,
  )
}

// ── Case 5: throwaway $all workflow create → delete ─────────────────────────
async function caseAllWorkflow(base, headers) {
  const name = `Churn $all ${stamp()}`
  if (DRY_RUN) return record('$all workflow create→delete', true, `[dry-run] ${name}`)
  const created = await createWorkflow(base, headers, {
    name,
    contentTypes: ['$all'],
    branches: ['$all'],
    stages: [
      { name: 'Open', next: ['Closed'] },
      { name: 'Closed', next: ['$all'] },
    ],
    enabled: true,
  })
  if (!created.ok) {
    return record('$all workflow create→delete', false, `create ${created.status}: ${created.body?.error_message || ''}`)
  }
  const wfUid = created.body?.workflow?.uid
  await sleep(500)
  const deleted = wfUid ? await deleteWorkflow(base, headers, wfUid) : { ok: false, status: 0 }
  record('$all workflow create→delete', deleted.ok, `${name} (delete ${deleted.status})`)
}

// ── Case 6: one entry delete → restore ──────────────────────────────────────
async function caseEntryDeleteRestore(base, headers, contentTypes, locale) {
  for (const ctUid of contentTypes) {
    const { ok, body } = await listEntries(base, headers, ctUid, {
      locale,
      limit: 5,
      desc: 'created_at',
    })
    const entry = (body.entries || [])[0]
    if (!ok || !entry) continue
    if (DRY_RUN) return record('entry delete→restore', true, `[dry-run] ${ctUid}/${entry.uid}`)
    const del = await deleteEntry(base, headers, { contentTypeUid: ctUid, entryUid: entry.uid, locale })
    await sleep(500)
    const res = await restoreEntry(base, headers, { contentTypeUid: ctUid, entryUid: entry.uid, locale })
    return record(
      'entry delete→restore',
      del.ok && res.ok,
      `${ctUid}/${entry.uid} (delete ${del.status}, restore ${res.status})`,
    )
  }
  record('entry delete→restore', false, 'no entry available')
}

async function main() {
  const { apiKey, base, branch, locale } = loadStackAuth()
  const tokens = loadManagementTokens()
  const headers = headersForToken(apiKey, tokens[0], branch)
  const contentTypes = csv('CONTENTSTACK_CHURN_CONTENT_TYPES', manifestContentTypes())
  const cases = csv('CONTENTSTACK_CHURN_CASES', [
    'disable', 'detach', 'branch', 'locale', 'allwf', 'entry',
  ])

  console.log('churn-orphans')
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  cases: ${cases.join(', ')}`)
  console.log(`  CTs:   ${contentTypes.join(', ') || '(none)'}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  const run = async (fn) => {
    try { await fn() } catch (e) { record(fn.name, false, e.message) }
  }
  if (cases.includes('disable')) await run(() => caseDisableEnable(base, headers))
  if (cases.includes('detach')) await run(() => caseDetachReattach(base, headers, contentTypes))
  if (cases.includes('branch')) await run(() => caseBranchLifecycle(base, headers))
  if (cases.includes('locale')) await run(() => caseLocaleLifecycle(base, headers))
  if (cases.includes('allwf')) await run(() => caseAllWorkflow(base, headers))
  if (cases.includes('entry')) await run(() => caseEntryDeleteRestore(base, headers, contentTypes, locale))

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n✓ churn done — ${results.length - failed}/${results.length} cases ok`)
  // Soft-fail: only non-zero if EVERY case failed (likely an auth/config issue).
  if (results.length > 0 && failed === results.length) process.exitCode = 1
}

main().catch((err) => {
  console.error('churn-orphans failed:', err)
  process.exit(1)
})
