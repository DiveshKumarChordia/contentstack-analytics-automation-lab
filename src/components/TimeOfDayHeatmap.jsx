/**
 * Time-of-Day Heatmap
 * Shows error frequency by hour of day (when do errors occur?)
 * Helps identify recurring patterns or peak-risk windows
 */

export default function TimeOfDayHeatmap({ runs }) {
  if (!runs || !runs.length) return null

  // Aggregate errors by hour of day (0-23)
  const hourData = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    label: `${i.toString().padStart(2, '0')}:00`,
    errors: 0,
    runs: 0,
    errorRate: 0,
  }))

  for (const run of runs) {
    const date = new Date(run.startedAt)
    const hour = date.getHours()
    hourData[hour].runs++

    if (!run.ok || (run.errors && run.errors.length > 0)) {
      hourData[hour].errors += (run.errors?.length || 1)
    }
  }

  // Calculate error rates
  const maxErrors = Math.max(...hourData.map(h => h.errors), 1)
  hourData.forEach(h => {
    h.errorRate = h.runs > 0 ? (h.errors / h.runs) * 100 : 0
  })

  return (
    <div className="toh">
      <h2 className="toh__title">🕐 Error Frequency by Hour of Day</h2>

      <div className="toh__grid">
        {hourData.map(hour => (
          <div
            key={hour.hour}
            className="toh__cell"
            style={{
              background: hour.errors > 0
                ? `color-mix(in srgb, #ef4444 ${Math.min(100, (hour.errors / maxErrors) * 100)}%, transparent)`
                : 'transparent',
            }}
            title={`${hour.label}: ${hour.errors} errors in ${hour.runs} runs (${hour.errorRate.toFixed(0)}%)`}
          >
            <div className="toh__hour">{hour.hour}</div>
            {hour.errors > 0 && <div className="toh__count">{hour.errors}</div>}
          </div>
        ))}
      </div>

      <div className="toh__legend">
        <span className="toh__legend-item">Darker = more errors in that hour</span>
        <span className="toh__legend-item">Click any hour to filter by time window</span>
      </div>

      <div className="toh__stats">
        <TimeOfDayStats hourData={hourData} />
      </div>
    </div>
  )
}

function TimeOfDayStats({ hourData }) {
  const totalErrors = hourData.reduce((sum, h) => sum + h.errors, 0)
  const peakHour = hourData.reduce((max, h) => (h.errors > max.errors ? h : max), hourData[0])
  const quietHours = hourData.filter(h => h.errors === 0).length
  const avgErrorsPerHour = (totalErrors / 24).toFixed(1)

  return (
    <div className="toh-stats">
      <StatCard label="Peak Error Hour" value={`${peakHour.label}`} detail={`${peakHour.errors} errors`} />
      <StatCard label="Total Errors" value={totalErrors} detail={`${avgErrorsPerHour}/hr avg`} />
      <StatCard label="Quiet Hours" value={quietHours} detail="no errors" />
      <StatCard label="Error Concentration" value={`${((peakHour.errors / totalErrors) * 100).toFixed(0)}%`} detail={`in peak hour`} />
    </div>
  )
}

function StatCard({ label, value, detail }) {
  return (
    <div className="stat-card">
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
      {detail && <div className="stat-card__detail">{detail}</div>}
    </div>
  )
}
