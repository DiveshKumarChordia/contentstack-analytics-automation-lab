#!/usr/bin/env node
/**
 * seed-publishing-rules.mjs
 *
 * Reads each workflow's `publishingRules[]` block from
 * scripts/workflows.manifest.json and creates a publishing rule on the stack
 * for each one. Idempotent — rules whose (workflow_uid, workflow_stage,
 * environment, content_types) tuple already exists are skipped.
 *
 * Why: drives the `entries_publish_rules` snapshot meter that powers the
 * Workflow Health → "Entries with Publishing Rules" KPI. Without rules,
 * that KPI is always zero regardless of workflow + entry activity.
 *
 * A publishing rule says: "when entry is at stage S of workflow W (in any
 * of these content types, on any of these branches), once approved by the
 * configured approvers, auto-publish to environment E."
 *
 * Token: stack-level CONTENTSTACK_MANAGEMENT_TOKEN.
 *
 * Usage:
 *   node --env-file=.env scripts/seed-publishing-rules.mjs
 *   node --env-file=.env scripts/seed-publishing-rules.mjs --dry-run
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadStackAuth,
  loadManagementTokens,
  headersForToken,
  listWorkflows,
  findWorkflowByName,
  listPublishingRules,
  createPublishingRule,
  findEnvironmentUidByName,
  optionalEnv,
} from './lib/cma.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')

function fmtCmaError(body) {
  if (!body || typeof body !== 'object') return String(body)
  const parts = []
  if (body.error_message) parts.push(body.error_message)
  if (body.error_code != null) parts.push(`code=${body.error_code}`)
  if (body.errors) parts.push(`errors=${JSON.stringify(body.errors)}`)
  if (parts.length === 0) parts.push(JSON.stringify(body).slice(0, 300))
  return parts.join('  ')
}

/**
 * Build a stable "signature" for a publishing rule so we can dedupe against
 * what's already on the stack without comparing full objects field-by-field.
 * Used only for idempotency.
 */
function ruleSignature({ workflow, workflow_stage, environment, content_types }) {
  const cts = [...(content_types || [])].sort().join(',')
  return `${workflow}::${workflow_stage}::${environment}::${cts}`
}

async function main() {
  const { apiKey, base, branch, publishEnv, locale } = loadStackAuth()
  const tokens = loadManagementTokens()
  const headers = headersForToken(apiKey, tokens[0], branch)

  const manifestPath =
    optionalEnv('CONTENTSTACK_WORKFLOWS_MANIFEST_PATH') ||
    resolve(__dirname, 'workflows.manifest.json')

  // Default locales for rules that don't specify any. The schema marks
  // locales optional but cma-api's validator returns code 338 ("Locales
  // not specified") on empty/missing — so we always send at least the
  // stack's primary locale.
  const defaultRuleLocales = (
    optionalEnv('CONTENTSTACK_PUBLISHING_RULE_LOCALES') || locale
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Publishing rules require the environment UID, not the name. Bulk publish
  // accepts both — this endpoint does not. Resolve once upfront so all
  // rules share the lookup.
  const defaultEnvUid = await findEnvironmentUidByName(base, headers, publishEnv)
  if (!defaultEnvUid) {
    console.error(`  ✗ could not resolve environment "${publishEnv}" to a UID — does it exist on the stack?`)
    process.exit(1)
  }

  console.log(`seed-publishing-rules`)
  console.log(`  stack:    api_key=${apiKey.slice(0, 10)}…  branch=${branch || '(none)'}`)
  console.log(`  env:      ${publishEnv}  (uid=${defaultEnvUid})`)
  console.log(`  locales:  ${defaultRuleLocales.join(', ')}  (default when rule omits 'locales')`)
  console.log(`  manifest: ${manifestPath}`)
  if (DRY_RUN) console.log('** DRY RUN — no API writes **')

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const workflows = manifest.workflows || []

  // Fetch existing rules once so we can dedupe across the whole pass.
  const { ok: lOk, body: lBody } = await listPublishingRules(base, headers, { limit: 100 })
  const existing = new Set()
  if (lOk && Array.isArray(lBody?.publishing_rules)) {
    for (const r of lBody.publishing_rules) {
      existing.add(
        ruleSignature({
          workflow: r.workflow,
          workflow_stage: r.workflow_stage,
          environment: r.environment,
          content_types: r.content_types,
        }),
      )
    }
    console.log(`  existing rules on stack: ${lBody.publishing_rules.length}`)
  } else {
    console.warn(`  ⚠ listPublishingRules failed — proceeding without dedupe`)
  }

  let created = 0
  let skipped = 0
  let failed = 0

  for (const wfManifest of workflows) {
    const rules = wfManifest.publishingRules || []
    if (rules.length === 0) continue

    // Resolve the workflow object (need its UID + stage UIDs).
    const wf = await findWorkflowByName(base, headers, wfManifest.name)
    if (!wf) {
      console.warn(`  workflow "${wfManifest.name}" not found on stack — skipping its rules`)
      continue
    }
    const stageByName = new Map(wf.workflow_stages.map((s) => [s.name, s]))
    console.log(`\n• ${wfManifest.name} — ${rules.length} rule(s)`)

    for (const r of rules) {
      // Resolve the stage by name (manifest uses names for readability).
      const stage = stageByName.get(r.stage)
      if (!stage) {
        console.warn(`    ⚠ stage "${r.stage}" not in workflow — skipping`)
        skipped++
        continue
      }
      // r.environment can be either a name or a UID. If it's a name, resolve.
      let env = r.environment || defaultEnvUid
      if (env && !env.startsWith('blt')) {
        // Treat as a name needing resolution.
        const resolvedUid = await findEnvironmentUidByName(base, headers, env)
        if (resolvedUid) env = resolvedUid
      }
      const cts = r.contentTypes || wfManifest.contentTypes
      const branches = r.branches || wfManifest.branches || ['main']
      const approvers = r.approvers || { users: [], roles: [] }
      const locales = r.locales || defaultRuleLocales

      const sig = ruleSignature({
        workflow: wf.uid,
        workflow_stage: stage.uid,
        environment: env,
        content_types: cts,
      })
      if (existing.has(sig)) {
        console.log(`    [skip] rule for stage "${r.stage}" → env "${env}" already exists`)
        skipped++
        continue
      }
      if (DRY_RUN) {
        console.log(`    [dry-run] CREATE rule  stage="${r.stage}"  env="${env}"  cts=[${cts.join(', ')}]`)
        created++
        continue
      }

      const { ok, status, body } = await createPublishingRule(base, headers, {
        workflow: wf.uid,
        workflow_stage: stage.uid,
        content_types: cts,
        environment: env,
        branches,
        approvers,
        locales,
      })
      if (ok) {
        console.log(`    ✓ created rule for stage "${r.stage}" → env "${env}" (uid=${body?.publishing_rule?.uid})`)
        created++
        existing.add(sig)
      } else {
        console.error(`    ✗ create rule failed (${status}): ${fmtCmaError(body)}`)
        failed++
      }
    }
  }

  console.log(`\n✓ done — ${created} created, ${skipped} skipped, ${failed} failed`)
  // soft-fail philosophy — exit 0 unless EVERY attempt failed (caller can
  // inspect counts via summary line above).
  if (failed > 0 && created === 0 && skipped === 0) process.exit(1)
}

main().catch((err) => {
  console.error('seed-publishing-rules failed:', err)
  process.exit(1)
})
