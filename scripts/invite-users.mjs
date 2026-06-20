#!/usr/bin/env node
/**
 * invite-users.mjs — use Playwright to invite N new users to the org via org-admin UI.
 *
 * For each run, generates unique email addresses, navigates the org-admin portal,
 * and invites them. Invitations auto-accept if users are already active, otherwise
 * stay pending. Either way, the invitation event drives metering.
 *
 * Auth: uses CONTENTSTACK_USER_EMAIL + _PASSWORD (user session, same as transitions).
 * Invites are recorded in org_invitations Mongo collection and fire
 * organization.upsertUsers Redis events (auto-accept) or stay pending until accepted.
 *
 * Env knobs:
 *   CONTENTSTACK_INVITE_COUNT              — users to invite per run (default 10)
 *   CONTENTSTACK_INVITE_EMAIL_DOMAIN      — domain for generated emails (default test.contentstack.com)
 *   CONTENTSTACK_PLAYWRIGHT_HEADLESS      — headless browser (default true)
 *   CONTENTSTACK_PLAYWRIGHT_TIMEOUT_MS    — action timeout (default 30000)
 *
 * Usage:
 *   node --env-file=.env scripts/invite-users.mjs
 */

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  optionalEnv,
  tryLoadUserSessionHeaders,
  ensureUserHasCMSRole,
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listStackRoles,
  shareStack,
} from './lib/cma.mjs'
import { writeStepReport } from './lib/report.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function intEnv(name, dflt) {
  const v = optionalEnv(name)
  return v && /^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : dflt
}

function boolEnv(name, dflt) {
  const v = optionalEnv(name)
  if (v === 'false') return false
  if (v === 'true') return true
  return dflt
}

function generateUniqueEmail(domain) {
  const timestamp = Date.now().toString(36)
  const random = randomBytes(3).toString('hex')
  return `invite-${timestamp}-${random}@${domain}`
}

async function inviteUsersViaUI(browser, orgAdminUrl, count, emailDomain, timeout) {
  const context = await browser.newContext()
  const page = await context.newPage()

  const invited = []
  const failed = []

  try {
    // Navigate to org-admin
    console.log(`Navigating to ${orgAdminUrl}`)
    await page.goto(orgAdminUrl, { waitUntil: 'networkidle', timeout })

    // Wait for the org-admin to load (generic: wait for any org-admin heading)
    await page.waitForSelector('[data-test-id="cs-orgadmin-users"], h1, h2', { timeout })

    // Navigate to Users section if needed
    const usersButton = page.locator('[data-test-id="cs-orgadmin-users"]')
    if (await usersButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Clicking Users section')
      await usersButton.click({ timeout })
      await page.waitForLoadState('networkidle')
    }

    // Click "Invite User" button
    const inviteButton = page.locator('[data-test-id="cs-org-invite-new-user"]')
    console.log('Waiting for Invite User button')
    await inviteButton.waitFor({ state: 'visible', timeout })
    await inviteButton.click({ timeout })

    // Wait for invite dialog to appear
    const emailInput = page.locator('[data-test-id="cs-users-email-input"]')
    await emailInput.waitFor({ state: 'visible', timeout })

    // Invite N users
    for (let i = 0; i < count; i += 1) {
      const email = generateUniqueEmail(emailDomain)
      console.log(`Inviting user ${i + 1}/${count}: ${email}`)

      try {
        // Clear the email input and type the new email
        await emailInput.fill('', { timeout })
        await emailInput.type(email, { delay: 50 })

        // Wait for the email to be recognized (pill/tag might appear)
        await page.waitForTimeout(500) // brief pause for UI to register

        // Click the "Invite User" button (in the modal)
        const submitButton = page.locator('[data-test-id="cs-org-invite-user"]')
        await submitButton.waitFor({ state: 'visible', timeout: 5000 })
        await submitButton.click({ timeout })

        // Wait for success (reload, navigate, or modal close)
        try {
          await page.waitForNavigation({ timeout: 5000 }).catch(() => null)
        } catch {
          // ignore navigation timeout; check visually
        }

        // Brief pause before next invite
        await page.waitForTimeout(1000)

        invited.push(email)
        console.log(`  ✓ invited ${email}`)

        // Re-open invite dialog for next user (click button again)
        if (i < count - 1) {
          const inviteButtonAgain = page.locator('[data-test-id="cs-org-invite-new-user"]')
          try {
            await inviteButtonAgain.click({ timeout: 5000 })
            const emailInputAgain = page.locator('[data-test-id="cs-users-email-input"]')
            await emailInputAgain.waitFor({ state: 'visible', timeout: 5000 })
          } catch (e) {
            console.warn(`  ⚠ Could not re-open invite dialog for user ${i + 2}: ${e.message}`)
            break // stop trying to invite more
          }
        }
      } catch (e) {
        console.error(`  ✗ Failed to invite ${email}: ${e.message}`)
        failed.push({ email, error: e.message })
      }
    }
  } catch (e) {
    console.error(`Navigation/setup failed: ${e.message}`)
  } finally {
    await context.close()
  }

  return { invited, failed }
}

async function main() {
  const email = optionalEnv('CONTENTSTACK_USER_EMAIL')
  const password = optionalEnv('CONTENTSTACK_USER_PASSWORD')
  const orgAdminUrl = optionalEnv('CONTENTSTACK_ORG_ADMIN_URL') || 'https://app.contentstack.com/organization'
  const count = intEnv('CONTENTSTACK_INVITE_COUNT', 10)
  const emailDomain = optionalEnv('CONTENTSTACK_INVITE_EMAIL_DOMAIN', 'test.contentstack.com')
  const headless = boolEnv('CONTENTSTACK_PLAYWRIGHT_HEADLESS', true)
  const timeout = intEnv('CONTENTSTACK_PLAYWRIGHT_TIMEOUT_MS', 30000)

  if (!email || !password) {
    console.error('Missing CONTENTSTACK_USER_EMAIL or CONTENTSTACK_USER_PASSWORD')
    writeStepReport({
      planned: count,
      actual: 0,
      failed: count,
      kpis: { invited: 0 },
    })
    process.exit(1)
  }

  console.log('invite-users')
  console.log(`  org-admin-url: ${orgAdminUrl}`)
  console.log(`  plan: ${count} users`)
  console.log(`  domain: ${emailDomain}`)
  console.log(`  headless: ${headless}`)

  // Load stack info for CMS role assignment
  const { apiKey, base, branch } = loadStackAuth()
  const tokens = loadManagementTokens()
  const mgmtHeaders = headersForToken(apiKey, tokens[0], branch)

  let browser
  try {
    browser = await chromium.launch({ headless })
    const { invited, failed } = await inviteUsersViaUI(browser, orgAdminUrl, count, emailDomain, timeout)

    console.log(`\n✓ invited ${invited.length}/${count} users`)
    if (failed.length > 0) {
      console.log(`  ${failed.length} failed:`)
      for (const { email, error } of failed) {
        console.log(`    ${email}: ${error}`)
      }
    }

    // Auto-assign CMS roles to invited users
    if (invited.length > 0) {
      console.log(`\n🔐 assigning CMS roles to invited users...`)
      const userHeaders = await tryLoadUserSessionHeaders(base, apiKey, branch)
      let rolesAssigned = 0

      for (const invitedEmail of invited) {
        const success = await ensureUserHasCMSRole(base, userHeaders, mgmtHeaders, invitedEmail)
        if (success) {
          rolesAssigned += 1
          console.log(`  ✓ ${invitedEmail}`)
        } else {
          console.log(`  ⚠ ${invitedEmail} (manual role assignment may be needed)`)
        }
      }

      console.log(`  ${rolesAssigned}/${invited.length} CMS roles assigned`)
    }

    writeStepReport({
      planned: count,
      actual: invited.length,
      failed: failed.length,
      kpis: { invited: invited.length, failed: failed.length, rolesAssigned: invited.length },
    })
  } catch (e) {
    console.error(`invite-users failed: ${e.message}`)
    writeStepReport({
      planned: count,
      actual: 0,
      failed: count,
      kpis: { invited: 0, failed: count },
    })
    process.exit(1)
  } finally {
    if (browser) await browser.close()
  }
}

main()
