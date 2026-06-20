/**
 * user-assignment.mjs — Pre-assign operations to users, encode in email
 *
 * Strategy:
 * 1. Generate run ID with human-readable date/time
 * 2. Create operation assignment plan (which ops each user does)
 * 3. Encode operations in email: divesh.k+run-2025-dec-08-0230pm-ops-create-publish-transition
 * 4. Track and report what each user actually performed
 */

/**
 * Format timestamp as human-readable calendar date/time
 * 2025-12-08T14:30:45 → 2025-dec-08-0230pm
 *
 * @param {Date} date - Date to format
 * @returns {string} - Human readable format
 */
export function formatDateTimeHuman(date = new Date()) {
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ]

  const year = date.getFullYear()
  const month = months[date.getMonth()]
  const day = String(date.getDate()).padStart(2, '0')

  let hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'pm' : 'am'
  hours = hours % 12 || 12 // Convert to 12-hour format

  const timeStr = `${hours}${minutes}${ampm}`

  return `${year}-${month}-${day}-${timeStr}`
}

/**
 * Generate run ID with human-readable timestamp
 * @returns {string} - Run ID (e.g., run-2025-dec-08-0230pm)
 */
export function generateRunId(date = new Date()) {
  return `run-${formatDateTimeHuman(date)}`
}

/**
 * Shorten operation names for email encoding
 * create-entry → create
 * delete-entry → delete
 * publish-entry → publish
 * bulk-publish-cycle → bulk-pub
 * workflow-transition → workflow
 * localize-entries → localize
 */
export function encodeOperationName(operation) {
  const map = {
    'create-entry': 'create',
    'create-entries': 'create',
    'delete-entry': 'delete',
    'delete-entries': 'delete',
    'publish-entry': 'publish',
    'publish-entries': 'publish',
    'unpublish-entry': 'unpub',
    'unpublish-entries': 'unpub',
    'bulk-publish-cycle': 'bulk-pub',
    'bulk-unpublish': 'bulk-unpub',
    'workflow-transition': 'workflow',
    'workflow-transitions': 'workflow',
    'localize-entries': 'localize',
    'localize-entry': 'localize',
    'list-entries': 'list',
    'list-assets': 'assets',
    'get-content-types': 'content-types',
    'edit-after-publish': 'edit-pub',
    'permanent-deletes': 'perm-delete',
    'aged-stalls': 'stalls',
    'no-workflow-ct': 'no-workflow',
    'multi-actor-create-publish': 'multi-actor',
    'branch-locale-deletion': 'delete-branch',
    'invite-users': 'invite',
  }

  return map[operation] || operation.toLowerCase().slice(0, 8)
}

/**
 * Generate email with operation assignment
 * divesh.k+run-2025-dec-08-0230pm-ops-create-publish-workflow
 *
 * @param {string} baseEmail - Base email
 * @param {string} runId - Run ID
 * @param {string[]} operations - Assigned operations (shortened names)
 * @returns {string} - Full email with operation encoding
 */
export function generateEmailWithOps(baseEmail, runId, operations = []) {
  const [prefix, domain] = baseEmail.split('@')

  // Limit to 3-4 ops per email (keep it readable)
  const opsStr = operations.slice(0, 4).join('-')
  const suffix = opsStr ? `${runId}-ops-${opsStr}` : runId

  return `${prefix}+${suffix}@${domain}`
}

/**
 * Parse email to extract run info and assigned operations
 * Reverse of generateEmailWithOps()
 *
 * @param {string} email - Email to parse
 * @returns {object} - { runId, operations }
 */
export function parseEmailOps(email) {
  const match = email.match(/\+([^@]+)@/)
  if (!match) return null

  const suffix = match[1]

  // Format: run-2025-dec-08-0230pm or run-2025-dec-08-0230pm-ops-create-publish
  const parts = suffix.split('-ops-')
  const runId = parts[0]
  const opsStr = parts[1] || ''
  const operations = opsStr ? opsStr.split('-') : []

  return { runId, operations }
}

/**
 * Operation Assignment Plan
 * Decides which operations each user will perform
 */
export class OperationAssignmentPlan {
  constructor(totalUsers, availableOperations = []) {
    this.totalUsers = totalUsers
    this.availableOperations = availableOperations
    this.assignments = new Map() // userId → operations[]
    this.userEmails = new Map() // userId → email
  }

  /**
   * Random assignment - each user gets random subset of operations
   * @param {number} opsPerUserMin - Min operations per user
   * @param {number} opsPerUserMax - Max operations per user
   */
  assignRandomly(opsPerUserMin = 2, opsPerUserMax = 5) {
    for (let i = 0; i < this.totalUsers; i++) {
      const count = Math.floor(Math.random() * (opsPerUserMax - opsPerUserMin + 1)) + opsPerUserMin
      const assigned = []

      // Shuffle available ops and pick random subset
      const shuffled = [...this.availableOperations].sort(() => Math.random() - 0.5)

      for (let j = 0; j < Math.min(count, shuffled.length); j++) {
        assigned.push(shuffled[j])
      }

      this.assignments.set(`user-${i}`, assigned)
    }
  }

  /**
   * Round-robin assignment - distribute ops evenly across users
   */
  assignRoundRobin() {
    let opIndex = 0

    for (let i = 0; i < this.totalUsers; i++) {
      const assigned = []

      // Each user gets roughly same number of ops
      const opsPerUser = Math.ceil(this.availableOperations.length / this.totalUsers)

      for (let j = 0; j < opsPerUser && opIndex < this.availableOperations.length; j++) {
        assigned.push(this.availableOperations[opIndex])
        opIndex++
      }

      this.assignments.set(`user-${i}`, assigned)
    }
  }

  /**
   * Fixed assignment - each user does all operations
   */
  assignAll() {
    for (let i = 0; i < this.totalUsers; i++) {
      this.assignments.set(`user-${i}`, [...this.availableOperations])
    }
  }

  /**
   * Get assignment for specific user
   */
  getAssignment(userId) {
    return this.assignments.get(userId) || []
  }

  /**
   * Set email for user
   */
  setUserEmail(userId, email) {
    this.userEmails.set(userId, email)
  }

  /**
   * Get email for user
   */
  getUserEmail(userId) {
    return this.userEmails.get(userId)
  }

  /**
   * Get all assignments as structured data
   */
  getAllAssignments() {
    const result = []
    for (const [userId, operations] of this.assignments.entries()) {
      result.push({
        userId,
        email: this.userEmails.get(userId),
        assignedOps: operations,
        count: operations.length,
      })
    }
    return result
  }

  /**
   * Get statistics
   */
  getStats() {
    const stats = {
      totalUsers: this.totalUsers,
      totalOps: this.availableOperations.length,
      avgOpsPerUser: 0,
      minOpsPerUser: Infinity,
      maxOpsPerUser: 0,
      distribution: {},
    }

    let totalOpsAssigned = 0
    const counts = []

    for (const [, ops] of this.assignments.entries()) {
      const count = ops.length
      counts.push(count)
      totalOpsAssigned += count

      if (count > stats.maxOpsPerUser) stats.maxOpsPerUser = count
      if (count < stats.minOpsPerUser) stats.minOpsPerUser = count

      stats.distribution[count] = (stats.distribution[count] || 0) + 1
    }

    stats.avgOpsPerUser = (totalOpsAssigned / this.totalUsers).toFixed(2)

    return stats
  }
}

/**
 * User with operation assignment and tracking
 */
export class UserWithAssignment {
  constructor(email, assignedOps = []) {
    this.email = email
    this.assignedOps = assignedOps // What user is supposed to do
    this.performedOps = [] // What user actually did
    this.created_at = new Date().toISOString()
  }

  /**
   * Mark operation as performed by this user
   */
  recordOperation(operationName, success = true, result = null) {
    this.performedOps.push({
      operation: operationName,
      success,
      result,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Get operations that user was supposed to do but didn't
   */
  getMissingOps() {
    const performed = new Set(this.performedOps.map((o) => o.operation))
    return this.assignedOps.filter((op) => !performed.has(op))
  }

  /**
   * Get operations user did that weren't assigned
   */
  getExtraOps() {
    const assigned = new Set(this.assignedOps)
    return this.performedOps.filter((o) => !assigned.has(o.operation))
  }

  /**
   * Get performance summary
   */
  getSummary() {
    const successful = this.performedOps.filter((o) => o.success).length
    const failed = this.performedOps.length - successful

    return {
      email: this.email,
      assigned_ops: this.assignedOps,
      performed_ops: this.performedOps.length,
      successful,
      failed,
      success_rate: this.performedOps.length > 0 ? `${((successful / this.performedOps.length) * 100).toFixed(0)}%` : 'N/A',
      missing_ops: this.getMissingOps(),
      extra_ops: this.getExtraOps(),
      created_at: this.created_at,
    }
  }
}

/**
 * Example usage:
 *
 * // Generate run ID
 * const runId = generateRunId()  // run-2025-dec-08-0230pm
 *
 * // Create assignment plan
 * const plan = new OperationAssignmentPlan(30, [
 *   'create-entry',
 *   'publish-entry',
 *   'workflow-transition',
 *   'localize-entries'
 * ])
 *
 * // Assign randomly (each user gets 2-4 ops)
 * plan.assignRandomly(2, 4)
 *
 * // Generate email with operations
 * const ops = plan.getAssignment('user-0')
 * const email = generateEmailWithOps(
 *   'divesh.k@contentstack.com',
 *   runId,
 *   ops.map(encodeOperationName)
 * )
 * // divesh.k+run-2025-dec-08-0230pm-ops-create-publish-workflow@contentstack.com
 *
 * // Track what user does
 * const user = new UserWithAssignment(email, ops)
 * user.recordOperation('create-entry', true)
 * user.recordOperation('publish-entry', true)
 * user.recordOperation('workflow-transition', false)  // failed
 *
 * // Get summary
 * console.log(user.getSummary())
 * // {
 * //   email: 'divesh.k+run-2025-dec-08-0230pm-ops-create-publish-workflow@...',
 * //   assigned_ops: ['create-entry', 'publish-entry', 'workflow-transition'],
 * //   performed_ops: 3,
 * //   successful: 2,
 * //   failed: 1,
 * //   success_rate: '67%',
 * //   missing_ops: [],
 * //   extra_ops: []
 * // }
 */
