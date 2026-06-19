#!/usr/bin/env node
/**
 * ensure-stack-user-role.mjs
 *
 * Ensures the automation user (CONTENTSTACK_USER_EMAIL) holds an EXPLICIT
 * stack-level role (RBAC) on the target stack.
 *
 * Why this matters (the auth-sdk fix):
 *   The analytics "stack user count" comes from auth-sdk `listStackUsers`, which
 *   returns only users that have an explicit stack ROLE record. A user with only
 *   org-level access (e.g. the org owner) has NO stack-role record, so it is
 *   counted by org-admin's `/stacks` users.count but is MISSING from auth-sdk's
 *   stack list — the mismatch we saw. Giving the user a real CMS stack role
 *   creates that RBAC record, so auth-sdk counts it and the two agree. As a
 *   bonus, entries created while logged in as this user carry a real
 *   `_created_by` that the directory (auth-sdk FetchOrgUsers) can resolve.
 *
 * Mechanism:
 *   POST /v3/stacks/share { emails:[email], roles:{ email:[roleUid] } } — needs
 *   a USER authtoken (mgmt tokens can't share). We obtain it the same way the
 *   workflow transitions do (CONTENTSTACK_USER_* → /v3/user-session, TOTP-aware).
 *
 * Idempotent: if the user is already a stack member (or is the owner), cma
 * returns a benign error which we treat as "already satisfied" and move on.
 *
 * Env knobs:
 *   CONTENTSTACK_USER_EMAIL            — the user to grant a role to (required)
 *   CONTENTSTACK_STACK_ROLE_UID        — exact role uid to assign (optional)
 *   CONTENTSTACK_STACK_ROLE_NAME       — role name to match (optional; default
 *                                        prefers Developer/Content Manager, else
 *                                        the first non-Admin role)
 *
 * Usage:
 *   node --env-file=.env scripts/ensure-stack-user-role.mjs
 *   node --env-file=.env scripts/ensure-stack-user-role.mjs --dry-run
 */

import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  tryLoadUserSessionHeaders,
  listStackRoles,
  shareStack,
  optionalEnv,
} from './lib/cma.mjs'

const DRY_RUN = process.argv.slice(2).includes('--dry-run')

/** Pick the role uid to assign: explicit uid → name match → preferred system
 *  names → first non-Admin/Owner role → first role. */
function pickRole(roles) {
  const wantUid = optionalEnv('CONTENTSTACK_STACK_ROLE_UID')
  if (wantUid) {
    const r = roles.find((x) => x.uid === wantUid)
    if (r) return r
  }
  const wantName = optionalEnv('CONTENTSTACK_STACK_ROLE_NAME')
  if (wantName) {
    const r = roles.find((x) => (x.name || '').toLowerCase() === wantName.toLowerCase())
    if (r) return r
  }
  const preferred = ['developer', 'content manager', 'content_manager']
  for (const name of preferred) {
    const r = roles.find((x) => (x.name || '').toLowerCase() === name)
    if (r) return r
  }
  // Any role that is not Admin/Owner gives an explicit RBAC record.
  const nonAdmin = roles.find(
    (x) => !/^(admin|owner)$/i.test(x.name || ''),
  )
  return nonAdmin || roles[0]
}

async function main() {
  const { apiKey, base, branch } = loadStackAuth()
  const email = optionalEnv('CONTENTSTACK_USER_EMAIL')

  console.log('ensure-stack-user-role')
  console.log(`  stack: api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  user:  ${email || '(CONTENTSTACK_USER_EMAIL unset)'}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  if (!email) {
    console.log(
      '  Skipping — set CONTENTSTACK_USER_EMAIL to the automation user so it can\n' +
        '  be given an explicit stack CMS role (so auth-sdk listStackUsers counts it).',
    )
    return
  }

  // 1) Find a role to assign (mgmt token can read roles).
  const tokens = loadManagementTokens()
  const mgmt = headersForToken(apiKey, tokens[0], branch)
  const { ok: rOk, status: rStatus, body: rBody } = await listStackRoles(base, mgmt)
  if (!rOk) {
    console.warn(`  ✗ could not list stack roles (${rStatus}) — skipping role grant`)
    process.exitCode = 1
    return
  }
  const roles = rBody.roles || []
  const role = pickRole(roles)
  if (!role) {
    console.warn('  ✗ no stack roles available to assign — skipping')
    process.exitCode = 1
    return
  }
  console.log(`  role:  "${role.name}" (${role.uid})`)

  // 2) Need a USER authtoken to /share (mgmt tokens cannot share a stack).
  const userHeaders = await tryLoadUserSessionHeaders(base, apiKey, branch)
  if (!userHeaders) {
    console.log(
      '  Skipping share — no user session. Set CONTENTSTACK_USER_EMAIL +\n' +
        '  CONTENTSTACK_USER_PASSWORD (+ CONTENTSTACK_USER_TOTP_SECRET for 2FA),\n' +
        '  or CONTENTSTACK_USER_AUTHTOKEN. (Management tokens cannot share a stack.)',
    )
    process.exitCode = 1
    return
  }

  if (DRY_RUN) {
    console.log(`  [dry-run] would share stack with ${email} as "${role.name}"`)
    return
  }

  // 3) Share the stack with the user + role → creates the explicit RBAC record.
  const { ok, status, body } = await shareStack(base, userHeaders, {
    emails: [email],
    roles: { [email]: [role.uid] },
  })
  if (ok) {
    console.log(`  ✓ shared — ${email} now has stack role "${role.name}"`)
    return
  }
  // Benign cases: already a member / already invited / is the owner. Treat as
  // satisfied (owner can't be assigned a role, but that's fine — surface a note).
  const msg = (body?.error_message || JSON.stringify(body)).toLowerCase()
  const benign =
    status === 409 ||
    /already|owner|member|invited|exists/.test(msg)
  if (benign) {
    console.log(`  • already satisfied (${status}: ${body?.error_message || 'member/owner'})`)
    return
  }
  console.warn(`  ✗ share failed (${status}): ${body?.error_message || JSON.stringify(body).slice(0, 200)}`)
  process.exitCode = 1
}

main().catch((err) => {
  console.error('ensure-stack-user-role failed:', err)
  process.exit(1)
})
