/**
 * analytics-engine.mjs — Comprehensive KPI and analytics generation from audit trails
 *
 * Extracts detailed metrics from audit trail data without redundant logging
 * Generates visualization-ready data structures
 */

/**
 * Analytics Engine - processes audit trails for comprehensive insights
 */
export class AnalyticsEngine {
  constructor(auditTrail = [], roleDefinitions = {}, operationDefinitions = {}) {
    this.auditTrail = auditTrail
    this.roles = roleDefinitions
    this.operations = operationDefinitions
    this.startTime = null
    this.endTime = null
    this.processTrail()
  }

  /**
   * Process trail and extract timestamps
   */
  processTrail() {
    if (this.auditTrail.length === 0) return

    const timestamps = this.auditTrail
      .map((entry) => new Date(entry.timestamp))
      .filter((t) => !isNaN(t.getTime()))

    if (timestamps.length > 0) {
      this.startTime = new Date(Math.min(...timestamps))
      this.endTime = new Date(Math.max(...timestamps))
    }
  }

  // ============================================================
  // ROLE-BASED ANALYTICS
  // ============================================================

  /**
   * Get KPIs for each role
   */
  getRoleAnalytics() {
    const roleStats = {}

    // Initialize for each role
    Object.keys(this.roles).forEach((roleKey) => {
      roleStats[roleKey] = {
        role: this.roles[roleKey].name,
        level: this.roles[roleKey].level,
        users_with_role: 0,
        total_operations: 0,
        successful_operations: 0,
        failed_operations: 0,
        success_rate: 0,
        operations_breakdown: {},
        error_patterns: {},
        avg_operations_per_user: 0,
      }
    })

    // Count users per role
    const usersByRole = {}
    this.auditTrail.forEach((entry) => {
      if (!usersByRole[entry.role]) {
        usersByRole[entry.role] = new Set()
      }
      usersByRole[entry.role].add(entry.user)
    })

    // Process each entry
    this.auditTrail.forEach((entry) => {
      const stats = roleStats[entry.role]
      if (!stats) return

      stats.total_operations++
      if (entry.success) {
        stats.successful_operations++
      } else {
        stats.failed_operations++
        stats.error_patterns[entry.operation] = (stats.error_patterns[entry.operation] || 0) + 1
      }

      if (!stats.operations_breakdown[entry.operation]) {
        stats.operations_breakdown[entry.operation] = { count: 0, successful: 0, failed: 0 }
      }
      stats.operations_breakdown[entry.operation].count++
      if (entry.success) {
        stats.operations_breakdown[entry.operation].successful++
      } else {
        stats.operations_breakdown[entry.operation].failed++
      }
    })

    // Calculate derived metrics
    Object.keys(roleStats).forEach((roleKey) => {
      const stats = roleStats[roleKey]
      stats.users_with_role = usersByRole[roleKey]?.size || 0
      stats.success_rate = stats.total_operations > 0 ? Math.round((stats.successful_operations / stats.total_operations) * 100) : 0
      stats.avg_operations_per_user = stats.users_with_role > 0 ? Math.round(stats.total_operations / stats.users_with_role) : 0
    })

    return roleStats
  }

  /**
   * Role capability coverage - which roles actually performed which operations
   */
  getRoleCapabilityCoverage() {
    const coverage = {}

    Object.keys(this.roles).forEach((roleKey) => {
      coverage[roleKey] = {
        role: this.roles[roleKey].name,
        allowed_operations: this.roles[roleKey].operations.length,
        performed_operations: new Set(),
        coverage_percentage: 0,
        unperformed_allowed_ops: [],
      }
    })

    this.auditTrail.forEach((entry) => {
      if (coverage[entry.role]) {
        coverage[entry.role].performed_operations.add(entry.operation)
      }
    })

    // Calculate coverage
    Object.keys(coverage).forEach((roleKey) => {
      const cov = coverage[roleKey]
      cov.performed_count = cov.performed_operations.size
      cov.coverage_percentage = (cov.performed_count / cov.allowed_operations) * 100
      cov.performed_operations = Array.from(cov.performed_operations)

      const allowed = new Set(this.roles[roleKey].operations)
      cov.unperformed_allowed_ops = this.roles[roleKey].operations.filter((op) => !allowed.has(op))
    })

    return coverage
  }

  /**
   * Permission boundary validation - check role enforcement
   */
  validatePermissionBoundaries() {
    const violations = []
    const validations = {
      total_operations_checked: 0,
      permission_violations: 0,
      valid_operations: 0,
      violations_by_role: {},
      violations_by_operation: {},
    }

    this.auditTrail.forEach((entry) => {
      validations.total_operations_checked++
      const role = this.roles[entry.role]

      if (!role) {
        violations.push({
          timestamp: entry.timestamp,
          user: entry.user,
          role: entry.role,
          operation: entry.operation,
          issue: 'Unknown role',
        })
        return
      }

      if (!role.operations.includes(entry.operation)) {
        violations.push({
          timestamp: entry.timestamp,
          user: entry.user,
          role: entry.role,
          operation: entry.operation,
          issue: 'Operation not allowed for role',
        })
        validations.permission_violations++
        validations.violations_by_role[entry.role] = (validations.violations_by_role[entry.role] || 0) + 1
        validations.violations_by_operation[entry.operation] = (validations.violations_by_operation[entry.operation] || 0) + 1
      } else {
        validations.valid_operations++
      }
    })

    return {
      validations,
      violations: violations.slice(0, 100), // Top 100 violations
    }
  }

  // ============================================================
  // OPERATION-BASED ANALYTICS
  // ============================================================

  /**
   * Get KPIs for each operation
   */
  getOperationAnalytics() {
    const opStats = {}

    this.auditTrail.forEach((entry) => {
      if (!opStats[entry.operation]) {
        opStats[entry.operation] = {
          operation: entry.operation,
          total_executions: 0,
          successful: 0,
          failed: 0,
          success_rate: 0,
          users_performed_by: new Set(),
          roles_performed_by: new Set(),
          error_frequency: {},
        }
      }

      const stats = opStats[entry.operation]
      stats.total_executions++
      if (entry.success) {
        stats.successful++
      } else {
        stats.failed++
      }
      stats.users_performed_by.add(entry.user)
      stats.roles_performed_by.add(entry.role)
    })

    // Calculate derived metrics
    Object.keys(opStats).forEach((opName) => {
      const stats = opStats[opName]
      stats.success_rate = Math.round((stats.successful / stats.total_executions) * 100)
      stats.unique_users = stats.users_performed_by.size
      stats.roles_involved = Array.from(stats.roles_performed_by)
      delete stats.users_performed_by
      delete stats.roles_performed_by
    })

    return opStats
  }

  /**
   * Operation dependency graph - which operations follow which
   */
  getOperationSequencePatterns() {
    const sequences = {}

    for (let i = 0; i < this.auditTrail.length - 1; i++) {
      const current = this.auditTrail[i]
      const next = this.auditTrail[i + 1]

      // Same user within 5 seconds
      if (
        current.user === next.user &&
        new Date(next.timestamp) - new Date(current.timestamp) < 5000
      ) {
        const pair = `${current.operation} → ${next.operation}`
        sequences[pair] = (sequences[pair] || 0) + 1
      }
    }

    return sequences
  }

  // ============================================================
  // USER-BASED ANALYTICS
  // ============================================================

  /**
   * Get metrics for each user
   */
  getUserAnalytics() {
    const userStats = {}

    this.auditTrail.forEach((entry) => {
      if (!userStats[entry.user]) {
        userStats[entry.user] = {
          user: entry.user,
          role: entry.role,
          total_operations: 0,
          successful: 0,
          failed: 0,
          success_rate: 0,
          operations_performed: new Set(),
          first_operation_at: null,
          last_operation_at: null,
        }
      }

      const stats = userStats[entry.user]
      stats.total_operations++
      if (entry.success) {
        stats.successful++
      } else {
        stats.failed++
      }
      stats.operations_performed.add(entry.operation)

      const timestamp = new Date(entry.timestamp)
      if (!stats.first_operation_at || timestamp < new Date(stats.first_operation_at)) {
        stats.first_operation_at = entry.timestamp
      }
      if (!stats.last_operation_at || timestamp > new Date(stats.last_operation_at)) {
        stats.last_operation_at = entry.timestamp
      }
    })

    // Calculate derived metrics
    Object.keys(userStats).forEach((userKey) => {
      const stats = userStats[userKey]
      stats.success_rate = Math.round((stats.successful / stats.total_operations) * 100)
      stats.unique_operations = stats.operations_performed.size
      stats.operations_performed = Array.from(stats.operations_performed)

      if (stats.first_operation_at && stats.last_operation_at) {
        const duration = new Date(stats.last_operation_at) - new Date(stats.first_operation_at)
        stats.duration_seconds = Math.round(duration / 1000)
        stats.ops_per_second = (stats.total_operations / (duration / 1000)).toFixed(2)
      }
    })

    return userStats
  }

  /**
   * User reliability ranking
   */
  getUserReliabilityRanking() {
    const userAnalytics = this.getUserAnalytics()
    const ranking = Object.values(userAnalytics)
      .sort((a, b) => b.success_rate - a.success_rate)
      .map((u, idx) => ({
        rank: idx + 1,
        user: u.user,
        role: u.role,
        success_rate: u.success_rate,
        operations: u.total_operations,
      }))

    return ranking
  }

  /**
   * User specialization - which operations each user is good at
   */
  getUserSpecialization() {
    const userOpsBreakdown = {}

    this.auditTrail.forEach((entry) => {
      if (!userOpsBreakdown[entry.user]) {
        userOpsBreakdown[entry.user] = { role: entry.role, operations: {} }
      }

      if (!userOpsBreakdown[entry.user].operations[entry.operation]) {
        userOpsBreakdown[entry.user].operations[entry.operation] = { count: 0, successful: 0 }
      }

      userOpsBreakdown[entry.user].operations[entry.operation].count++
      if (entry.success) {
        userOpsBreakdown[entry.user].operations[entry.operation].successful++
      }
    })

    // Calculate specialization score for each user-operation pair
    const specialization = {}
    Object.keys(userOpsBreakdown).forEach((user) => {
      specialization[user] = {
        role: userOpsBreakdown[user].role,
        strengths: [], // Operations with 100% success
        good_at: [], // Operations with 80%+ success
        weak_in: [], // Operations with <50% success
      }

      Object.keys(userOpsBreakdown[user].operations).forEach((op) => {
        const opData = userOpsBreakdown[user].operations[op]
        const successRate = (opData.successful / opData.count) * 100

        if (successRate === 100) {
          specialization[user].strengths.push({ operation: op, executions: opData.count })
        } else if (successRate >= 80) {
          specialization[user].good_at.push({
            operation: op,
            success_rate: Math.round(successRate),
            executions: opData.count,
          })
        } else if (successRate < 50) {
          specialization[user].weak_in.push({
            operation: op,
            success_rate: Math.round(successRate),
            executions: opData.count,
          })
        }
      })
    })

    return specialization
  }

  // ============================================================
  // MULTI-USER OPERATION ANALYTICS
  // ============================================================

  /**
   * Analyze multi-user operations
   */
  getMultiUserOperationAnalytics() {
    const multiUserOps = this.auditTrail.filter((e) => e.type === 'multi-user')

    if (multiUserOps.length === 0) {
      return { total_multi_user_ops: 0, operations: {} }
    }

    const opsAnalysis = {}

    multiUserOps.forEach((entry) => {
      if (!opsAnalysis[entry.operation]) {
        opsAnalysis[entry.operation] = {
          operation: entry.operation,
          total_executions: 0,
          successful: 0,
          failed: 0,
          success_rate: 0,
          steps_completed: new Set(),
          roles_involved: new Set(),
          step_success_rates: {},
        }
      }

      const stats = opsAnalysis[entry.operation]
      stats.steps_completed.add(entry.step)
      stats.roles_involved.add(entry.role)

      if (!stats.step_success_rates[entry.step]) {
        stats.step_success_rates[entry.step] = { count: 0, successful: 0 }
      }
      stats.step_success_rates[entry.step].count++
      if (entry.success) {
        stats.step_success_rates[entry.step].successful++
      }
    })

    // Calculate overall metrics
    Object.keys(opsAnalysis).forEach((opName) => {
      const stats = opsAnalysis[opName]
      const allSteps = Object.values(stats.step_success_rates)
      stats.total_executions = allSteps.reduce((sum, s) => sum + s.count, 0)
      stats.successful = allSteps.reduce((sum, s) => sum + s.successful, 0)
      stats.failed = stats.total_executions - stats.successful
      stats.success_rate = Math.round((stats.successful / stats.total_executions) * 100)
      stats.steps_completed = Array.from(stats.steps_completed)
      stats.roles_involved = Array.from(stats.roles_involved)

      // Step-wise success rates
      Object.keys(stats.step_success_rates).forEach((step) => {
        const sr = stats.step_success_rates[step]
        sr.success_rate = Math.round((sr.successful / sr.count) * 100)
      })
    })

    return {
      total_multi_user_ops: multiUserOps.length,
      operations: opsAnalysis,
    }
  }

  // ============================================================
  // SYSTEM-WIDE ANALYTICS
  // ============================================================

  /**
   * Overall system KPIs
   */
  getSystemAnalytics() {
    const singleUserOps = this.auditTrail.filter((e) => e.type !== 'multi-user')
    const multiUserOps = this.auditTrail.filter((e) => e.type === 'multi-user')

    const totalOps = this.auditTrail.length
    const successOps = this.auditTrail.filter((e) => e.success).length
    const failedOps = totalOps - successOps

    const uniqueUsers = new Set(this.auditTrail.map((e) => e.user)).size
    const uniqueRoles = new Set(this.auditTrail.map((e) => e.role)).size
    const uniqueOperations = new Set(this.auditTrail.map((e) => e.operation)).size

    return {
      summary: {
        total_operations: totalOps,
        successful_operations: successOps,
        failed_operations: failedOps,
        overall_success_rate: totalOps > 0 ? Math.round((successOps / totalOps) * 100) : 0,
      },
      breakdown: {
        single_user_operations: singleUserOps.length,
        multi_user_operations: multiUserOps.length,
      },
      unique_counts: {
        users: uniqueUsers,
        roles: uniqueRoles,
        operations: uniqueOperations,
      },
      duration: {
        start: this.startTime?.toISOString(),
        end: this.endTime?.toISOString(),
        duration_seconds: this.startTime && this.endTime ? Math.round((this.endTime - this.startTime) / 1000) : 0,
        throughput_ops_per_second: this.startTime && this.endTime ? (totalOps / ((this.endTime - this.startTime) / 1000)).toFixed(2) : 0,
      },
    }
  }

  /**
   * Load distribution fairness
   */
  getLoadDistribution() {
    const userAnalytics = this.getUserAnalytics()
    const opCounts = Object.values(userAnalytics).map((u) => u.total_operations)

    const avgOps = opCounts.reduce((a, b) => a + b, 0) / opCounts.length
    const variance = opCounts.reduce((sum, count) => sum + Math.pow(count - avgOps, 2), 0) / opCounts.length
    const stdDev = Math.sqrt(variance)
    const fairnessScore = 100 - Math.round((stdDev / avgOps) * 100) // Higher is more fair

    return {
      average_ops_per_user: Math.round(avgOps),
      min_ops: Math.min(...opCounts),
      max_ops: Math.max(...opCounts),
      std_deviation: Math.round(stdDev),
      fairness_score: Math.max(0, fairnessScore), // 0-100
      distribution_explanation:
        fairnessScore > 80 ? 'Excellent distribution' : fairnessScore > 60 ? 'Good distribution' : 'Uneven distribution',
    }
  }

  /**
   * Comprehensive report combining all analytics
   */
  getComprehensiveReport() {
    return {
      system: this.getSystemAnalytics(),
      load_distribution: this.getLoadDistribution(),
      roles: this.getRoleAnalytics(),
      role_coverage: this.getRoleCapabilityCoverage(),
      permission_validation: this.validatePermissionBoundaries(),
      operations: this.getOperationAnalytics(),
      operation_sequences: this.getOperationSequencePatterns(),
      users: this.getUserAnalytics(),
      user_reliability_ranking: this.getUserReliabilityRanking(),
      user_specialization: this.getUserSpecialization(),
      multi_user_operations: this.getMultiUserOperationAnalytics(),
    }
  }

  /**
   * Generate visualization-ready data
   */
  getVisualizationData() {
    const roleAnalytics = this.getRoleAnalytics()
    const operationAnalytics = this.getOperationAnalytics()
    const userAnalytics = this.getUserAnalytics()

    return {
      role_success_rates: Object.entries(roleAnalytics).map(([key, data]) => ({
        role: data.role,
        success_rate: data.success_rate,
        total_ops: data.total_operations,
        users: data.users_with_role,
      })),

      operation_success_rates: Object.entries(operationAnalytics).map(([key, data]) => ({
        operation: key,
        success_rate: data.success_rate,
        executions: data.total_executions,
        users: data.unique_users,
      })),

      user_workload: Object.entries(userAnalytics).map(([key, data]) => ({
        user: key,
        role: data.role,
        operations: data.total_operations,
        success_rate: data.success_rate,
      })),

      role_operation_heatmap: this._generateRoleOperationHeatmap(roleAnalytics),

      system_metrics: this.getSystemAnalytics(),
    }
  }

  /**
   * Private: Generate role x operation heatmap
   */
  _generateRoleOperationHeatmap(roleAnalytics) {
    const heatmap = {}

    Object.keys(roleAnalytics).forEach((roleKey) => {
      const roleData = roleAnalytics[roleKey]
      Object.keys(roleData.operations_breakdown).forEach((op) => {
        const key = `${roleKey}:${op}`
        heatmap[key] = {
          role: roleKey,
          operation: op,
          executions: roleData.operations_breakdown[op].count,
          success_rate:
            roleData.operations_breakdown[op].count > 0
              ? Math.round((roleData.operations_breakdown[op].successful / roleData.operations_breakdown[op].count) * 100)
              : 0,
        }
      })
    })

    return heatmap
  }
}
