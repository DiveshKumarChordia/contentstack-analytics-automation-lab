/**
 * Error Classification Breakdown
 * Shows transient (retryable) vs permanent (fail-fast) vs unknown errors
 */

export default function ErrorClassification({ runs }) {
  if (!runs || !runs.length) return null

  // Aggregate error types from all runs
  const errorStats = {
    transient: { count: 0, examples: [], autoRecoveryRate: 0 },
    permanent: { count: 0, examples: [], manualNeeded: 0 },
    unknown: { count: 0, examples: [] },
  }

  const allErrors = []
  for (const run of runs) {
    if (run.observability?.totalOperations) {
      // If we have structured observability data
      const successRate = run.observability.avgSuccessRate || 0
      // Estimate transient recovery (operations that succeeded despite transient errors)
      errorStats.transient.autoRecoveryRate = Math.max(
        errorStats.transient.autoRecoveryRate,
        Math.min(100, (successRate + 10)) // Add buffer for recovered transients
      )
    }

    // Parse error audit log
    for (const err of run.errors || []) {
      allErrors.push({ ...err, at: run.startedAt })

      // Classify based on error message patterns
      const msg = (err.message || '').toLowerCase()
      if (
        msg.includes('timeout') ||
        msg.includes('429') ||
        msg.includes('rate limit') ||
        msg.includes('econnreset') ||
        msg.includes('503') ||
        msg.includes('504')
      ) {
        errorStats.transient.count++
        if (errorStats.transient.examples.length < 3) {
          errorStats.transient.examples.push(err.message)
        }
      } else if (
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('404') ||
        msg.includes('unauthorized') ||
        msg.includes('forbidden') ||
        msg.includes('not found')
      ) {
        errorStats.permanent.count++
        errorStats.permanent.manualNeeded++
        if (errorStats.permanent.examples.length < 3) {
          errorStats.permanent.examples.push(err.message)
        }
      } else {
        errorStats.unknown.count++
        if (errorStats.unknown.examples.length < 3) {
          errorStats.unknown.examples.push(err.message)
        }
      }
    }
  }

  const total = errorStats.transient.count + errorStats.permanent.count + errorStats.unknown.count

  if (total === 0) {
    return (
      <div className="error-class">
        <p className="error-class__none">No errors recorded. ✅</p>
      </div>
    )
  }

  return (
    <div className="error-class">
      <div className="error-class__grid">
        {/* Transient errors (retryable) */}
        <div className="error-class__card error-class__card--transient">
          <div className="error-class__icon">🔄</div>
          <div className="error-class__count">{errorStats.transient.count}</div>
          <div className="error-class__label">Transient (Retryable)</div>
          <div className="error-class__status">
            {errorStats.transient.autoRecoveryRate.toFixed(0)}% auto-recovery
          </div>
          {errorStats.transient.examples.length > 0 && (
            <div className="error-class__examples">
              {errorStats.transient.examples.map((ex, i) => (
                <div key={i} className="error-class__example">
                  {ex.slice(0, 45)}…
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Permanent errors (fail-fast) */}
        <div className="error-class__card error-class__card--permanent">
          <div className="error-class__icon">❌</div>
          <div className="error-class__count">{errorStats.permanent.count}</div>
          <div className="error-class__label">Permanent (Fail-Fast)</div>
          <div className="error-class__status">
            {errorStats.permanent.manualNeeded} need manual intervention
          </div>
          {errorStats.permanent.examples.length > 0 && (
            <div className="error-class__examples">
              {errorStats.permanent.examples.map((ex, i) => (
                <div key={i} className="error-class__example">
                  {ex.slice(0, 45)}…
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Unknown errors */}
        <div className="error-class__card error-class__card--unknown">
          <div className="error-class__icon">❓</div>
          <div className="error-class__count">{errorStats.unknown.count}</div>
          <div className="error-class__label">Unknown</div>
          <div className="error-class__status">
            {errorStats.unknown.count} unclassified
          </div>
          {errorStats.unknown.examples.length > 0 && (
            <div className="error-class__examples">
              {errorStats.unknown.examples.map((ex, i) => (
                <div key={i} className="error-class__example">
                  {ex.slice(0, 45)}…
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Distribution pie-like visualization */}
      <div className="error-class__summary">
        <div className="error-class__bar">
          {errorStats.transient.count > 0 && (
            <div
              className="error-class__bar-segment error-class__bar-segment--transient"
              style={{ width: `${(errorStats.transient.count / total) * 100}%` }}
              title={`${errorStats.transient.count} transient`}
            />
          )}
          {errorStats.permanent.count > 0 && (
            <div
              className="error-class__bar-segment error-class__bar-segment--permanent"
              style={{ width: `${(errorStats.permanent.count / total) * 100}%` }}
              title={`${errorStats.permanent.count} permanent`}
            />
          )}
          {errorStats.unknown.count > 0 && (
            <div
              className="error-class__bar-segment error-class__bar-segment--unknown"
              style={{ width: `${(errorStats.unknown.count / total) * 100}%` }}
              title={`${errorStats.unknown.count} unknown`}
            />
          )}
        </div>
        <p className="error-class__total">
          Total: {total} errors
          {errorStats.transient.count > 0 && (
            <> · {Math.round((errorStats.transient.count / total) * 100)}% transient</>
          )}
          {errorStats.permanent.count > 0 && (
            <> · {Math.round((errorStats.permanent.count / total) * 100)}% permanent</>
          )}
        </p>
      </div>
    </div>
  )
}
