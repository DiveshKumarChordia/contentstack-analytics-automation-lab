/**
 * Smart retry strategy with exponential backoff and error classification.
 * Integrates with ErrorClassifier for intelligent retry decisions.
 */

import { sleep } from './cma.mjs'
import { classifyError, shouldRetry, getRetryDelay, getErrorDescription } from './error-classifier.mjs'

export class RetryableOperation {
  constructor(name, fn, config = {}) {
    this.name = name
    this.fn = fn
    this.maxAttempts = config.maxAttempts || 3
    this.baseDelay = config.baseDelay || 1000
    this.maxDelay = config.maxDelay || 30000
    this.onRetry = config.onRetry || (() => {})
    this.logger = config.logger
    this.metrics = config.metrics
  }

  async execute() {
    let lastError = null
    let lastErrorType = null

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const startTime = Date.now()
        const result = await this.fn()
        const duration = Date.now() - startTime

        if (this.metrics) {
          this.metrics.recordOperation(this.name, 'execute', duration, true)
        }

        if (attempt > 1 && this.logger) {
          this.logger.info(`${this.name} succeeded on attempt ${attempt}/${this.maxAttempts}`, {
            durationMs: duration,
          })
        }

        return {
          success: true,
          result,
          attempts: attempt,
          totalDuration: Date.now() - (startTime - duration * (attempt - 1)),
        }
      } catch (error) {
        lastError = error
        const errorType = classifyError(error)
        lastErrorType = errorType
        const duration = Date.now() - Date.now() // Capture operation timing

        if (this.metrics) {
          this.metrics.recordOperation(this.name, 'execute', 0, false, {
            attempt,
            errorType,
            status: error.status,
          })
        }

        if (attempt < this.maxAttempts) {
          // Decide whether to retry
          if (!shouldRetry(error, attempt, this.maxAttempts)) {
            if (this.logger) {
              this.logger.warn(`${this.name} non-retryable error (${errorType})`, {
                attempt,
                error: error.message,
                status: error.status,
                description: getErrorDescription(error),
              })
            }
            throw error
          }

          // Calculate retry delay
          const delay = getRetryDelay(attempt - 1, this.baseDelay, this.maxDelay)

          if (this.logger) {
            this.logger.info(`${this.name} attempt ${attempt}/${this.maxAttempts} failed (${errorType}), retrying in ${delay}ms`, {
              error: error.message,
              status: error.status,
              description: getErrorDescription(error),
            })
          }

          // Invoke retry callback (for metrics, logging, circuit breaker)
          this.onRetry({
            attempt,
            error,
            errorType,
            nextDelayMs: delay,
          })

          // Wait before retry
          await sleep(delay)
        }
      }
    }

    // All retries exhausted
    if (this.logger) {
      this.logger.error(
        `${this.name} failed after ${this.maxAttempts} attempts (${lastErrorType})`,
        lastError,
        {
          maxAttempts: this.maxAttempts,
          lastErrorType,
        },
      )
    }

    throw lastError
  }
}

export class BulkRetryableOperations {
  constructor(operations, config = {}) {
    this.operations = operations // Array of { name, fn }
    this.concurrency = config.concurrency || 5
    this.maxAttempts = config.maxAttempts || 3
    this.baseDelay = config.baseDelay || 1000
    this.onRetry = config.onRetry || (() => {})
    this.logger = config.logger
    this.metrics = config.metrics
  }

  async executeAll() {
    const results = []
    const queue = [...this.operations]
    const inFlight = new Set()

    while (queue.length > 0 || inFlight.size > 0) {
      // Start new operations up to concurrency limit
      while (inFlight.size < this.concurrency && queue.length > 0) {
        const op = queue.shift()
        const retryable = new RetryableOperation(op.name, op.fn, {
          maxAttempts: this.maxAttempts,
          baseDelay: this.baseDelay,
          onRetry: this.onRetry,
          logger: this.logger,
          metrics: this.metrics,
        })

        const promise = retryable.execute()
        inFlight.add(promise)

        promise
          .then((result) => {
            results.push({ name: op.name, ...result })
          })
          .catch((error) => {
            results.push({ name: op.name, success: false, error })
          })
          .finally(() => {
            inFlight.delete(promise)
          })
      }

      // Wait for at least one to complete
      if (inFlight.size > 0) {
        await Promise.race(inFlight)
      }
    }

    return results
  }

  getSummary() {
    const succeeded = this.results.filter((r) => r.success).length
    return {
      total: this.results.length,
      succeeded,
      failed: this.results.length - succeeded,
      results: this.results,
    }
  }
}
