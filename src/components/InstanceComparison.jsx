/**
 * Instance Comparison Dashboard
 * Shows per-instance success rate and latency
 * Helps identify instance-specific issues or bottlenecks
 */

export default function InstanceComparison({ runs }) {
  if (!runs || !runs.length) return null

  // Aggregate stats by instance
  const instances = {}

  for (const run of runs) {
    const instance = run.instance || 'unknown'
    if (!instances[instance]) {
      instances[instance] = {
        name: instance,
        totalMs: 0,
        count: 0,
        successes: 0,
        failures: 0,
        durations: [],
      }
    }

    instances[instance].count++
    instances[instance].durations.push(run.ms)
    if (run.ok) {
      instances[instance].successes++
    } else {
      instances[instance].failures++
    }
  }

  // Calculate stats for each instance
  const stats = Object.values(instances).map(inst => {
    const successes = inst.successes
    const total = inst.count
    const successRate = total > 0 ? Math.round((successes / total) * 100) : 0

    const durations = inst.durations.sort((a, b) => a - b)
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0
    const p95Idx = Math.floor(durations.length * 0.95)
    const p95 = durations[p95Idx] || durations[durations.length - 1] || 0

    return {
      name: inst.name,
      successRate,
      successes,
      failures,
      total,
      avg,
      p95,
      min: Math.min(...durations),
      max: Math.max(...durations),
    }
  })

  // Sort by success rate (descending)
  stats.sort((a, b) => b.successRate - a.successRate)

  if (stats.length === 0) return null

  return (
    <div className="instances">
      <h2 className="instances__title">🖥️ Instance Comparison</h2>
      <div className="instances__table">
        <div className="instances__header">
          <div className="instances__col instances__col--name">Instance</div>
          <div className="instances__col instances__col--success">Success</div>
          <div className="instances__col instances__col--latency">Latency</div>
          <div className="instances__col instances__col--counts">Runs</div>
        </div>
        {stats.map(stat => (
          <InstanceRow key={stat.name} stat={stat} />
        ))}
      </div>
    </div>
  )
}

function InstanceRow({ stat }) {
  const healthColor =
    stat.successRate >= 95
      ? '#22c55e'
      : stat.successRate >= 80
        ? '#f59e0b'
        : '#ef4444'

  return (
    <div className="instances__row">
      <div className="instances__col instances__col--name">
        <span className="instance-name">{stat.name}</span>
      </div>

      <div className="instances__col instances__col--success">
        <div className="instance-success">
          <div className="instance-success__bar">
            <div
              className="instance-success__fill"
              style={{ width: `${stat.successRate}%`, background: healthColor }}
            />
          </div>
          <span className="instance-success__label" style={{ color: healthColor }}>
            {stat.successRate}%
          </span>
        </div>
      </div>

      <div className="instances__col instances__col--latency">
        <div className="instance-latency">
          <div className="latency-metric">
            <div className="latency-label">avg</div>
            <div className="latency-value">{stat.avg}ms</div>
          </div>
          <div className="latency-metric">
            <div className="latency-label">p95</div>
            <div className="latency-value">{stat.p95}ms</div>
          </div>
        </div>
      </div>

      <div className="instances__col instances__col--counts">
        <div className="instance-counts">
          {stat.successes > 0 && (
            <span className="count count--ok">✓ {stat.successes}</span>
          )}
          {stat.failures > 0 && (
            <span className="count count--fail">✗ {stat.failures}</span>
          )}
        </div>
      </div>
    </div>
  )
}
