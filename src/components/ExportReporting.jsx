/**
 * Export & Reporting
 * Generate and share analysis reports
 * Formats: JSON, CSV, Markdown summary
 */

import { useState } from 'react'

export default function ExportReporting({ runs, data }) {
  const [exportFormat, setExportFormat] = useState('json')
  const [exported, setExported] = useState(false)

  const handleExport = () => {
    let content = ''
    let filename = `analytics-report-${new Date().toISOString().split('T')[0]}`

    switch (exportFormat) {
      case 'json':
        content = JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            runs: runs.length,
            data: data,
            summary: generateSummary(runs, data),
          },
          null,
          2
        )
        filename += '.json'
        break

      case 'csv':
        content = generateCSV(runs)
        filename += '.csv'
        break

      case 'markdown':
        content = generateMarkdown(runs, data)
        filename += '.md'
        break

      default:
        break
    }

    // Download file
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    setExported(true)
    setTimeout(() => setExported(false), 2000)
  }

  const handleShare = () => {
    const summary = generateMarkdown(runs, data)
    const text = `Analytics Report\n${new Date().toLocaleString()}\n\n${summary}`

    if (navigator.share) {
      navigator.share({ title: 'Analytics Report', text })
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(text)
      alert('Report copied to clipboard!')
    }
  }

  return (
    <div className="export">
      <h2 className="export__title">📤 Export & Reporting</h2>

      <div className="export__controls">
        <div className="export__group">
          <label className="export__label">Format</label>
          <select
            className="export__select"
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value)}
          >
            <option value="json">JSON (structured data)</option>
            <option value="csv">CSV (spreadsheet)</option>
            <option value="markdown">Markdown (summary)</option>
          </select>
        </div>

        <div className="export__group">
          <button
            className={`export__btn export__btn--primary ${exported ? 'export__btn--done' : ''}`}
            onClick={handleExport}
          >
            {exported ? '✓ Downloaded' : '⬇️ Download'}
          </button>
          <button className="export__btn export__btn--secondary" onClick={handleShare}>
            📤 Share
          </button>
        </div>
      </div>

      <div className="export__preview">
        <ReportPreview runs={runs} data={data} />
      </div>
    </div>
  )
}

function generateSummary(runs, data) {
  return {
    totalRuns: runs.length,
    timespan: runs.length > 0 ? {
      from: runs[0]?.startedAt,
      to: runs[runs.length - 1]?.startedAt,
    } : null,
    keyMetrics: data?.groups?.[0]?.items?.slice(0, 5) || [],
  }
}

function generateCSV(runs) {
  const headers = ['Timestamp', 'Instance', 'Mode', 'Steps OK', 'Steps Total', 'Created', 'Deleted', 'Localized', 'Published', 'Errors', 'Duration (s)']
  const rows = runs.map(r => [
    r.startedAt,
    r.instance || 'unknown',
    r.mode || 'standard',
    r.stepsOk || 0,
    r.stepsTotal || 0,
    r.kpis?.created || 0,
    r.kpis?.deleted || 0,
    r.kpis?.localized || 0,
    r.kpis?.published || 0,
    r.errors?.length || 0,
    ((r.durationMs || 0) / 1000).toFixed(1),
  ])

  return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
}

function generateMarkdown(runs, data) {
  const summary = generateSummary(runs, data)

  let md = `# Analytics Report\n\nGenerated: ${new Date().toLocaleString()}\n\n`

  md += `## Summary\n\n`
  md += `- **Total Runs**: ${summary.totalRuns}\n`
  if (summary.timespan) {
    md += `- **Timespan**: ${summary.timespan.from} to ${summary.timespan.to}\n`
  }
  md += `\n`

  if (data?.groups) {
    md += `## Key Metrics\n\n`
    data.groups.slice(0, 3).forEach(group => {
      md += `### ${group.title}\n\n`
      group.items.slice(0, 5).forEach(([label, value]) => {
        md += `- ${label}: **${value}**\n`
      })
      md += `\n`
    })
  }

  md += `## Run Log\n\n`
  md += `| Time | Instance | Steps | Created | Status |\n`
  md += `|------|----------|-------|---------|--------|\n`
  runs.slice(-10).reverse().forEach(r => {
    const ratio = r.stepsTotal ? r.stepsOk / r.stepsTotal : 0
    const status = ratio === 1 ? '✅' : ratio > 0.5 ? '⚠️' : '❌'
    md += `| ${r.startedAt} | ${r.instance || 'local'} | ${r.stepsOk}/${r.stepsTotal} | ${r.kpis?.created || 0} | ${status} |\n`
  })

  return md
}

function ReportPreview({ runs, data }) {
  const summary = generateSummary(runs, data)

  return (
    <div className="report-preview">
      <h3 className="report-preview__title">📋 Report Preview</h3>

      <div className="report-preview__section">
        <h4>Summary</h4>
        <div className="report-preview__stats">
          <div className="preview-stat">
            <span className="preview-stat__label">Total Runs</span>
            <span className="preview-stat__value">{summary.totalRuns}</span>
          </div>
          {summary.timespan && (
            <>
              <div className="preview-stat">
                <span className="preview-stat__label">From</span>
                <span className="preview-stat__value">{new Date(summary.timespan.from).toLocaleDateString()}</span>
              </div>
              <div className="preview-stat">
                <span className="preview-stat__label">To</span>
                <span className="preview-stat__value">{new Date(summary.timespan.to).toLocaleDateString()}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {data?.groups?.[0] && (
        <div className="report-preview__section">
          <h4>{data.groups[0].title}</h4>
          <div className="report-preview__metrics">
            {data.groups[0].items.slice(0, 4).map(([label, value]) => (
              <div key={label} className="preview-metric">
                <span className="preview-metric__label">{label}</span>
                <span className="preview-metric__value">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
