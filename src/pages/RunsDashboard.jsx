import { useEffect, useMemo, useState } from 'react'
import './RunsDashboard.css'

// drive-all appends each run to public/run-history.json (committed back by CI).
const HISTORY_URL = import.meta.env.VITE_RUN_HISTORY_URL || '/run-history.json'

const DAY = 86_400_000
const ORPHAN_CASES = ['churnDisable', 'churnDetach', 'churnBranch', 'churnLocale', 'churnAllWf', 'churnRestore']

function relTime(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString() : '—')
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—')
function ratioColor(r) {
  if (r >= 0.999) return 'var(--ok)'
  if (r >= 0.5) return 'var(--warn)'
  return 'var(--bad)'
}

/** Compute ~50 KPIs (grouped) + chart/table data from the run history. */
function computeAll(runs) {
  const R = [...runs].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
  const n = R.length
  const now = Date.now()
  const sumK = (k) => R.reduce((a, r) => a + (Number(r.kpis?.[k]) || 0), 0)
  const last = R[n - 1] || null
  const isGreen = (r) => r.stepsTotal > 0 && r.stepsOk === r.stepsTotal

  // run-level
  const runs24 = R.filter((r) => now - Date.parse(r.startedAt) < DAY)
  const green = R.filter(isGreen).length
  const stepsOk = R.reduce((a, r) => a + (r.stepsOk || 0), 0)
  const stepsTotal = R.reduce((a, r) => a + (r.stepsTotal || 0), 0)
  const durs = R.map((r) => r.durationMs || 0).sort((a, b) => a - b)
  const p95 = durs.length ? durs[Math.min(durs.length - 1, Math.floor(durs.length * 0.95))] : 0
  // streaks
  let cur = 0
  for (let i = R.length - 1; i >= 0; i--) { if (isGreen(R[i])) cur++; else break }
  let longest = 0, run = 0
  for (const r of R) { if (isGreen(r)) { run++; longest = Math.max(longest, run) } else run = 0 }
  // span / throughput
  const spanH = n > 1 ? (Date.parse(last.startedAt) - Date.parse(R[0].startedAt)) / 3_600_000 : 0
  const created = sumK('created'), deleted = sumK('deleted'), localized = sumK('localized')
  const published = sumK('published'), unpublished = sumK('unpublished')
  // planned vs actual + step timing
  let planned = 0, actual = 0, stepMs = 0, stepCount = 0
  const stepTime = {}, stepFails = {}
  for (const r of R) for (const s of r.steps || []) {
    if (Number.isFinite(s.planned)) planned += s.planned
    if (Number.isFinite(s.actual)) actual += s.actual
    stepMs += s.ms || 0; stepCount++
    stepTime[s.name] = (stepTime[s.name] || 0) + (s.ms || 0)
    if (!s.ok) stepFails[s.name] = (stepFails[s.name] || 0) + 1
  }
  const busiest = Object.entries(stepTime).sort((a, b) => b[1] - a[1])[0]
  const mostFailing = Object.entries(stepFails).sort((a, b) => b[1] - a[1])[0]
  // errors
  const allErrors = R.flatMap((r) => (r.errors || []).map((e) => ({ ...e, at: r.startedAt })))
  const distinctMsgs = new Set(allErrors.map((e) => e.message)).size
  let lastFailIdx = -1
  for (let i = R.length - 1; i >= 0; i--) { if (!isGreen(R[i])) { lastFailIdx = i; break } }
  const orphanCovered = ORPHAN_CASES.filter((k) => sumK(k) > 0).length

  const groups = [
    { title: 'Runs & reliability', items: [
      ['Total runs', fmt(n)],
      ['Runs (24h)', fmt(runs24.length)],
      ['Fully-green runs', fmt(green)],
      ['Run success rate', pct(green, n), green === n ? 'ok' : green / n < 0.5 ? 'bad' : 'warn'],
      ['Step success rate', pct(stepsOk, stepsTotal)],
      ['Total step failures', fmt(stepsTotal - stepsOk), stepsTotal - stepsOk ? 'bad' : 'ok'],
      ['Current green streak', fmt(cur), 'ok'],
      ['Longest green streak', fmt(longest)],
      ['Avg run duration', `${(durs.reduce((a, b) => a + b, 0) / (n || 1) / 1000).toFixed(1)}s`],
      ['p95 run duration', `${(p95 / 1000).toFixed(1)}s`],
    ]},
    { title: 'Entries lifecycle', items: [
      ['Entries created', fmt(created)],
      ['Created (24h)', fmt(runs24.reduce((a, r) => a + (r.kpis?.created || 0), 0))],
      ['Avg created / run', fmt(Math.round(created / (n || 1)))],
      ['Entries deleted', fmt(deleted)],
      ['Net entries', fmt(created - deleted), created - deleted >= 0 ? 'ok' : 'warn'],
      ['Trimmed >30d band', fmt(sumK('deletedOver30d'))],
      ['Trimmed 15–30d band', fmt(sumK('deleted15to30d'))],
      ['Trimmed 7–15d band', fmt(sumK('deleted7to15d'))],
      ['Trim deferred (cap)', fmt(sumK('deferred')), sumK('deferred') ? 'warn' : 'ok'],
      ['Entries localized', fmt(localized)],
      ['Already localized', fmt(sumK('already'))],
      ['Localize failures', fmt(sumK('localizeFailed')), sumK('localizeFailed') ? 'bad' : 'ok'],
      ['Localize success rate', pct(localized, localized + sumK('localizeFailed'))],
      ['Localization coverage', pct(localized, created)],
    ]},
    { title: 'Publish & locale', items: [
      ['Entries published', fmt(published)],
      ['Entries unpublished', fmt(unpublished)],
      ['Pre-publish transitions', fmt(sumK('transitioned'))],
      ['Publish failures', fmt(sumK('publishFailed')), sumK('publishFailed') ? 'bad' : 'ok'],
      ['Net published', fmt(published - unpublished)],
      ['Published / hour', spanH ? fmt(Math.round(published / spanH)) : '—'],
      ['Locale targets', fmt(last?.kpis?.localeTargets ?? '—')],
    ]},
    { title: 'Workflow & churn', items: [
      ['Workflow transitions', fmt(sumK('transitions'))],
      ['Transitions skipped', fmt(sumK('transitionsSkipped'))],
      ['Churn cases run', fmt(sumK('casesOk') + sumK('casesFailed'))],
      ['Churn cases ok', fmt(sumK('casesOk')), 'ok'],
      ['Churn cases failed', fmt(sumK('casesFailed')), sumK('casesFailed') ? 'bad' : 'ok'],
      ['Churn success rate', pct(sumK('casesOk'), sumK('casesOk') + sumK('casesFailed'))],
      ['Workflows churned', fmt(sumK('churnAllWf'))],
      ['Branches churned', fmt(sumK('churnBranch'))],
      ['Locales churned', fmt(sumK('churnLocale'))],
      ['Entries restored', fmt(sumK('churnRestore'))],
      ['CT detach cycles', fmt(sumK('churnDetach'))],
      ['WF disable cycles', fmt(sumK('churnDisable'))],
    ]},
    { title: 'Branch lifecycle', items: [
      ['Branches created', fmt(sumK('branchesCreated'))],
      ['Branches deleted', fmt(sumK('branchesDeleted'))],
      ['Branch entries', fmt(sumK('branchEntries'))],
      ['Post-attach entries', fmt(sumK('secondWaveEntries'))],
      ['Branch localizations', fmt(sumK('branchLocalized'))],
      ['Dynamic CTs created', fmt(sumK('dynCtCreated'))],
      ['Dynamic CT entries', fmt(sumK('dynCtEntries'))],
      ['Workflow branch adds', fmt(sumK('workflowBranchAdds'))],
      ['Multi-branch publish rules', fmt(sumK('publishRules'))],
    ]},
    { title: 'Meter-coverage scenarios', items: [
      ['Edit-after-publish (in-progress)', fmt(sumK('editedPostPublish'))],
      ['Permanent deletes (entries_deleted)', fmt(sumK('deleted'))],
      ['Aged stalls (stalled_by_stage)', fmt(sumK('transitioned'))],
      ['No-workflow CT (entries_without_workflow)', fmt(sumK('entriesCreated'))],
      ['Multi-actor publishes (user_uid)', fmt(sumK('publishedByB'))],
      ['Branch/locale deletions (orphan)', fmt(sumK('branchDeleted'))],
      ['Users invited (org-level)', fmt(sumK('invited'))],
      ['User invites failed', fmt(sumK('inviteFailed')), sumK('inviteFailed') ? 'bad' : 'ok'],
    ]},
    { title: 'Efficiency & plan', items: [
      ['Total planned ops', fmt(planned)],
      ['Total actual ops', fmt(actual)],
      ['Plan completion', pct(actual, planned), actual >= planned ? 'ok' : actual / (planned || 1) < 0.5 ? 'bad' : 'warn'],
      ['Ops / run (avg)', fmt(Math.round(actual / (n || 1)))],
      ['Avg step duration', `${(stepMs / (stepCount || 1) / 1000).toFixed(2)}s`],
      ['Busiest step', busiest ? busiest[0] : '—'],
    ]},
    { title: 'Errors & coverage', items: [
      ['Total errors', fmt(allErrors.length), allErrors.length ? 'bad' : 'ok'],
      ['Errors / run', (allErrors.length / (n || 1)).toFixed(1), allErrors.length ? 'warn' : 'ok'],
      ['Most-failing step', mostFailing ? `${mostFailing[0]} (${mostFailing[1]})` : '—'],
      ['Distinct error msgs', fmt(distinctMsgs)],
      ['Create failures', fmt(sumK('failed')), sumK('failed') ? 'bad' : 'ok'],
      ['Org entry-cap hits', fmt(sumK('capHit')), sumK('capHit') ? 'warn' : 'ok'],
      ['Orphan-case coverage', `${orphanCovered}/${ORPHAN_CASES.length}`, orphanCovered === ORPHAN_CASES.length ? 'ok' : 'warn'],
      ['Time since last fail', lastFailIdx < 0 ? 'all green ✅' : relTime(R[lastFailIdx].startedAt)],
    ]},
  ]

  return {
    groups,
    sorted: R,
    last,
    stepRate: stepsTotal ? stepsOk / stepsTotal : 0,
    planned,
    actual,
    errors: allErrors.reverse().slice(0, 60),
  }
}

export default function RunsDashboard() {
  const [runs, setRuns] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(HISTORY_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && setRuns(Array.isArray(d) ? d : []))
      .catch((e) => alive && (setError(e.message), setRuns([])))
    return () => { alive = false }
  }, [])

  const data = useMemo(() => (runs && runs.length ? computeAll(runs) : null), [runs])

  if (runs === null) return <div className="runs"><p className="runs__muted">Loading run history…</p></div>
  if (!runs.length) {
    return (
      <div className="runs">
        <h1 className="runs__h1">Automation Runs</h1>
        <p className="runs__muted">
          No runs recorded yet{error ? ` (${error})` : ''}. The dashboard reads <code>{HISTORY_URL}</code>,
          which the GitHub Actions cron appends to on each <code>drive-all</code> run.
        </p>
      </div>
    )
  }

  const chartRuns = data.sorted.slice(-60)

  return (
    <div className="runs">
      <header className="runs__head">
        <h1 className="runs__h1">Automation Runs</h1>
        <p className="runs__sub">
          {data.sorted.length} runs · last {relTime(data.last?.startedAt)} on <code>{data.last?.instance || 'local'}</code> ·{' '}
          <strong style={{ color: ratioColor(data.stepRate) }}>{(data.stepRate * 100).toFixed(0)}%</strong> steps ok
        </p>
      </header>

      {data.groups.map((g) => (
        <section className="kgroup" key={g.title}>
          <h2 className="kgroup__title">{g.title}</h2>
          <div className="kgroup__grid">
            {g.items.map(([label, value, tone]) => (
              <div className={`stat ${tone ? `stat--${tone}` : ''}`} key={label}>
                <div className="stat__value">{value}</div>
                <div className="stat__label">{label}</div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="runs__panel">
        <h2 className="runs__h2">Step success per run <span className="runs__hint">(last {chartRuns.length})</span></h2>
        <div className="bars" role="img" aria-label="Step success ratio per run">
          {chartRuns.map((r) => {
            const ratio = r.stepsTotal ? r.stepsOk / r.stepsTotal : 0
            return (
              <div key={r.runId} className="bars__bar"
                style={{ height: `${Math.max(4, ratio * 100)}%`, background: ratioColor(ratio) }}
                title={`${r.startedAt} · ${r.stepsOk}/${r.stepsTotal} ok · ${(r.durationMs / 1000).toFixed(1)}s · ${r.instance}`} />
            )
          })}
        </div>
      </section>

      <section className="runs__panel">
        <h2 className="runs__h2">Planned vs actual <span className="runs__hint">(all runs)</span></h2>
        <PlannedVsActual planned={data.planned} actual={data.actual} />
      </section>

      <section className="runs__panel">
        <h2 className="runs__h2">Recent runs</h2>
        <div className="runs__tablewrap">
          <table className="runs__table">
            <thead><tr><th>When</th><th>Mode</th><th>Instance</th><th>Steps</th><th>Created</th><th>Deleted</th><th>Localized</th><th>Published</th><th>Errors</th><th>Time</th></tr></thead>
            <tbody>
              {[...data.sorted].reverse().slice(0, 25).map((r) => {
                const ratio = r.stepsTotal ? r.stepsOk / r.stepsTotal : 0
                return (
                  <tr key={r.runId}>
                    <td title={r.startedAt}>{relTime(r.startedAt)}</td>
                    <td>{r.mode}{r.dryRun ? ' (dry)' : ''}</td>
                    <td><code>{r.instance}</code></td>
                    <td><span style={{ color: ratioColor(ratio) }}>{r.stepsOk}/{r.stepsTotal}</span></td>
                    <td>{fmt(r.kpis?.created ?? '—')}</td>
                    <td>{fmt(r.kpis?.deleted ?? '—')}</td>
                    <td>{fmt(r.kpis?.localized ?? '—')}</td>
                    <td>{fmt(r.kpis?.published ?? '—')}</td>
                    <td className={r.errors?.length ? 'runs__err' : ''}>{r.errors?.length || 0}</td>
                    <td>{(r.durationMs / 1000).toFixed(1)}s</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="runs__panel">
        <h2 className="runs__h2">⚠️ Error audit log <span className="runs__hint">(latest {data.errors.length})</span></h2>
        {data.errors.length === 0 ? (
          <p className="runs__muted">No errors recorded. ✅</p>
        ) : (
          <div className="runs__tablewrap">
            <table className="runs__table">
              <thead><tr><th>When</th><th>Step</th><th>Case</th><th>Message</th></tr></thead>
              <tbody>
                {data.errors.map((e, i) => (
                  <tr key={i}>
                    <td title={e.at}>{relTime(e.at)}</td>
                    <td>{e.step}</td>
                    <td>{e.label || '—'}</td>
                    <td className="runs__msg">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function PlannedVsActual({ planned, actual }) {
  const max = Math.max(planned, actual, 1)
  const Bar = ({ label, value, color }) => (
    <div className="pva__row">
      <span className="pva__label">{label}</span>
      <div className="pva__track"><div className="pva__fill" style={{ width: `${(value / max) * 100}%`, background: color }} /></div>
      <span className="pva__val">{fmt(value)}</span>
    </div>
  )
  return (
    <div className="pva">
      <Bar label="Planned" value={planned} color="var(--accent)" />
      <Bar label="Actual" value={actual} color="var(--ok)" />
      <p className="runs__hint">{planned ? Math.round((actual / planned) * 100) : 0}% of planned operations completed</p>
    </div>
  )
}
