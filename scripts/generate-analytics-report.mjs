#!/usr/bin/env node
/**
 * generate-analytics-report.mjs — Generate comprehensive analytics from audit trails
 *
 * Extracts detailed KPIs and visualization data without file logging
 * Uses audit trail as source of truth
 *
 * Usage:
 *   node scripts/generate-analytics-report.mjs <audit-trail-json>
 *   node scripts/generate-analytics-report.mjs step-reports/automate-with-roles.json
 */

import fs from 'fs'
import path from 'path'
import { AnalyticsEngine } from './lib/analytics-engine.mjs'
import { ROLES } from './lib/role-based-users.mjs'

/**
 * Format percentage
 */
function pct(value) {
  return `${value}%`
}

/**
 * Format number with thousands separator
 */
function fmt(num) {
  return num.toLocaleString()
}

/**
 * Print section header
 */
function header(title) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`  ${title}`)
  console.log(`${'='.repeat(70)}\n`)
}

/**
 * Print subsection
 */
function subheader(title) {
  console.log(`\n${title}`)
  console.log(`${'-'.repeat(title.length)}\n`)
}

/**
 * Load audit trail from JSON file
 */
function loadAuditTrail(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(content)

    // Extract audit trail - try multiple paths
    let trail = data.audit_trail || data.auditTrail || data.trail || []

    if (Array.isArray(data) && data.length > 0 && data[0].timestamp) {
      trail = data
    }

    if (!Array.isArray(trail)) {
      throw new Error('Audit trail not found or not an array')
    }

    return trail
  } catch (e) {
    console.error(`Error loading audit trail: ${e.message}`)
    process.exit(1)
  }
}

/**
 * Main analytics generation
 */
async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error('Usage: node generate-analytics-report.mjs <audit-trail-json>')
    console.error('Example: node generate-analytics-report.mjs step-reports/automate-with-roles.json')
    process.exit(1)
  }

  const trailFile = args[0]

  if (!fs.existsSync(trailFile)) {
    console.error(`File not found: ${trailFile}`)
    process.exit(1)
  }

  console.log(`Loading audit trail from: ${trailFile}`)
  const auditTrail = loadAuditTrail(trailFile)
  console.log(`Loaded ${auditTrail.length} audit entries\n`)

  // Create analytics engine
  const engine = new AnalyticsEngine(auditTrail, ROLES, {})

  // ================================================================
  // SYSTEM OVERVIEW
  // ================================================================
  header('SYSTEM OVERVIEW')

  const system = engine.getSystemAnalytics()
  console.log(`Total Operations: ${fmt(system.summary.total_operations)}`)
  console.log(`  ✓ Successful: ${fmt(system.summary.successful_operations)} (${pct(system.summary.overall_success_rate)})`)
  console.log(`  ✗ Failed: ${fmt(system.summary.failed_operations)}`)
  console.log(`\nBreakdown:`)
  console.log(`  Single-User Ops: ${fmt(system.breakdown.single_user_operations)}`)
  console.log(`  Multi-User Ops: ${fmt(system.breakdown.multi_user_operations)}`)
  console.log(`\nUnique Counts:`)
  console.log(`  Users: ${system.unique_counts.users}`)
  console.log(`  Roles: ${system.unique_counts.roles}`)
  console.log(`  Operations: ${system.unique_counts.operations}`)

  if (system.duration.start && system.duration.end) {
    console.log(`\nExecution Time:`)
    console.log(`  Start: ${system.duration.start}`)
    console.log(`  End: ${system.duration.end}`)
    console.log(`  Duration: ${system.duration.duration_seconds}s`)
    console.log(`  Throughput: ${system.duration.throughput_ops_per_second} ops/sec`)
  }

  // ================================================================
  // LOAD DISTRIBUTION
  // ================================================================
  header('LOAD DISTRIBUTION FAIRNESS')

  const distribution = engine.getLoadDistribution()
  console.log(`Average Operations per User: ${distribution.average_ops_per_user}`)
  console.log(`Min: ${distribution.min_ops} | Max: ${distribution.max_ops}`)
  console.log(`Std Deviation: ${distribution.std_deviation}`)
  console.log(`Fairness Score: ${distribution.fairness_score}/100`)
  console.log(`Status: ${distribution.distribution_explanation}`)

  // ================================================================
  // ROLE-BASED ANALYTICS
  // ================================================================
  header('ROLE-BASED ANALYTICS')

  const roleAnalytics = engine.getRoleAnalytics()
  Object.entries(roleAnalytics)
    .sort((a, b) => b[1].level - a[1].level)
    .forEach(([key, data]) => {
      subheader(`${data.role} (Level ${data.level})`)
      console.log(`Users with role: ${data.users_with_role}`)
      console.log(`Total operations: ${data.total_operations}`)
      console.log(`Success rate: ${pct(data.success_rate)} (${data.successful_operations}/${data.total_operations})`)
      console.log(`Avg ops/user: ${data.avg_operations_per_user}`)

      if (Object.keys(data.operations_breakdown).length > 0) {
        console.log(`\nOperations breakdown:`)
        Object.entries(data.operations_breakdown)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 5)
          .forEach(([op, opData]) => {
            const rate = Math.round((opData.successful / opData.count) * 100)
            console.log(`  ${op}: ${opData.count} (${pct(rate)} success)`)
          })
      }
    })

  // ================================================================
  // ROLE CAPABILITY COVERAGE
  // ================================================================
  header('ROLE CAPABILITY COVERAGE')

  const coverage = engine.getRoleCapabilityCoverage()
  Object.entries(coverage)
    .sort((a, b) => b[1].coverage_percentage - a[1].coverage_percentage)
    .forEach(([key, data]) => {
      console.log(`${data.role}: ${data.performed_count}/${data.allowed_operations} (${pct(Math.round(data.coverage_percentage))})`)
    })

  // ================================================================
  // OPERATION ANALYTICS
  // ================================================================
  header('OPERATION ANALYTICS')

  const operationAnalytics = engine.getOperationAnalytics()
  const topOps = Object.entries(operationAnalytics)
    .sort((a, b) => b[1].total_executions - a[1].total_executions)
    .slice(0, 10)

  console.log('Top 10 Operations by Frequency:\n')
  topOps.forEach(([op, data], idx) => {
    console.log(`${idx + 1}. ${op}`)
    console.log(`   Executions: ${data.total_executions} | Success Rate: ${pct(data.success_rate)}`)
    console.log(`   Roles: ${data.roles_involved.join(', ')} | Users: ${data.unique_users}`)
  })

  // ================================================================
  // OPERATION SEQUENCES
  // ================================================================
  header('OPERATION SEQUENCE PATTERNS')

  const sequences = engine.getOperationSequencePatterns()
  const topSequences = Object.entries(sequences)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  if (topSequences.length > 0) {
    console.log('Most Common Operation Sequences:\n')
    topSequences.forEach(([seq, count], idx) => {
      console.log(`${idx + 1}. ${seq} (${count} times)`)
    })
  } else {
    console.log('No common sequences found')
  }

  // ================================================================
  // USER ANALYTICS
  // ================================================================
  header('USER RELIABILITY RANKING')

  const reliability = engine.getUserReliabilityRanking()
  const topUsers = reliability.slice(0, 10)

  console.log(`Top 10 Users by Success Rate:\n`)
  topUsers.forEach((user) => {
    console.log(`${user.rank}. ${user.user}`)
    console.log(`   Role: ${user.role} | Operations: ${user.operations}`)
    console.log(`   Success Rate: ${pct(user.success_rate)}`)
  })

  // ================================================================
  // USER SPECIALIZATION
  // ================================================================
  header('USER SPECIALIZATION ANALYSIS')

  const specialization = engine.getUserSpecialization()
  const usersWithSpecialties = Object.entries(specialization).filter(
    ([_, data]) => data.strengths.length > 0 || data.good_at.length > 0 || data.weak_in.length > 0
  )

  if (usersWithSpecialties.length > 0) {
    usersWithSpecialties.slice(0, 5).forEach(([user, data]) => {
      subheader(`${user}`)
      console.log(`Role: ${data.role}`)

      if (data.strengths.length > 0) {
        console.log(`\nStrengths (100% success):`)
        data.strengths.forEach((s) => {
          console.log(`  ✓ ${s.operation} (${s.executions} times)`)
        })
      }

      if (data.good_at.length > 0) {
        console.log(`\nGood at (80%+ success):`)
        data.good_at.forEach((g) => {
          console.log(`  ✓ ${g.operation} (${pct(g.success_rate)}, ${g.executions} times)`)
        })
      }

      if (data.weak_in.length > 0) {
        console.log(`\nWeak in (<50% success):`)
        data.weak_in.forEach((w) => {
          console.log(`  ✗ ${w.operation} (${pct(w.success_rate)}, ${w.executions} times)`)
        })
      }
    })
  }

  // ================================================================
  // MULTI-USER OPERATIONS
  // ================================================================
  header('MULTI-USER OPERATION ANALYTICS')

  const multiUserOps = engine.getMultiUserOperationAnalytics()
  if (multiUserOps.total_multi_user_ops > 0) {
    console.log(`Total Multi-User Operations: ${multiUserOps.total_multi_user_ops}\n`)

    Object.entries(multiUserOps.operations).forEach(([op, data]) => {
      subheader(`${op}`)
      console.log(`Executions: ${data.total_executions}`)
      console.log(`Success Rate: ${pct(data.success_rate)}`)
      console.log(`Roles Involved: ${data.roles_involved.join(', ')}`)

      console.log(`\nStep-wise Success Rates:`)
      Object.entries(data.step_success_rates).forEach(([step, sr]) => {
        console.log(`  ${step}: ${pct(sr.success_rate)} (${sr.count} executions)`)
      })
    })
  } else {
    console.log('No multi-user operations found')
  }

  // ================================================================
  // PERMISSION VALIDATION
  // ================================================================
  header('PERMISSION BOUNDARY VALIDATION')

  const validation = engine.validatePermissionBoundaries()
  console.log(`Total Operations Checked: ${validation.validations.total_operations_checked}`)
  console.log(`Valid Operations: ${validation.validations.valid_operations}`)
  console.log(`Permission Violations: ${validation.validations.permission_violations}`)

  if (validation.validations.permission_violations > 0) {
    console.log(`\nViolations by Role:`)
    Object.entries(validation.validations.violations_by_role).forEach(([role, count]) => {
      console.log(`  ${role}: ${count}`)
    })

    console.log(`\nSample Violations (first 5):`)
    validation.violations.slice(0, 5).forEach((v) => {
      console.log(`  ${v.user} (${v.role}) tried ${v.operation}: ${v.issue}`)
    })
  } else {
    console.log('✓ No permission violations detected!')
  }

  // ================================================================
  // SAVE COMPREHENSIVE REPORT
  // ================================================================
  const reportPath = path.join('step-reports', 'analytics-report.json')
  const report = engine.getComprehensiveReport()

  try {
    fs.mkdirSync('step-reports', { recursive: true })
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`\n✓ Comprehensive report saved to: ${reportPath}`)
  } catch (e) {
    console.error(`Warning: Could not save report: ${e.message}`)
  }

  // ================================================================
  // SAVE VISUALIZATION DATA
  // ================================================================
  const vizPath = path.join('step-reports', 'visualization-data.json')
  const vizData = engine.getVisualizationData()

  try {
    fs.writeFileSync(vizPath, JSON.stringify(vizData, null, 2))
    console.log(`✓ Visualization data saved to: ${vizPath}`)
  } catch (e) {
    console.error(`Warning: Could not save visualization data: ${e.message}`)
  }

  console.log(`\n✓ Analytics report generation complete!`)
}

// Run
main().catch((err) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
