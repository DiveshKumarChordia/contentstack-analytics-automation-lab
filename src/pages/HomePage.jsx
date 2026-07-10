import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { DigestItem } from '../components/DigestItem.jsx'
import EnvironmentGallery from '../components/EnvironmentGallery.jsx'
import '../components/EnvironmentGallery.css'
import {
  buildEntriesUrl,
  deliveryHeaders,
  deliveryResponseMessage,
  getConfig,
  isMissingContentTypeError,
  parseContentTypeUids,
} from '../lib/contentstackDelivery.js'
import { humanizeContentTypeUid } from '../lib/entryFormat.js'
import { CS_DIGEST_RELOAD } from '../lib/siteEvents.js'

const HeroCanvas = lazy(() => import('../components/HeroCanvas.jsx'))

function DigestSkeleton({ count }) {
  return (
    <div className="digest-skeleton-stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="digest-skeleton">
          <div className="digest-skeleton__line digest-skeleton__line--short" />
          <div className="digest-skeleton__line" />
          <div className="digest-skeleton__line digest-skeleton__line--med" />
        </div>
      ))}
    </div>
  )
}

export default function HomePage() {
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [skippedTypes, setSkippedTypes] = useState([])
  const [digestFilter, setDigestFilter] = useState(null)

  const reloadEntries = useCallback(async () => {
    const { apiKey, deliveryToken, environment, deliveryHost, branch } =
      getConfig()

    if (!apiKey || !deliveryToken || !deliveryHost) {
      setLoading(false)
      setError(
        'Missing configuration. Copy .env.example to .env and set VITE_CONTENTSTACK_* variables.',
      )
      setSections([])
      setSkippedTypes([])
      return
    }

    const contentTypeUids = parseContentTypeUids()

    setLoading(true)
    setError(null)
    setSkippedTypes([])
    try {
      const okSections = []
      const skipped = []

      for (const uid of contentTypeUids) {
        const url = buildEntriesUrl(deliveryHost, environment, uid)
        const res = await fetch(url, {
          headers: deliveryHeaders(apiKey, deliveryToken, branch),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg = deliveryResponseMessage(body, res)
          if (isMissingContentTypeError(res, msg)) {
            skipped.push({ uid, detail: msg })
            continue
          }
          throw new Error(`${uid}: ${msg}`)
        }
        const list = Array.isArray(body.entries) ? body.entries : []
        const sorted = [...list].sort((a, b) => {
          const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0
          const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0
          return tb - ta
        })
        okSections.push({ contentTypeUid: uid, entries: sorted })
      }

      setSections(okSections)
      setSkippedTypes(skipped)

      if (okSections.length === 0 && contentTypeUids.length > 0) {
        const allSkipped = skipped.length === contentTypeUids.length
        if (!allSkipped) {
          setError('No content could be loaded for the configured types.')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load entries')
      setSections([])
      setSkippedTypes([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadEntries()
  }, [reloadEntries])

  useEffect(() => {
    const onReload = () => {
      void reloadEntries()
    }
    window.addEventListener(CS_DIGEST_RELOAD, onReload)
    return () => window.removeEventListener(CS_DIGEST_RELOAD, onReload)
  }, [reloadEntries])

  useEffect(() => {
    const loaded = new Set(sections.map((s) => s.contentTypeUid))
    if (digestFilter != null && !loaded.has(digestFilter)) {
      setDigestFilter(null)
    }
  }, [sections, digestFilter])

  const contentTypeUids = parseContentTypeUids()
  const filterUids = useMemo(
    () =>
      contentTypeUids.filter((uid) =>
        sections.some((s) => s.contentTypeUid === uid),
      ),
    [contentTypeUids, sections],
  )
  const totalEntries = sections.reduce((n, s) => n + s.entries.length, 0)

  const digestItems = useMemo(() => {
    const rows = sections.flatMap((s) =>
      s.entries.map((e) => ({
        entry: e,
        contentTypeUid: s.contentTypeUid,
        key: `${s.contentTypeUid}:${e.uid}`,
      })),
    )
    rows.sort((a, b) => {
      const ta = a.entry.updated_at
        ? new Date(a.entry.updated_at).getTime()
        : 0
      const tb = b.entry.updated_at
        ? new Date(b.entry.updated_at).getTime()
        : 0
      return tb - ta
    })
    return rows
  }, [sections])

  const filteredDigest = useMemo(() => {
    if (digestFilter == null) return digestItems
    return digestItems.filter((r) => r.contentTypeUid === digestFilter)
  }, [digestItems, digestFilter])

  return (
    <main className="page">
      <div className="page__intro">
        <h1 className="page__headline">Latest updates</h1>
        <p className="page__lede">
          Published content from your stack, newest first—like a lightweight
          changelog across your selected types. Use Refresh in the header after
          automation or publishes to reload. Each entry opens on its own URL.
        </p>
        {!loading && !error ? (
          <p className="page__intro-meta" aria-live="polite">
            {skippedTypes.length > 0 ? (
              <>
                <strong>{sections.length}</strong> of{' '}
                <strong>{contentTypeUids.length}</strong> types loaded ·{' '}
              </>
            ) : (
              <>
                <strong>{contentTypeUids.length}</strong> types ·{' '}
              </>
            )}
            <strong>{totalEntries}</strong> entries
          </p>
        ) : null}
      </div>

      <EnvironmentGallery />

      {!loading && !error && totalEntries > 0 ? (
        <div
          className="digest-filters"
          role="group"
          aria-label="Filter by content type"
        >
          <button
            type="button"
            className={
              digestFilter == null
                ? 'digest-filter digest-filter--active'
                : 'digest-filter'
            }
            onClick={() => setDigestFilter(null)}
          >
            All
          </button>
          {filterUids.map((uid) => (
            <button
              key={uid}
              type="button"
              className={
                digestFilter === uid
                  ? 'digest-filter digest-filter--active'
                  : 'digest-filter'
              }
              onClick={() => setDigestFilter(uid)}
            >
              {humanizeContentTypeUid(uid)}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? <DigestSkeleton count={5} /> : null}

      {error ? (
        <div className="banner banner--error" role="alert">
          <strong className="banner__title">Something went wrong</strong>
          <p className="banner__text">{error}</p>
        </div>
      ) : null}

      {!loading && !error && skippedTypes.length > 0 ? (
        <div className="banner banner--neutral" role="status">
          <strong className="banner__title">
            {skippedTypes.length === contentTypeUids.length
              ? 'None of these content types exist on this stack yet'
              : 'Some types are not on this stack'}
          </strong>
          <p className="banner__text">
            {skippedTypes.length === contentTypeUids.length ? (
              <>
                Configured UIDs:{' '}
                <code>{skippedTypes.map((s) => s.uid).join(', ')}</code>. Run{' '}
                <code>npm run automate:manifest</code> with this stack’s
                credentials to create them, or set{' '}
                <code>VITE_CONTENTSTACK_CONTENT_TYPE_UIDS</code> in Launch to
                UIDs that already exist (e.g. <code>top_url_lines</code>).
              </>
            ) : (
              <>
                Skipped: {skippedTypes.map((s) => s.uid).join(', ')}. Run{' '}
                <code>npm run automate:manifest</code> for this stack, or
                remove them from <code>VITE_CONTENTSTACK_CONTENT_TYPE_UIDS</code>
                .
              </>
            )}
          </p>
        </div>
      ) : null}

      {!loading && !error && sections.length > 0 && totalEntries === 0 ? (
        <div className="banner banner--neutral">
          <strong className="banner__title">No entries yet</strong>
          <p className="banner__text">
            Publish content to this environment or check your delivery token,
            environment uid, and content type list in{' '}
            <code>VITE_CONTENTSTACK_CONTENT_TYPE_UIDS</code>.
          </p>
        </div>
      ) : null}

      {!loading && !error && filteredDigest.length > 0 ? (
        <ol className="digest-feed">
          {filteredDigest.map(({ entry, contentTypeUid, key }) => (
            <DigestItem
              key={key}
              entry={entry}
              contentTypeUid={contentTypeUid}
            />
          ))}
        </ol>
      ) : null}

      {!loading && !error && totalEntries > 0 && filteredDigest.length === 0 ? (
        <p className="digest-empty-filter">No entries for this type.</p>
      ) : null}

      <section className="hero-canvas-wrap" aria-label="Decorative 3D graphic">
        <Suspense
          fallback={<div className="hero-canvas hero-canvas--fallback" />}
        >
          <HeroCanvas />
        </Suspense>
      </section>
    </main>
  )
}
