#!/usr/bin/env node
/**
 * meter-consistency-matrix.mjs — provision one brand-new Contentstack stack
 * per row of the Meter Consistency Test Matrix, and drive that row's exact
 * scenario (create/publish/delete/workflow/branch/locale actions) inside it.
 *
 * Why one stack per case: isolating each scenario in its own stack means the
 * analytics team can query that stack alone and see EXACTLY the meter counts
 * the row predicts, with zero cross-contamination from other scenarios or
 * prior runs.
 *
 * Stack lifecycle — at most 46 matrix stacks exist at any time: every case
 * has a STABLE name prefix (category + case number + scenario slug, no
 * timestamp). Before creating this run's stack, we list every stack in the
 * org and delete any whose name starts with that exact case's prefix — so
 * re-running the same case replaces its stack rather than piling up a new
 * one alongside it. Only names matching our own `mtx-<category>-<num>-...`
 * prefix are ever touched; nothing else in the org is looked at. The final
 * stack name still embeds the run date so it's identifiable in the UI.
 *
 * Auth (fully automated, no manual step):
 *   Uses the same CONTENTSTACK_USER_AUTHTOKEN / CONTENTSTACK_USER_EMAIL +
 *   CONTENTSTACK_USER_PASSWORD (+ CONTENTSTACK_USER_TOTP_SECRET) chain as
 *   seed-workflows.mjs — see .env.example. Stack creation (and deletion)
 *   needs a USER authtoken (management tokens can't create or delete
 *   stacks; they're minted per-stack, after the stack exists). The
 *   organization UID is auto-derived from the logged-in user unless
 *   CONTENTSTACK_ORG_UID is set.
 *
 * Usage:
 *   node --env-file=.env scripts/meter-consistency-matrix.mjs                # all 46 cases
 *   node --env-file=.env scripts/meter-consistency-matrix.mjs --list          # print the matrix, no API calls
 *   node --env-file=.env scripts/meter-consistency-matrix.mjs --only entries_created,entries_deleted
 *   node --env-file=.env scripts/meter-consistency-matrix.mjs --case entries_published:5
 *   node --env-file=.env scripts/meter-consistency-matrix.mjs --case entries_deleted:5,entries_published:1  # multiple
 *   node --env-file=.env scripts/meter-consistency-matrix.mjs --limit 3       # first 3 selected cases (smoke test)
 *
 * Output:
 *   step-reports/meter-consistency-matrix.json        — latest run snapshot
 *   step-reports/meter-consistency-matrix-history.jsonl — one line per case, ever
 */

import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs'
import {
  resolveUserAuthtoken,
  userSessionHeaders,
  deriveOrgUid,
  orgAuthHeaders,
  createStack,
  listStacksInOrg,
  deleteStack,
  createContentType,
  defaultTitleOnlySchema,
  createEntry,
  updateEntry,
  publishEntry,
  deleteEntry,
  localizeEntry,
  createLocale,
  createBranch,
  pollBranchReady,
  createEnvironment,
  createWorkflow,
  transitionEntryWorkflow,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'

const REPORT_DIR = 'step-reports'
const SNAPSHOT_PATH = `${REPORT_DIR}/meter-consistency-matrix.json`
const HISTORY_PATH = `${REPORT_DIR}/meter-consistency-matrix-history.jsonl`

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
const pad = (n) => String(n).padStart(2, '0')

// =============================================================================
// Case table — one entry per Meter Consistency Test Matrix row (46 total)
// =============================================================================
// `needs` controls what gets provisioned in that case's stack before `run()`
// executes:
//   branch2    — create a `dev` branch off `main`
//   locale2    — create the `fr-fr` locale
//   env2       — create a second `staging` environment
//   workflow   — attach a 2-stage workflow to the main content type
//   secondCt   — create a second, permanently workflow-free content type
//                (only cross-meter #6 needs this)

function makeCase(category, num, scenario, keyFields, needs, run, note) {
  return { category, num, scenario, keyFields, needs: needs || {}, run, note: note || null }
}

const OUTSIDE_RANGE_NOTE =
  'CMA does not allow backdating created_at/updated_at/deleted_at — this seeds the entry for real, ' +
  'now. Validate the "outside range" assertion by re-running the consistency query with a window ' +
  'that starts strictly after this stack was created (or wait for this timestamp to age out of a ' +
  'shorter window).'

const NULL_UID_NOTE =
  'A literal `_workflow.uid: null` (or `""`) is an internal data-integrity edge case, not a state ' +
  'reachable through the public CMA — this reproduces the closest real state instead (entry created ' +
  'on a workflow-enabled/disabled content type, never transitioned).'

const CASES = [
  // ---------------------------------------------------------------- entries_created
  makeCase('entries_created', 1, 'Entry created, single branch, single locale',
    'created_at: T, _branches: ["main"], deleted_at: false', {},
    async (ctx) => { const e = await ctx.create(); return { ok: e.ok, detail: `created ${e.uid} on main/${ctx.masterLocale}` } }),

  makeCase('entries_created', 2, 'Entry created, 2 branches',
    '_branches: ["main", "dev"]', { branch2: true },
    async (ctx) => {
      const a = await ctx.create({ branch: 'main' })
      const b = await ctx.create({ branch: 'dev' })
      return { ok: a.ok && b.ok, detail: `created main:${a.uid} dev:${b.uid}` }
    }),

  makeCase('entries_created', 3, 'Entry created in 2 locales (en-us + fr-fr)',
    'Two separate docs, each _branches: ["main"]', { locale2: true },
    async (ctx) => {
      const a = await ctx.create()
      const b = a.ok ? await ctx.localize(a.uid, ctx.secondLocale) : { ok: false }
      return { ok: a.ok && b.ok, detail: `${ctx.masterLocale} doc ${a.uid}, localized to ${ctx.secondLocale}` }
    }),

  makeCase('entries_created', 4, 'Entry created then deleted in same window',
    'created_at: T, deleted_at: T2', {},
    async (ctx) => {
      const e = await ctx.create()
      const d = e.ok ? await ctx.del(e.uid) : false
      return { ok: e.ok && d, detail: `created+deleted ${e.uid}` }
    }),

  makeCase('entries_created', 5, 'Entry created before range, still live',
    'created_at < range start', {},
    async (ctx) => { const e = await ctx.create(); return { ok: e.ok, detail: `created ${e.uid}, left live` } },
    OUTSIDE_RANGE_NOTE),

  makeCase('entries_created', 6, '_branches is empty/missing',
    'Defaults to ["main"] → entry_count = 1', {},
    async (ctx) => {
      const e = await ctx.create({ branch: null })
      return { ok: e.ok, detail: `created ${e.uid} with no branch header — expect _branches to default to ["main"]` }
    }),

  // ---------------------------------------------------------------- entries_deleted
  makeCase('entries_deleted', 1, 'Entry deleted, single branch',
    'deleted_at: T, _branches: ["main"]', {},
    async (ctx) => {
      const e = await ctx.create()
      const d = e.ok ? await ctx.del(e.uid) : false
      return { ok: e.ok && d, detail: `deleted ${e.uid} (main)` }
    }),

  makeCase('entries_deleted', 2, 'Entry deleted, 2 branches',
    '_branches: ["main", "dev"], deleted_at: T', { branch2: true },
    async (ctx) => {
      const a = await ctx.create({ branch: 'main' })
      const b = await ctx.create({ branch: 'dev' })
      const da = a.ok ? await ctx.del(a.uid, { branch: 'main' }) : false
      const db = b.ok ? await ctx.del(b.uid, { branch: 'dev' }) : false
      return { ok: a.ok && b.ok && da && db, detail: `deleted main:${a.uid} dev:${b.uid}` }
    }),

  makeCase('entries_deleted', 3, 'Entry deleted in 2 locales',
    'Two docs with deleted_at: T', { locale2: true },
    async (ctx) => {
      const a = await ctx.create()
      const b = a.ok ? await ctx.localize(a.uid, ctx.secondLocale) : { ok: false }
      const da = a.ok ? await ctx.del(a.uid, { locale: ctx.masterLocale }) : false
      const db = b.ok ? await ctx.del(a.uid, { locale: ctx.secondLocale }) : false
      return { ok: a.ok && b.ok && da && db, detail: `deleted both locale docs for ${a.uid}` }
    }),

  makeCase('entries_deleted', 4, 'Entry created AND deleted in range',
    'created_at: T1, deleted_at: T2', {},
    async (ctx) => {
      const e = await ctx.create()
      const d = e.ok ? await ctx.del(e.uid) : false
      return { ok: e.ok && d, detail: `created+deleted ${e.uid}` }
    }),

  makeCase('entries_deleted', 5, 'Entry soft-deleted (deleted_at: false)',
    'deleted_at: false — still live', {},
    async (ctx) => { const e = await ctx.create(); return { ok: e.ok, detail: `created ${e.uid}, left live` } }),

  makeCase('entries_deleted', 6, 'Entry deleted before range',
    'deleted_at < range start', {},
    async (ctx) => {
      const e = await ctx.create()
      const d = e.ok ? await ctx.del(e.uid) : false
      return { ok: e.ok && d, detail: `deleted ${e.uid}` }
    }, OUTSIDE_RANGE_NOTE),

  // ---------------------------------------------------------------- entries_published
  makeCase('entries_published', 1, 'First publish, single env, single branch',
    'publish_details.time: T, _branches_locales: [{b:"main", l:"en-us"}]', {},
    async (ctx) => {
      const e = await ctx.create()
      const p = e.ok ? await ctx.publish(e.uid) : false
      return { ok: e.ok && p, detail: `published ${e.uid} to ${ctx.envPrimary}` }
    }),

  makeCase('entries_published', 2, 'Published to 2 envs',
    '2 docs (different env), each with _branches_locales: [{b:"main"}]', { env2: true },
    async (ctx) => {
      const e = await ctx.create()
      const p1 = e.ok ? await ctx.publish(e.uid, { env: ctx.envPrimary }) : false
      const p2 = e.ok ? await ctx.publish(e.uid, { env: ctx.envSecondary }) : false
      return { ok: e.ok && p1 && p2, detail: `published ${e.uid} to ${ctx.envPrimary} + ${ctx.envSecondary}` }
    }),

  makeCase('entries_published', 3, 'Published, 2 distinct branches in _branches_locales',
    '[{b:"main",l:"en-us"}, {b:"dev",l:"en-us"}]', { branch2: true },
    async (ctx) => {
      const a = await ctx.create({ branch: 'main' })
      const b = await ctx.create({ branch: 'dev' })
      const pa = a.ok ? await ctx.publish(a.uid, { branch: 'main' }) : false
      const pb = b.ok ? await ctx.publish(b.uid, { branch: 'dev' }) : false
      return { ok: a.ok && b.ok && pa && pb, detail: `published main:${a.uid} dev:${b.uid}` }
    }),

  makeCase('entries_published', 4, 'Published, same branch appears with fallback locale',
    '[{b:"main",l:"en-us"}, {b:"main",l:"fr-fr"}]', { locale2: true },
    async (ctx) => {
      const a = await ctx.create()
      const pa = a.ok ? await ctx.publish(a.uid, { locale: ctx.masterLocale }) : false
      const b = a.ok ? await ctx.localize(a.uid, ctx.secondLocale) : { ok: false }
      const pb = b.ok ? await ctx.publish(a.uid, { locale: ctx.secondLocale }) : false
      return { ok: a.ok && pa && b.ok && pb, detail: `published ${ctx.masterLocale}+${ctx.secondLocale} on main` }
    }),

  makeCase('entries_published', 5, 'Double publish (same entry published twice)',
    'Old doc replaced by new doc (deleteMany+insertMany). Only one doc in collection with T2', {},
    async (ctx) => {
      const e = await ctx.create()
      const p1 = e.ok ? await ctx.publish(e.uid) : false
      const u = e.ok ? await ctx.update(e.uid, { suffix: 'v2' }) : false
      const p2 = e.ok ? await ctx.publish(e.uid) : false
      return { ok: e.ok && p1 && u && p2, detail: `double-published ${e.uid} (edit, then re-publish)` }
    }),

  makeCase('entries_published', 6, 'Published but source entry deleted',
    'Entry doc has deleted_at set → correlation lookup fails', {},
    async (ctx) => {
      const e = await ctx.create()
      const p = e.ok ? await ctx.publish(e.uid) : false
      const d = e.ok ? await ctx.del(e.uid) : false
      return { ok: e.ok && p && d, detail: `published then deleted ${e.uid}` }
    }),

  makeCase('entries_published', 7, '_in_progress: true in published_objects, updated_at in range',
    'No publish_details.time, _in_progress: true, updated_at: T', {},
    async (ctx) => {
      const e = await ctx.create()
      const u = e.ok ? await ctx.update(e.uid) : false
      return { ok: e.ok && u, detail: `created+edited ${e.uid}, never published` }
    }),

  makeCase('entries_published', 8, '_in_progress: true AND publish_details.time both present',
    'Both OR branches match same doc', {},
    async (ctx) => {
      const e = await ctx.create()
      const p = e.ok ? await ctx.publish(e.uid) : false
      const u = e.ok ? await ctx.update(e.uid, { suffix: 'post-publish edit' }) : false
      return { ok: e.ok && p && u, detail: `published then edited ${e.uid} (both flags set)` }
    }),

  makeCase('entries_published', 9, '_in_progress: true but updated_at outside range',
    'updated_at < range start', {},
    async (ctx) => {
      const e = await ctx.create()
      const u = e.ok ? await ctx.update(e.uid) : false
      return { ok: e.ok && u, detail: `created+edited ${e.uid}, never published` }
    }, OUTSIDE_RANGE_NOTE),

  makeCase('entries_published', 10, '_in_progress: false, no publish_details',
    'Neither OR branch matches', {},
    async (ctx) => { const e = await ctx.create(); return { ok: e.ok, detail: `created ${e.uid}, no edits, no publish (baseline)` } }),

  // ---------------------------------------------------------------- entries_ready_to_publish
  makeCase('entries_ready_to_publish', 1, 'Entry has _in_progress: true, live, in range',
    '_in_progress: true, updated_at: T, deleted_at: false, _branches: ["main"]', {},
    async (ctx) => {
      const e = await ctx.create()
      const u = e.ok ? await ctx.update(e.uid) : false
      return { ok: e.ok && u, detail: `in-progress ${e.uid}` }
    }),

  makeCase('entries_ready_to_publish', 2, 'Entry has _in_progress: true, 2 branches',
    '_branches: ["main", "dev"]', { branch2: true },
    async (ctx) => {
      const a = await ctx.create({ branch: 'main' })
      const b = await ctx.create({ branch: 'dev' })
      const ua = a.ok ? await ctx.update(a.uid, { branch: 'main' }) : false
      const ub = b.ok ? await ctx.update(b.uid, { branch: 'dev' }) : false
      return { ok: a.ok && b.ok && ua && ub, detail: `in-progress main:${a.uid} dev:${b.uid}` }
    }),

  makeCase('entries_ready_to_publish', 3, 'Entry has _in_progress: true but deleted',
    'deleted_at: T2 — LIVE_ENTRY_FILTER excludes', {},
    async (ctx) => {
      const e = await ctx.create()
      const u = e.ok ? await ctx.update(e.uid) : false
      const d = e.ok ? await ctx.del(e.uid) : false
      return { ok: e.ok && u && d, detail: `in-progress ${e.uid}, then deleted` }
    }),

  makeCase('entries_ready_to_publish', 4, 'Entry has _in_progress: false',
    'Flag not set', {},
    async (ctx) => { const e = await ctx.create(); return { ok: e.ok, detail: `created ${e.uid}, never edited (baseline)` } }),

  makeCase('entries_ready_to_publish', 5, 'Entry has _in_progress: true, updated_at outside range',
    'updated_at < range start', {},
    async (ctx) => {
      const e = await ctx.create()
      const u = e.ok ? await ctx.update(e.uid) : false
      return { ok: e.ok && u, detail: `in-progress ${e.uid}` }
    }, OUTSIDE_RANGE_NOTE),

  makeCase('entries_ready_to_publish', 6, 'Entry has _in_progress: true, 2 locales',
    'Two docs (en-us, fr-fr), each _branches: ["main"]', { locale2: true },
    async (ctx) => {
      const a = await ctx.create()
      const ua = a.ok ? await ctx.update(a.uid) : false
      const b = a.ok ? await ctx.localize(a.uid, ctx.secondLocale) : { ok: false }
      const ub = b.ok ? await ctx.update(a.uid, { locale: ctx.secondLocale }) : false
      return { ok: a.ok && ua && b.ok && ub, detail: `in-progress on ${ctx.masterLocale}+${ctx.secondLocale}` }
    }),

  makeCase('entries_ready_to_publish', 7, 'Same entry in_progress fixed (mandatory field filled)',
    '_in_progress removed or set to false', {},
    async (ctx) => {
      const e = await ctx.create()
      const u = e.ok ? await ctx.update(e.uid, { suffix: 'mandatory field filled' }) : false
      const p = e.ok ? await ctx.publish(e.uid) : false
      return { ok: e.ok && u && p, detail: `${e.uid} in-progress then fixed+published (flag cleared)` }
    }),

  // ---------------------------------------------------------------- entries_with_workflow
  makeCase('entries_with_workflow', 1, 'Workflow assigned, _workflow.uid present',
    '_workflow: { uid: "wf1", updated_at: T }, live entry', { workflow: true },
    async (ctx) => {
      const e = await ctx.create()
      const t = e.ok ? await ctx.transition(e.uid) : false
      return { ok: e.ok && t, detail: `${e.uid} → workflow stage "${ctx.workflow.stageName}"` }
    }),

  makeCase('entries_with_workflow', 2, '_workflow exists but uid is null',
    '_workflow: { uid: null }', { workflow: true },
    async (ctx) => {
      const e = await ctx.create()
      return { ok: e.ok, detail: `created ${e.uid} on workflow-enabled CT, never transitioned` }
    }, NULL_UID_NOTE),

  makeCase('entries_with_workflow', 3, '_workflow field missing entirely',
    'No _workflow key', {},
    async (ctx) => {
      const e = await ctx.create()
      return { ok: e.ok, detail: `created ${e.uid} on a CT with no workflow attached (control case)` }
    }),

  makeCase('entries_with_workflow', 4, 'Workflow assigned, 2 branches',
    '_branches: ["main", "dev"]', { workflow: true, branch2: true },
    async (ctx) => {
      const a = await ctx.create({ branch: 'main' })
      const b = await ctx.create({ branch: 'dev' })
      const ta = a.ok ? await ctx.transition(a.uid, { branch: 'main' }) : false
      const tb = b.ok ? await ctx.transition(b.uid, { branch: 'dev' }) : false
      return { ok: a.ok && b.ok && ta && tb, detail: `workflow-assigned main:${a.uid} dev:${b.uid}` }
    }),

  makeCase('entries_with_workflow', 5, 'Workflow assigned but entry deleted',
    'deleted_at set', { workflow: true },
    async (ctx) => {
      const e = await ctx.create()
      const t = e.ok ? await ctx.transition(e.uid) : false
      const d = e.ok ? await ctx.del(e.uid) : false
      return { ok: e.ok && t && d, detail: `workflow-assigned ${e.uid}, then deleted` }
    }),

  makeCase('entries_with_workflow', 6, '_workflow.updated_at outside range',
    'Exists but before range start', { workflow: true },
    async (ctx) => {
      const e = await ctx.create()
      const t = e.ok ? await ctx.transition(e.uid) : false
      return { ok: e.ok && t, detail: `${e.uid} → workflow stage "${ctx.workflow.stageName}"` }
    }, OUTSIDE_RANGE_NOTE),

  // ---------------------------------------------------------------- entries_without_workflow
  makeCase('entries_without_workflow', 1, 'Entry has no _workflow field',
    'updated_at: T, live', {},
    async (ctx) => { const e = await ctx.create(); return { ok: e.ok, detail: `created ${e.uid} on bare CT` } }),

  makeCase('entries_without_workflow', 2, 'Entry has _workflow.uid = "" (empty string)',
    '_workflow: { uid: "" } — treated as no workflow', {},
    async (ctx) => { const e = await ctx.create(); return { ok: e.ok, detail: `created ${e.uid} on bare CT` } }, NULL_UID_NOTE),

  makeCase('entries_without_workflow', 3, 'Entry has valid _workflow.uid',
    'Excluded by ENTRY_WITHOUT_WORKFLOW_FILTER', { workflow: true },
    async (ctx) => {
      const e = await ctx.create()
      const t = e.ok ? await ctx.transition(e.uid) : false
      return { ok: e.ok && t, detail: `${e.uid} HAS a valid workflow uid (control: must be excluded)` }
    }),

  makeCase('entries_without_workflow', 4, 'Entry without workflow, 2 branches',
    '_branches: ["main", "dev"]', { branch2: true },
    async (ctx) => {
      const a = await ctx.create({ branch: 'main' })
      const b = await ctx.create({ branch: 'dev' })
      return { ok: a.ok && b.ok, detail: `no-workflow entries main:${a.uid} dev:${b.uid}` }
    }),

  makeCase('entries_without_workflow', 5, 'Entry without workflow but deleted',
    'deleted_at set', {},
    async (ctx) => {
      const e = await ctx.create()
      const d = e.ok ? await ctx.del(e.uid) : false
      return { ok: e.ok && d, detail: `no-workflow ${e.uid}, then deleted` }
    }),

  // ---------------------------------------------------------------- cross-meter consistency checks
  makeCase('cross_meter', 1, 'Entry created, never published',
    'entries_created=1, entries_published=0', {},
    async (ctx) => { const e = await ctx.create(); return { ok: e.ok, detail: `${e.uid} — expect created=1, published=0` } }),

  makeCase('cross_meter', 2, 'Entry created and published in same window',
    'entries_created=1, entries_published=1', {},
    async (ctx) => {
      const e = await ctx.create()
      const p = e.ok ? await ctx.publish(e.uid) : false
      return { ok: e.ok && p, detail: `${e.uid} — expect created=1, published=1` }
    }),

  makeCase('cross_meter', 3, 'Entry in_progress and published',
    'Both entries_in_progress=1 AND entries_published=1 (intentional overlap)', {},
    async (ctx) => {
      const e = await ctx.create()
      const p = e.ok ? await ctx.publish(e.uid) : false
      const u = e.ok ? await ctx.update(e.uid, { suffix: 'post-publish edit' }) : false
      return { ok: e.ok && p && u, detail: `${e.uid} — expect in_progress=1 AND published=1` }
    }),

  makeCase('cross_meter', 4, 'Entry on 2 branches, published once',
    'entries_created=2 (branch-expanded), entries_published=2 (distinct branches in _branches_locales)', { branch2: true },
    async (ctx) => {
      const a = await ctx.create({ branch: 'main' })
      const b = await ctx.create({ branch: 'dev' })
      const pa = a.ok ? await ctx.publish(a.uid, { branch: 'main' }) : false
      const pb = b.ok ? await ctx.publish(b.uid, { branch: 'dev' }) : false
      return { ok: a.ok && b.ok && pa && pb, detail: `main:${a.uid} dev:${b.uid} — expect created=2, published=2` }
    }),

  makeCase('cross_meter', 5, 'Localized entry (en-us + fr-fr), both published',
    'entries_created=2, entries_published=2 (one published_objects doc per locale)', { locale2: true },
    async (ctx) => {
      const a = await ctx.create()
      const pa = a.ok ? await ctx.publish(a.uid, { locale: ctx.masterLocale }) : false
      const b = a.ok ? await ctx.localize(a.uid, ctx.secondLocale) : { ok: false }
      const pb = b.ok ? await ctx.publish(a.uid, { locale: ctx.secondLocale }) : false
      return { ok: a.ok && pa && b.ok && pb, detail: `${a.uid} en-us+fr-fr — expect created=2, published=2` }
    }),

  makeCase('cross_meter', 6, 'entries_with_workflow + entries_without_workflow should ≈ total live entries',
    'Not exact (time windows differ) but directionally consistent', { workflow: true, secondCt: true },
    async (ctx) => {
      const withWf = await ctx.create()
      const t = withWf.ok ? await ctx.transition(withWf.uid) : false
      const noWf = await ctx.create({ ct: ctx.secondCtUid })
      return {
        ok: withWf.ok && t && noWf.ok,
        detail: `workflow:${withWf.uid} + bare-CT:${noWf.uid} — expect with_workflow + without_workflow ≈ 2 live entries`,
      }
    }),
]

// =============================================================================
// CLI
// =============================================================================

function parseArgs(argv) {
  const opts = { only: null, caseFilters: null, limit: null, list: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--list') opts.list = true
    else if (a === '--only') opts.only = argv[++i].split(',').map((s) => s.trim())
    else if (a === '--case') {
      // Accepts one or more comma-separated "category:num" pairs, e.g.
      // --case entries_deleted:5,entries_deleted:6,entries_published:1
      opts.caseFilters = argv[++i].split(',').map((pair) => {
        const [cat, numStr] = pair.trim().split(':')
        return { cat, num: Number.parseInt(numStr, 10) }
      })
    } else if (a === '--limit') opts.limit = Number.parseInt(argv[++i], 10)
  }
  return opts
}

function selectCases(opts) {
  let selected = CASES
  if (opts.only) selected = selected.filter((c) => opts.only.includes(c.category))
  if (opts.caseFilters) {
    selected = selected.filter((c) => opts.caseFilters.some((f) => f.cat === c.category && f.num === c.num))
  }
  if (opts.limit != null && Number.isFinite(opts.limit)) selected = selected.slice(0, opts.limit)
  return selected
}

// =============================================================================
// Per-case stack provisioning + execution
// =============================================================================

/** Stable per-case prefix — no run stamp — used to find and delete this case's prior stack. */
function caseStackPrefix(c) {
  return `mtx-${slug(c.category)}-${pad(c.num)}-${slug(c.scenario)}-`
}

function buildStackName(c, runStamp) {
  return `${caseStackPrefix(c)}${runStamp}`.slice(0, 90)
}

function makeEntryCtx({ base, apiKey, authtoken, ctUid, secondCtUid, masterLocale, secondLocale, envPrimary, envSecondary, workflow }) {
  const hdr = (branch) => userSessionHeaders(apiKey, authtoken, branch || undefined)
  let seq = 0
  const title = () => `mtx entry ${Date.now().toString(36)}-${(seq += 1)}`

  return {
    masterLocale,
    secondLocale,
    envPrimary,
    envSecondary,
    workflow,

    async create({ locale, branch, ct } = {}) {
      const { ok, body } = await createEntry(base, hdr(branch), ct || ctUid, { title: title() }, locale)
      return { ok, uid: body?.entry?.uid || null, locale: locale || masterLocale, branch: branch || 'main' }
    },

    async localize(uid, locale, ct) {
      const { ok } = await localizeEntry(base, hdr(), { contentTypeUid: ct || ctUid, entryUid: uid, locale, fields: { title: title() } })
      return { ok, uid, locale }
    },

    async publish(uid, { locale, env, branch, ct } = {}) {
      const { ok } = await publishEntry(base, hdr(branch), ct || ctUid, uid, locale || masterLocale, env || envPrimary)
      return ok
    },

    async del(uid, { locale, branch, ct } = {}) {
      const { ok } = await deleteEntry(base, hdr(branch), { contentTypeUid: ct || ctUid, entryUid: uid, locale })
      return ok
    },

    async update(uid, { locale, branch, ct, suffix } = {}) {
      const { ok } = await updateEntry(base, hdr(branch), ct || ctUid, uid, { title: `${title()} ${suffix || 'edited'}` }, locale)
      return ok
    },

    async transition(uid, { locale, branch } = {}) {
      if (!workflow) throw new Error('workflow was not provisioned for this case')
      const { ok } = await transitionEntryWorkflow(base, hdr(branch), {
        contentTypeUid: ctUid,
        entryUid: uid,
        stageUid: workflow.stageUid,
        locale,
      })
      return ok
    },
  }
}

/** Provision a fresh stack for one case, then run it. Never throws — all failures are captured in the result. */
async function runCase(c, shared, runStamp, runDateLabel) {
  const startedAt = Date.now()
  const stackName = buildStackName(c, runStamp)
  const phases = []
  const record = (name, ok, extra) => phases.push({ name, ok, ...extra })

  try {
    // Delete-before-create: keep at most one stack alive per case, ever.
    // Only stacks whose name starts with THIS case's exact prefix are ever
    // touched — nothing else in the org is looked at or matched.
    const prefix = caseStackPrefix(c)
    const stale = (shared.existingStacks || []).filter((s) => typeof s?.name === 'string' && s.name.startsWith(prefix))
    for (const s of stale) {
      const del = await deleteStack(shared.base, userSessionHeaders(s.api_key, shared.authtoken), { name: s.name })
      record('delete_prior_stack', del.ok, { status: del.status, deletedStackName: s.name, deletedStackUid: s.uid })
    }

    const created = await createStack(shared.base, orgAuthHeaders(shared.authtoken, shared.orgUid), {
      name: stackName,
      description:
        `Meter Consistency Test Matrix — ${c.category} #${c.num}: ${c.scenario}. ` +
        `Key fields: ${c.keyFields}. Run: ${runDateLabel}. ` +
        `Auto-managed by meter-consistency-matrix.mjs — replaced on next run, safe to delete.`,
      masterLocale: shared.masterLocale,
    })
    record('create_stack', created.ok, { status: created.status })
    if (!created.ok) {
      return finish(c, stackName, null, phases, false, `stack creation failed (${created.status})`, startedAt)
    }
    const apiKey = created.body?.stack?.api_key
    const stackUid = created.body?.stack?.uid
    if (!apiKey) return finish(c, stackName, null, phases, false, 'stack created but no api_key in response', startedAt)

    await sleep(1500) // brief buffer before the stack accepts content-type/entry calls
    const hdr = (branch) => userSessionHeaders(apiKey, shared.authtoken, branch)

    const ctUid = 'mtx_entry'
    const ct = await createContentType(shared.base, hdr(), { uid: ctUid, title: 'Meter Test Entry', schema: defaultTitleOnlySchema() })
    record('create_content_type', ct.ok, { status: ct.status })
    if (!ct.ok) return finish(c, stackName, apiKey, phases, false, 'content type creation failed', startedAt)

    let secondCtUid = null
    if (c.needs.secondCt) {
      secondCtUid = 'mtx_entry_bare'
      const ct2 = await createContentType(shared.base, hdr(), { uid: secondCtUid, title: 'Meter Test Entry (no workflow)', schema: defaultTitleOnlySchema() })
      record('create_second_content_type', ct2.ok, { status: ct2.status })
    }

    const envPrimary = 'production'
    const env1 = await createEnvironment(shared.base, hdr(), { name: envPrimary, locale: shared.masterLocale, url: shared.deployUrl })
    record('create_environment_primary', env1.ok, { status: env1.status })

    let envSecondary = null
    if (c.needs.env2) {
      envSecondary = 'staging'
      const env2 = await createEnvironment(shared.base, hdr(), { name: envSecondary, locale: shared.masterLocale, url: shared.deployUrl })
      record('create_environment_secondary', env2.ok, { status: env2.status })
    }

    const secondLocale = 'fr-fr'
    if (c.needs.locale2) {
      const loc = await createLocale(shared.base, hdr(), { code: secondLocale, name: 'French (France)', fallbackLocale: shared.masterLocale })
      record('create_locale', loc.ok, { status: loc.status })
    }

    if (c.needs.branch2) {
      const br = await createBranch(shared.base, hdr(), { uid: 'dev', source: 'main' })
      const ready = br.ok && (await pollBranchReady(shared.base, hdr(), 'dev', { timeoutMs: 45000 }))
      record('create_branch_dev', !!ready, { status: br.status })
    }

    let workflow = null
    if (c.needs.workflow) {
      const branches = c.needs.branch2 ? ['main', 'dev'] : ['main']
      const wf = await createWorkflow(shared.base, hdr(), {
        name: 'Review',
        contentTypes: [ctUid],
        stages: [{ name: 'Draft' }, { name: 'Review' }],
        branches,
      })
      record('create_workflow', wf.ok, { status: wf.status })
      if (wf.ok) {
        const stage = wf.body?.workflow?.workflow_stages?.find((s) => s.name === 'Review')
        if (stage) workflow = { uid: wf.body.workflow.uid, stageUid: stage.uid, stageName: stage.name }
      }
    }

    const ctx = makeEntryCtx({
      base: shared.base,
      apiKey,
      authtoken: shared.authtoken,
      ctUid,
      secondCtUid,
      masterLocale: shared.masterLocale,
      secondLocale,
      envPrimary,
      envSecondary,
      workflow,
    })

    const result = await c.run(ctx)
    record('scenario', result.ok, { detail: result.detail })
    return finish(c, stackName, apiKey, phases, result.ok, result.detail, startedAt, stackUid)
  } catch (err) {
    record('exception', false, { message: err.message })
    return finish(c, stackName, null, phases, false, `threw: ${err.message}`, startedAt)
  }
}

function finish(c, stackName, apiKey, phases, ok, detail, startedAt, stackUid) {
  return {
    category: c.category,
    num: c.num,
    scenario: c.scenario,
    keyFields: c.keyFields,
    note: c.note,
    stackName,
    stackUid: stackUid || null,
    apiKey: apiKey || null,
    ok,
    detail,
    phases,
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString(),
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const selected = selectCases(opts)

  if (opts.list || selected.length === 0) {
    console.log(`Meter Consistency Test Matrix — ${CASES.length} cases total, ${selected.length} selected\n`)
    for (const c of selected.length ? selected : CASES) {
      console.log(`  ${c.category} #${c.num}  ${c.scenario}`)
      console.log(`    ${c.keyFields}`)
    }
    if (opts.list) return
  }

  // Auth: entirely independent of any existing stack's api_key / management
  // token / publish environment — this only ever needs a USER account
  // (CONTENTSTACK_USER_AUTHTOKEN, or email+password+TOTP) that belongs to an
  // organization allowed to create stacks. /v3/user-session login is
  // account-level, not stack-scoped.
  const base = optionalEnv('CONTENTSTACK_MANAGEMENT_HOST', 'https://api.contentstack.io').replace(/\/$/, '')
  console.log('meter-consistency-matrix')
  console.log(`  cases selected: ${selected.length}/${CASES.length}`)

  const authtoken = await resolveUserAuthtoken(base)
  if (!authtoken) {
    console.error(
      'Missing user-session auth: set CONTENTSTACK_USER_AUTHTOKEN, or CONTENTSTACK_USER_EMAIL + ' +
      'CONTENTSTACK_USER_PASSWORD (+ CONTENTSTACK_USER_TOTP_SECRET) — see .env.example. ' +
      'Stack creation requires a user authtoken; management tokens cannot create stacks.',
    )
    process.exit(1)
  }

  let orgUid = optionalEnv('CONTENTSTACK_ORG_UID')
  if (!orgUid) {
    orgUid = await deriveOrgUid(base, { authtoken, 'Content-Type': 'application/json' })
    if (orgUid) console.log(`  org uid auto-derived: ${orgUid}`)
  }
  if (!orgUid) {
    console.error('Could not resolve an organization UID — set CONTENTSTACK_ORG_UID explicitly.')
    process.exit(1)
  }

  const masterLocale = optionalEnv('CONTENTSTACK_LOCALE', 'en-us')
  const now = new Date()
  // Filesystem/stack-name-safe date stamp, e.g. 2026-07-10-09-45-30 — makes
  // the run date visible directly in the stack name, not just its description.
  const runStamp = optionalEnv('RUN_STAMP') || now.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const runDateLabel = now.toISOString()
  // Reuse the CDN delivery host you've already configured for the live site
  // as the environment's deploy URL, instead of an unrelated placeholder —
  // it's a real, reachable HTTPS URL, unlike a dummy example.com.
  const deployUrl = optionalEnv('VITE_CONTENTSTACK_DELIVERY_HOST') || optionalEnv('CONTENTSTACK_DELIVERY_HOST') || undefined

  const stacksList = await listStacksInOrg(base, orgAuthHeaders(authtoken, orgUid))
  const existingStacks = Array.isArray(stacksList.body?.stacks) ? stacksList.body.stacks : []
  const priorMatrixStacks = existingStacks.filter((s) => typeof s?.name === 'string' && s.name.startsWith('mtx-'))
  console.log(`  found ${priorMatrixStacks.length} prior matrix stack(s) in the org — matching cases will be replaced`)

  const shared = { base, authtoken, orgUid, masterLocale, deployUrl, existingStacks }

  mkdirSync(REPORT_DIR, { recursive: true })
  const results = []

  for (const c of selected) {
    process.stdout.write(`  → ${c.category} #${c.num} "${c.scenario}" … `)
    const result = await runCase(c, shared, runStamp, runDateLabel)
    console.log(result.ok ? `✓ (${result.stackName})` : `✗ ${result.detail} (${result.stackName})`)
    results.push(result)
    appendFileSync(HISTORY_PATH, `${JSON.stringify({ runStamp, ...result })}\n`, 'utf-8')
    await sleep(1500) // spacing between stack creations — Contentstack rate-limits POST /v3/stacks tighter than regular CMA calls
  }

  const ok = results.filter((r) => r.ok).length
  const snapshot = {
    runStamp,
    startedAt: new Date().toISOString(),
    casesSelected: selected.length,
    casesOk: ok,
    casesFailed: results.length - ok,
    results,
  }
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8')

  console.log(`\n✓ meter-consistency-matrix done: ${ok}/${results.length} cases ok`)
  console.log(`  snapshot: ${SNAPSHOT_PATH}`)
  console.log(`  history:  ${HISTORY_PATH}`)
  if (ok < results.length) process.exitCode = 1
}

main().catch((err) => {
  console.error('meter-consistency-matrix failed:', err)
  process.exit(1)
})
