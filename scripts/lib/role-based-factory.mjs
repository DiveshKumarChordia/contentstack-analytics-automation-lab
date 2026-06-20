/**
 * role-based-factory.mjs — Create role-based users at scale
 *
 * Strategies for distributing roles:
 * 1. Pyramid: More editors than admins, more contributors than editors
 * 2. Balanced: Equal distribution across all roles
 * 3. Custom: Specify exact count for each role
 */

import {
  optionalEnv,
  loadStackAuth,
  loadManagementTokens,
  tryLoadUserSessionHeaders,
  inviteUserToOrganization,
  listOrganizationRoles,
  listStackRoles,
  ensureUserHasCMSRole,
  sleep,
} from './cma.mjs'
import { generateRunId, encodeOperationName } from './user-assignment.mjs'
import { ROLES, generateEmailWithRole, RoleBasedUser, RoleBasedUserBatch } from './role-based-users.mjs'
import { UserPool } from './gmail-utils.mjs'

/**
 * Role distribution strategies
 */
export const DISTRIBUTION_STRATEGIES = {
  pyramid: {
    // Many contributors, fewer editors, few admins, 1 owner
    owner: 1,
    admin: Math.max(1, Math.floor(30 * 0.1)), // 10%
    editor: Math.max(1, Math.floor(30 * 0.3)), // 30%
    contributor: Math.max(1, Math.floor(30 * 0.4)), // 40%
    viewer: Math.max(1, Math.floor(30 * 0.2)), // 20%
  },

  balanced: {
    // Equal distribution
    owner: Math.max(1, Math.floor(30 / 5)), // 6 each
    admin: Math.max(1, Math.floor(30 / 5)),
    editor: Math.max(1, Math.floor(30 / 5)),
    contributor: Math.max(1, Math.floor(30 / 5)),
    viewer: Math.max(1, Math.floor(30 / 5)),
  },

  admin_heavy: {
    // More admins for testing management operations
    owner: 1,
    admin: Math.max(1, Math.floor(30 * 0.4)), // 40%
    editor: Math.max(1, Math.floor(30 * 0.3)), // 30%
    contributor: Math.max(1, Math.floor(30 * 0.2)), // 20%
    viewer: Math.max(1, Math.floor(30 * 0.1)), // 10%
  },

  viewer_heavy: {
    // More viewers for testing read-only operations
    owner: 1,
    admin: Math.max(1, Math.floor(30 * 0.1)), // 10%
    editor: Math.max(1, Math.floor(30 * 0.15)), // 15%
    contributor: Math.max(1, Math.floor(30 * 0.25)), // 25%
    viewer: Math.max(1, Math.floor(30 * 0.5)), // 50%
  },
}

/**
 * Create role-based users at scale
 *
 * @param {object} options
 *   - baseEmail: Base email for plus addressing
 *   - orgUid: Organization UID
 *   - userCount: Total users to create (default 30)
 *   - distribution: 'pyramid' | 'balanced' | 'admin_heavy' | 'viewer_heavy' | custom object
 *
 * @returns {object} { users, batch, runId, distribution }
 */
export async function createRoleBasedUsers(options = {}) {
  const {
    baseEmail = optionalEnv('CONTENTSTACK_TEST_USER_EMAIL'),
    orgUid = optionalEnv('CONTENTSTACK_ORG_UID'),
    userCount = 30,
    distribution = 'pyramid',
  } = options

  if (!baseEmail || !orgUid) {
    throw new Error('Missing baseEmail or orgUid')
  }

  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmtHeaders = {
    authorization: tokens[0],
    api_key: apiKey,
  }

  let userHeaders
  try {
    userHeaders = await tryLoadUserSessionHeaders(base, apiKey, branch)
  } catch (e) {
    console.warn('Could not load user session headers')
  }

  const headers = userHeaders || mgmtHeaders

  // Generate run ID
  const runId = generateRunId()
  console.log(`\n🚀 Run: ${runId}`)

  // Determine role distribution
  let roleDistribution
  if (typeof distribution === 'string') {
    roleDistribution = { ...DISTRIBUTION_STRATEGIES[distribution] }
  } else {
    roleDistribution = distribution
  }

  // Calculate actual counts
  let totalAssigned = 0
  const roleCount = {}

  for (const [role, count] of Object.entries(roleDistribution)) {
    const actualCount = Math.max(0, Math.floor(count))
    roleCount[role] = actualCount
    totalAssigned += actualCount
  }

  // Adjust to match userCount if needed
  if (totalAssigned < userCount) {
    const diff = userCount - totalAssigned
    roleCount['editor'] = (roleCount['editor'] || 0) + diff
  }

  console.log(`📊 Role distribution:`)
  for (const [role, count] of Object.entries(roleCount)) {
    if (count > 0) {
      const r = ROLES[role]
      console.log(`  ${r.name}: ${count}`)
    }
  }

  // Get org and stack roles
  let orgRoleUid, stackRoleUid
  {
    const { ok: rOk, body: rBody } = await listOrganizationRoles(base, headers, orgUid)
    if (!rOk || !Array.isArray(rBody?.roles)) {
      throw new Error('Could not fetch organization roles')
    }
    const memberRole = rBody.roles.find((r) => r.domain === 'organization' && r.name === 'member')
    if (!memberRole) {
      throw new Error('Organization has no member role')
    }
    orgRoleUid = memberRole.uid
  }

  {
    const { ok: sOk, body: sBody } = await listStackRoles(base, mgmtHeaders)
    if (!sOk || !Array.isArray(sBody?.roles)) {
      throw new Error('Could not fetch stack roles')
    }
    stackRoleUid = (sBody.roles.find((r) => !/(admin|owner)/i.test(r.name)) || sBody.roles[0]).uid
  }

  // Create users
  const users = []
  const pool = new UserPool(baseEmail)

  console.log(`\n👥 Creating users...`)

  let userIndex = 0

  for (const [roleKey, count] of Object.entries(roleCount)) {
    if (count === 0) continue

    const role = ROLES[roleKey]
    console.log(`\n  ${role.name} (${count} users):`)

    for (let i = 0; i < count; i++) {
      try {
        // Get operations available to this role
        const availableOps = role.operations.slice(0, 4).map(encodeOperationName)

        // Generate email
        const email = generateEmailWithRole(baseEmail, runId, roleKey, availableOps)

        console.log(`    [${userIndex + 1}] ${email.split('@')[0].split('+')[0]}+...`)

        // Invite to org
        const inviteResponse = await inviteUserToOrganization(base, headers, orgUid, {
          emails: [email],
          roles: { [email]: [orgRoleUid] },
        })

        const orgInvitation = inviteResponse.body?.org_invitations?.[0]
        if (!orgInvitation) {
          throw new Error('Failed to invite to org')
        }

        const { user_uid, acceptance_token } = orgInvitation

        // Assign stack role
        await ensureUserHasCMSRole(base, headers, mgmtHeaders, email)

        // Create role-based user object
        const user = new RoleBasedUser(email, roleKey, role.operations)
        Object.assign(user, {
          user_uid,
          org_uid: orgUid,
          acceptance_token,
          password: generateSecurePassword(),
        })

        users.push(user)
        pool.addUser(email, user.password, null, user_uid, orgUid)

        userIndex++

        if (i < count - 1) {
          await sleep(300)
        }
      } catch (e) {
        console.error(`      ✗ Failed: ${e.message}`)
      }
    }
  }

  console.log(`\n✓ Created ${users.length} users`)

  // Create batch tracker
  const batch = new RoleBasedUserBatch(users, runId)

  return {
    users,
    batch,
    pool,
    runId,
    distribution: roleCount,
    distribution_strategy: typeof distribution === 'string' ? distribution : 'custom',
  }
}

/**
 * Helper: Generate secure password
 */
function generateSecurePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let password = ''
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

/**
 * Example usage:
 *
 * // Create role-based users with pyramid distribution
 * const result = await createRoleBasedUsers({
 *   baseEmail: 'divesh.k@contentstack.com',
 *   orgUid: 'org_123',
 *   userCount: 30,
 *   distribution: 'pyramid'  // or 'balanced', 'admin_heavy', etc.
 * })
 *
 * const { users, batch, runId, distribution } = result
 *
 * // Now users have roles:
 * // - Owner user: can do all operations
 * // - Admin users: can do everything except delete stack
 * // - Editor users: can create, publish, localize
 * // - Contributor users: can create and edit only
 * // - Viewer users: can only read
 */
