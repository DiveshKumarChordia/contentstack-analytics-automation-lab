/**
 * report.mjs — lightweight per-step run reporting.
 *
 * Each automation sub-script calls `writeStepReport({...})` once at the end with
 * its KPIs (planned vs actual, counts, errors). drive-all sets two env vars per
 * step before spawning it:
 *   RUN_REPORT_DIR  — a temp dir to drop the per-step JSON into
 *   RUN_STEP_SLUG   — the file name (one per step)
 * After all steps run, drive-all reads every `${RUN_REPORT_DIR}/${slug}.json`,
 * aggregates them into one run record, renders the GitHub Actions job summary,
 * and appends to the run-history the /runs dashboard reads.
 *
 * No-op when those env vars are unset (i.e. running a script standalone), so
 * instrumenting a script never changes its standalone behavior.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * @param {object} data
 * @param {number} [data.planned]  how many operations were intended this run
 * @param {number} [data.actual]   how many actually succeeded
 * @param {number} [data.failed]   how many failed
 * @param {Object<string,number>} [data.kpis]  named counters (e.g. { created: 5 })
 * @param {Array<{label:string,message:string}>} [data.errors]  per-item failures
 * @param {Object<string,number>} [data.entryCountBefore]  entry counts by CT before step (tiered)
 * @param {Object<string,number>} [data.entryCountAfter]   entry counts by CT after step
 * @param {string} [data.logTrail]  detailed operation log
 * @param {object} [data.operationMetrics]  operation timing stats and success rates
 * @param {Array} [data.circuitBreakerStatus]  circuit breaker status for all monitored operations
 */
export function writeStepReport(data = {}) {
  const dir = process.env.RUN_REPORT_DIR
  const slug = process.env.RUN_STEP_SLUG
  if (!dir || !slug) return // standalone run — nothing to collect
  try {
    mkdirSync(dir, { recursive: true })

    // Validate: planned should equal actual + failed
    const planned = Number.isFinite(data.planned) ? data.planned : null
    const actual = Number.isFinite(data.actual) ? data.actual : null
    const failed = Number.isFinite(data.failed) ? data.failed : 0

    let validation = null
    if (planned != null && actual != null) {
      const sum = actual + failed
      validation = {
        valid: sum === planned,
        message: sum === planned ? null : `Mismatch: planned=${planned} but actual+failed=${sum} (${actual}+${failed})`,
      }
    }

    const payload = {
      planned,
      actual,
      failed,
      validation,
      kpis: data.kpis && typeof data.kpis === 'object' ? data.kpis : {},
      errors: Array.isArray(data.errors) ? data.errors.slice(0, 25) : [],
      entryCountBefore: data.entryCountBefore && typeof data.entryCountBefore === 'object' ? data.entryCountBefore : {},
      entryCountAfter: data.entryCountAfter && typeof data.entryCountAfter === 'object' ? data.entryCountAfter : {},
      logTrail: data.logTrail ? String(data.logTrail).slice(0, 5000) : null,
      operationMetrics: data.operationMetrics && typeof data.operationMetrics === 'object' ? data.operationMetrics : null,
      circuitBreakerStatus: Array.isArray(data.circuitBreakerStatus) ? data.circuitBreakerStatus : [],
    }
    writeFileSync(resolve(dir, `${slug}.json`), JSON.stringify(payload), 'utf-8')
  } catch {
    // Reporting must never break the actual automation.
  }
}
