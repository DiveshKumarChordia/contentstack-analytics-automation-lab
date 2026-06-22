/**
 * Error classification system for intelligent retry decisions.
 * Categorizes errors as transient (retryable) or permanent (non-retryable).
 */

export const ErrorType = {
  TRANSIENT: 'transient',
  PERMANENT: 'permanent',
  UNKNOWN: 'unknown',
}

export function classifyError(error, context = {}) {
  if (!error) return ErrorType.UNKNOWN

  const status = error.status || error.statusCode || 0
  const message = (error.message || '').toLowerCase()
  const code = error.code || ''

  // HTTP status-based classification
  if (status === 429) return ErrorType.TRANSIENT // Rate limit
  if (status === 503) return ErrorType.TRANSIENT // Service unavailable
  if (status === 504) return ErrorType.TRANSIENT // Gateway timeout
  if (status === 408) return ErrorType.TRANSIENT // Request timeout
  if (status >= 500 && status < 600 && status !== 501 && status !== 505) {
    return ErrorType.TRANSIENT // Most 5xx are transient
  }

  // Network error classification
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH'
  ) {
    return ErrorType.TRANSIENT
  }

  // Message-based transient detection
  if (
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('temporarily unavailable') ||
    message.includes('please try again')
  ) {
    return ErrorType.TRANSIENT
  }

  // Permanent errors - authentication & authorization
  if (status === 401) return ErrorType.PERMANENT // Unauthorized
  if (status === 403) return ErrorType.PERMANENT // Forbidden
  if (status === 404) return ErrorType.PERMANENT // Not found
  if (status === 405) return ErrorType.PERMANENT // Method not allowed
  if (status === 422) return ErrorType.PERMANENT // Unprocessable entity (validation)

  // Permanent errors - client issues
  if (status >= 400 && status < 500) return ErrorType.PERMANENT

  // Message-based permanent detection
  if (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('not found') ||
    message.includes('invalid') ||
    message.includes('authentication') ||
    message.includes('permission denied')
  ) {
    return ErrorType.PERMANENT
  }

  return ErrorType.UNKNOWN
}

export function shouldRetry(error, attempt, maxAttempts) {
  const type = classifyError(error)
  return type === ErrorType.TRANSIENT && attempt < maxAttempts
}

export function getRetryDelay(attempt, baseDelay = 1000, maxDelay = 30000) {
  // Exponential backoff with jitter: 2^attempt * baseDelay +/- 10% jitter
  const exponential = baseDelay * Math.pow(2, attempt)
  const jitter = exponential * (0.9 + Math.random() * 0.2) // ±10% jitter
  return Math.min(jitter, maxDelay) // Cap at maxDelay
}

export function getErrorDescription(error) {
  const type = classifyError(error)
  const status = error.status || 0
  const message = error.message || ''

  if (type === ErrorType.TRANSIENT) {
    if (status === 429) return 'Rate limited (429) — temporary backoff needed'
    if (status === 503) return 'Service unavailable (503) — temporary issue'
    if (status === 504) return 'Gateway timeout (504) — temporary issue'
    if (status === 408 || message.includes('timeout')) return 'Request timeout — temporary issue'
    return `Transient error: ${status || message}`
  }

  if (type === ErrorType.PERMANENT) {
    if (status === 401) return 'Unauthorized (401) — check credentials'
    if (status === 403) return 'Forbidden (403) — insufficient permissions'
    if (status === 404) return 'Not found (404) — resource does not exist'
    if (status === 422) return 'Validation error (422) — invalid request'
    return `Permanent error: ${status || message}`
  }

  return `Unknown error: ${message || 'No details'}`
}

export const ErrorRecoveryStrategy = {
  RETRY_EXPONENTIAL: 'retry-exponential', // Retry with exponential backoff
  RETRY_FIXED: 'retry-fixed', // Retry with fixed interval
  CIRCUIT_BREAK: 'circuit-break', // Open circuit, fast-fail
  AUTO_REMEDIATE: 'auto-remediate', // Attempt to auto-fix
  DEGRADE_GRACEFULLY: 'degrade-gracefully', // Return partial data
  FAIL_FAST: 'fail-fast', // Don't retry
}

export function getRecoveryStrategy(error, context = {}) {
  const type = classifyError(error)
  const attempt = context.attempt || 0
  const maxAttempts = context.maxAttempts || 3

  if (type === ErrorType.PERMANENT) {
    // Can't retry permanent errors
    if (context.canAutoRemediate) return ErrorRecoveryStrategy.AUTO_REMEDIATE
    if (context.canDegrade) return ErrorRecoveryStrategy.DEGRADE_GRACEFULLY
    return ErrorRecoveryStrategy.FAIL_FAST
  }

  if (type === ErrorType.TRANSIENT) {
    // Retry transient errors
    if (attempt >= maxAttempts) {
      if (context.canDegrade) return ErrorRecoveryStrategy.DEGRADE_GRACEFULLY
      if (context.canCircuitBreak) return ErrorRecoveryStrategy.CIRCUIT_BREAK
      return ErrorRecoveryStrategy.FAIL_FAST
    }
    return ErrorRecoveryStrategy.RETRY_EXPONENTIAL
  }

  // Unknown type - be conservative
  if (attempt < maxAttempts) return ErrorRecoveryStrategy.RETRY_EXPONENTIAL
  return ErrorRecoveryStrategy.FAIL_FAST
}
