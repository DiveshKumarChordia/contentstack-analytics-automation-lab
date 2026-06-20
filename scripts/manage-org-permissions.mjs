#!/usr/bin/env node
/**
 * manage-org-permissions.mjs — update organization user roles and permissions.
 *
 * This script manages org-level user access:
 *   - List organization users and their current roles
 *   - Invite new users with specific roles
 *   - Promote users to admin/higher roles
 *   - Downgrade users to member role
 *   - Remove users from organization
 *   - Check user permissions
 *
 * Usage (must set CONTENTSTACK_ORG_UID):
 *   node --env-file=.env scripts/manage-org-permissions.mjs list-users
 *   node --env-file=.env scripts/manage-org-permissions.mjs list-roles
 *   node --env-file=.env scripts/manage-org-permissions.mjs promote <userUid>
 *   node --env-file=.env scripts/manage-org-permissions.mjs demote <userUid>
 *   node --env-file=.env scripts/manage-org-permissions.mjs remove <userUid>
 */

import {
  loadStackAuth,
  managementHeaders,
  listOrganizationRoles,
  listOrganizationUsers,
  inviteUserToOrganization,
  updateUserOrganizationRoles,
  removeUserFromOrganization,
  promoteUserToAdmin,
  downgradeUserToMember,
  userHasRole,
  optionalEnv,
  sleep,
} from './lib/cma.mjs'
import { writeStepReport } from './lib/report.mjs'

const { apiKey, base, token } = loadStackAuth()
const headers = managementHeaders(apiKey, token)

async function main() {
  const command = process.argv[2]
  const orgUid = optionalEnv('CONTENTSTACK_ORG_UID')

  if (!orgUid) {
    console.error('Missing CONTENTSTACK_ORG_UID environment variable')
    process.exit(1)
  }

  const report = {
    command,
    timestamp: new Date().toISOString(),
    orgUid,
    results: null,
    error: null,
  }

  try {
    switch (command) {
      case 'list-users':
        report.results = await cmdListUsers(orgUid)
        break
      case 'list-roles':
        report.results = await cmdListRoles(orgUid)
        break
      case 'promote':
        report.results = await cmdPromote(orgUid, process.argv[3])
        break
      case 'demote':
        report.results = await cmdDemote(orgUid, process.argv[3])
        break
      case 'remove':
        report.results = await cmdRemove(orgUid, process.argv[3])
        break
      case 'invite':
        report.results = await cmdInvite(orgUid, process.argv[3], process.argv[4])
        break
      case 'check-role':
        report.results = await cmdCheckRole(orgUid, process.argv[3], process.argv[4])
        break
      default:
        console.log(`
Usage:
  manage-org-permissions list-users          List all org users + roles
  manage-org-permissions list-roles          List all org roles
  manage-org-permissions promote <userUid>   Promote user to admin
  manage-org-permissions demote <userUid>    Demote user to member
  manage-org-permissions remove <userUid>    Remove user from org
  manage-org-permissions invite <email> <roleUid>   Invite user with role
  manage-org-permissions check-role <userUid> <roleName>   Check if user has role
        `)
        process.exit(0)
    }

    console.log(JSON.stringify(report, null, 2))
    await writeStepReport('manage-org-permissions', report)
  } catch (err) {
    report.error = err.message
    console.error(JSON.stringify(report, null, 2))
    await writeStepReport('manage-org-permissions', report)
    process.exit(1)
  }
}

async function cmdListUsers(orgUid) {
  console.log(`📋 Fetching organization users for ${orgUid}...`)
  const { ok, body } = await listOrganizationUsers(base, headers, orgUid, { limit: 100 })

  if (!ok) {
    throw new Error(`Failed to list users: ${body.message || body.error || 'unknown error'}`)
  }

  const users = body?.data || []
  console.log(`✅ Found ${users.length} users`)

  // Fetch roles for role name mapping
  const { ok: rOk, body: rBody } = await listOrganizationRoles(base, headers, orgUid)
  const roleMap = {}
  if (rOk && Array.isArray(rBody?.roles)) {
    rBody.roles.forEach((r) => {
      roleMap[r.uid] = { name: r.name, domain: r.domain }
    })
  }

  const result = users.map((u) => ({
    uid: u.uid,
    email: u.email,
    user_uid: u.user_uid,
    org_roles: (u.org_roles || []).map((rid) => roleMap[rid]?.name || rid),
    status: u.status,
  }))

  console.table(result)
  return result
}

async function cmdListRoles(orgUid) {
  console.log(`📋 Fetching organization roles for ${orgUid}...`)
  const { ok, body } = await listOrganizationRoles(base, headers, orgUid)

  if (!ok) {
    throw new Error(`Failed to list roles: ${body.message || 'unknown error'}`)
  }

  const roles = body?.roles || []
  console.log(`✅ Found ${roles.length} roles`)

  const result = roles.map((r) => ({
    uid: r.uid,
    name: r.name,
    domain: r.domain,
    admin: r.admin ?? false,
    user_count: (r.users || []).length,
  }))

  console.table(result)
  return result
}

async function cmdPromote(orgUid, userUid) {
  if (!userUid) throw new Error('Usage: promote <userUid>')
  console.log(`⬆️  Promoting user ${userUid} to admin...`)
  const ok = await promoteUserToAdmin(base, headers, orgUid, userUid)
  if (!ok) throw new Error('Failed to promote user')
  console.log('✅ User promoted to admin')
  return { promoted: true, userUid }
}

async function cmdDemote(orgUid, userUid) {
  if (!userUid) throw new Error('Usage: demote <userUid>')
  console.log(`⬇️  Demoting user ${userUid} to member...`)
  const ok = await downgradeUserToMember(base, headers, orgUid, userUid)
  if (!ok) throw new Error('Failed to demote user')
  console.log('✅ User demoted to member')
  return { demoted: true, userUid }
}

async function cmdRemove(orgUid, userUid) {
  if (!userUid) throw new Error('Usage: remove <userUid>')
  console.log(`🗑️  Removing user ${userUid} from organization...`)
  const { ok } = await removeUserFromOrganization(base, headers, orgUid, userUid)
  if (!ok) throw new Error('Failed to remove user')
  console.log('✅ User removed from organization')
  return { removed: true, userUid }
}

async function cmdInvite(orgUid, email, roleUid) {
  if (!email || !roleUid) throw new Error('Usage: invite <email> <roleUid>')
  console.log(`📧 Inviting ${email} with role ${roleUid}...`)
  const { ok, body } = await inviteUserToOrganization(base, headers, orgUid, {
    emails: [email],
    roles: { [email]: [roleUid] },
  })
  if (!ok) throw new Error(`Failed to invite: ${body.message || 'unknown error'}`)
  console.log(`✅ User ${email} invited`)
  return { invited: true, email, roleUid }
}

async function cmdCheckRole(orgUid, userUid, roleName) {
  if (!userUid || !roleName) throw new Error('Usage: check-role <userUid> <roleName>')
  console.log(`🔍 Checking if user ${userUid} has role ${roleName}...`)
  const hasRole = await userHasRole(base, headers, orgUid, userUid, roleName)
  console.log(`${hasRole ? '✅' : '❌'} User ${hasRole ? 'has' : 'does not have'} role ${roleName}`)
  return { hasRole, userUid, roleName }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
