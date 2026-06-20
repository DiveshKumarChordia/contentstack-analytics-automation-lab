/**
 * user-factory-v2.mjs — Create users with operation assignments encoded in email
 *
 * Email format: divesh.k+run-2025-dec-08-0230pm-ops-create-publish-workflow@contentstack.com
 *
 * Shows:
 * - Run ID (when the run started)
 * - Date/time in human format
 * - Operations assigned to this user
 * - Tracking of what user actually performed
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
import {
  generateRunId,
  encodeOperationName,
  generateEmailWithOps,
  parseEmailOps,
  OperationAssignmentPlan,
  UserWithAssignment,
} from './user-assignment.mjs'
import { UserPool } from './gmail-utils.mjs'

/**
 * Create test users with operation assignments
 *
 * @param {object} options
 *   - baseEmail: Base email for plus addressing
 *   - orgUid: Organization UID
 *   - userCount: Number of users to create (default 30)
 *   - operations: Array of available operations
 *   - assignmentStrategy: 'random' | 'round-robin' | 'all' (default 'random')
 *
 * @returns {object} { users, plan, runId, stats }
 */
export async function createUsersWithOperationAssignments(options = {}) {
  const {
    baseEmail = optionalEnv('CONTENTSTACK_TEST_USER_EMAIL'),
    orgUid = optionalEnv('CONTENTSTACK_ORG_UID'),
    userCount = 30,
    operations = [
      'create-entry',
      'delete-entry',
      'publish-entry',
      'unpublish-entry',
      'bulk-publish-cycle',
      'workflow-transition',
      'localize-entries',
      'list-entries',
    ],
    assignmentStrategy = 'random',
  } = options

  if (!baseEmail) {
    throw new Error('Missing baseEmail or CONTENTSTACK_TEST_USER_EMAIL')
  }
  if (!orgUid) {
    throw new Error('Missing orgUid or CONTENTSTACK_ORG_UID')
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

  // 1. Generate run ID with human-readable timestamp
  const runId = generateRunId()
  console.log(`\n🚀 Run: ${runId}`)
  console.log(`📊 Creating ${userCount} users with operation assignments`)

  // 2. Create assignment plan
  const plan = new OperationAssignmentPlan(userCount, operations)

  if (assignmentStrategy === 'random') {
    plan.assignRandomly(2, 5)
  } else if (assignmentStrategy === 'round-robin') {
    plan.assignRoundRobin()
  } else if (assignmentStrategy === 'all') {
    plan.assignAll()
  }

  // 3. Get org roles
  let orgRoleUid
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

  // 4. Get stack roles
  let stackRoleUid
  {
    const { ok: sOk, body: sBody } = await listStackRoles(base, mgmtHeaders)
    if (!sOk || !Array.isArray(sBody?.roles)) {
      throw new Error('Could not fetch stack roles')
    }
    const devRole = sBody.roles.find(
      (r) => r.name?.toLowerCase() === 'developer' && !/(admin|owner)/i.test(r.name)
    )
    stackRoleUid = (devRole || sBody.roles.find((r) => !/(admin|owner)/i.test(r.name)) || sBody.roles[0])
      .uid
  }

  // 5. Create users
  const users = []
  const pool = new UserPool(baseEmail)

  console.log(`\n👥 Creating users...`)

  for (let i = 0; i < userCount; i++) {
    try {
      const userId = `user-${i}`
      const assignedOps = plan.getAssignment(userId)
      const encodedOps = assignedOps.map(encodeOperationName)

      // Generate email with operation assignment
      const email = generateEmailWithOps(baseEmail, runId, encodedOps)
      plan.setUserEmail(userId, email)

      console.log(`\n[${i + 1}/${userCount}] ${email.split('@')[0]}@...`)
      console.log(`  Assigned ops: ${encodedOps.join(', ')}`)

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

      // Create user object with assignment tracking
      const userObj = new UserWithAssignment(email, assignedOps)
      Object.assign(userObj, {
        user_uid,
        org_uid: orgUid,
        acceptance_token,
        password: generateSecurePassword(),
        firstName: baseEmail.split('.')[0],
        lastName: baseEmail.split('.')[1]?.split('@')[0],
      })

      users.push(userObj)
      pool.addUser(email, userObj.password, null, user_uid, orgUid)

      console.log(`  ✓ Created (ops count: ${assignedOps.length})`)

      // Small delay between creations
      if (i < userCount - 1) {
        await sleep(500)
      }
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`)
    }
  }

  console.log(`\n✓ Created ${users.length}/${userCount} users`)

  return {
    users,
    pool,
    plan,
    runId,
    stats: plan.getStats(),
    assignment_summary: plan.getAllAssignments(),
  }
}

/**
 * Create batch of users and track their operations
 */
export class UserBatch {
  constructor(users, runId) {
    this.users = users // UserWithAssignment[]
    this.runId = runId
    this.startedAt = new Date()
  }

  /**
   * Get random user from batch
   */
  getRandomUser() {
    return this.users[Math.floor(Math.random() * this.users.length)]
  }

  /**
   * Get all users assigned to an operation
   */
  getUsersForOperation(operationName) {
    return this.users.filter((u) => u.assignedOps.includes(operationName))
  }

  /**
   * Record operation performed by user
   */
  recordUserOperation(email, operationName, success = true, result = null) {
    const user = this.users.find((u) => u.email === email)
    if (user) {
      user.recordOperation(operationName, success, result)
      return user
    }
    throw new Error(`User not found: ${email}`)
  }

  /**
   * Get batch summary
   */
  getSummary() {
    const summaries = this.users.map((u) => u.getSummary())

    const totalAssigned = summaries.reduce((sum, s) => sum + s.assigned_ops.length, 0)
    const totalPerformed = summaries.reduce((sum, s) => sum + s.performed_ops, 0)
    const totalSuccessful = summaries.reduce((sum, s) => sum + s.successful, 0)
    const totalFailed = summaries.reduce((sum, s) => sum + s.failed, 0)

    return {
      runId: this.runId,
      startedAt: this.startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      userCount: this.users.length,
      stats: {
        total_assigned_ops: totalAssigned,
        total_performed_ops: totalPerformed,
        total_successful: totalSuccessful,
        total_failed: totalFailed,
        overall_success_rate:
          totalPerformed > 0 ? `${((totalSuccessful / totalPerformed) * 100).toFixed(0)}%` : 'N/A',
        coverage_rate: totalAssigned > 0 ? `${((totalPerformed / totalAssigned) * 100).toFixed(0)}%` : 'N/A',
      },
      user_details: summaries,
    }
  }

  /**
   * Get audit trail of all operations
   */
  getAuditTrail() {
    const trail = []

    for (const user of this.users) {
      for (const op of user.performedOps) {
        trail.push({
          timestamp: op.timestamp,
          user: user.email.split('+')[0] + '+...',
          operation: op.operation,
          assigned: user.assignedOps.includes(op.operation),
          success: op.success,
        })
      }
    }

    return trail.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  }
}

/**
 * Helper: generate secure password
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
 * // Create 30 users with operation assignments
 * const result = await createUsersWithOperationAssignments({
 *   baseEmail: 'divesh.k@contentstack.com',
 *   orgUid: 'org_123',
 *   userCount: 30,
 *   operations: [
 *     'create-entry',
 *     'delete-entry',
 *     'publish-entry',
 *     'workflow-transition',
 *     'localize-entries'
 *   ],
 *   assignmentStrategy: 'random'  // or 'round-robin' or 'all'
 * })
 *
 * const { users, pool, plan, runId, stats } = result
 *
 * // Create batch tracker
 * const batch = new UserBatch(users, runId)
 *
 * // Get random user
 * const user = batch.getRandomUser()
 * // Email: divesh.k+run-2025-dec-08-0230pm-ops-create-publish-workflow@contentstack.com
 *
 * // Perform operation
 * try {
 *   const result = await createEntry(user.email)
 *   batch.recordUserOperation(user.email, 'create-entry', true, result)
 * } catch (e) {
 *   batch.recordUserOperation(user.email, 'create-entry', false, e.message)
 * }
 *
 * // Get summary
 * const summary = batch.getSummary()
 * // Shows: user assignments, what they did, success rates, etc.
 */
