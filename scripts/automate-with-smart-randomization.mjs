#!/usr/bin/env node
/**
 * automate-with-smart-randomization.mjs — Advanced random operation assignment
 *
 * Features:
 * - Multiple randomization strategies (pure, weighted, balanced, round-robin)
 * - Operation clustering (related operations together)
 * - User balancing (distribute operations evenly)
 * - Comprehensive tracking and reporting
 *
 * Usage:
 *   node --env-file=.env scripts/automate-with-smart-randomization.mjs
 *   node --env-file=.env scripts/automate-with-smart-randomization.mjs --strategy balanced
 *   node --env-file=.env scripts/automate-with-smart-randomization.mjs --users 10 --ops 50 --strategy clustered
 */

import { optionalEnv, loadStackAuth, managementHeaders, loadManagementTokens, sleep } from './lib/cma.mjs'
import { createMultipleTestUsers } from './lib/user-factory.mjs'
import { getLogger } from './lib/logger.mjs'
import { OperationRandomizer, RANDOMIZATION_STRATEGIES } from './lib/operation-randomizer.mjs'
import { writeStepReport } from './lib/report.mjs'

const log = getLogger('smart-randomization')

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

function stringEnv(name, dflt) {
  return optionalEnv(name) || dflt
}

/**
 * Available operations
 */
function createOperations(base, apiKey, orgUid, stackApiKey) {
  return [
    {
      name: 'create-entry',
      handler: async (user, ctx) => {
        const response = await fetch(`${base}/v3/content_types/${ctx.contentTypeUid}/entries`, {
          method: 'POST',
          headers: {
            authorization: user.authtoken || 'mgmt-token',
            api_key: stackApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            entry: {
              title: `Entry by ${user.email.split('@')[0]}`,
              body: `Created at ${new Date().toISOString()}`,
            },
          }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      },
    },

    {
      name: 'list-entries',
      handler: async (user, ctx) => {
        const response = await fetch(`${base}/v3/content_types/${ctx.contentTypeUid}/entries?limit=10`, {
          method: 'GET',
          headers: {
            authorization: user.authtoken || 'mgmt-token',
            api_key: stackApiKey,
          },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      },
    },

    {
      name: 'list-assets',
      handler: async (user, ctx) => {
        const response = await fetch(`${base}/v3/assets?limit=10`, {
          method: 'GET',
          headers: {
            authorization: user.authtoken || 'mgmt-token',
            api_key: stackApiKey,
          },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      },
    },

    {
      name: 'get-content-types',
      handler: async (user, ctx) => {
        const response = await fetch(`${base}/v3/content_types?limit=5`, {
          method: 'GET',
          headers: {
            authorization: user.authtoken || 'mgmt-token',
            api_key: stackApiKey,
          },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      },
    },
  ]
}

/**
 * Main automation flow
 */
async function main() {
  const userCount = intEnv('CONTENTSTACK_USER_COUNT', 8)
  const operationCount = intEnv('CONTENTSTACK_OPERATION_COUNT', 40)
  const strategy = stringEnv('RANDOMIZATION_STRATEGY', 'pure')

  const baseEmail = optionalEnv('CONTENTSTACK_TEST_USER_EMAIL')
  const orgUid = optionalEnv('CONTENTSTACK_ORG_UID')
  const stackApiKey = optionalEnv('CONTENTSTACK_API_KEY')

  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmtHeaders = managementHeaders(apiKey, tokens[0], branch)

  log.info('=== Smart Randomization Automation ===', {
    users: userCount,
    operations: operationCount,
    strategy,
  })

  if (!baseEmail || !orgUid) {
    throw new Error('Missing CONTENTSTACK_TEST_USER_EMAIL or CONTENTSTACK_ORG_UID')
  }

  // Phase 1: Create users
  log.info('Phase 1: Creating test users...')
  const userPool = await createMultipleTestUsers(userCount, {
    baseEmail,
    orgUid,
  })

  const createdUsers = userPool.getAllUsers()
  if (createdUsers.length === 0) {
    throw new Error('Failed to create any test users')
  }

  log.info(`Created ${createdUsers.length} users`)

  // Phase 2: Fetch content type
  log.info('Phase 2: Fetching content types...')
  const ctRes = await fetch(`${base}/v3/content_types?limit=1`, {
    method: 'GET',
    headers: mgmtHeaders,
  })
  const ctBody = await ctRes.json()
  const contentTypeUid = ctBody.content_types?.[0]?.uid

  if (!contentTypeUid) {
    log.warn('No content types found, operations will be limited')
  }

  // Phase 3: Setup randomizer
  log.info('Phase 3: Setting up operation randomizer...', { strategy })
  const operations = createOperations(base, apiKey, orgUid, stackApiKey)
  const randomizer = new OperationRandomizer(
    operations.map((o) => o.name),
    createdUsers.map((u) => ({ email: u.email }))
  )

  // Validate strategy
  if (!Object.values(RANDOMIZATION_STRATEGIES).includes(strategy)) {
    throw new Error(`Unknown strategy: ${strategy}. Available: ${Object.values(RANDOMIZATION_STRATEGIES).join(', ')}`)
  }

  randomizer.setStrategy(strategy)

  // Configure strategy-specific settings
  if (strategy === 'weighted') {
    randomizer.setOperationWeight('create-entry', 0.4)
    randomizer.setOperationWeight('list-entries', 0.3)
    randomizer.setOperationWeight('list-assets', 0.2)
    randomizer.setOperationWeight('get-content-types', 0.1)
    log.debug('Weighted strategy: create (40%), list-entries (30%), list-assets (20%), get-ct (10%)')
  }

  if (strategy === 'clustered') {
    log.debug('Clustered strategy: related operations grouped together')
  }

  // Phase 4: Run operations
  log.info('Phase 4: Running operations with smart randomization...')

  for (let i = 0; i < operationCount; i++) {
    // Select operation and user
    const selectedOpName = randomizer.selectNextOperation()
    const selectedUser = randomizer.selectNextUser()

    const operation = operations.find((o) => o.name === selectedOpName)
    if (!operation) {
      log.warn(`Operation not found: ${selectedOpName}`)
      continue
    }

    const assignment = randomizer.assignOperationToUser(operation, selectedUser)

    // Execute operation
    try {
      log.debug(`Executing ${assignment.operation} with ${assignment.user.split('@')[0]}`)

      await operation.handler(selectedUser, {
        contentTypeUid,
      })

      randomizer.recordResult(assignment, true)
      log.debug(`✓ ${assignment.operation} succeeded`)
    } catch (e) {
      randomizer.recordResult(assignment, false, { error: e.message })
      log.warn(`✗ ${assignment.operation} failed: ${e.message}`)
    }

    // Progress indicator
    if ((i + 1) % 10 === 0) {
      log.info(`Progress: ${i + 1}/${operationCount} operations`)
    }

    // Delay between operations
    if (i < operationCount - 1) {
      await sleep(200)
    }
  }

  // Phase 5: Generate report
  log.info('Phase 5: Generating report...')
  const summary = randomizer.getSummary()

  log.info('=== SUMMARY ===')
  log.info(`Strategy: ${summary.strategy}`)
  log.info(`Total Operations: ${summary.total_operations}`)
  log.info(`Successful: ${summary.total_successes}`)
  log.info(`Failed: ${summary.total_failures}`)
  log.info(`Success Rate: ${summary.success_rate}`)

  log.info('=== Per-User Breakdown ===')
  summary.users.forEach((user) => {
    log.info(`${user.user}: ${user.count} ops (${user.successes} successful, ${user.failures} failed) - ${user.success_rate}`)
  })

  log.info('=== Per-Operation Breakdown ===')
  summary.operations.forEach((op) => {
    log.info(`${op.operation}: ${op.count} ops (${op.successes} successful, ${op.user_count} different users) - ${op.success_rate}`)
  })

  // Phase 6: Write report
  const report = {
    mode: 'smart-randomization',
    strategy,
    timestamp: new Date().toISOString(),
    configuration: {
      users: userCount,
      operations: operationCount,
    },
    results: summary,
  }

  await writeStepReport('automate-smart-randomization.json', report)
  log.info('Report written to step-reports/automate-smart-randomization.json')
}

// Run
main().catch((err) => {
  log.error('Automation failed', { error: err.message })
  process.exit(1)
})
