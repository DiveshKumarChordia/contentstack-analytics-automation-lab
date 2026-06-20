/**
 * Contentstack Content Management API helpers (Node 18+ fetch).
 */

export function optionalEnv(name, fallback = '') {
  const v = process.env[name]
  if (v == null || String(v).trim() === '') return fallback
  return String(v).trim()
}

export function requireEnv(name) {
  const v = process.env[name]
  if (!v || String(v).trim() === '') {
    console.error(`Missing required environment variable: ${name}`)
    process.exit(1)
  }
  return v.trim()
}

export function loadStackAuth() {
  const apiKey =
    optionalEnv('CONTENTSTACK_API_KEY') ||
    optionalEnv('VITE_CONTENTSTACK_API_KEY')
  if (!apiKey) {
    console.error(
      'Missing stack API key: set CONTENTSTACK_API_KEY or VITE_CONTENTSTACK_API_KEY',
    )
    process.exit(1)
  }
  const token = requireEnv('CONTENTSTACK_MANAGEMENT_TOKEN')
  let base = optionalEnv('CONTENTSTACK_MANAGEMENT_HOST', 'https://api.contentstack.io')
  base = base.replace(/\/$/, '')
  const branch = optionalEnv('CONTENTSTACK_BRANCH')
  const locale = optionalEnv('CONTENTSTACK_LOCALE', 'en-us')
  const publishEnv =
    optionalEnv('CONTENTSTACK_PUBLISH_ENVIRONMENT') ||
    optionalEnv('VITE_CONTENTSTACK_ENVIRONMENT')
  if (!publishEnv) {
    console.error(
      'Missing publish target: set CONTENTSTACK_PUBLISH_ENVIRONMENT or VITE_CONTENTSTACK_ENVIRONMENT',
    )
    process.exit(1)
  }

  return { apiKey, token, base, branch, locale, publishEnv }
}

export function managementHeaders(apiKey, token, branch) {
  const h = {
    api_key: apiKey,
    authorization: token,
    'Content-Type': 'application/json',
  }
  if (branch) h.branch = branch
  return h
}

export function defaultTitleOnlySchema() {
  return [
    {
      data_type: 'text',
      display_name: 'Title',
      field_metadata: {
        _default: true,
        version: 3,
      },
      mandatory: true,
      uid: 'title',
      unique: true,
      multiple: false,
      non_localizable: false,
    },
  ]
}

export function defaultContentTypeOptions() {
  return {
    is_page: false,
    singleton: false,
    sub_title: [],
    title: 'title',
  }
}

export async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

export async function contentTypeExists(base, headers, uid) {
  const url = `${base}/v3/content_types/${uid}`
  const res = await fetch(url, { method: 'GET', headers })
  return res.ok
}

export async function createContentType(base, headers, { uid, title, schema }) {
  const url = `${base}/v3/content_types`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      content_type: {
        title,
        uid,
        schema,
        options: defaultContentTypeOptions(),
      },
    }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** List all content types on the stack. */
export async function listContentTypes(base, headers, { limit = 100, includeCount = true } = {}) {
  const params = new URLSearchParams()
  if (limit != null) params.set('limit', String(limit))
  if (includeCount) params.set('include_count', 'true')
  const url = `${base}/v3/content_types?${params.toString()}`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** DELETE /v3/content_types/{uid}. force=true also removes its entries. */
export async function deleteContentType(base, headers, uid, { force = true } = {}) {
  const q = force ? '?force=true' : ''
  const res = await fetch(`${base}/v3/content_types/${uid}${q}`, {
    method: 'DELETE',
    headers,
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

export async function createEntry(base, headers, contentTypeUid, entryFields, locale) {
  const q = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  const url = `${base}/v3/content_types/${contentTypeUid}/entries${q}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ entry: entryFields }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** Update (save) an entry without publishing. Used for entries_in_progress meter. */
export async function updateEntry(base, headers, contentTypeUid, entryUid, entryFields, locale) {
  const q = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  const url = `${base}/v3/content_types/${contentTypeUid}/entries/${entryUid}${q}`
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ entry: entryFields }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

export async function publishEntry(
  base,
  headers,
  contentTypeUid,
  entryUid,
  locale,
  publishEnv,
) {
  const url = `${base}/v3/content_types/${contentTypeUid}/entries/${entryUid}/publish`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      entry: {
        environments: [publishEnv],
        locales: [locale],
      },
      locale,
    }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** Unpublish a single entry from an environment/locale (mirror of publishEntry). */
export async function unpublishEntry(
  base,
  headers,
  contentTypeUid,
  entryUid,
  locale,
  publishEnv,
) {
  const url = `${base}/v3/content_types/${contentTypeUid}/entries/${entryUid}/unpublish`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      entry: {
        environments: [publishEnv],
        locales: [locale],
      },
      locale,
    }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/**
 * List entries (Management API). Uses environment when provided to scope results.
 */
export async function listEntries(
  base,
  headers,
  contentTypeUid,
  { locale, environment, limit = 10, skip, desc, asc, includeCount, query } = {},
) {
  const params = new URLSearchParams()
  if (locale) params.set('locale', locale)
  if (environment) params.set('environment', environment)
  if (limit != null) params.set('limit', String(limit))
  if (skip != null) params.set('skip', String(skip))
  if (includeCount) params.set('include_count', 'true')
  if (query) params.set('query', JSON.stringify(query))
  if (desc) params.set('desc', desc)
  if (asc) params.set('asc', asc)
  const q = params.toString()
  const url = `${base}/v3/content_types/${contentTypeUid}/entries${q ? `?${q}` : ''}`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

export async function getLatestEntryUid(
  base,
  headers,
  contentTypeUid,
  locale,
  environment,
) {
  const { ok, body } = await listEntries(base, headers, contentTypeUid, {
    locale,
    environment,
    limit: 1,
    desc: 'updated_at',
  })
  if (!ok || !Array.isArray(body.entries) || body.entries.length === 0) {
    return null
  }
  return body.entries[0]?.uid ?? null
}

export async function getFirstEntryUid(
  base,
  headers,
  contentTypeUid,
  locale,
  environment,
) {
  const { ok, body } = await listEntries(base, headers, contentTypeUid, {
    locale,
    environment,
    limit: 1,
    asc: 'created_at',
  })
  if (!ok || !Array.isArray(body.entries) || body.entries.length === 0) {
    return null
  }
  return body.entries[0]?.uid ?? null
}

export async function createAndPublishEntry(
  base,
  headers,
  contentTypeUid,
  entryFields,
  locale,
  publishEnv,
) {
  const created = await createEntry(base, headers, contentTypeUid, entryFields, locale)
  if (!created.ok) {
    return { ok: false, step: 'create', ...created }
  }
  const entryUid = created.body.entry?.uid
  if (!entryUid) {
    return {
      ok: false,
      step: 'create',
      status: created.status,
      body: created.body,
      message: 'missing entry.uid',
    }
  }
  const published = await publishEntry(
    base,
    headers,
    contentTypeUid,
    entryUid,
    locale,
    publishEnv,
  )
  if (!published.ok) {
    return { ok: false, step: 'publish', entryUid, ...published }
  }
  return { ok: true, entryUid, body: published.body }
}

// =============================================================================
// Multi-token round-robin (Phase 2, multi-user simulation)
// =============================================================================
// Each cma-api request carries a user_uid derived from the management token's
// owner. To make Active Users / Entries Per Author dashboards have variety, set
// CONTENTSTACK_MANAGEMENT_TOKENS (plural, comma-separated) and the seeders will
// round-robin across them. Falls back to the single CONTENTSTACK_MANAGEMENT_TOKEN
// when the plural form is unset.
export function loadManagementTokens() {
  const multi = optionalEnv('CONTENTSTACK_MANAGEMENT_TOKENS')
  if (multi) {
    const tokens = multi
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (tokens.length > 0) return tokens
  }
  const single = optionalEnv('CONTENTSTACK_MANAGEMENT_TOKEN')
  if (single) return [single]
  console.error(
    'Missing management token: set CONTENTSTACK_MANAGEMENT_TOKEN or CONTENTSTACK_MANAGEMENT_TOKENS',
  )
  process.exit(1)
}

/** Build headers for one specific token — used inside round-robin loops. */
export function headersForToken(apiKey, token, branch) {
  return managementHeaders(apiKey, token, branch)
}

// =============================================================================
// User-session auth (for workflow stage transitions)
// =============================================================================
// Per Contentstack docs, **management tokens cannot change workflow stages.**
// That call requires a user authtoken (a logged-in user's session). We exchange
// CONTENTSTACK_USER_EMAIL / CONTENTSTACK_USER_PASSWORD for an authtoken via
// POST /v3/user-session, then use it on the transition endpoint.
//
// The authtoken header is `authtoken` (not `authorization`); api_key + branch
// still go with the request as before.

/**
 * POST /v3/user-session to exchange email+password for a user authtoken.
 * Returns { ok, status, authtoken, body }. The authtoken is good for
 * subsequent CMA calls that require user-identity (e.g. workflow transit).
 */
export async function loginUserSession(base, apiKey, email, password, tfaToken) {
  const headers = {
    'Content-Type': 'application/json',
    api_key: apiKey,
  }
  const payload = { user: { email, password } }
  if (tfaToken) payload.user.tfa_token = tfaToken
  const res = await fetch(`${base}/v3/user-session`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  const authtoken = body?.user?.authtoken
  return { ok: res.ok && !!authtoken, status: res.status, authtoken, body }
}

/** Build request headers carrying a user authtoken (NOT a mgmt token). */
export function userSessionHeaders(apiKey, authtoken, branch) {
  const h = {
    api_key: apiKey,
    authtoken,
    'Content-Type': 'application/json',
  }
  if (branch) h.branch = branch
  return h
}

/**
 * Convenience: build headers suitable for stage transitions by trying these
 * env paths in order:
 *
 *   1. CONTENTSTACK_USER_AUTHTOKEN — use directly (long-lived authtoken
 *      already obtained from a prior interactive login). Skips the login
 *      flow entirely.
 *
 *   2. CONTENTSTACK_USER_EMAIL + CONTENTSTACK_USER_PASSWORD +
 *      CONTENTSTACK_USER_TOTP_SECRET — compute the TOTP code at request time
 *      and log in via /v3/user-session. Works fully automated even with 2FA
 *      enabled.
 *
 *   3. CONTENTSTACK_USER_EMAIL + CONTENTSTACK_USER_PASSWORD only — log in
 *      without 2FA. Fails (401) if the account has 2FA enabled.
 *
 *   4. CONTENTSTACK_USER_EMAIL + CONTENTSTACK_USER_PASSWORD +
 *      CONTENTSTACK_USER_TFA_TOKEN — log in with a manually-pasted 6-digit
 *      TFA code. Will only work within the ~30s before that code expires;
 *      mostly useful for one-off interactive runs.
 *
 * Returns null when nothing is configured, so callers can skip transition
 * flows gracefully.
 */
export async function tryLoadUserSessionHeaders(base, apiKey, branch) {
  // Path 1: direct authtoken — bypass login
  const directToken = optionalEnv('CONTENTSTACK_USER_AUTHTOKEN')
  if (directToken) {
    return userSessionHeaders(apiKey, directToken, branch)
  }

  const email = optionalEnv('CONTENTSTACK_USER_EMAIL')
  const password = optionalEnv('CONTENTSTACK_USER_PASSWORD')
  if (!email || !password) return null

  // Path 2: TOTP at runtime — preferred for automation with 2FA enabled.
  // Path 4 fallback: a manually-pasted TFA code (no secret).
  const totpSecret = optionalEnv('CONTENTSTACK_USER_TOTP_SECRET')
  const manualTfa = optionalEnv('CONTENTSTACK_USER_TFA_TOKEN')

  // When multiple CI instances authenticate simultaneously with the same credentials,
  // they can collide on TOTP codes (30-second window). Avoid this by adding a random
  // wait before login. Range: 0 to 80 TOTP steps (30sec each) = 0 to 2400ms.
  // Factor 50 (middle value) gives 50/80 = 62.5% of max wait time.
  if (totpSecret) {
    const randomFactor = Math.floor(Math.random() * 81) // 0 to 80 inclusive
    const waitMs = randomFactor * 30 // Each step is 30 seconds in ms units (as factor)
    if (waitMs > 0) {
      console.log(`  ⏳ Random TOTP backoff: waiting ${waitMs}ms to avoid collision with parallel instances`)
      await sleep(waitMs)
    }
  }

  // Retry on transient failures: 5xx / 429 are server-side or rate-limit blips
  // ("/v3/user-session 500: We're sorry, something went wrong…" is Contentstack's
  // generic 500), and a 401 right at a TOTP rollover clears on a fresh code.
  // We recompute the TOTP each attempt (time advances) and back off between tries.
  const maxAttempts = 4
  let last = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let tfaToken = manualTfa
    if (totpSecret) {
      const { totp, secondsUntilNextStep } = await import('./totp.mjs')
      // If we're within the last second of the current step, the code we compute
      // might roll over server-side mid-flight — wait through the boundary first.
      const remaining = secondsUntilNextStep()
      if (remaining <= 1) await sleep((remaining + 0.2) * 1000)
      tfaToken = totp(totpSecret)
    }

    const result = await loginUserSession(base, apiKey, email, password, tfaToken)
    if (result.ok) return userSessionHeaders(apiKey, result.authtoken, branch)
    last = result

    const transient = result.status >= 500 || result.status === 429
    // A 401 is only worth retrying on the TOTP path (a fresh code may pass);
    // a manual TFA token that 401s is simply wrong/expired.
    const rolloverAuth = !!totpSecret && result.status === 401
    if (attempt < maxAttempts && (transient || rolloverAuth)) {
      const wait = transient ? 1500 * attempt : 900 // linear backoff for 5xx/429
      console.warn(
        `  ⚠ /v3/user-session attempt ${attempt}/${maxAttempts} failed (${result.status}) — retrying in ${Math.round(wait / 100) / 10}s`,
      )
      await sleep(wait)
      continue
    }
    break
  }

  console.warn(
    `  ⚠ /v3/user-session login failed (${last?.status}): ${last?.body?.error_message || JSON.stringify(last?.body).slice(0, 200)}`,
  )
  return null
}

// =============================================================================
// Workflows
// =============================================================================
// Stack-level mgmt token is sufficient. CMA emits two events on stage changes:
//   entry_workflow_stage_added   — first time entry enters a workflow
//   entry_workflow_stage_updated — every subsequent transit
// (analytics-data-sync materializes these into entry_workflow_state snapshots.)

export async function listWorkflows(base, headers, { limit = 100, includeCount = true } = {}) {
  const params = new URLSearchParams()
  if (limit != null) params.set('limit', String(limit))
  if (includeCount) params.set('include_count', 'true')
  const url = `${base}/v3/workflows?${params.toString()}`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** Returns the workflow object with matching name, or null. Case-sensitive match. */
export async function findWorkflowByName(base, headers, name) {
  const { ok, body } = await listWorkflows(base, headers)
  if (!ok || !Array.isArray(body.workflows)) return null
  return body.workflows.find((w) => w.name === name) ?? null
}

/**
 * Create a workflow with the given stages and attach to content types.
 *
 * @param stages — Array of stage descriptors. Each: { uid?, name, color?, next? }.
 *   `next` is an array of stage names (resolved to UIDs after assignment) or
 *   the literal '$all' to allow transit to any other stage.
 * @param contentTypes — Array of content_type UIDs the workflow attaches to.
 */
export async function createWorkflow(
  base,
  headers,
  { name, contentTypes, stages, branches, adminUsers, adminRoles, enabled = true },
) {
  // cma-api workflow2.0 schema requires stage.uid to match ^[a-z0-9-]+$ —
  // hyphens ONLY, no underscores. (services/workflow2.0/model/schema.js line 67-71)
  const slug = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const stagesWithUid = stages.map((s) => ({
    ...s,
    uid: s.uid || slug(s.name),
  }))
  // Build name → uid map so `next: ['Review']` can resolve to the stage UID.
  const nameToUid = Object.fromEntries(stagesWithUid.map((s) => [s.name, s.uid]))
  const resolvedStages = stagesWithUid.map((s, i) => {
    const next = s.next ?? '$all'
    let nextAvailable
    if (next === '$all' || (Array.isArray(next) && next.includes('$all'))) {
      nextAvailable = ['$all']
    } else {
      nextAvailable = (Array.isArray(next) ? next : [next]).map(
        (n) => nameToUid[n] || n, // pass through if already a UID
      )
    }
    const stage = {
      uid: s.uid,
      name: s.name,
      color: s.color || ['#2196f3', '#4caf50', '#ff9800', '#9c27b0'][i % 4],
      SYS_ACL: {
        users: { uids: ['$all'], read: true, write: true, transit: true },
        roles: { uids: [], read: true, write: true, transit: true },
        others: { read: true, write: true, transit: false },
      },
      next_available_stages: nextAvailable,
    }
    // Only include description when set — schema enforces a min length so
    // an empty string can fail validation.
    if (s.description) stage.description = s.description
    // entry_lock is gated by the "Workflow Stage Entry Locking" plan feature.
    // If the stack's plan lacks it (cma-api returns code 337 on POST), even
    // sending entry_lock:'none' is rejected. Only include it when the manifest
    // explicitly opts in.
    if (s.entry_lock) stage.entry_lock = s.entry_lock
    return stage
  })

  // workflow2.0 schema requires branches to be a non-empty array
  // (services/workflow2.0/model/schema.js lines 38-42, $require: true).
  // Default to ["main"] when the manifest doesn't specify so the seeder works
  // on both branches-enabled and branches-disabled stacks.
  const effectiveBranches = (branches && branches.length > 0) ? branches : ['main']

  const body = {
    workflow: {
      name,
      enabled,
      content_types: contentTypes,
      branches: effectiveBranches,
      workflow_stages: resolvedStages,
      admin_users: {
        users: adminUsers || [],
        roles: adminRoles || [],
      },
    },
  }

  const res = await fetch(`${base}/v3/workflows`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const respBody = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body: respBody }
}

/**
 * Transition an entry into a workflow stage. Emits entry_workflow_stage_added
 * on first call (when entry has no current stage) and entry_workflow_stage_updated
 * on subsequent calls. Locale matters — workflow state is per-(entry, locale).
 */
export async function transitionEntryWorkflow(
  base,
  headers,
  { contentTypeUid, entryUid, stageUid, locale, dueDate, assignedTo, comment },
) {
  const q = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  const url = `${base}/v3/content_types/${contentTypeUid}/entries/${entryUid}/workflow${q}`
  const payload = {
    workflow: {
      workflow_stage: {
        uid: stageUid,
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(assignedTo ? { assigned_to: assignedTo } : {}),
        ...(comment ? { comment } : {}),
      },
    },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

// =============================================================================
// Publishing rules (a.k.a. publish rules) — attached to a workflow stage
// =============================================================================
// A publishing rule says "when an entry is at workflow_stage S of workflow W,
// once approved, auto-publish to environment E (in these locales, on these
// branches)". The snapshot meter `entries_publish_rules` populated by
// analytics-data-sync's cron counts how many entries fall under any rule —
// drives the Workflow Health → Publishing Rules KPI.
//
// Endpoint: POST /v3/workflows/publishing_rules  (body wrapper: publishing_rule)
// Token: stack-level CONTENTSTACK_MANAGEMENT_TOKEN authenticates as the token
// owner (a system user); cma-api's requireSystemUser check accepts that.

/** GET /v3/environments — list all environments on the stack. */
export async function listEnvironments(base, headers, { limit = 100 } = {}) {
  const url = `${base}/v3/environments?limit=${limit}`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/**
 * Resolve an environment name to its UID. Bulk-publish accepts names but
 * publishing rules want UIDs, so callers that need a UID can route through
 * this helper. Returns the UID string, or null if not found.
 */
export async function findEnvironmentUidByName(base, headers, name) {
  const { ok, body } = await listEnvironments(base, headers)
  if (!ok || !Array.isArray(body?.environments)) return null
  const env = body.environments.find((e) => e.name === name || e.uid === name)
  return env?.uid ?? null
}

export async function listPublishingRules(base, headers, { limit = 100, includeCount = true } = {}) {
  const params = new URLSearchParams()
  if (limit != null) params.set('limit', String(limit))
  if (includeCount) params.set('include_count', 'true')
  const url = `${base}/v3/workflows/publishing_rules?${params.toString()}`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/**
 * Create a publishing rule. Required fields per cma-api schema:
 *   - workflow (workflow uid) — the workflow this rule belongs to
 *   - workflow_stage (stage uid) — which stage triggers the rule
 *   - content_types (string[]) — min 1 — which CTs the rule applies to
 *   - environment (string) — environment uid OR name
 *   - branches (string[]) — usually ["main"]
 *   - approvers (object) — { users: [], roles: [] } accepted as empty
 *
 * Optional:
 *   - locales (string[]) — defaults stack-wide
 *   - actions (any[]) — defaults []
 *   - four_eye_principle_enabled / status / disable_approver_publishing
 */
export async function createPublishingRule(
  base,
  headers,
  {
    workflow,
    workflow_stage,
    content_types,
    environment,
    branches,
    locales,
    actions,
    approvers,
    four_eye_principle_enabled,
    status,
    disable_approver_publishing,
  },
) {
  const payload = {
    publishing_rule: {
      workflow,
      workflow_stage,
      content_types,
      environment,
      branches: branches && branches.length > 0 ? branches : ['main'],
      approvers: approvers || { users: [], roles: [] },
      actions: actions || [],
    },
  }
  if (locales) payload.publishing_rule.locales = locales
  if (typeof four_eye_principle_enabled === 'boolean') {
    payload.publishing_rule.four_eye_principle_enabled = four_eye_principle_enabled
  }
  if (typeof status === 'boolean') payload.publishing_rule.status = status
  if (typeof disable_approver_publishing === 'boolean') {
    payload.publishing_rule.disable_approver_publishing = disable_approver_publishing
  }

  const res = await fetch(`${base}/v3/workflows/publishing_rules`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** DELETE /v3/workflows/publishing_rules/{uid}. */
export async function deletePublishingRule(base, headers, ruleUid) {
  const res = await fetch(`${base}/v3/workflows/publishing_rules/${ruleUid}`, {
    method: 'DELETE',
    headers,
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

// =============================================================================
// Locales
// =============================================================================
// Stack-level mgmt token is sufficient. Creating a locale on a stack with
// existing entries emits `entries_orphaned_by_locale_deleted` only on locale
// DELETE; CREATE is silent from the metering side but exercises the
// "Locale" filter axis in dashboards.

export async function listLocales(base, headers) {
  const url = `${base}/v3/locales`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

export async function localeExists(base, headers, code) {
  const { ok, body } = await listLocales(base, headers)
  if (!ok || !Array.isArray(body.locales)) return false
  return body.locales.some((l) => l.code === code)
}

export async function createLocale(base, headers, { code, name, fallbackLocale }) {
  const payload = { locale: { code } }
  if (name) payload.locale.name = name
  if (fallbackLocale) payload.locale.fallback_locale = fallbackLocale
  const res = await fetch(`${base}/v3/locales`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/**
 * DELETE a locale by code. Triggers `entries_orphaned_by_locale_deleted`
 * meter event for any entries that had localized values in this locale.
 * Returns 422 if the locale is the master or has dependents — caller's
 * responsibility to handle.
 */
export async function deleteLocale(base, headers, code) {
  const url = `${base}/v3/locales/${encodeURIComponent(code)}`
  const res = await fetch(url, { method: 'DELETE', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/**
 * Localize an entry — i.e. create a localized version of an existing entry
 * in a non-master locale. The endpoint is `PUT /entries/{uid}?locale={code}`
 * with the translated field values. cma-api treats this as `entry_created`
 * in the target locale's keyspace, so it drives the same meter as a
 * regular create.
 *
 * @param fields  field values for the localized entry; must include `title`
 *                if the content type marks title mandatory.
 */
export async function localizeEntry(base, headers, { contentTypeUid, entryUid, locale, fields }) {
  const url = `${base}/v3/content_types/${contentTypeUid}/entries/${entryUid}?locale=${encodeURIComponent(locale)}`
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ entry: fields }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/**
 * GET an entry across all locales it exists in. Useful for checking whether
 * an entry is ALREADY localized to a given locale before trying to PUT a
 * localized version (avoids the 422 "entry already localized" path).
 */
export async function getEntryLocales(base, headers, { contentTypeUid, entryUid }) {
  const url = `${base}/v3/content_types/${contentTypeUid}/entries/${entryUid}/locales`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

// =============================================================================
// Branches
// =============================================================================
// Stack-level mgmt token is sufficient. Branch creation is ASYNC — the POST
// returns 201 with a notice, but the branch isn't usable until the bulk task
// finishes. Caller should pollBranchReady() before using the new branch.

export async function listBranches(base, headers) {
  const url = `${base}/v3/stacks/branches`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

export async function branchExists(base, headers, uid) {
  const { ok, body } = await listBranches(base, headers)
  if (!ok || !Array.isArray(body.branches)) return false
  return body.branches.some((b) => b.uid === uid)
}

/**
 * Create a branch off `source`. Returns immediately; branch is ready when it
 * appears in listBranches() — typically within a few seconds.
 */
export async function createBranch(base, headers, { uid, source = 'main' }) {
  const res = await fetch(`${base}/v3/stacks/branches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ branch: { uid, source } }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** Poll listBranches until `uid` shows up (or timeoutMs is hit). */
export async function pollBranchReady(base, headers, uid, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await branchExists(base, headers, uid)) return true
    await sleep(intervalMs)
  }
  return false
}

// =============================================================================
// Bulk publish / unpublish
// =============================================================================
// Stack-level mgmt token is sufficient. CMA returns 201 with "request in
// progress" — the actual publishing is enqueued. Watch for entry_published /
// entry_unpublished meter events once the task drains (usually <1 min for
// modest batches).

/**
 * Build the request body shape for /v3/bulk/publish and /v3/bulk/unpublish.
 *
 * Each entries[] item must be { uid, content_type, locale }. Callers may pass
 * plain uid strings alongside a single contentTypeUid+locale via the
 * `defaultContentType`/`defaultLocale` opts and we expand here.
 */
function buildBulkPublishBody({
  entries,
  assets,
  locales,
  environments,
  scheduledAt,
  defaultContentType,
  defaultLocale,
}) {
  const body = {}
  if (Array.isArray(entries) && entries.length > 0) {
    body.entries = entries.map((e) => {
      if (typeof e === 'string') {
        return {
          uid: e,
          content_type: defaultContentType,
          locale: defaultLocale,
        }
      }
      return {
        uid: e.uid,
        content_type: e.content_type || e.contentType || defaultContentType,
        locale: e.locale || defaultLocale,
      }
    })
  }
  if (Array.isArray(assets) && assets.length > 0) {
    body.assets = assets.map((a) => (typeof a === 'string' ? { uid: a } : a))
  }
  if (locales) body.locales = locales
  if (environments) body.environments = environments
  if (scheduledAt) body.scheduled_at = scheduledAt
  return body
}

export async function bulkPublish(base, headers, opts) {
  const res = await fetch(`${base}/v3/bulk/publish`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildBulkPublishBody(opts)),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

export async function bulkUnpublish(base, headers, opts) {
  const res = await fetch(`${base}/v3/bulk/unpublish`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildBulkPublishBody(opts)),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

// =============================================================================
// Delete entry — drives `entry_deleted` meter event.
// =============================================================================
export async function deleteEntry(base, headers, { contentTypeUid, entryUid, locale }) {
  const q = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  const url = `${base}/v3/content_types/${contentTypeUid}/entries/${entryUid}${q}`
  const res = await fetch(url, { method: 'DELETE', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

// =============================================================================
// Restore + orphan-driving destructive ops (used by churn-orphans.mjs).
// These exercise the exact cma mutations the analytics meter must handle:
// entry restore, workflow scope-edit / disable / delete, branch + locale delete.
// =============================================================================

/**
 * Restore a soft-deleted (trashed) entry in a given locale.
 * PUT /v3/content_types/{ct}/entries/{uid}/restore  body { entry: { locale } }.
 * Restore bumps the entry's `updated_at` (the only un-delete that does), so the
 * snapshot meter's Axis-1 picks it up hourly.
 */
export async function restoreEntry(base, headers, { contentTypeUid, entryUid, locale }) {
  const url = `${base}/v3/content_types/${contentTypeUid}/entries/${entryUid}/restore`
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ entry: locale ? { locale } : {} }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** GET a single workflow (workflow2.0) by uid — to read its current scope. */
export async function getWorkflow(base, headers, workflowUid) {
  const url = `${base}/v3/workflows/${workflowUid}`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/**
 * Update a workflow (PUT /v3/workflows/{uid}). Pass a partial workflow object;
 * cma replaces the supplied keys. Used to DETACH a content_type/branch from the
 * workflow's scope (orphans its entries) or to toggle `enabled`.
 */
export async function updateWorkflow(base, headers, workflowUid, workflow) {
  const url = `${base}/v3/workflows/${workflowUid}`
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ workflow }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** DELETE a workflow (terminal — orphans its in-workflow entries' `_workflow`). */
export async function deleteWorkflow(base, headers, workflowUid) {
  const url = `${base}/v3/workflows/${workflowUid}`
  const res = await fetch(url, { method: 'DELETE', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** DELETE a branch (async, terminal). Orphans entries that still list it in
 *  `_branches`. POST returns a job; the branch is gone once it settles. */
export async function deleteBranch(base, headers, branchUid) {
  const url = `${base}/v3/stacks/branches/${encodeURIComponent(branchUid)}`
  const res = await fetch(url, { method: 'DELETE', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

// =============================================================================
// Stack users + roles (for ensure-stack-user-role.mjs — the auth-sdk fix).
// auth-sdk's listStackUsers only returns users with an EXPLICIT stack role
// (RBAC). A user with only org-level access isn't counted. Sharing the stack
// with the automation user + a CMS role creates that RBAC record.
// =============================================================================

/** GET the logged-in user (needs a USER authtoken, not a mgmt token). */
export async function getCurrentUser(base, headers) {
  const url = `${base}/v3/user`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** GET the stack's roles (mgmt token ok). Used to find a CMS/Developer role uid. */
export async function listStackRoles(base, headers) {
  const url = `${base}/v3/roles?include_rules=false&limit=100`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/**
 * Share the stack with one or more users, assigning stack roles.
 * POST /v3/stacks/share  body { emails: [...], roles: { <email>: [roleUid] } }.
 * Requires a USER authtoken. Idempotent-ish: re-sharing an existing member with
 * the same roles is a no-op / benign error the caller can tolerate.
 */
export async function shareStack(base, headers, { emails, roles }) {
  const url = `${base}/v3/stacks/share`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ emails, roles }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

// =============================================================================
// Self-healing helpers: auto-create/assign missing prerequisites
// =============================================================================

/**
 * Ensure a user has a CMS role on the stack.
 * If user doesn't have any role, assign them the first non-Admin role.
 * Requires USER authtoken (not mgmt token).
 */
export async function ensureUserHasCMSRole(base, userHeaders, mgmtHeaders, userEmail) {
  try {
    // List stack roles to find a suitable CMS role
    const { ok: rOk, body: rBody } = await listStackRoles(base, mgmtHeaders)
    if (!rOk || !Array.isArray(rBody.roles)) return false

    const roles = rBody.roles
    // Pick first non-Admin/Owner role, or the first one available
    const cmsRole = roles.find((r) => !['Admin', 'Owner'].includes(r.name)) || roles[0]
    if (!cmsRole) return false

    // Share the stack with the user, assigning the CMS role
    const { ok: sOk } = await shareStack(base, userHeaders, {
      emails: [userEmail],
      roles: { [userEmail]: [cmsRole.uid] },
    })

    return sOk
  } catch {
    return false
  }
}

/**
 * Ensure a workflow exists on the stack; create if missing.
 * Returns the workflow (found or created), or null if both fail.
 */
export async function ensureWorkflowExists(base, headers, workflowName, createPayload) {
  try {
    // Try to find the workflow by name
    const existing = await findWorkflowByName(base, headers, workflowName)
    if (existing) return existing

    // If not found and createPayload is provided, create it
    if (!createPayload) return null

    const { ok: cOk, body: cBody } = await createWorkflow(base, headers, createPayload)
    if (cOk && cBody?.workflow) return cBody.workflow

    return null
  } catch {
    return null
  }
}

/**
 * Ensure a content type exists on the stack; create if missing.
 * Returns the CT (found or created), or null if both fail.
 */
export async function ensureContentTypeExists(base, headers, ctUid, createPayload) {
  try {
    // Try to find the CT
    const { ok: gOk, body: gBody } = await getContentType(base, headers, ctUid)
    if (gOk && gBody?.content_type) return gBody.content_type

    // If not found and createPayload is provided, create it
    if (!createPayload) return null

    const { ok: cOk, body: cBody } = await createContentType(base, headers, {
      uid: ctUid,
      ...createPayload,
    })
    if (cOk && cBody?.content_type) return cBody.content_type

    return null
  } catch {
    return null
  }
}

/** Get a content type by uid (minimal info). */
export async function getContentType(base, headers, ctUid) {
  const url = `${base}/v3/content_types/${ctUid}`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

// =============================================================================
// Organization Admin APIs (manage org-level user roles and permissions)
// =============================================================================

/** GET /v4/organizations/{orgUid}/roles — list all organization roles. */
export async function listOrganizationRoles(base, headers, orgUid, { limit = 100 } = {}) {
  const params = new URLSearchParams()
  if (limit != null) params.set('limit', String(limit))
  const url = `${base}/v4/organizations/${encodeURIComponent(orgUid)}/roles?${params.toString()}`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** GET /v4/organizations/{orgUid}/roles/{roleUid} — get role details. */
export async function getOrganizationRole(base, headers, orgUid, roleUid) {
  const url = `${base}/v4/organizations/${encodeURIComponent(orgUid)}/roles/${encodeURIComponent(roleUid)}`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** Find an org role by name. Returns role object or null. */
export async function findOrganizationRoleByName(base, headers, orgUid, name, domain = 'organization') {
  const { ok, body } = await listOrganizationRoles(base, headers, orgUid)
  if (!ok || !Array.isArray(body?.roles)) return null
  return body.roles.find((r) => r.name === name && r.domain === domain) ?? null
}

/** GET /v4/organizations/{orgUid}/share/users — list all shared users. */
export async function listOrganizationUsers(base, headers, orgUid, { limit = 100, skip = 0 } = {}) {
  const params = new URLSearchParams()
  if (limit != null) params.set('limit', String(limit))
  if (skip != null) params.set('skip', String(skip))
  const url = `${base}/v4/organizations/${encodeURIComponent(orgUid)}/share/users?${params.toString()}`
  const res = await fetch(url, { method: 'GET', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** POST /v4/organizations/{orgUid}/share — invite user(s) with roles. */
export async function inviteUserToOrganization(base, headers, orgUid, { emails, roles }) {
  const url = `${base}/v4/organizations/${encodeURIComponent(orgUid)}/share`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ emails, roles }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** PATCH /v4/organizations/{orgUid}/share/{userUid} — update user's org roles. */
export async function updateUserOrganizationRoles(base, headers, orgUid, userUid, roleUids) {
  const url = `${base}/v4/organizations/${encodeURIComponent(orgUid)}/share/${encodeURIComponent(userUid)}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ org_roles: roleUids }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** DELETE /v4/organizations/{orgUid}/share/{userUid} — remove user from org. */
export async function removeUserFromOrganization(base, headers, orgUid, userUid) {
  const url = `${base}/v4/organizations/${encodeURIComponent(orgUid)}/share/${encodeURIComponent(userUid)}`
  const res = await fetch(url, { method: 'DELETE', headers })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

/** Helper: promote user to admin role. */
export async function promoteUserToAdmin(base, headers, orgUid, userUid) {
  const { ok: rOk, body: rBody } = await listOrganizationRoles(base, headers, orgUid)
  if (!rOk || !Array.isArray(rBody?.roles)) return false
  const adminRole = rBody.roles.find((r) => r.domain === 'organization' && (r.name === 'admin' || r.name === 'owner'))
  if (!adminRole) return false
  const { ok: uOk } = await updateUserOrganizationRoles(base, headers, orgUid, userUid, [adminRole.uid])
  return uOk
}

/** Helper: downgrade user to member role. */
export async function downgradeUserToMember(base, headers, orgUid, userUid) {
  const { ok: rOk, body: rBody } = await listOrganizationRoles(base, headers, orgUid)
  if (!rOk || !Array.isArray(rBody?.roles)) return false
  const memberRole = rBody.roles.find((r) => r.domain === 'organization' && r.name === 'member')
  if (!memberRole) return false
  const { ok: uOk } = await updateUserOrganizationRoles(base, headers, orgUid, userUid, [memberRole.uid])
  return uOk
}

/** Helper: check if user has a specific role by name. */
export async function userHasRole(base, headers, orgUid, userUid, roleName) {
  const { ok, body } = await listOrganizationUsers(base, headers, orgUid)
  if (!ok || !Array.isArray(body?.data)) return false
  const user = body.data.find((u) => u.uid === userUid || u.user_uid === userUid)
  if (!user || !Array.isArray(user.org_roles)) return false
  const { ok: rOk, body: rBody } = await listOrganizationRoles(base, headers, orgUid)
  if (!rOk || !Array.isArray(rBody?.roles)) return false
  const roleUid = rBody.roles.find((r) => r.name === roleName)?.uid
  return roleUid && user.org_roles.includes(roleUid)
}
