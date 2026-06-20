/**
 * role-based-users.mjs — Create users with roles, support multi-user operations
 *
 * Features:
 * 1. Define user roles (owner, admin, editor, viewer, contributor)
 * 2. Create users with specific roles
 * 3. Map operations to roles (which roles can do which ops)
 * 4. Support multi-user operations (require multiple roles)
 * 5. Email encodes: run + role + assigned operations
 *
 * Email format:
 * divesh.k+run-2025-dec-08-0230pm-role-admin-ops-create-publish@contentstack.com
 *        └────────────────────────┘ └──────┘ └──────────────────┘
 *        Run ID                    Role     Operations available
 */

/**
 * Define system roles and their permissions
 */
export const ROLES = {
  owner: {
    name: 'Owner',
    abbreviation: 'owner',
    level: 5,
    operations: [
      'create-entry',
      'delete-entry',
      'publish-entry',
      'unpublish-entry',
      'bulk-publish-cycle',
      'workflow-transition',
      'localize-entries',
      'list-entries',
      'list-assets',
      'invite-users',
      'manage-roles',
      'delete-stack',
    ],
    description: 'Full access to all operations',
  },

  admin: {
    name: 'Admin',
    abbreviation: 'admin',
    level: 4,
    operations: [
      'create-entry',
      'delete-entry',
      'publish-entry',
      'unpublish-entry',
      'bulk-publish-cycle',
      'workflow-transition',
      'localize-entries',
      'list-entries',
      'list-assets',
      'invite-users',
      'manage-roles',
    ],
    description: 'Can manage content and users, but cannot delete stack',
  },

  editor: {
    name: 'Content Editor',
    abbreviation: 'editor',
    level: 3,
    operations: [
      'create-entry',
      'edit-after-publish',
      'publish-entry',
      'unpublish-entry',
      'workflow-transition',
      'localize-entries',
      'list-entries',
      'list-assets',
    ],
    description: 'Can create, edit, and publish content',
  },

  contributor: {
    name: 'Contributor',
    abbreviation: 'contributor',
    level: 2,
    operations: ['create-entry', 'edit-after-publish', 'list-entries', 'list-assets'],
    description: 'Can create and edit content, but cannot publish',
  },

  viewer: {
    name: 'Viewer',
    abbreviation: 'viewer',
    level: 1,
    operations: ['list-entries', 'list-assets'],
    description: 'Read-only access to content',
  },
}

/**
 * Multi-user operations that require specific role combinations
 */
export const MULTI_USER_OPERATIONS = {
  'review-and-publish': {
    name: 'Review & Publish',
    requiredRoles: ['editor', 'admin'], // Editor creates, Admin approves
    steps: ['create-entry', 'workflow-transition', 'publish-entry'],
    description: 'Editor creates entry, Admin reviews and publishes',
  },

  'collaborative-create': {
    name: 'Collaborative Create',
    requiredRoles: ['contributor', 'editor'], // Contributor creates, Editor refines
    steps: ['create-entry', 'edit-after-publish'],
    description: 'Contributor creates entry, Editor refines and publishes',
  },

  'owner-approval-publish': {
    name: 'Owner Approval & Publish',
    requiredRoles: ['editor', 'admin', 'owner'],
    steps: ['create-entry', 'workflow-transition', 'workflow-transition', 'publish-entry'],
    description: 'Editor creates, Admin reviews, Owner approves and publishes',
  },

  'bulk-localize-publish': {
    name: 'Bulk Localize & Publish',
    requiredRoles: ['editor', 'admin'],
    steps: ['localize-entries', 'bulk-publish-cycle'],
    description: 'Editor localizes entries, Admin publishes in bulk',
  },

  'delete-and-purge': {
    name: 'Delete & Purge (Owner Only)',
    requiredRoles: ['owner'],
    steps: ['delete-entry'],
    description: 'Owner permanently deletes entries',
  },
}

/**
 * Encode role in email
 * abbreviations: owner, admin, editor, contributor, viewer
 */
export function encodeRole(roleKey) {
  const role = ROLES[roleKey]
  if (!role) throw new Error(`Unknown role: ${roleKey}`)
  return role.abbreviation
}

/**
 * Parse role from email
 * Extract from: run-2025-dec-08-0230pm-role-admin-ops-...
 */
export function parseRoleFromEmail(email) {
  const match = email.match(/role-([a-z]+)-ops/)
  return match?.[1] || null
}

/**
 * Generate email with role
 * divesh.k+run-2025-dec-08-0230pm-role-admin-ops-create-publish@...
 */
export function generateEmailWithRole(baseEmail, runId, roleKey, operations = []) {
  const [prefix, domain] = baseEmail.split('@')

  const roleAbbrev = encodeRole(roleKey)
  const opsStr = operations.slice(0, 3).join('-') // Limit to 3 for readability

  const suffix = opsStr ? `${runId}-role-${roleAbbrev}-ops-${opsStr}` : `${runId}-role-${roleAbbrev}`

  return `${prefix}+${suffix}@${domain}`
}

/**
 * User with role and operations
 */
export class RoleBasedUser {
  constructor(email, roleKey, assignedOps = []) {
    this.email = email
    this.roleKey = roleKey
    this.role = ROLES[roleKey]
    this.assignedOps = assignedOps // Operations available to this role
    this.performedOps = [] // What user actually did

    if (!this.role) {
      throw new Error(`Unknown role: ${roleKey}`)
    }
  }

  /**
   * Check if user can perform operation (based on role)
   */
  canPerform(operationName) {
    return this.role.operations.includes(operationName)
  }

  /**
   * Record operation performed by this user
   */
  recordOperation(operationName, success = true, result = null) {
    if (!this.canPerform(operationName)) {
      throw new Error(
        `Role ${this.role.name} cannot perform ${operationName}. ` +
          `Available: ${this.role.operations.join(', ')}`
      )
    }

    this.performedOps.push({
      operation: operationName,
      success,
      result,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Get summary
   */
  getSummary() {
    const successful = this.performedOps.filter((o) => o.success).length
    const failed = this.performedOps.length - successful

    return {
      email: this.email,
      role: this.role.name,
      role_key: this.roleKey,
      role_level: this.role.level,
      available_ops: this.role.operations,
      assigned_ops: this.assignedOps,
      performed_ops: this.performedOps.length,
      successful,
      failed,
      success_rate: this.performedOps.length > 0 ? `${((successful / this.performedOps.length) * 100).toFixed(0)}%` : 'N/A',
      operations_detail: this.performedOps,
    }
  }
}

/**
 * Multi-user operation executor
 * Coordinates users with different roles to perform complex operations
 */
export class MultiUserOperation {
  constructor(operationKey, requiredUsers = {}) {
    const opDef = MULTI_USER_OPERATIONS[operationKey]
    if (!opDef) {
      throw new Error(`Unknown multi-user operation: ${operationKey}`)
    }

    this.operationKey = operationKey
    this.definition = opDef
    this.requiredUsers = requiredUsers // { roleKey: [user1, user2, ...] }
    this.executedSteps = []
  }

  /**
   * Validate that required roles are present
   */
  validate() {
    const providedRoles = Object.keys(this.requiredUsers)
    const missing = this.definition.requiredRoles.filter((role) => !providedRoles.includes(role))

    if (missing.length > 0) {
      throw new Error(
        `Multi-user operation "${this.definition.name}" requires roles: ${missing.join(', ')}`
      )
    }
  }

  /**
   * Execute operation step with specific user
   */
  executeStep(stepName, user) {
    if (!user.canPerform(stepName)) {
      throw new Error(
        `${user.role.name} (${user.roleKey}) cannot perform step: ${stepName}`
      )
    }

    user.recordOperation(stepName, true)

    this.executedSteps.push({
      step: stepName,
      user: user.email,
      role: user.roleKey,
      timestamp: new Date().toISOString(),
      success: true,
    })
  }

  /**
   * Execute entire operation with users
   * Automatically assigns steps to appropriate roles
   */
  async executeAutomatic() {
    this.validate()

    for (const step of this.definition.steps) {
      // Find a user who can perform this step
      let executed = false

      for (const roleKey of this.definition.requiredRoles) {
        const users = this.requiredUsers[roleKey] || []
        if (users.length > 0) {
          const user = users[Math.floor(Math.random() * users.length)]
          if (user.canPerform(step)) {
            this.executeStep(step, user)
            executed = true
            break
          }
        }
      }

      if (!executed) {
        throw new Error(`Could not find user to execute step: ${step}`)
      }
    }
  }

  /**
   * Get execution summary
   */
  getSummary() {
    return {
      operation: this.definition.name,
      operation_key: this.operationKey,
      description: this.definition.description,
      required_roles: this.definition.requiredRoles,
      steps: this.definition.steps,
      executed_steps: this.executedSteps.length,
      steps_detail: this.executedSteps,
      participants: [...new Set(this.executedSteps.map((s) => s.user))],
    }
  }
}

/**
 * Role-based user batch
 */
export class RoleBasedUserBatch {
  constructor(users, runId) {
    this.users = users // RoleBasedUser[]
    this.runId = runId
    this.startedAt = new Date()
    this.multiUserOps = [] // Completed multi-user operations
  }

  /**
   * Get users by role
   */
  getUsersByRole(roleKey) {
    return this.users.filter((u) => u.roleKey === roleKey)
  }

  /**
   * Get random user with specific role
   */
  getRandomUserWithRole(roleKey) {
    const users = this.getUsersByRole(roleKey)
    if (users.length === 0) {
      throw new Error(`No users with role: ${roleKey}`)
    }
    return users[Math.floor(Math.random() * users.length)]
  }

  /**
   * Execute multi-user operation
   */
  async executeMultiUserOperation(operationKey) {
    // Get required roles
    const opDef = MULTI_USER_OPERATIONS[operationKey]
    if (!opDef) {
      throw new Error(`Unknown operation: ${operationKey}`)
    }

    const requiredUsers = {}
    for (const roleKey of opDef.requiredRoles) {
      const user = this.getRandomUserWithRole(roleKey)
      requiredUsers[roleKey] = [user]
    }

    const multiOp = new MultiUserOperation(operationKey, requiredUsers)
    await multiOp.executeAutomatic()

    this.multiUserOps.push(multiOp)
    return multiOp
  }

  /**
   * Get batch summary
   */
  getSummary() {
    const userSummaries = this.users.map((u) => u.getSummary())

    return {
      runId: this.runId,
      startedAt: this.startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      users: {
        total: this.users.length,
        by_role: Object.fromEntries(
          Object.keys(ROLES).map((role) => [role, this.getUsersByRole(role).length])
        ),
      },
      single_user_operations: {
        total_performed: userSummaries.reduce((sum, u) => sum + u.performed_ops, 0),
        total_successful: userSummaries.reduce((sum, u) => sum + u.successful, 0),
        total_failed: userSummaries.reduce((sum, u) => sum + u.failed, 0),
      },
      multi_user_operations: {
        total: this.multiUserOps.length,
        details: this.multiUserOps.map((o) => o.getSummary()),
      },
      user_details: userSummaries,
    }
  }

  /**
   * Get audit trail
   */
  getAuditTrail() {
    const trail = []

    // Single-user operations
    for (const user of this.users) {
      for (const op of user.performedOps) {
        trail.push({
          timestamp: op.timestamp,
          type: 'single-user',
          user: user.email.split('+')[0] + '+...',
          role: user.roleKey,
          operation: op.operation,
          success: op.success,
        })
      }
    }

    // Multi-user operations
    for (const multiOp of this.multiUserOps) {
      for (const step of multiOp.executedSteps) {
        trail.push({
          timestamp: step.timestamp,
          type: 'multi-user',
          operation: multiOp.operationKey,
          user: step.user.split('+')[0] + '+...',
          role: step.role,
          step: step.step,
          success: step.success,
        })
      }
    }

    return trail.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  }
}

/**
 * Example usage:
 *
 * // Create users with roles
 * const ownerUser = new RoleBasedUser(
 *   'divesh.k+run-2025-dec-08-0230pm-role-owner@...',
 *   'owner'
 * )
 *
 * const editorUser = new RoleBasedUser(
 *   'divesh.k+run-2025-dec-08-0230pm-role-editor-ops-create-publish@...',
 *   'editor'
 * )
 *
 * // Single user operation
 * editorUser.recordOperation('create-entry', true)
 * editorUser.recordOperation('publish-entry', true)
 *
 * // Multi-user operation
 * const batch = new RoleBasedUserBatch([ownerUser, editorUser], 'run-2025-dec-08-0230pm')
 * const result = await batch.executeMultiUserOperation('review-and-publish')
 *
 * // Get summaries
 * console.log(ownerUser.getSummary())
 * console.log(batch.getSummary())
 * console.log(batch.getAuditTrail())
 */
