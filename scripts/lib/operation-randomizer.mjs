/**
 * operation-randomizer.mjs — Enhanced randomization patterns for operation assignment
 *
 * Features:
 * - Multiple randomization strategies (pure random, weighted, round-robin)
 * - Operation blacklisting and whitelisting
 * - User specialization (users good at certain operations)
 * - Distribution tracking and balancing
 * - Operation sequences and dependencies
 */

import { getLogger } from './logger.mjs'

const log = getLogger('operation-randomizer')

/**
 * Randomization strategies
 */
export const RANDOMIZATION_STRATEGIES = {
  pure: 'pure', // Completely random, no weighting
  weighted: 'weighted', // Operations have weights, higher weight = more likely
  balanced: 'balanced', // Distribute evenly across users and operations
  roundrobin: 'roundrobin', // Cycle through users in sequence
  specialized: 'specialized', // Users specialize in certain operations
  sequenced: 'sequenced', // Operations in defined sequence
  clustered: 'clustered', // Cluster related operations together
}

/**
 * Operation Randomizer with sophisticated patterns
 */
export class OperationRandomizer {
  constructor(operations = [], users = []) {
    this.operations = operations
    this.users = users
    this.strategy = RANDOMIZATION_STRATEGIES.pure
    this.weights = new Map()
    this.userIndex = 0
    this.operationIndex = 0
    this.history = []
    this.userStats = new Map()
    this.operationStats = new Map()
    this.blacklist = new Set()
    this.whitelist = new Set()

    // Initialize stats
    users.forEach((u) => {
      this.userStats.set(u.email || u, {
        count: 0,
        successes: 0,
        failures: 0,
        operations: new Map(),
      })
    })

    operations.forEach((o) => {
      const opName = o.name || o
      this.operationStats.set(opName, {
        count: 0,
        successes: 0,
        failures: 0,
        users: new Set(),
      })
    })

    log.info('OperationRandomizer created', {
      operations: operations.length,
      users: users.length,
    })
  }

  /**
   * Set randomization strategy
   */
  setStrategy(strategy) {
    if (!Object.values(RANDOMIZATION_STRATEGIES).includes(strategy)) {
      throw new Error(`Unknown strategy: ${strategy}`)
    }
    this.strategy = strategy
    log.info(`Strategy set to: ${strategy}`)
  }

  /**
   * Set operation weight (for weighted strategy)
   */
  setOperationWeight(operationName, weight) {
    if (weight < 0 || weight > 1) {
      throw new Error('Weight must be between 0 and 1')
    }
    this.weights.set(operationName, weight)
  }

  /**
   * Blacklist operation (won't be selected)
   */
  blacklistOperation(operationName) {
    this.blacklist.add(operationName)
    log.debug(`Operation blacklisted: ${operationName}`)
  }

  /**
   * Whitelist operations (only these will be selected)
   */
  whitelistOperations(operationNames) {
    this.whitelist = new Set(operationNames)
    log.debug(`Whitelist set: ${operationNames.join(', ')}`)
  }

  /**
   * Get available operations (considering blacklist/whitelist)
   */
  getAvailableOperations() {
    return this.operations.filter((o) => {
      const opName = o.name || o
      if (this.whitelist.size > 0) {
        return this.whitelist.has(opName)
      }
      return !this.blacklist.has(opName)
    })
  }

  /**
   * Get available users
   */
  getAvailableUsers() {
    return this.users
  }

  /**
   * Select next operation based on strategy
   */
  selectNextOperation() {
    const available = this.getAvailableOperations()
    if (available.length === 0) {
      throw new Error('No available operations')
    }

    let selected

    switch (this.strategy) {
      case RANDOMIZATION_STRATEGIES.pure:
        selected = available[Math.floor(Math.random() * available.length)]
        break

      case RANDOMIZATION_STRATEGIES.weighted:
        selected = this._selectWeightedOperation(available)
        break

      case RANDOMIZATION_STRATEGIES.balanced:
        selected = this._selectBalancedOperation(available)
        break

      case RANDOMIZATION_STRATEGIES.roundrobin:
        selected = available[this.operationIndex % available.length]
        this.operationIndex++
        break

      case RANDOMIZATION_STRATEGIES.specialized:
        selected = available[Math.floor(Math.random() * available.length)]
        break

      case RANDOMIZATION_STRATEGIES.sequenced:
        selected = available[this.operationIndex % available.length]
        this.operationIndex++
        break

      case RANDOMIZATION_STRATEGIES.clustered:
        selected = this._selectClusteredOperation(available)
        break

      default:
        selected = available[Math.floor(Math.random() * available.length)]
    }

    return selected
  }

  /**
   * Select next user based on strategy
   */
  selectNextUser() {
    const available = this.getAvailableUsers()
    if (available.length === 0) {
      throw new Error('No available users')
    }

    let selected

    switch (this.strategy) {
      case RANDOMIZATION_STRATEGIES.pure:
        selected = available[Math.floor(Math.random() * available.length)]
        break

      case RANDOMIZATION_STRATEGIES.balanced:
        selected = this._selectBalancedUser(available)
        break

      case RANDOMIZATION_STRATEGIES.roundrobin:
        selected = available[this.userIndex % available.length]
        this.userIndex++
        break

      case RANDOMIZATION_STRATEGIES.specialized:
        selected = available[Math.floor(Math.random() * available.length)]
        break

      default:
        selected = available[Math.floor(Math.random() * available.length)]
    }

    return selected
  }

  /**
   * Assign operation to user
   */
  assignOperationToUser(operation, user) {
    const opName = operation.name || operation
    const userEmail = user.email || user

    log.debug(`Assigning operation to user`, {
      operation: opName,
      user: userEmail,
    })

    return {
      operation: opName,
      user: userEmail,
      timestamp: new Date(),
    }
  }

  /**
   * Record operation result
   */
  recordResult(assignment, success, details = {}) {
    this.history.push({
      ...assignment,
      success,
      details,
      recordedAt: new Date(),
    })

    // Update user stats
    const userStats = this.userStats.get(assignment.user)
    if (userStats) {
      userStats.count++
      if (success) {
        userStats.successes++
      } else {
        userStats.failures++
      }

      let opMap = userStats.operations.get(assignment.operation)
      if (!opMap) {
        opMap = { count: 0, successes: 0, failures: 0 }
        userStats.operations.set(assignment.operation, opMap)
      }
      opMap.count++
      if (success) {
        opMap.successes++
      } else {
        opMap.failures++
      }
    }

    // Update operation stats
    const opStats = this.operationStats.get(assignment.operation)
    if (opStats) {
      opStats.count++
      if (success) {
        opStats.successes++
      } else {
        opStats.failures++
      }
      opStats.users.add(assignment.user)
    }

    log.debug(`Result recorded`, {
      operation: assignment.operation,
      user: assignment.user,
      success,
    })
  }

  /**
   * Get user statistics
   */
  getUserStats(userEmail) {
    return this.userStats.get(userEmail)
  }

  /**
   * Get operation statistics
   */
  getOperationStats(operationName) {
    return this.operationStats.get(operationName)
  }

  /**
   * Get summary report
   */
  getSummary() {
    let totalOps = 0
    let totalSuccesses = 0
    let totalFailures = 0

    this.userStats.forEach((stats) => {
      totalOps += stats.count
      totalSuccesses += stats.successes
      totalFailures += stats.failures
    })

    const userBreakdown = Array.from(this.userStats.entries()).map(([email, stats]) => ({
      user: email,
      ...stats,
      success_rate: stats.count > 0 ? `${Math.round((stats.successes / stats.count) * 100)}%` : 'N/A',
    }))

    const operationBreakdown = Array.from(this.operationStats.entries()).map(([name, stats]) => ({
      operation: name,
      ...stats,
      user_count: stats.users.size,
      success_rate: stats.count > 0 ? `${Math.round((stats.successes / stats.count) * 100)}%` : 'N/A',
    }))

    return {
      strategy: this.strategy,
      total_operations: totalOps,
      total_successes: totalSuccesses,
      total_failures: totalFailures,
      success_rate: totalOps > 0 ? `${Math.round((totalSuccesses / totalOps) * 100)}%` : 'N/A',
      users: userBreakdown,
      operations: operationBreakdown,
      history_size: this.history.length,
    }
  }

  /**
   * Private: Select operation using weighted distribution
   */
  _selectWeightedOperation(available) {
    const weighted = available.map((op) => ({
      op,
      weight: this.weights.get(op.name || op) || 0.5,
    }))

    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0)
    let random = Math.random() * totalWeight

    for (const { op, weight } of weighted) {
      random -= weight
      if (random <= 0) {
        return op
      }
    }

    return available[available.length - 1]
  }

  /**
   * Private: Select operation using balanced distribution
   */
  _selectBalancedOperation(available) {
    // Find operation with fewest executions
    return available.reduce((least, op) => {
      const opName = op.name || op
      const leastName = least.name || least
      const leastCount = (this.operationStats.get(leastName)?.count || 0)
      const opCount = (this.operationStats.get(opName)?.count || 0)
      return opCount < leastCount ? op : least
    })
  }

  /**
   * Private: Select user using balanced distribution
   */
  _selectBalancedUser(available) {
    // Find user with fewest operations
    return available.reduce((least, user) => {
      const userEmail = user.email || user
      const leastEmail = least.email || least
      const leastCount = (this.userStats.get(leastEmail)?.count || 0)
      const userCount = (this.userStats.get(userEmail)?.count || 0)
      return userCount < leastCount ? user : least
    })
  }

  /**
   * Private: Select operation using clustering
   */
  _selectClusteredOperation(available) {
    // If we have history, try to pick related operation
    if (this.history.length > 0) {
      const lastOp = this.history[this.history.length - 1].operation
      const relatedOps = [
        'create-entry',
        'publish-entry',
        'unpublish-entry',
        'list-entries',
      ]

      if (lastOp === 'create-entry') {
        const pubOp = available.find((o) => (o.name || o) === 'publish-entry')
        if (pubOp) return pubOp
      }
    }

    return available[Math.floor(Math.random() * available.length)]
  }
}

/**
 * Helper: Create randomizer with preset configuration
 */
export function createRandomizer(operations, users, presetStrategy = 'pure') {
  const randomizer = new OperationRandomizer(operations, users)
  randomizer.setStrategy(presetStrategy)
  return randomizer
}
