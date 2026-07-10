import { useEffect, useMemo, useState } from 'react'

// Every hosted deployment's cron appends its own runs to this SAME file
// (see drive-all.mjs / RunsDashboard.jsx), tagged with `instance` +
// `hostedUrl` — so this is already a live, shared directory of every
// environment that has ever run automation. Nothing new to wire up when a
// new one is added; it just starts showing up here.
const HISTORY_URL = import.meta.env.VITE_RUN_HISTORY_URL || '/run-history.json'

// A live <iframe> preview would need every hosted environment to allow
// framing — Vercel deployments send `X-Frame-Options: DENY` by default, and
// these environments can be hosted anywhere, so we can't rely on fixing that
// per-platform. A screenshot IMAGE works regardless of hosting platform or
// frame policy, since it's fetched server-side by the screenshot service,
// not embedded in-browser.
function screenshotUrl(pageUrl) {
  return `https://api.microlink.io/?url=${encodeURIComponent(pageUrl)}&screenshot=true&meta=false&embed=screenshot.url`
}

function EnvironmentThumb({ url }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <div className="env-gallery__thumb env-gallery__thumb--placeholder" aria-hidden="true" />
  }

  return (
    <div className="env-gallery__thumb">
      <img src={screenshotUrl(url)} alt="" loading="lazy" onError={() => setFailed(true)} />
    </div>
  )
}

export default function EnvironmentGallery() {
  const [runs, setRuns] = useState(null)

  useEffect(() => {
    let alive = true
    fetch(HISTORY_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && setRuns(Array.isArray(d) ? d : []))
      .catch(() => alive && setRuns([]))
    return () => {
      alive = false
    }
  }, [])

  const environments = useMemo(() => {
    if (!runs) return []
    // Sorted ascending by start time so the last write per instance wins —
    // i.e. each card shows the MOST RECENT known hosted URL for that instance.
    const sorted = [...runs].sort((a, b) => Date.parse(a.startedAt || 0) - Date.parse(b.startedAt || 0))
    const byInstance = new Map()
    for (const run of sorted) {
      if (run.hostedUrl) byInstance.set(run.instance || 'default', { instance: run.instance || 'default', hostedUrl: run.hostedUrl })
    }
    return [...byInstance.values()]
  }, [runs])

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : null

  if (runs === null || environments.length === 0) return null

  return (
    <section className="env-gallery" aria-label="Hosted environments">
      <div className="env-gallery__head">
        <h2 className="env-gallery__title">Hosted environments</h2>
        <p className="env-gallery__hint">{environments.length} known — jump to any of them</p>
      </div>
      <div className="env-gallery__grid">
        {environments.map(({ instance, hostedUrl }) => {
          const isCurrent = currentOrigin && hostedUrl.replace(/\/$/, '') === currentOrigin.replace(/\/$/, '')
          return (
            <a
              key={instance}
              href={hostedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`env-gallery__card${isCurrent ? ' env-gallery__card--current' : ''}`}
            >
              <EnvironmentThumb url={hostedUrl} />
              <div className="env-gallery__meta">
                <span className="env-gallery__label">{instance}</span>
                {isCurrent ? <span className="env-gallery__badge">you are here</span> : <span className="env-gallery__icon">↗</span>}
              </div>
            </a>
          )
        })}
      </div>
    </section>
  )
}
