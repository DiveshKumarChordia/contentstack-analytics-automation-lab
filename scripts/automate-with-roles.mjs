#!/usr/bin/env node
/**
 * automate-with-roles.mjs — Run operations with role-based users
 *
 * Features:
 * 1. Create users with different roles (owner, admin, editor, contributor, viewer)
 * 2. Perform single-user operations (based on role permissions)
 * 3. Perform multi-user operations (requiring specific role combinations)
 * 4. Track role-based performance and operation coverage
 * 5. Generate detailed reports with role analysis
 *
 * Email format:
 * divesh.k+run-2025-dec-08-0230pm-role-admin-ops-create-publish@contentstack.com
 *
 * Usage:
 *   npm run automate:with-roles
 *   DISTRIBUTION=pyramid CONTENTSTACK_USER_COUNT=50 npm run automate:with-roles
 */

import { optionalEnv, sleep } from './lib/cma.mjs'
import { createRoleBasedUsers, DISTRIBUTION_STRATEGIES } from './lib/role-based-factory.mjs'
import { ROLES, MULTI_USER_OPERATIONS, MultiUserOperation } from './lib/role-based-users.mjs'
import { writeStepReport } from './lib/report.mjs'

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

/**
 * Main automation with roles
 */
async function main() {
  const userCount = intEnv('CONTENTSTACK_USER_COUNT', 30)
  const distribution = optionalEnv('DISTRIBUTION', 'pyramid')
  const baseEmail = optionalEnv('CONTENTSTACK_TEST_USER_EMAIL')
  const orgUid = optionalEnv('CONTENTSTACK_ORG_UID')

  console.log('=== Automation with Role-Based Users ===\n')
  console.log(`📊 Configuration:`)
  console.log(`  Users to create: ${userCount}`)
  console.log(`  Distribution: ${distribution}`)
  console.log(`  Base email: ${baseEmail || '(not set)'}`)
  console.log(`  Organization: ${orgUid || '(not set)'}`)

  if (!baseEmail || !orgUid) {
    throw new Error('Missing CONTENTSTACK_TEST_USER_EMAIL or CONTENTSTACK_ORG_UID')
  }

  // 1. Create role-based users
  console.log(`\n🏭 Phase 1: Creating role-based users...`)
  const result = await createRoleBasedUsers({
    baseEmail,
    orgUid,
    userCount,
    distribution,
  })

  const { users, batch, runId } = result

  console.log(`\n✓ Created ${users.length} users`)

  // 2. Perform single-user operations
  console.log(`\n🎯 Phase 2: Performing single-user operations...`)

  let singleUserOpsCount = 0
  let singleUserSuccessful = 0

  for (let i = 0; i < Math.min(50, users.length * 2); i++) {
    const user = users[Math.floor(Math.random() * users.length)]
    const op = user.role.operations[Math.floor(Math.random() * user.role.operations.length)]

    try {
      user.recordOperation(op, true)
      singleUserOpsCount++
      singleUserSuccessful++
      console.log(`  ${user.role.abbreviation.padEnd(12)} → ${op.padEnd(25)} ✓`)
    } catch (e) {
      console.log(`  ${user.role.abbreviation.padEnd(12)} → ${op.padEnd(25)} ✗ (${e.message.slice(0, 30)})`)
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  Progress: ${i + 1} operations`)
    }

    await sleep(50)
  }

  console.log(`\n✓ Completed ${singleUserOpsCount} single-user operations (${singleUserSuccessful} successful)`)

  // 3. Perform multi-user operations
  console.log(`\n👥 Phase 3: Performing multi-user operations...`)

  const multiUserResults = []
  const multiUserOpsToTry = [
    'review-and-publish',
    'collaborative-create',
    'owner-approval-publish',
    'bulk-localize-publish',
  ]

  for (const opKey of multiUserOpsToTry) {
    try {
      console.log(`\n  ${opKey.padEnd(25)}...`)
      const result = await batch.executeMultiUserOperation(opKey)
      multiUserResults.push(result)
      console.log(`    ✓ Completed by roles: ${result.definition.requiredRoles.join(', ')}`)
    } catch (e) {
      console.log(`    ✗ Failed: ${e.message}`)
    }

    await sleep(300)
  }

  console.log(`\n✓ Completed ${multiUserResults.length} multi-user operations`)

  // 4. Generate reports
  console.log(`\n📊 Phase 4: Generating reports...`)

  const batchSummary = batch.getSummary()
  const auditTrail = batch.getAuditTrail()

  // Role-based coverage
  const roleCoverage = {}
  for (const roleKey of Object.keys(ROLES)) {
    const roleUsers = batch.getUsersByRole(roleKey)
    const roleOps = roleUsers.reduce((sum, u) => sum + u.performedOps.length, 0)
    const roleSuccess = roleUsers.reduce(
      (sum, u) => sum + u.performedOps.filter((o) => o.success).length,
      0
    )

    roleCoverage[roleKey] = {
      count: roleUsers.length,
      total_ops: roleOps,
      successful: roleSuccess,
      failed: roleOps - roleSuccess,
      success_rate: roleOps > 0 ? `${((roleSuccess / roleOps) * 100).toFixed(0)}%` : 'N/A',
    }
  }

  // Multi-user operation coverage
  const multiUserOpCoverage = {}
  for (const opKey of Object.keys(MULTI_USER_OPERATIONS)) {
    const completed = multiUserResults.filter((r) => r.operationKey === opKey).length
    multiUserOpCoverage[opKey] = {
      total_completed: completed,
      required_roles: MULTI_USER_OPERATIONS[opKey].requiredRoles,
    }
  }

  // Build report
  const report = {
    timestamp: new Date().toISOString(),
    runId,
    configuration: {
      users_created: users.length,
      distribution_strategy: result.distribution_strategy,
      distribution: result.distribution,
      base_email: baseEmail,
      organization: orgUid,
    },
    single_user_operations: {
      total: singleUserOpsCount,
      successful: singleUserSuccessful,
      failed: singleUserOpsCount - singleUserSuccessful,
      success_rate:
        singleUserOpsCount > 0
          ? `${((singleUserSuccessful / singleUserOpsCount) * 100).toFixed(0)}%`
          : 'N/A',
    },
    multi_user_operations: {
      total: multiUserResults.length,
      coverage: multiUserOpCoverage,
      details: multiUserResults.map((r) => r.getSummary()),
    },
    role_coverage: roleCoverage,
    batch_summary: batchSummary,
    audit_trail_sample: auditTrail.slice(0, 100),
    audit_trail_count: auditTrail.length,
  }

  // 5. Print summary
  console.log(`\n✅ Automation completed!`)
  console.log(`\n📋 Summary:`)
  console.log(`  Users created: ${users.length}`)
  console.log(`  Single-user operations: ${singleUserOpsCount} (${singleUserSuccessful} successful)`)
  console.log(`  Multi-user operations: ${multiUserResults.length}`)

  console.log(`\n👥 By Role:`)
  for (const [roleKey, coverage] of Object.entries(roleCoverage)) {
    if (coverage.count > 0) {
      const role = ROLES[roleKey]
      console.log(`  ${role.name.padEnd(20)}: ${coverage.count} users, ${coverage.total_ops} ops, ${coverage.success_rate} success`)
    }
  }

  console.log(`\n🔗 Multi-User Operations:`)
  for (const [opKey, coverage] of Object.entries(multiUserOpCoverage)) {
    console.log(`  ${opKey.padEnd(30)}: ${coverage.total_completed} completed`)
  }

  // Write report
  await writeStepReport('automate-with-roles', report)

  console.log(`\n✅ Report written to step-reports/`)
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
