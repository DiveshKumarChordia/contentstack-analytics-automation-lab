/**
 * Observability Metrics Dashboard
 * Deep dive into Phase 4 observability data:
 * - Circuit breaker patterns
 * - Operation timing (latency percentiles)
 * - Failure recovery patterns
 */

export default function ObservabilityMetrics({ runs }) {
  if (!runs || !runs.length) return null

  // Aggregate observability data
  const circuitBreakerStats = aggregateCircuitBreakerStats(runs)
  const operationStats = aggregateOperationStats(runs)
  const recoveryStats = aggregateRecoveryStats(runs)

  return (
    <div className="obsv">
      <h2 className="obsv__title">🔍 Phase 4 Observability Metrics</h2>

      <div className="obsv__grid">
        {/* Circuit Breaker Stats */}
        <section className="obsv__card">
          <h3 className="obsv__card-title">⚡ Circuit Breaker Health</h3>
          <CircuitBreakerStatsPanel stats={circuitBreakerStats} />
        </section>

        {/* Operation Timing Stats */}
        <section className="obsv__card">
          <h3 className="obsv__card-title">⏱️ Operation Latency</h3>
          <OperationStatsPanel stats={operationStats} />
        </section>

        {/* Recovery Patterns */}
        <section className="obsv__card">
          <h3 className="obsv__card-title">🔄 Recovery Patterns</h3>
          <RecoveryStatsPanel stats={recoveryStats} />
        </section>
      </div>
    </div>
  )
}

function aggregateCircuitBreakerStats(runs) {
  const stats = {
    totalBreakers: 0,
    closedCount: 0,
    halfOpenCount: 0,
    openCount: 0,
    failureRates: {},
    recentTransitions: [],
  }

  for (const run of runs) {
    if (!run.observability?.circuitBreakerStatus) continue

    for (const [name, cb] of Object.entries(run.observability.circuitBreakerStatus)) {
      if (!stats.failureRates[name]) {
        stats.failureRates[name] = {
          name,
          state: cb.state,
          failures: 0,
          successes: 0,
          rate: 0,
        }
      }

      const stat = stats.failureRates[name]
      stat.failures += cb.failures || 0
      stat.successes += cb.successes || 0
      stat.state = cb.state
      stat.rate = stat.successes + stat.failures > 0 ? (stat.failures / (stat.successes + stat.failures)) * 100 : 0

      if (cb.state === 'CLOSED') stats.closedCount++
      else if (cb.state === 'HALF_OPEN') stats.halfOpenCount++
      else if (cb.state === 'OPEN') stats.openCount++
    }

    stats.totalBreakers = Object.keys(stats.failureRates).length
  }

  return stats
}

function aggregateOperationStats(runs) {
  const stats = {
    avgLatency: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    slowestOp: null,
    fastestOp: null,
    operationLatencies: [],
  }

  for (const run of runs) {
    if (!run.observability?.operationMetrics) continue

    for (const [opName, metrics] of Object.entries(run.observability.operationMetrics)) {
      stats.operationLatencies.push({
        name: opName,
        latency: metrics.latencyMs || 0,
      })
    }
  }

  if (stats.operationLatencies.length === 0) return stats

  const latencies = stats.operationLatencies.map(o => o.latency).sort((a, b) => a - b)
  stats.avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
  stats.p50 = latencies[Math.floor(latencies.length * 0.5)]
  stats.p95 = latencies[Math.floor(latencies.length * 0.95)]
  stats.p99 = latencies[Math.floor(latencies.length * 0.99)]

  // Find slowest/fastest
  const byLatency = stats.operationLatencies.sort((a, b) => b.latency - a.latency)
  stats.slowestOp = byLatency[0]
  stats.fastestOp = byLatency[byLatency.length - 1]

  return stats
}

function aggregateRecoveryStats(runs) {
  const stats = {
    recoveryTime: [],
    successfulRecoveries: 0,
    failedRecoveries: 0,
    avgRecoveryMs: 0,
  }

  for (const run of runs) {
    if (!run.observability?.circuitBreakerStatus) continue

    for (const cb of Object.values(run.observability.circuitBreakerStatus)) {
      if (cb.lastRecoveryAt && cb.lastRecoveryMs) {
        stats.recoveryTime.push(cb.lastRecoveryMs)
        if (cb.state === 'CLOSED') {
          stats.successfulRecoveries++
        } else {
          stats.failedRecoveries++
        }
      }
    }
  }

  if (stats.recoveryTime.length > 0) {
    stats.avgRecoveryMs = Math.round(stats.recoveryTime.reduce((a, b) => a + b, 0) / stats.recoveryTime.length)
  }

  return stats
}

function CircuitBreakerStatsPanel({ stats }) {
  const topFailers = Object.values(stats.failureRates)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3)

  return (
    <div className="obsv-panel">
      <div className="obsv-stats">
        <StatBadge label="Total Breakers" value={stats.totalBreakers} />
        <StatBadge label="Closed" value={stats.closedCount} color="#22c55e" />
        <StatBadge label="Half-Open" value={stats.halfOpenCount} color="#f59e0b" />
        <StatBadge label="Open" value={stats.openCount} color="#ef4444" />
      </div>

      {topFailers.length > 0 && (
        <div className="obsv-list">
          <h4>Top Failing Operations</h4>
          {topFailers.map(op => (
            <div key={op.name} className="obsv-item">
              <span className="obsv-item__name">{op.name}</span>
              <span className={`obsv-item__rate obsv-item__rate--${op.rate > 10 ? 'bad' : op.rate > 5 ? 'warn' : 'ok'}`}>
                {op.rate.toFixed(1)}% failures
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OperationStatsPanel({ stats }) {
  return (
    <div className="obsv-panel">
      <div className="obsv-stats">
        <StatBadge label="Average" value={`${stats.avgLatency}ms`} />
        <StatBadge label="p50" value={`${stats.p50}ms`} />
        <StatBadge label="p95" value={`${stats.p95}ms`} />
        <StatBadge label="p99" value={`${stats.p99}ms`} />
      </div>

      {stats.slowestOp && (
        <div className="obsv-list">
          <h4>Outliers</h4>
          <div className="obsv-item">
            <span className="obsv-item__label">Slowest:</span>
            <span className="obsv-item__name">{stats.slowestOp.name}</span>
            <span className="obsv-item__val">{stats.slowestOp.latency}ms</span>
          </div>
          {stats.fastestOp && (
            <div className="obsv-item">
              <span className="obsv-item__label">Fastest:</span>
              <span className="obsv-item__name">{stats.fastestOp.name}</span>
              <span className="obsv-item__val">{stats.fastestOp.latency}ms</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RecoveryStatsPanel({ stats }) {
  const total = stats.successfulRecoveries + stats.failedRecoveries
  const successRate = total > 0 ? (stats.successfulRecoveries / total) * 100 : 0

  return (
    <div className="obsv-panel">
      <div className="obsv-stats">
        <StatBadge label="Successful" value={stats.successfulRecoveries} color="#22c55e" />
        <StatBadge label="Failed" value={stats.failedRecoveries} color={stats.failedRecoveries > 0 ? '#ef4444' : '#8b5cf6'} />
        <StatBadge label="Success Rate" value={`${successRate.toFixed(0)}%`} />
        <StatBadge label="Avg Recovery" value={`${stats.avgRecoveryMs}ms`} />
      </div>
    </div>
  )
}

function StatBadge({ label, value, color }) {
  return (
    <div className="stat-badge" style={color ? { borderColor: color } : {}}>
      <div className="stat-badge__label">{label}</div>
      <div className="stat-badge__value" style={color ? { color } : {}}>
        {value}
      </div>
    </div>
  )
}
