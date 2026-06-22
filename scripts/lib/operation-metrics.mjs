/**
 * Operation-level metrics tracking for API calls, queries, and operations.
 * Provides timing, success rates, and performance percentiles.
 */

export class OperationMetrics {
  constructor() {
    this.apiCalls = []
    this.queries = []
    this.operations = []
    this.startTime = Date.now()
  }

  recordApiCall(name, method, url, durationMs, status, success) {
    this.apiCalls.push({
      timestamp: Date.now(),
      name,
      method: method || 'GET',
      url: this.maskUrl(url),
      durationMs,
      status,
      success,
    })
  }

  recordQuery(name, querySummary, durationMs, rowsReturned, success) {
    this.queries.push({
      timestamp: Date.now(),
      name,
      querySummary: String(querySummary).slice(0, 100),
      durationMs,
      rowsReturned: rowsReturned || 0,
      success,
    })
  }

  recordOperation(name, category, durationMs, success, context = {}) {
    this.operations.push({
      timestamp: Date.now(),
      name,
      category, // 'create', 'delete', 'update', 'transition', 'publish', 'localize'
      durationMs,
      success,
      ...context,
    })
  }

  recordRetry(operationName, attempt, status, nextDelayMs) {
    this.recordOperation('retry', 'retry', 0, false, {
      operationName,
      attempt,
      status,
      nextDelayMs,
    })
  }

  maskUrl(url) {
    // Mask IDs and tokens in URLs
    return url
      .replace(/([a-f0-9]{16,})/gi, 'ID')
      .replace(/token=[^&]*/gi, 'token=***')
      .replace(/key=[^&]*/gi, 'key=***')
  }

  percentile(values, p) {
    if (!values.length) return 0
    const sorted = values.slice().sort((a, b) => a - b)
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  getTimingStats(items) {
    if (!items.length) {
      return {
        count: 0,
        avgMs: 0,
        minMs: 0,
        maxMs: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      }
    }
    const durations = items.map((i) => i.durationMs)
    return {
      count: items.length,
      avgMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      minMs: Math.min(...durations),
      maxMs: Math.max(...durations),
      p50: Math.round(this.percentile(durations, 50)),
      p95: Math.round(this.percentile(durations, 95)),
      p99: Math.round(this.percentile(durations, 99)),
    }
  }

  getSummary() {
    const apiSuccess = this.apiCalls.filter((c) => c.success).length
    const querySuccess = this.queries.filter((q) => q.success).length
    const opSuccess = this.operations.filter((o) => o.success).length

    return {
      runtime: {
        totalMs: Date.now() - this.startTime,
        startTime: new Date(this.startTime).toISOString(),
      },
      apiCalls: {
        ...this.getTimingStats(this.apiCalls),
        success: apiSuccess,
        failed: this.apiCalls.length - apiSuccess,
        successRate: this.apiCalls.length ? Math.round((apiSuccess / this.apiCalls.length) * 100) : 0,
        byStatus: this.groupBy(this.apiCalls, 'status'),
      },
      queries: {
        ...this.getTimingStats(this.queries),
        success: querySuccess,
        failed: this.queries.length - querySuccess,
        successRate: this.queries.length ? Math.round((querySuccess / this.queries.length) * 100) : 0,
        totalRowsReturned: this.queries.reduce((a, b) => a + b.rowsReturned, 0),
      },
      operations: {
        ...this.getTimingStats(this.operations),
        success: opSuccess,
        failed: this.operations.length - opSuccess,
        successRate: this.operations.length ? Math.round((opSuccess / this.operations.length) * 100) : 0,
        byCategory: this.groupBy(this.operations, 'category'),
      },
      slowestItems: {
        apiCall: this.apiCalls.sort((a, b) => b.durationMs - a.durationMs)[0],
        query: this.queries.sort((a, b) => b.durationMs - a.durationMs)[0],
        operation: this.operations.sort((a, b) => b.durationMs - a.durationMs)[0],
      },
    }
  }

  groupBy(items, key) {
    return items.reduce((acc, item) => {
      const k = item[key]
      acc[k] = (acc[k] || 0) + 1
      return acc
    }, {})
  }

  getMostCommonErrors() {
    const failures = [
      ...this.apiCalls.filter((c) => !c.success).map((c) => ({ type: 'api', status: c.status })),
      ...this.queries.filter((q) => !q.success).map((q) => ({ type: 'query' })),
      ...this.operations.filter((o) => !o.success).map((o) => ({ type: 'operation', category: o.category })),
    ]

    const errors = {}
    for (const f of failures) {
      const key = f.status ? `${f.type}:${f.status}` : `${f.type}:${f.category}`
      errors[key] = (errors[key] || 0) + 1
    }

    return Object.entries(errors)
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
  }
}
