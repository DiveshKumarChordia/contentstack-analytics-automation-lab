/**
 * Tiny progress logger — no deps, terminal-friendly, cron-friendly.
 *
 * Why custom: long-running scripts (1k+ transitions, 100+ deletes) need
 * heartbeat output so the user can tell the script is alive. The standard
 * "spinner" packages are TTY-only and look noisy in CI logs; this prints
 * structured one-line updates that work equally well in a terminal and in
 * GitHub Actions output.
 *
 * Usage:
 *   const log = createProgress({ label: 'transitioning', total: 1268 })
 *   for (const item of items) { ...; log.tick({ ok: true }) }
 *   log.done()
 *
 * Output:
 *   transitioning  [    50 / 1268]  3.9%   ok=48 fail=2   (50/s)
 *   transitioning  [   100 / 1268]  7.9%   ok=97 fail=3   (51/s)
 *   ...
 *   transitioning  done  1268/1268  ok=1260 fail=8  in 24.8s
 *
 * Configuration:
 * - everyN          — emit a line at most every N ticks (default 50)
 * - everyMs         — emit a line at most every Ms milliseconds, even if
 *                     fewer than everyN ticks have happened (default 5000).
 *                     Whichever comes first wins.
 */

export function createProgress({ label = 'progress', total = null, everyN = 50, everyMs = 5000 } = {}) {
  const start = Date.now()
  let n = 0
  let ok = 0
  let fail = 0
  let lastLogAt = start
  let lastLogN = 0

  function maybeEmit(force = false) {
    const now = Date.now()
    const elapsed = (now - start) / 1000
    const sincePrint = now - lastLogAt
    const ticksSincePrint = n - lastLogN
    const shouldPrint =
      force || ticksSincePrint >= everyN || sincePrint >= everyMs
    if (!shouldPrint) return
    const rate = elapsed > 0 ? (n / elapsed).toFixed(1) : '—'
    const pct = total ? `${((n / total) * 100).toFixed(1)}%` : ''
    const denom = total ? ` / ${total}` : ''
    console.log(
      `    ${label}  [${String(n).padStart(6)}${denom}]  ${pct.padStart(6)}   ok=${ok} fail=${fail}   (${rate}/s)`,
    )
    lastLogAt = now
    lastLogN = n
  }

  return {
    /** Record one finished item. Pass {ok: false} to count it as a failure. */
    tick({ ok: okFlag = true } = {}) {
      n++
      if (okFlag) ok++
      else fail++
      maybeEmit(false)
    },
    /** Force-emit a line now (e.g. between sub-sections). */
    flush() {
      maybeEmit(true)
    },
    /** Final summary. */
    done() {
      const elapsed = (Date.now() - start) / 1000
      console.log(
        `    ${label}  done  ${n}${total ? '/' + total : ''}  ok=${ok} fail=${fail}  in ${elapsed.toFixed(1)}s`,
      )
    },
    /** Read-only counters. */
    get counts() {
      return { n, ok, fail }
    },
  }
}

/**
 * Run `worker(item)` for each item with at most `concurrency` in flight at a
 * time. No dependencies — uses async/await + an in-flight set.
 *
 * Useful for the workflow transit pass which is otherwise serial (~600ms per
 * call against dev22): concurrency=8 cuts a 13-minute pass to ~1.5 minutes.
 *
 * Order of completion is NOT preserved (workers race), so callers shouldn't
 * rely on items resolving in input order. If you need strict ordering, fall
 * back to a serial for-loop.
 *
 * Errors thrown by worker are caught and forwarded to onError(item, err) —
 * the pool continues. Return value is total processed count.
 */
export async function runWithConcurrency(items, worker, { concurrency = 8, onError } = {}) {
  let idx = 0
  let processed = 0
  const inFlight = new Set()

  async function spawn() {
    if (idx >= items.length) return
    const myIdx = idx++
    const item = items[myIdx]
    const p = (async () => {
      try {
        await worker(item, myIdx)
      } catch (err) {
        if (onError) onError(item, err)
        else console.error('pool worker threw:', err)
      } finally {
        processed++
        inFlight.delete(p)
      }
    })()
    inFlight.add(p)
  }

  // Prime up to concurrency workers
  for (let i = 0; i < Math.min(concurrency, items.length); i++) await spawn()
  // Whenever any worker finishes, spawn another
  while (inFlight.size > 0) {
    await Promise.race(inFlight)
    while (inFlight.size < concurrency && idx < items.length) await spawn()
  }
  return processed
}
