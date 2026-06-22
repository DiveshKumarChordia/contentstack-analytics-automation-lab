/**
 * Meter Coverage Matrix
 * Shows which dimensions are tested (✅/⚠️/❌)
 * Analytics engineers use this to verify meter dimension coverage
 */

export default function MeterCoverage({ runs }) {
  if (!runs || !runs.length) return null

  // Define meter scenarios and their dimensions
  const METERS = [
    {
      meter: 'entry_created',
      dimensions: ['locale', 'user_uid', 'branch', 'content_type'],
      scenarios: ['periodic-entries', 'localize-entries', 'multi-actor'],
    },
    {
      meter: 'entry_published',
      dimensions: ['user_uid', 'stage_id', 'environment'],
      scenarios: ['bulk-publish-cycle', 'multi-actor-create-publish'],
    },
    {
      meter: 'entry_deleted',
      dimensions: ['reason', 'branch'],
      scenarios: ['delete-old-entries', 'permanent-deletes'],
    },
    {
      meter: 'entry_workflow_stage',
      dimensions: ['stage_name', 'transition_type'],
      scenarios: ['seed-workflows', 'aged-stalls'],
    },
  ]

  // Aggregate coverage from runs
  const coverage = {}
  for (const meter of METERS) {
    coverage[meter.meter] = {}
    for (const dim of meter.dimensions) {
      coverage[meter.meter][dim] = { tested: false, count: 0, lastRun: null }
    }
  }

  // Check which dimensions have data
  for (const run of runs) {
    for (const step of run.steps || []) {
      // Check entry_created (locale tested via localize-entries)
      if (step.name.includes('localize') && step.ok) {
        coverage['entry_created'].locale = { tested: true, count: (coverage['entry_created'].locale.count || 0) + (run.kpis?.localized || 0), lastRun: run.startedAt }
      }
      // Check user_uid via multi-actor
      if (step.name.includes('multi-actor') && step.ok) {
        coverage['entry_published'].user_uid = { tested: true, count: (coverage['entry_published'].user_uid.count || 0) + (run.kpis?.publishedByB || 0), lastRun: run.startedAt }
        coverage['entry_created'].user_uid = { tested: true, count: (coverage['entry_created'].user_uid.count || 0) + 1, lastRun: run.startedAt }
      }
      // Check deletions
      if (step.name.includes('delete') && step.ok) {
        coverage['entry_deleted'].reason = { tested: true, count: (coverage['entry_deleted'].reason.count || 0) + (run.kpis?.deleted || 0), lastRun: run.startedAt }
      }
      // Check workflow transitions
      if (step.name.includes('workflow') && step.ok) {
        coverage['entry_workflow_stage'].stage_name = { tested: true, count: (coverage['entry_workflow_stage'].stage_name.count || 0) + (run.kpis?.transitions || 0), lastRun: run.startedAt }
      }
    }
  }

  return (
    <div className="coverage">
      <h2 className="coverage__title">✅ Meter Coverage Matrix</h2>
      <div className="coverage__grid">
        {METERS.map(meter => (
          <MeterRow key={meter.meter} meter={meter} coverage={coverage[meter.meter]} />
        ))}
      </div>
    </div>
  )
}

function MeterRow({ meter, coverage }) {
  const tested = Object.values(coverage).filter(d => d.tested).length
  const total = Object.keys(coverage).length
  const allTested = tested === total

  return (
    <div className="meter-row">
      <div className="meter-row__header">
        <h3 className="meter-row__name">{meter.meter}</h3>
        <span className={`meter-row__badge ${allTested ? 'meter-row__badge--ok' : 'meter-row__badge--warn'}`}>
          {tested}/{total}
        </span>
      </div>
      <div className="meter-row__dims">
        {Object.entries(coverage).map(([dim, data]) => (
          <div key={dim} className={`meter-dim ${data.tested ? 'meter-dim--ok' : 'meter-dim--missing'}`}>
            <div className="meter-dim__icon">{data.tested ? '✅' : '⚠️'}</div>
            <div className="meter-dim__name">{dim}</div>
            {data.tested && data.count > 0 && (
              <div className="meter-dim__count">{data.count}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
