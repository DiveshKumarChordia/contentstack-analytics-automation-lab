/**
 * Circuit Breaker Status Board
 * Displays real-time health of circuit breakers (CLOSED/OPEN/HALF_OPEN)
 * from Phase 4 observability infrastructure
 */

export default function CircuitBreakerStatus({ runs }) {
  if (!runs || !runs.length) return null

  // Aggregate circuit breaker status from latest runs
  const cbStatus = {}
  const cbHistory = {}

  for (const run of [...runs].reverse()) {
    if (run.observability?.circuitBreakersByStep) {
      for (const [stepName, breakers] of Object.entries(run.observability.circuitBreakersByStep)) {
        for (const breaker of breakers) {
          if (!cbStatus[breaker.name]) {
            cbStatus[breaker.name] = {
              name: breaker.name,
              state: breaker.state,
              failureCount: breaker.failureCount || 0,
              successCount: breaker.successCount || 0,
              lastFailureTime: breaker.lastFailureTime,
              nextRetryAt: breaker.nextRetryAt,
              step: stepName,
            }
          }
          if (!cbHistory[breaker.name]) {
            cbHistory[breaker.name] = []
          }
          cbHistory[breaker.name].push({
            state: breaker.state,
            at: run.startedAt,
          })
        }
      }
    }
  }

  const breakers = Object.values(cbStatus).sort((a, b) => {
    // Sort by state: OPEN first, then HALF_OPEN, then CLOSED
    const stateOrder = { open: 0, 'half-open': 1, closed: 2 }
    return stateOrder[a.state] - stateOrder[b.state]
  })

  if (breakers.length === 0) {
    return null
  }

  const openCount = breakers.filter(b => b.state === 'open').length
  const halfOpenCount = breakers.filter(b => b.state === 'half-open').length
  const closedCount = breakers.filter(b => b.state === 'closed').length

  return (
    <div className="cb-status">
      <div className="cb-status__header">
        <h3 className="cb-status__title">🔌 Circuit Breaker Status</h3>
        <div className="cb-status__summary">
          <span className="cb-status__badge cb-status__badge--closed">✅ {closedCount} Healthy</span>
          {halfOpenCount > 0 && (
            <span className="cb-status__badge cb-status__badge--half-open">⚡ {halfOpenCount} Recovering</span>
          )}
          {openCount > 0 && (
            <span className="cb-status__badge cb-status__badge--open">❌ {openCount} Open</span>
          )}
        </div>
      </div>

      <div className="cb-status__list">
        {breakers.map(breaker => (
          <div key={breaker.name} className={`cb-status__item cb-status__item--${breaker.state}`}>
            <div className="cb-status__left">
              <div className="cb-status__icon">
                {breaker.state === 'closed' && '✅'}
                {breaker.state === 'half-open' && '⚡'}
                {breaker.state === 'open' && '❌'}
              </div>
              <div className="cb-status__info">
                <div className="cb-status__name">{breaker.name}</div>
                <div className="cb-status__step">{breaker.step}</div>
              </div>
            </div>

            <div className="cb-status__center">
              <div className="cb-status__state">
                {breaker.state === 'closed' && 'CLOSED'}
                {breaker.state === 'open' && 'OPEN'}
                {breaker.state === 'half-open' && 'HALF_OPEN'}
              </div>
              <div className="cb-status__counts">
                {breaker.failureCount > 0 && (
                  <span className="cb-status__count cb-status__count--fail">
                    {breaker.failureCount}✗
                  </span>
                )}
                {breaker.successCount > 0 && (
                  <span className="cb-status__count cb-status__count--success">
                    {breaker.successCount}✓
                  </span>
                )}
              </div>
            </div>

            <div className="cb-status__right">
              {breaker.state === 'open' && breaker.nextRetryAt && (
                <div className="cb-status__meta">
                  Retry: {new Date(breaker.nextRetryAt).toLocaleTimeString()}
                </div>
              )}
              {breaker.state === 'half-open' && breaker.nextRetryAt && (
                <div className="cb-status__meta cb-status__meta--recovering">
                  Recovering…
                </div>
              )}
              {breaker.state === 'closed' && breaker.lastFailureTime && (
                <div className="cb-status__meta">
                  Last fail: {formatTime(breaker.lastFailureTime)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {openCount > 0 && (
        <div className="cb-status__alert">
          ⚠️ {openCount} circuit breaker(s) are OPEN. Operations are being fast-failed to prevent cascading failures.
        </div>
      )}
    </div>
  )
}

function formatTime(isoString) {
  const date = new Date(isoString)
  const now = new Date()
  const diff = now - date
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (seconds < 60) return `${seconds}s ago`
  if (minutes < 60) return `${minutes}m ago`
  return `${hours}h ago`
}
