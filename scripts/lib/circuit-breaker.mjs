/**
 * Circuit breaker pattern for preventing cascading failures.
 * States: CLOSED (normal) → OPEN (fast-fail) → HALF_OPEN (testing recovery)
 */

export const CircuitState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open',
}

export class CircuitBreaker {
  constructor(name, config = {}) {
    this.name = name
    this.state = CircuitState.CLOSED
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = null
    this.openTime = null

    // Configuration thresholds
    this.failureThreshold = config.failureThreshold || 5 // Trip circuit after 5 failures
    this.successThreshold = config.successThreshold || 2 // Close circuit after 2 successes in HALF_OPEN
    this.timeout = config.timeout || 30000 // Wait 30s before trying to recover

    this.logger = config.logger
    this.metrics = config.metrics
  }

  canExecute() {
    if (this.state === CircuitState.CLOSED) return true

    if (this.state === CircuitState.OPEN) {
      // Check if timeout has elapsed to transition to HALF_OPEN
      if (Date.now() - this.openTime > this.timeout) {
        this.transition(CircuitState.HALF_OPEN)
        return true
      }
      return false
    }

    // HALF_OPEN: allow one request to test recovery
    return true
  }

  recordSuccess() {
    this.failureCount = 0

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++
      if (this.successCount >= this.successThreshold) {
        this.transition(CircuitState.CLOSED)
      }
    }

    if (this.metrics) {
      this.metrics.recordOperation(`${this.name}:circuit-breaker`, 'success', 0, true, {
        state: this.state,
      })
    }
  }

  recordFailure(error) {
    this.failureCount++
    this.lastFailureTime = Date.now()
    this.successCount = 0

    if (this.state === CircuitState.HALF_OPEN) {
      // Failure in HALF_OPEN means recovery failed, reopen circuit
      this.transition(CircuitState.OPEN)
    } else if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
      // Too many failures, open circuit
      this.transition(CircuitState.OPEN)
    }

    if (this.metrics) {
      this.metrics.recordOperation(`${this.name}:circuit-breaker`, 'failure', 0, false, {
        state: this.state,
        failureCount: this.failureCount,
      })
    }

    if (this.logger) {
      this.logger.warn(`${this.name} circuit breaker: failure recorded (${this.failureCount}/${this.failureThreshold})`, {
        state: this.state,
        error: error?.message,
      })
    }
  }

  transition(newState) {
    const oldState = this.state
    this.state = newState
    this.failureCount = 0
    this.successCount = 0

    if (newState === CircuitState.OPEN) {
      this.openTime = Date.now()
    }

    if (this.logger) {
      this.logger.info(`${this.name} circuit breaker: ${oldState} → ${newState}`, {
        nextRetryAt: newState === CircuitState.OPEN ? new Date(this.openTime + this.timeout).toISOString() : null,
      })
    }
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      nextRetryAt:
        this.state === CircuitState.OPEN ? new Date(this.openTime + this.timeout).toISOString() : null,
    }
  }
}

export class CircuitBreakerManager {
  constructor(config = {}) {
    this.breakers = new Map()
    this.logger = config.logger
    this.metrics = config.metrics
  }

  get(name, config = {}) {
    if (!this.breakers.has(name)) {
      this.breakers.set(
        name,
        new CircuitBreaker(name, {
          ...config,
          logger: this.logger,
          metrics: this.metrics,
        }),
      )
    }
    return this.breakers.get(name)
  }

  async executeWithBreaker(name, fn, config = {}) {
    const breaker = this.get(name, config)

    if (!breaker.canExecute()) {
      const err = new Error(`Circuit breaker open for ${name}`)
      err.code = 'CIRCUIT_OPEN'
      throw err
    }

    try {
      const result = await fn()
      breaker.recordSuccess()
      return result
    } catch (error) {
      breaker.recordFailure(error)
      throw error
    }
  }

  getAllStatuses() {
    return Array.from(this.breakers.values()).map((b) => b.getStatus())
  }

  reset(name) {
    if (this.breakers.has(name)) {
      const breaker = this.breakers.get(name)
      breaker.transition(CircuitState.CLOSED)
      if (this.logger) {
        this.logger.info(`${name} circuit breaker reset`, {})
      }
    }
  }

  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.transition(CircuitState.CLOSED)
    }
    if (this.logger) {
      this.logger.info('All circuit breakers reset', { count: this.breakers.size })
    }
  }
}
