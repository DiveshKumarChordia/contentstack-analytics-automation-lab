/**
 * Failure diagnostics system for detailed error context collection.
 * Captures stack health, quota info, API responses, and environmental state.
 */

export class FailureDiagnostics {
  constructor(cmaClient, config = {}) {
    this.cmaClient = cmaClient
    this.logger = config.logger
    this.metrics = config.metrics
    this.diagnostics = []
  }

  async captureErrorContext(error, operation = {}) {
    const context = {
      timestamp: new Date().toISOString(),
      operationName: operation.name || 'unknown',
      operationCategory: operation.category || 'unknown',
      error: {
        name: error?.name || 'Unknown',
        message: error?.message || String(error),
        status: error?.status || error?.statusCode || 0,
        code: error?.code || '',
        stack: error?.stack
          ? error.stack
              .split('\n')
              .slice(0, 5)
              .map((l) => l.trim())
          : [],
      },
      context: operation.context || {},
    }

    // Capture API response details if available
    if (error.response) {
      context.apiResponse = {
        status: error.response?.status,
        statusText: error.response?.statusText,
        headers: this.sanitizeHeaders(error.response?.headers),
        bodyPreview: String(error.response?.data || error.response?.text || '').slice(0, 500),
      }
    }

    // Capture request details if available
    if (error.request) {
      context.apiRequest = {
        method: error.request?.method,
        url: this.maskUrl(error.request?.url),
        headers: this.sanitizeHeaders(error.request?.headers),
      }
    }

    this.diagnostics.push(context)

    if (this.logger) {
      this.logger.error(`Failure diagnostics captured for ${operation.name}`, error, {
        diagnosticId: context.timestamp,
      })
    }

    if (this.metrics) {
      this.metrics.recordOperation('failure-diagnostics:capture', 'diagnostics', 0, true, {
        operationName: operation.name,
        errorStatus: error.status,
      })
    }

    return context
  }

  async captureStackHealth() {
    const health = {
      timestamp: new Date().toISOString(),
      stackStatus: 'checking...',
      quotaUsage: {},
      limits: {},
    }

    try {
      // Check stack status via organization endpoint
      const orgHealth = await this.cmaClient.organization?.fetch?.()
      health.stackStatus = 'operational'
      health.organization = {
        uid: orgHealth?.uid,
        name: orgHealth?.name,
      }
    } catch (error) {
      health.stackStatus = 'error'
      health.stackError = error?.message
    }

    try {
      // Get content type count for quota estimation
      const contentTypes = await this.cmaClient.contentType?.query?.().find()
      health.quotaUsage.contentTypes = contentTypes?.length || 0
    } catch (error) {
      health.quotaUsage.error = error?.message
    }

    if (this.logger) {
      this.logger.info('Stack health snapshot captured', health)
    }

    return health
  }

  async captureQotaInfo() {
    const quota = {
      timestamp: new Date().toISOString(),
      apiCallsRemaining: 'unknown',
      rateLimitWindow: 'unknown',
    }

    // Extract from rate limit headers if available
    try {
      // This would typically come from response headers
      // For now, document the structure for integration
      quota.headers = {
        'X-RateLimit-Limit': 'check-response-headers',
        'X-RateLimit-Remaining': 'check-response-headers',
        'X-RateLimit-Reset': 'check-response-headers',
      }
    } catch (error) {
      quota.error = error?.message
    }

    return quota
  }

  sanitizeHeaders(headers = {}) {
    if (typeof headers !== 'object') return {}

    const sanitized = { ...headers }
    const secretKeys = ['authorization', 'x-api-key', 'authentication', 'cookie', 'token']

    for (const key of secretKeys) {
      if (sanitized[key]) {
        sanitized[key] = '***'
      }
    }

    return sanitized
  }

  maskUrl(url = '') {
    if (!url) return ''
    return url
      .replace(/([a-f0-9]{16,})/gi, 'ID')
      .replace(/token=[^&]*/gi, 'token=***')
      .replace(/key=[^&]*/gi, 'key=***')
  }

  async generateDiagnosticReport(operation) {
    const report = {
      operationName: operation.name,
      operationCategory: operation.category,
      timestamp: new Date().toISOString(),
      diagnosticCount: this.diagnostics.length,
      stackHealth: await this.captureStackHealth(),
      quotaInfo: await this.captureQotaInfo(),
      recentFailures: this.diagnostics.slice(-5),
      recommendations: this.generateRecommendations(),
    }

    if (this.logger) {
      this.logger.info('Diagnostic report generated', {
        operationName: operation.name,
        failureCount: this.diagnostics.length,
      })
    }

    return report
  }

  generateRecommendations() {
    if (!this.diagnostics.length) return []

    const recommendations = []
    const recentErrors = this.diagnostics.slice(-10)

    // Analyze error patterns
    const statusCodes = recentErrors
      .map((d) => d.error?.status)
      .filter((s) => s)
    const errorMessages = recentErrors.map((d) => d.error?.message?.toLowerCase())

    // Rate limit detection
    if (statusCodes.includes(429)) {
      recommendations.push({
        type: 'rate-limit',
        severity: 'high',
        message: 'Rate limit detected. Implement exponential backoff retry.',
        action: 'increase-retry-delay',
      })
    }

    // Timeout detection
    if (errorMessages.some((m) => m?.includes('timeout'))) {
      recommendations.push({
        type: 'timeout',
        severity: 'medium',
        message: 'Request timeouts detected. Increase timeout duration or optimize payload.',
        action: 'increase-timeout-duration',
      })
    }

    // Authentication errors
    if (statusCodes.includes(401) || statusCodes.includes(403)) {
      recommendations.push({
        type: 'auth',
        severity: 'high',
        message: 'Authentication or permission errors. Check credentials and permissions.',
        action: 'verify-credentials',
      })
    }

    // Not found errors
    if (statusCodes.includes(404)) {
      recommendations.push({
        type: 'not-found',
        severity: 'medium',
        message: 'Resource not found. Verify resource UIDs and existence.',
        action: 'verify-resource-existence',
      })
    }

    // Service unavailable
    if (statusCodes.includes(503) || statusCodes.includes(504)) {
      recommendations.push({
        type: 'service-unavailable',
        severity: 'medium',
        message: 'Service temporarily unavailable. Retry with backoff.',
        action: 'retry-with-backoff',
      })
    }

    // Network errors
    if (errorMessages.some((m) => m?.includes('connection'))) {
      recommendations.push({
        type: 'network',
        severity: 'medium',
        message: 'Network connectivity issues. Check network and retry.',
        action: 'verify-network',
      })
    }

    return recommendations
  }

  getSummary() {
    return {
      totalDiagnostics: this.diagnostics.length,
      errorTypes: this.diagnostics.reduce(
        (acc, d) => {
          const type = d.error?.name || 'unknown'
          acc[type] = (acc[type] || 0) + 1
          return acc
        },
        {},
      ),
      lastCapture: this.diagnostics[this.diagnostics.length - 1]?.timestamp || null,
      oldestCapture: this.diagnostics[0]?.timestamp || null,
    }
  }

  clear() {
    this.diagnostics = []
  }
}

export async function captureFullDiagnostics(error, operation, cmaClient, logger) {
  const diagnostics = new FailureDiagnostics(cmaClient, { logger })

  const errorContext = await diagnostics.captureErrorContext(error, operation)
  const stackHealth = await diagnostics.captureStackHealth()
  const quotaInfo = await diagnostics.captureQotaInfo()

  return {
    error: errorContext,
    stackHealth,
    quotaInfo,
    recommendations: diagnostics.generateRecommendations(),
  }
}
