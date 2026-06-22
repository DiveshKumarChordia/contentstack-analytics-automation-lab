/**
 * Step Performance Trends
 * Shows latency (avg ± p95) and success rate trends per step over time
 */

export default function StepTrends({ runs }) {
  if (!runs || runs.length < 2) return null

  // Aggregate step statistics by step name, grouped by time windows
  const stepStats = {}
  const majorSteps = [
    'delete old entries',
    'periodic entries from manifest',
    'localize entries',
    'bulk publish cycle',
  ]

  for (const run of runs) {
    for (const step of run.steps || []) {
      if (!majorSteps.some(s => step.name.toLowerCase().includes(s.replace(/\s+/g, ' ')))) {
        continue
      }

      if (!stepStats[step.name]) {
        stepStats[step.name] = {
          name: step.name,
          times: [],
          successes: 0,
          failures: 0,
        }
      }

      if (step.ms) {
        stepStats[step.name].times.push({
          ms: step.ms,
          at: run.startedAt,
          ok: step.ok,
        })
      }

      if (step.ok) {
        stepStats[step.name].successes++
      } else {
        stepStats[step.name].failures++
      }
    }
  }

  // Filter to only steps with enough data
  const filteredSteps = Object.values(stepStats).filter(
    (s) => s.times.length >= 3 // At least 3 runs
  )

  if (filteredSteps.length === 0) return null

  return (
    <div className="trends">
      <h2 className="trends__title">📈 Step Performance Trends</h2>
      <div className="trends__grid">
        {filteredSteps.map((step) => (
          <StepTrendCard key={step.name} step={step} />
        ))}
      </div>
    </div>
  )
}

function StepTrendCard({ step }) {
  // Calculate statistics
  const durations = step.times.map((t) => t.ms).sort((a, b) => a - b)
  const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
  const min = Math.min(...durations)
  const max = Math.max(...durations)
  const p95Idx = Math.floor(durations.length * 0.95)
  const p95 = durations[p95Idx] || durations[durations.length - 1]

  const totalRuns = step.successes + step.failures
  const successRate = Math.round((step.successes / totalRuns) * 100)

  // Trend direction (is it getting faster or slower?)
  const recent = step.times.slice(-5)
  const older = step.times.slice(0, 5)
  const recentAvg = recent.length ? Math.round(recent.reduce((a, b) => a + b.ms, 0) / recent.length) : avg
  const olderAvg = older.length ? Math.round(older.reduce((a, b) => a + b.ms, 0) / older.length) : avg
  const trend = recentAvg < olderAvg ? '↓' : recentAvg > olderAvg ? '↑' : '→'

  return (
    <div className="trend-card">
      <div className="trend-card__header">
        <h3 className="trend-card__name">{step.name}</h3>
        <span className={`trend-card__trend trend-card__trend--${trend === '↓' ? 'down' : trend === '↑' ? 'up' : 'stable'}`}>
          {trend}
        </span>
      </div>

      <div className="trend-card__metrics">
        <div className="trend-metric">
          <div className="trend-metric__label">Average</div>
          <div className="trend-metric__value">{avg}ms</div>
        </div>
        <div className="trend-metric">
          <div className="trend-metric__label">p95</div>
          <div className="trend-metric__value">{p95}ms</div>
        </div>
        <div className="trend-metric">
          <div className="trend-metric__label">Range</div>
          <div className="trend-metric__value">
            {min}–{max}ms
          </div>
        </div>
      </div>

      <div className="trend-card__success">
        <div className="trend-success__label">Success Rate</div>
        <div className="trend-success__bar">
          <div
            className="trend-success__fill"
            style={{
              width: `${successRate}%`,
              background:
                successRate >= 95
                  ? 'var(--ok)'
                  : successRate >= 80
                    ? 'var(--warn)'
                    : 'var(--bad)',
            }}
          />
        </div>
        <div className="trend-success__value">{successRate}%</div>
      </div>

      <div className="trend-card__runs">
        {step.successes > 0 && (
          <span className="trend-run trend-run--ok">✓ {step.successes}</span>
        )}
        {step.failures > 0 && (
          <span className="trend-run trend-run--fail">✗ {step.failures}</span>
        )}
      </div>

      <div className="trend-card__chart">
        <Sparkline data={step.times.map((t) => t.ms)} />
      </div>
    </div>
  )
}

function Sparkline({ data }) {
  if (!data || data.length === 0) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  return (
    <svg
      viewBox={`0 0 ${data.length * 4} 40`}
      preserveAspectRatio="none"
      className="sparkline"
    >
      {/* Grid line at average */}
      <line
        x1="0"
        y1={(40 * (Math.avg(data) - min)) / range || 20}
        x2={data.length * 4}
        y2={(40 * (Math.avg(data) - min)) / range || 20}
        stroke="var(--line)"
        strokeWidth="0.5"
        opacity="0.5"
      />

      {/* Line chart */}
      <polyline
        points={data
          .map((d, i) => {
            const x = i * 4
            const y = 40 - ((d - min) / range) * 40
            return `${x},${y}`
          })
          .join(' ')}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />

      {/* Dots for each point */}
      {data.map((d, i) => {
        const x = i * 4
        const y = 40 - ((d - min) / range) * 40
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="1.5"
            fill="var(--accent)"
            opacity="0.7"
          />
        )
      })}
    </svg>
  )
}

// Helper to get Math.avg
Object.defineProperty(Math, 'avg', {
  value: (arr) => (arr.length ? arr.reduce((a, b) => a + b) / arr.length : 0),
  writable: false,
})
