/**
 * Volume Trending Chart
 * Stacked area chart showing created/deleted/localized entries over time
 * Helps identify volume trends and bottlenecks in the pipeline
 */

export default function VolumeTrending({ runs }) {
  if (!runs || runs.length < 3) return null

  // Aggregate volume by time (binned into 1h intervals)
  const ONE_HOUR = 3600000
  const volumes = {}

  for (const run of runs) {
    if (!run.startedAt || !run.kpis) continue

    const timestamp = Math.floor(new Date(run.startedAt).getTime() / ONE_HOUR) * ONE_HOUR
    if (!volumes[timestamp]) {
      volumes[timestamp] = {
        created: 0,
        deleted: 0,
        localized: 0,
        timestamp,
      }
    }

    volumes[timestamp].created += run.kpis.created || 0
    volumes[timestamp].deleted += run.kpis.deleted || 0
    volumes[timestamp].localized += run.kpis.localized || 0
  }

  const data = Object.values(volumes)
    .sort((a, b) => a.timestamp - b.timestamp)

  if (data.length === 0) return null

  // Calculate max value for scaling
  const maxValue = Math.max(
    ...data.map(d => d.created + d.deleted + d.localized)
  )

  if (maxValue === 0) return null

  return (
    <div className="volume">
      <h2 className="volume__title">📊 Volume Trending</h2>
      <div className="volume__chart">
        <VolumeChart data={data} maxValue={maxValue} />
      </div>
      <div className="volume__legend">
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#3b82f6' }} />
          <span>Created</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#ef4444' }} />
          <span>Deleted</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#8b5cf6' }} />
          <span>Localized</span>
        </div>
      </div>
      <div className="volume__stats">
        <VolumeStats data={data} />
      </div>
    </div>
  )
}

function VolumeChart({ data, maxValue }) {
  const width = 100
  const height = 180
  const padding = 20

  // Scale functions
  const scaleX = (i) => (i / (data.length - 1)) * (width - padding * 2) + padding
  const scaleY = (v) => height - (v / maxValue) * (height - padding * 2) - padding

  // Build paths for stacked areas
  const points = data.map((d, i) => {
    const x = scaleX(i)
    const createdY = scaleY(d.created)
    const deletedY = scaleY(d.created + d.deleted)
    const localizedY = scaleY(d.created + d.deleted + d.localized)

    return {
      x,
      createdY,
      deletedY,
      localizedY,
      d,
    }
  })

  // Build path strings
  const createdPath = `M ${points.map((p) => `${p.x},${p.createdY}`).join(' L ')} L ${points[points.length - 1].x},${height - padding} L ${points[0].x},${height - padding} Z`
  const deletedBasePath = points.map((p) => `${p.x},${p.deletedY}`).join(' L ')
  const deletedPath = `M ${deletedBasePath} L ${points[points.length - 1].x},${height - padding} L ${points[0].x},${height - padding} Z`
  const localizedBasePath = points.map((p) => `${p.x},${p.localizedY}`).join(' L ')
  const localizedPath = `M ${localizedBasePath} L ${points[points.length - 1].x},${height - padding} L ${points[0].x},${height - padding} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="volume-chart">
      {/* Y-axis grid lines */}
      {[0.25, 0.5, 0.75].map((frac) => {
        const y = height - frac * (height - padding * 2) - padding
        return (
          <line
            key={`grid-${frac}`}
            x1={padding}
            y1={y}
            x2={width - padding}
            y2={y}
            stroke="var(--line)"
            strokeWidth="0.5"
            opacity="0.5"
          />
        )
      })}

      {/* Stacked areas (bottom to top: created, deleted, localized) */}
      <path d={createdPath} fill="#3b82f6" opacity="0.8" />
      <path d={deletedPath} fill="#ef4444" opacity="0.8" />
      <path d={localizedPath} fill="#8b5cf6" opacity="0.8" />

      {/* Axes */}
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        stroke="var(--line)"
        strokeWidth="1"
      />
      <line
        x1={padding}
        y1={padding}
        x2={padding}
        y2={height - padding}
        stroke="var(--line)"
        strokeWidth="1"
      />

      {/* Y-axis labels */}
      <text x={padding - 5} y={height - padding + 4} fontSize="8" textAnchor="end" fill="var(--muted)">
        0
      </text>
      <text x={padding - 5} y={padding + 4} fontSize="8" textAnchor="end" fill="var(--muted)">
        {Math.round(maxValue)}
      </text>
    </svg>
  )
}

function VolumeStats({ data }) {
  const totals = {
    created: data.reduce((sum, d) => sum + d.created, 0),
    deleted: data.reduce((sum, d) => sum + d.deleted, 0),
    localized: data.reduce((sum, d) => sum + d.localized, 0),
  }

  const avgPerRun = {
    created: Math.round(totals.created / data.length),
    deleted: Math.round(totals.deleted / data.length),
    localized: Math.round(totals.localized / data.length),
  }

  return (
    <div className="volume-stats-grid">
      <StatBox
        label="Total Created"
        value={totals.created}
        avg={avgPerRun.created}
        color="#3b82f6"
      />
      <StatBox
        label="Total Deleted"
        value={totals.deleted}
        avg={avgPerRun.deleted}
        color="#ef4444"
      />
      <StatBox
        label="Total Localized"
        value={totals.localized}
        avg={avgPerRun.localized}
        color="#8b5cf6"
      />
    </div>
  )
}

function StatBox({ label, value, avg, color }) {
  return (
    <div className="stat-box">
      <div className="stat-box__label">{label}</div>
      <div className="stat-box__value" style={{ color }}>
        {value}
      </div>
      <div className="stat-box__avg">Ø {avg}/run</div>
    </div>
  )
}
