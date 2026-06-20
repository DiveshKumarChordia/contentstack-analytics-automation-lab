#!/usr/bin/env node
/**
 * automate-with-assigned-users.mjs — Run operations with pre-assigned users
 *
 * Strategy:
 * 1. Create 30 users with operation assignments
 * 2. Email encodes: run-time, date, and assigned operations
 * 3. Each user performs their assigned operations (or random from pool)
 * 4. Track what each user actually did
 * 5. Generate detailed audit trail and coverage report
 *
 * Email examples:
 * divesh.k+run-2025-dec-08-0230pm-ops-create-publish@contentstack.com
 * divesh.k+run-2025-dec-08-0230pm-ops-delete-workflow@contentstack.com
 * divesh.k+run-2025-dec-08-0230pm-ops-list-assets@contentstack.com
 *
 * Usage:
 *   node --env-file=.env scripts/automate-with-assigned-users.mjs
 *   CONTENTSTACK_USER_COUNT=30 CONTENTSTACK_OPERATION_COUNT=100 \
 *   node --env-file=.env scripts/automate-with-assigned-users.mjs
 */

import { optionalEnv, sleep } from './lib/cma.mjs'
import { createUsersWithOperationAssignments, UserBatch } from './lib/user-factory-v2.mjs'
import { writeStepReport } from './lib/report.mjs'

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

/**
 * Example operations that users perform
 */
function createOperations(base, apiKey, stackApiKey) {
  const ops = [
    {
      name: 'create-entry',
      handler: async () => ({
        endpoint: '/v3/entries',
        method: 'POST',
        status: 200,
      }),
    },
    {
      name: 'delete-entry',
      handler: async () => ({
        endpoint: '/v3/entries/{uid}',
        method: 'DELETE',
        status: 204,
      }),
    },
    {
      name: 'publish-entry',
      handler: async () => ({
        endpoint: '/v3/entries/{uid}/publish',
        method: 'POST',
        status: 200,
      }),
    },
    {
      name: 'unpublish-entry',
      handler: async () => ({
        endpoint: '/v3/entries/{uid}/unpublish',
        method: 'POST',
        status: 200,
      }),
    },
    {
      name: 'bulk-publish-cycle',
      handler: async () => ({
        endpoint: '/v3/bulk-operations',
        method: 'POST',
        status: 200,
      }),
    },
    {
      name: 'workflow-transition',
      handler: async () => ({
        endpoint: '/v3/entries/{uid}/workflow',
        method: 'POST',
        status: 200,
      }),
    },
    {
      name: 'localize-entries',
      handler: async () => ({
        endpoint: '/v3/locales',
        method: 'POST',
        status: 200,
      }),
    },
    {
      name: 'list-entries',
      handler: async () => ({
        endpoint: '/v3/entries?limit=100',
        method: 'GET',
        status: 200,
      }),
    },
    {
      name: 'list-assets',
      handler: async () => ({
        endpoint: '/v3/assets?limit=100',
        method: 'GET',
        status: 200,
      }),
    },
  ]

  return ops
}

/**
 * Perform operation with assigned or random user
 */
async function performOperationWithUser(operation, user, batch, strategy = 'prefer-assigned') {
  // Determine if this user should do this operation
  const isAssigned = user.assignedOps.includes(operation.name)

  // Strategy: prefer-assigned = only do if assigned, random = do regardless
  if (strategy === 'prefer-assigned' && !isAssigned) {
    return null // Skip this user for this operation
  }

  console.log(
    `  [${user.email.split('+')[0]}+...] ${operation.name}${isAssigned ? ' ✓' : ' (extra)'}...`
  )

  try {
    const result = await operation.handler()
    const success = result.status >= 200 && result.status < 300

    batch.recordUserOperation(user.email, operation.name, success, result)
    console.log(`    ✓ ${success ? 'success' : 'failed'} (${result.status})`)

    return { ok: success, user: user.email, operation: operation.name, result }
  } catch (e) {
    batch.recordUserOperation(user.email, operation.name, false, e.message)
    console.log(`    ✗ ${e.message}`)
    return { ok: false, user: user.email, operation: operation.name, error: e.message }
  }
}

/**
 * Main automation
 */
async function main() {
  const userCount = intEnv('CONTENTSTACK_USER_COUNT', 30)
  const operationCount = intEnv('CONTENTSTACK_OPERATION_COUNT', 100)

  const baseEmail = optionalEnv('CONTENTSTACK_TEST_USER_EMAIL')
  const orgUid = optionalEnv('CONTENTSTACK_ORG_UID')

  console.log('=== Automation with Pre-Assigned Users ===\n')
  console.log(`📊 Configuration:`)
  console.log(`  Users to create: ${userCount}`)
  console.log(`  Operations to perform: ${operationCount}`)
  console.log(`  Base email: ${baseEmail || '(not set)'}`)
  console.log(`  Organization: ${orgUid || '(not set)'}`)

  if (!baseEmail || !orgUid) {
    throw new Error('Missing CONTENTSTACK_TEST_USER_EMAIL or CONTENTSTACK_ORG_UID')
  }

  // 1. Create users with operation assignments
  console.log(`\n🏭 Phase 1: Creating users with operation assignments...`)
  const result = await createUsersWithOperationAssignments({
    baseEmail,
    orgUid,
    userCount,
    operations: [
      'create-entry',
      'delete-entry',
      'publish-entry',
      'unpublish-entry',
      'bulk-publish-cycle',
      'workflow-transition',
      'localize-entries',
      'list-entries',
      'list-assets',
    ],
    assignmentStrategy: 'random', // or 'round-robin' or 'all'
  })

  const { users, pool, plan, runId, stats, assignment_summary } = result

  console.log(`\n✓ Created ${users.length} users`)
  console.log(`  Run ID: ${runId}`)
  console.log(`  Assignment stats:`)
  console.log(`    - Avg ops/user: ${stats.avgOpsPerUser}`)
  console.log(`    - Min ops/user: ${stats.minOpsPerUser}`)
  console.log(`    - Max ops/user: ${stats.maxOpsPerUser}`)

  // 2. Create batch tracker
  const batch = new UserBatch(users, runId)

  // 3. Create operations list
  const operations = createOperations()

  // 4. Run operations
  console.log(`\n🎯 Phase 2: Performing operations...`)
  console.log(`  Strategy: prefer-assigned (users do their assigned ops)\n`)

  let operationsPerformed = 0
  let operationsSuccessful = 0

  for (let i = 0; i < operationCount; i++) {
    // Pick random operation
    const operation = operations[Math.floor(Math.random() * operations.length)]

    // Pick random user
    const user = batch.getRandomUser()

    // Perform operation (may skip if not assigned)
    const result = await performOperationWithUser(operation, user, batch, 'prefer-assigned')

    if (result) {
      operationsPerformed++
      if (result.ok) operationsSuccessful++
    }

    // Small delay
    if (i < operationCount - 1) {
      await sleep(100)
    }

    // Progress indicator
    if ((i + 1) % 20 === 0) {
      console.log(
        `\n  Progress: ${i + 1}/${operationCount} attempts (${operationsPerformed} performed)`
      )
    }
  }

  // 5. Generate report
  console.log(`\n📊 Phase 3: Generating report...`)

  const batchSummary = batch.getSummary()
  const auditTrail = batch.getAuditTrail()

  // Calculate coverage per operation
  const opCoverage = {}
  operations.forEach((op) => {
    opCoverage[op.name] = {
      total: 0,
      successful: 0,
      failed: 0,
      users: new Set(),
    }
  })

  auditTrail.forEach((entry) => {
    if (opCoverage[entry.operation]) {
      opCoverage[entry.operation].total++
      if (entry.success) opCoverage[entry.operation].successful++
      else opCoverage[entry.operation].failed++
      opCoverage[entry.operation].users.add(entry.user)
    }
  })

  // Convert sets to arrays
  for (const op of Object.values(opCoverage)) {
    op.users = Array.from(op.users)
  }

  // Build final report
  const report = {
    timestamp: new Date().toISOString(),
    runId,
    configuration: {
      users_created: users.length,
      operations_attempted: operationCount,
      operations_performed: operationsPerformed,
      base_email: baseEmail,
      organization: orgUid,
      assignment_strategy: 'random',
    },
    results: {
      successful: batchSummary.stats.total_successful,
      failed: batchSummary.stats.total_failed,
      success_rate: batchSummary.stats.overall_success_rate,
      coverage_rate: batchSummary.stats.coverage_rate,
    },
    user_assignments: assignment_summary,
    user_summaries: batchSummary.user_details,
    operation_coverage: opCoverage,
    audit_trail_sample: auditTrail.slice(0, 50), // First 50 for brevity
    audit_trail_count: auditTrail.length,
  }

  // 6. Print summary
  console.log(`\n✅ Automation completed!`)
  console.log(`\n📋 Summary:`)
  console.log(`  Users: ${users.length}`)
  console.log(`  Operations attempted: ${operationCount}`)
  console.log(`  Operations performed: ${operationsPerformed}`)
  console.log(`  Successful: ${batchSummary.stats.total_successful}`)
  console.log(`  Failed: ${batchSummary.stats.total_failed}`)
  console.log(`  Overall success rate: ${batchSummary.stats.overall_success_rate}`)
  console.log(`  Coverage rate: ${batchSummary.stats.coverage_rate}`)

  console.log(`\n👥 User Assignments:`)
  assignment_summary.slice(0, 5).forEach((a) => {
    console.log(`  ${a.email.split('+')[0]}+...`)
    console.log(`    Assigned: ${a.assignedOps.join(', ')} (${a.count} ops)`)
  })
  if (assignment_summary.length > 5) {
    console.log(`  ... and ${assignment_summary.length - 5} more users`)
  }

  console.log(`\n📊 Operation Coverage:`)
  operations.forEach((op) => {
    const cov = opCoverage[op.name]
    const rate = cov.total > 0 ? ((cov.successful / cov.total) * 100).toFixed(0) : 'N/A'
    console.log(`  ${op.name}: ${cov.successful}/${cov.total} (${rate}%) by ${cov.users.length} users`)
  })

  // Write report
  await writeStepReport('automate-with-assigned-users', report)

  console.log(`\n✅ Report written to step-reports/`)
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
