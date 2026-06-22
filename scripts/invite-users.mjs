#!/usr/bin/env node
/**
 * invite-users.mjs — invite N new users to the organization via API.
 *
 * Uses the org-admin API to directly invite users instead of Playwright UI automation.
 * Still requires user email+password (for user session auth, just like Playwright did),
 * but replaces brittle UI with direct API calls.
 * Invitations auto-accept if users are already active, otherwise stay pending.
 * Assigns both org-level member role and stack-level CMS role.
 *
 * Auth: requires CONTENTSTACK_USER_EMAIL + CONTENTSTACK_USER_PASSWORD
 *   (+ CONTENTSTACK_USER_TOTP_SECRET for 2FA users)
 *   Optional: CONTENTSTACK_USER_AUTHTOKEN (use instead of email+password)
 *
 * Env knobs:
 *   CONTENTSTACK_INVITE_COUNT        — users to invite per run (default 10)
 *   CONTENTSTACK_INVITE_EMAIL_DOMAIN — domain for generated emails (default test.contentstack.com)
 *   CONTENTSTACK_ORG_UID             — organization UID (auto-derived from user if not set)
 *
 * Usage:
 *   node --env-file=.env scripts/invite-users.mjs
 */

import { randomBytes } from 'node:crypto'
import {
  optionalEnv,
  loadStackAuth,
  managementHeaders,
  loadManagementTokens,
  headersForToken,
  tryLoadUserSessionHeaders,
  ensureUserHasCMSRole,
  getCurrentUser,
  listOrganizationRoles,
  inviteUserToOrganization,
  sleep,
} from './lib/cma.mjs'
import { writeStepReport } from './lib/report.mjs'
import { StructuredLogger } from './lib/structured-logger.mjs'
import { OperationMetrics } from './lib/operation-metrics.mjs'
import { CircuitBreakerManager } from './lib/circuit-breaker.mjs'
import { RetryableOperation } from './lib/retry-strategy.mjs'

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

function generateUniqueEmail(domain) {
  const timestamp = Date.now().toString(36)
  const random = randomBytes(3).toString('hex')
  return `invite-${timestamp}-${random}@${domain}`
}

async function getUserOrgUid(base, headers) {
  const { ok, body } = await getCurrentUser(base, headers)
  if (!ok) return null
  const user = body?.user
  return user?.org_uid?.[0] || user?.shared_org_uid?.[0] || null
}

async function getOrgMemberRoleUid(base, headers, orgUid) {
  const { ok, body } = await listOrganizationRoles(base, headers, orgUid)
  if (!ok || !Array.isArray(body?.roles)) return null
  const memberRole = body.roles.find((r) => r.domain === 'organization' && r.name === 'member')
  return memberRole?.uid || null
}

async function inviteUsersViaAPI(base, headers, orgUid, count, emailDomain, logger, metrics, cbManager) {
  const invited = []
  const failed = []

  // Get member role for org level
  const memberRoleUid = await getOrgMemberRoleUid(base, headers, orgUid)
  if (!memberRoleUid) {
    throw new Error('Could not find org member role')
  }

  for (let i = 0; i < count; i += 1) {
    const email = generateUniqueEmail(emailDomain)
    console.log(`Inviting user ${i + 1}/${count}: ${email}`)

    // Use RetryableOperation for smart retry on transient errors
    const inviteOp = new RetryableOperation(
      `invite:${email}:${i}`,
      async () => {
        const result = await cbManager.executeWithBreaker(
          'inviteUser',
          async () => {
            return await inviteUserToOrganization(base, headers, orgUid, {
              emails: [email],
              roles: { [email]: [memberRoleUid] },
            })
          },
          { failureThreshold: 10, timeout: 30000 },
        )
        return result
      },
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        logger,
        metrics,
      },
    )

    try {
      const result = await inviteOp.execute()
      const { ok, body } = result.result

      if (!ok) {
        throw new Error(body?.message || body?.error || 'unknown error')
      }

      invited.push(email)
      metrics.recordOperation('user:invite', 'invite', 0, true, { email })
      logger.info(`User invited successfully`, { email, index: i })
      console.log(`  ✓ invited to org`)

      // Brief pause between invites
      await sleep(300)
    } catch (e) {
      metrics.recordOperation('user:invite', 'invite', 0, false, { email, error: e.message })
      logger.error(`Failed to invite user`, e, { email, index: i })
      console.error(`  ✗ Failed to invite ${email}: ${e.message}`)
      failed.push({ email, error: e.message })
    }
  }

  return { invited, failed }
}

async function main() {
  const logger = new StructuredLogger('invite-users')
  const metrics = new OperationMetrics()
  const cbManager = new CircuitBreakerManager({ logger, metrics })

  logger.info('Script started', {
    apiKey: process.env.CONTENTSTACK_API_KEY?.slice(0, 10) + '…',
  })

  const count = intEnv('CONTENTSTACK_INVITE_COUNT', 10)
  const emailDomain = optionalEnv('CONTENTSTACK_INVITE_EMAIL_DOMAIN', 'test.contentstack.com')

  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmtHeaders = headersForToken(apiKey, tokens[0], branch)

  // Get user session headers (needed for org API calls)
  console.log('Loading user session...')
  const userHeaders = await tryLoadUserSessionHeaders(base, apiKey, branch)
  if (!userHeaders) {
    throw new Error(
      'Could not load user session. Set CONTENTSTACK_USER_EMAIL + CONTENTSTACK_USER_PASSWORD\n' +
      '(+ CONTENTSTACK_USER_TOTP_SECRET for 2FA), or CONTENTSTACK_USER_AUTHTOKEN.'
    )
  }

  // Get org UID from env or derive from user
  let orgUid = optionalEnv('CONTENTSTACK_ORG_UID')
  if (!orgUid) {
    console.log('CONTENTSTACK_ORG_UID not set, deriving from user...')
    orgUid = await getUserOrgUid(base, userHeaders)
    if (!orgUid) {
      throw new Error('Could not determine organization UID from user')
    }
    console.log(`  Using org UID: ${orgUid}`)
  }

  console.log('invite-users (API)')
  console.log(`  plan: ${count} users`)
  console.log(`  domain: ${emailDomain}`)
  console.log(`  org: ${orgUid}`)

  try {
    const { invited, failed } = await inviteUsersViaAPI(base, userHeaders, orgUid, count, emailDomain, logger, metrics, cbManager)

    console.log(`\n✓ invited ${invited.length}/${count} users to organization`)
    if (failed.length > 0) {
      console.log(`  ${failed.length} failed:`)
      for (const { email, error } of failed) {
        console.log(`    ${email}: ${error}`)
      }
    }

    // Auto-assign CMS roles to invited users
    let rolesAssigned = 0
    if (invited.length > 0) {
      console.log(`\n🔐 assigning stack CMS roles to invited users...`)

      for (const invitedEmail of invited) {
        try {
          const success = await ensureUserHasCMSRole(base, userHeaders, mgmtHeaders, invitedEmail)
          if (success) {
            rolesAssigned += 1
            metrics.recordOperation('user:assign-role', 'assign-role', 0, true, { email: invitedEmail })
            logger.info(`CMS role assigned`, { email: invitedEmail })
            console.log(`  ✓ ${invitedEmail}`)
          } else {
            metrics.recordOperation('user:assign-role', 'assign-role', 0, false, { email: invitedEmail })
            logger.warn(`Failed to assign CMS role`, { email: invitedEmail })
            console.log(`  ⚠ ${invitedEmail} (manual CMS role assignment may be needed)`)
          }
        } catch (error) {
          metrics.recordOperation('user:assign-role', 'assign-role', 0, false, { email: invitedEmail, error: error.message })
          logger.error(`Error assigning CMS role`, error, { email: invitedEmail })
          console.log(`  ⚠ ${invitedEmail} (error: ${error.message})`)
        }
        await sleep(200)
      }

      console.log(`  ${rolesAssigned}/${invited.length} CMS roles assigned`)
    }

    const metricsSummary = metrics.getSummary()
    const cbStatus = cbManager.getAllStatuses()

    logger.info('Script completed successfully', {
      invited: invited.length,
      failed: failed.length,
      rolesAssigned,
      metricsSummary: {
        operationCount: metricsSummary.operations.count,
        operationSuccess: metricsSummary.operations.success,
        operationFailure: metricsSummary.operations.failed,
      },
      circuitBreakerStatus: cbStatus,
    })

    writeStepReport({
      planned: count,
      actual: invited.length,
      failed: failed.length,
      logTrail: logger.getLogTrail().slice(0, 5000),
      kpis: {
        invited: invited.length,
        failed: failed.length,
        rolesAssigned,
        operationMetrics: {
          totalOperations: metricsSummary.operations.count,
          successRate: metricsSummary.operations.successRate,
          avgDurationMs: metricsSummary.operations.avgMs,
        },
      },
    })
  } catch (e) {
    logger.error('Script failed', e, { fatal: true })
    console.error(`invite-users failed: ${e.message}`)
    writeStepReport({
      planned: count,
      actual: 0,
      failed: count,
      kpis: { invited: 0, failed: count },
    })
    process.exit(1)
  }
}

main().catch((err) => {
  const logger = new StructuredLogger('invite-users')
  logger.error('Script failed', err, { fatal: true })
  console.error('invite-users failed:', err)
  process.exit(1)
})
