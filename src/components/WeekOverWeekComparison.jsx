/**
 * Week-over-Week Comparison
 * Shows metrics trending up/down (volume, errors, success rate)
 * Helps identify if things are getting better or worse
 */

export default function WeekOverWeekComparison({ runs }) {
  if (!runs || !runs.length) return null

  const now = Date.now()
  const DAY = 86_400_000
  const WEEK = 7 * DAY

  // Split into this week and last week
  const thisWeekStart = now - WEEK
  const lastWeekStart = thisWeekStart - WEEK

  const thisWeek = runs.filter(r => {
    const t = new Date(r.startedAt).getTime()
    return t >= thisWeekStart
  })

  const lastWeek = runs.filter(r => {
    const t = new Date(r.startedAt).getTime()
    return t >= lastWeekStart && t < thisWeekStart
  })

  if (thisWeek.length === 0 && lastWeek.length === 0) return null

  // Calculate metrics for each week
  const metrics = {
    thisWeek: calculateMetrics(thisWeek),
    lastWeek: calculateMetrics(lastWeek),
  }

  // Calculate trends
  const trends = {
    runCount: calculateTrend(metrics.lastWeek.runCount, metrics.thisWeek.runCount),
    errorCount: calculateTrend(metrics.lastWeek.errorCount, metrics.thisWeek.errorCount, true), // lower is better
    successRate: calculateTrend(metrics.lastWeek.successRate, metrics.thisWeek.successRate),
    volume: calculateTrend(metrics.lastWeek.volume, metrics.thisWeek.volume),
  }

  return (
    <div className="wow">
      <h2 className="wow__title">📈 Week-over-Week Comparison</h2>

      <div className="wow__grid">
        <MetricCard
          label="Total Runs"
          thisWeek={metrics.thisWeek.runCount}
          lastWeek={metrics.lastWeek.runCount}
          trend={trends.runCount}
          format={(n) => n.toString()}
        />

        <MetricCard
          label="Total Errors"
          thisWeek={metrics.thisWeek.errorCount}
          lastWeek={metrics.lastWeek.errorCount}
          trend={trends.errorCount}
          format={(n) => n.toString()}
          inverseTrend={true}
        />

        <MetricCard
          label="Success Rate"
          thisWeek={`${metrics.thisWeek.successRate.toFixed(0)}%`}
          lastWeek={`${metrics.lastWeek.successRate.toFixed(0)}%`}
          trend={trends.successRate}
          format={(s) => s}
        />

        <MetricCard
          label="Total Volume"
          thisWeek={metrics.thisWeek.volume}
          lastWeek={metrics.lastWeek.volume}
          trend={trends.volume}
          format={(n) => n.toString()}
        />
      </div>

      <div className="wow__summary">
        <TrendSummary thisWeek={metrics.thisWeek} lastWeek={metrics.lastWeek} trends={trends} />
      </div>
    </div>
  )
}

function calculateMetrics(runs) {
  if (runs.length === 0) {
    return { runCount: 0, errorCount: 0, successRate: 0, volume: 0 }
  }

  const errorCount = runs.reduce((sum, r) => sum + (r.errors?.length || 0), 0)
  const successfulRuns = runs.filter(r => r.ok).length
  const successRate = (successfulRuns / runs.length) * 100

  const volume = runs.reduce((sum, r) => {
    const kpis = r.kpis || {}
    return sum + (kpis.created || 0) + (kpis.deleted || 0) + (kpis.localized || 0)
  }, 0)

  return {
    runCount: runs.length,
    errorCount,
    successRate,
    volume,
  }
}

function calculateTrend(prev, curr, lowerIsBetter = false) {
  if (prev === 0 && curr === 0) return { direction: '→', pct: 0 }
  if (prev === 0) {
    const direction = curr > 0 ? (lowerIsBetter ? '↑' : '↓') : '→'
    return { direction, pct: 100 }
  }

  const pct = Math.round(((curr - prev) / prev) * 100)
  let direction = '→'

  if (pct > 5) {
    direction = lowerIsBetter ? '↓' : '↑' // bad for lower-is-better, good for higher-is-better
  } else if (pct < -5) {
    direction = lowerIsBetter ? '↑' : '↓'
  }

  return { direction, pct: Math.abs(pct) }
}

function MetricCard({ label, thisWeek, lastWeek, trend, format, inverseTrend }) {
  const isBad = trend.direction === '↑' && !inverseTrend
  const isGood = trend.direction === '↓' && !inverseTrend

  return (
    <div className="wow-card">
      <div className="wow-card__header">
        <h3 className="wow-card__label">{label}</h3>
      </div>

      <div className="wow-card__rows">
        <div className="wow-card__row">
          <span className="wow-card__period">This week</span>
          <span className="wow-card__value">{format(thisWeek)}</span>
        </div>

        <div className="wow-card__row">
          <span className="wow-card__period">Last week</span>
          <span className="wow-card__value">{format(lastWeek)}</span>
        </div>
      </div>

      <div className={`wow-card__trend ${isBad ? 'wow-card__trend--bad' : isGood ? 'wow-card__trend--good' : 'wow-card__trend--stable'}`}>
        <span className="wow-card__direction">{trend.direction}</span>
        <span className="wow-card__pct">{trend.pct}%</span>
      </div>
    </div>
  )
}

function TrendSummary({ thisWeek, lastWeek, trends }) {
  const improvements = [
    trends.successRate.direction === '↑' ? 'Success rate improved' : null,
    trends.errorCount.direction === '↓' ? 'Errors decreased' : null,
    trends.volume.direction === '↑' ? 'Processing volume up' : null,
  ].filter(Boolean)

  const concerns = [
    trends.successRate.direction === '↓' ? 'Success rate declined' : null,
    trends.errorCount.direction === '↑' ? 'Errors increased' : null,
    trends.runCount.direction === '↓' ? 'Run frequency dropped' : null,
  ].filter(Boolean)

  return (
    <div className="wow-summary">
      {improvements.length > 0 && (
        <div className="wow-summary__block wow-summary__block--good">
          <h4>📊 Improvements</h4>
          <ul>
            {improvements.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {concerns.length > 0 && (
        <div className="wow-summary__block wow-summary__block--bad">
          <h4>⚠️ Concerns</h4>
          <ul>
            {concerns.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {improvements.length === 0 && concerns.length === 0 && (
        <div className="wow-summary__block wow-summary__block--neutral">
          <p>Metrics are stable week-over-week.</p>
        </div>
      )}
    </div>
  )
}
