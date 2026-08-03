#!/usr/bin/env node
/**
 * top-url-entries.mjs — the "top URL" content track, TOKEN-ONLY.
 *
 * Ensures the `top_url_lines` content type exists, creates + publishes a batch
 * of entries on it, then reads them back over the Delivery API to prove the
 * site can actually see them.
 *
 * Auth: stack API key + MANAGEMENT TOKEN (writes) and DELIVERY TOKEN (read-back).
 * It deliberately uses NOTHING from the CONTENTSTACK_USER_* family — no email,
 * no password, no TOTP, no authtoken. Every call here is one a management token
 * is allowed to make, which is why this track keeps working when the user-session
 * pipeline (workflow transitions, stack creation, org invites) is broken or
 * unconfigured. Do not add a user-session call to this file — put it in the
 * drive-all track instead.
 *
 * Run: npm run automate:top-url:entries   (or via npm run automate:top-url)
 *
 * Env (required): CONTENTSTACK_API_KEY | VITE_CONTENTSTACK_API_KEY,
 *   CONTENTSTACK_MANAGEMENT_TOKEN, CONTENTSTACK_PUBLISH_ENVIRONMENT |
 *   VITE_CONTENTSTACK_ENVIRONMENT
 * Env (optional): CONTENTSTACK_MANAGEMENT_HOST, CONTENTSTACK_BRANCH,
 *   CONTENTSTACK_LOCALE, TOP_URL_CONTENT_TYPE_UID (default top_url_lines),
 *   TOP_URL_ENTRY_COUNT (default 5), TOP_URL_SKIP_DELIVERY_VERIFY=true,
 *   VITE_CONTENTSTACK_DELIVERY_HOST, VITE_CONTENTSTACK_DELIVERY_TOKEN
 */

import process from 'node:process'
import {
  loadStackAuth,
  managementHeaders,
  optionalEnv,
  defaultTitleOnlySchema,
  ensureContentTypeExists,
  createContentType,
  getContentType,
  createEntry,
  publishEntry,
  listEnvironments,
  findEnvironmentUidByName,
  sleep,
} from './lib/cma.mjs'
import { writeStepReport } from './lib/report.mjs'

const CT_UID = optionalEnv('TOP_URL_CONTENT_TYPE_UID', 'top_url_lines')
const CT_TITLE = 'Top URL Lines'

/** Candidate paths the generated "top URL" rows point at. */
const SAMPLE_PATHS = [
  '/',
  '/news',
  '/news/technology',
  '/news/business',
  '/news/sports',
  '/search',
  '/authors',
  '/runs',
  '/entry/demo_plain_text',
  '/news/world',
]

/**
 * Schema for the top-URL content type: title (the app's display field) plus the
 * three columns a "top URL" row actually needs. Kept flat and optional so the
 * generated payload never trips a mandatory-field 422.
 */
function topUrlSchema() {
  return [
    ...defaultTitleOnlySchema(),
    {
      data_type: 'text',
      display_name: 'URL',
      uid: 'url',
      field_metadata: { description: '', default_value: '' },
      mandatory: false,
      multiple: false,
      unique: false,
      non_localizable: false,
    },
    {
      data_type: 'number',
      display_name: 'Rank',
      uid: 'rank',
      field_metadata: { description: '', default_value: '' },
      mandatory: false,
      multiple: false,
      unique: false,
      non_localizable: false,
    },
    {
      data_type: 'number',
      display_name: 'Hits',
      uid: 'hits',
      field_metadata: { description: '', default_value: '' },
      mandatory: false,
      multiple: false,
      unique: false,
      non_localizable: false,
    },
    {
      data_type: 'isodate',
      display_name: 'Captured At',
      uid: 'captured_at',
      field_metadata: { description: '', default_value: '' },
      startDate: null,
      endDate: null,
      mandatory: false,
      multiple: false,
      unique: false,
      non_localizable: false,
    },
  ]
}

function intEnv(name, fallback) {
  const raw = optionalEnv(name)
  if (!/^\d+$/.test(raw)) return fallback
  const n = Number.parseInt(raw, 10)
  return n > 0 ? n : fallback
}

/**
 * The CT may already exist on this stack with a narrower schema (e.g. created by
 * an older run as title-only). Send only fields the live schema actually has, so
 * we degrade to "title only" instead of failing with "unknown field".
 */
function fieldUidsOf(contentType) {
  const schema = Array.isArray(contentType?.schema) ? contentType.schema : []
  return new Set(schema.map((f) => f?.uid).filter(Boolean))
}

function buildRow(index, runStamp, isoNow) {
  const path = SAMPLE_PATHS[index % SAMPLE_PATHS.length]
  const rank = index + 1
  return {
    title: `top url #${rank} ${path} — ${runStamp}`,
    url: path,
    rank,
    // Deterministic-ish descending hit counts so the list reads like a ranking.
    hits: 10_000 - rank * 137,
    captured_at: isoNow,
  }
}

async function deliveryVerify({ apiKey, publishEnv, branch, entryUids }) {
  const host = optionalEnv('VITE_CONTENTSTACK_DELIVERY_HOST').replace(/\/$/, '')
  const token = optionalEnv('VITE_CONTENTSTACK_DELIVERY_TOKEN')
  if (!host || !token) {
    console.log(
      'delivery verify: skipped — set VITE_CONTENTSTACK_DELIVERY_HOST and VITE_CONTENTSTACK_DELIVERY_TOKEN to prove the site can read these entries.',
    )
    return { skipped: true, found: 0 }
  }

  const headers = { api_key: apiKey, access_token: token }
  if (branch) headers.branch = branch

  // Check each UID against the single-entry endpoint rather than scanning the
  // entries list. The list endpoint returns one default-ordered page (100), so
  // once a content type has more than that, freshly published entries need not
  // appear on page 1 — which reported a false "0/5 visible" in CI even though
  // all five had published successfully.
  const detailUrl = (uid) => {
    const u = new URL(`${host}/v3/content_types/${CT_UID}/entries/${uid}`)
    if (publishEnv) u.searchParams.set('environment', publishEnv)
    return u
  }

  const pending = new Set(entryUids)
  const total = pending.size
  // Publishing is asynchronous on the CDN side, so poll rather than assert on
  // the first pass. ~30s total is enough in practice for a handful of entries.
  for (let attempt = 1; attempt <= 6; attempt++) {
    for (const uid of [...pending]) {
      const res = await fetch(detailUrl(uid), { headers })
      if (res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body?.entry?.uid) pending.delete(uid)
      }
    }
    const found = total - pending.size
    console.log(
      `delivery verify: attempt ${attempt} — ${found}/${total} of this run's entries live on "${publishEnv}"`,
    )
    if (pending.size === 0) return { skipped: false, found, total }
    if (attempt === 6) {
      console.warn(
        `delivery verify: ${pending.size} entry(s) not visible yet — publishing is async, so this can be propagation lag rather than a failure.`,
      )
      return { skipped: false, found, total }
    }
    await sleep(5000)
  }
  return { skipped: false, found: 0, total }
}

async function main() {
  // publishEnv is reassigned by the preflight below when the preferred value
  // turns out not to exist on this stack.
  let { apiKey, token, base, branch, locale, publishEnv } = loadStackAuth()
  const headers = managementHeaders(apiKey, token, branch)
  const count = intEnv('TOP_URL_ENTRY_COUNT', 5)

  console.log(
    `top-url-entries: ${CT_UID} × ${count} → ${base} (branch ${branch || 'default'}, locale ${locale}, publish "${publishEnv}")`,
  )

  // ── 0. Preflight: resolve a publish target that exists on THIS stack ──────
  // Entries are the scarce resource (the org sits at its cap), so the publish
  // target is validated BEFORE anything is created.
  //
  // loadStackAuth() prefers CONTENTSTACK_PUBLISH_ENVIRONMENT over
  // VITE_CONTENTSTACK_ENVIRONMENT. In GitHub Actions a repository-level secret
  // is visible to every environment job, so an instance that sets only
  // VITE_CONTENTSTACK_ENVIRONMENT still inherits the repo-level
  // CONTENTSTACK_PUBLISH_ENVIRONMENT — which names an environment on a
  // DIFFERENT stack. Actions expressions cannot tell repo-level from
  // environment-level secrets, so this cannot be fixed in the workflow YAML.
  //
  // Observed on the "ssss dev22" instance: content type created, 5 entries
  // created, then 5 × HTTP 401 "Environment doesn't exist or insufficient
  // permission to access it" — 5 unreclaimable entries on a capped org.
  //
  // So try each candidate in preference order and take the first that actually
  // exists here, rather than trusting the first one blindly.
  const envCandidates = [
    ...new Set(
      [
        optionalEnv('CONTENTSTACK_PUBLISH_ENVIRONMENT'),
        optionalEnv('VITE_CONTENTSTACK_ENVIRONMENT'),
      ].filter(Boolean),
    ),
  ]

  let resolvedEnv = null
  let resolvedEnvUid = null
  for (const candidate of envCandidates) {
    const uid = await findEnvironmentUidByName(base, headers, candidate)
    if (uid) {
      resolvedEnv = candidate
      resolvedEnvUid = uid
      break
    }
    console.warn(`  publish environment "${candidate}" not found on this stack`)
  }

  if (!resolvedEnv) {
    const list = await listEnvironments(base, headers)
    const names = (list.body?.environments ?? []).map((e) => e.name).filter(Boolean)
    console.error(
      `No usable publish environment — tried ${envCandidates.map((c) => `"${c}"`).join(', ') || '(none set)'}. Nothing was created.`,
    )
    if (list.ok) {
      console.error(
        names.length
          ? `  Environments this token CAN see: ${names.join(', ')}`
          : '  This token can see no environments at all.',
      )
      console.error(
        '  Set CONTENTSTACK_PUBLISH_ENVIRONMENT on this GitHub Environment to one of the above.\n' +
          "  If the list looks like another stack's, the management token and API key are mismatched.\n" +
          '  If the list is empty, the token scope excludes every environment\n' +
          '  (Settings → Tokens → Management Tokens — scope is per environment).',
      )
    } else {
      console.error(`  Could not list environments (HTTP ${list.status}).`)
    }
    writeStepReport({
      planned: count,
      actual: 0,
      failed: count,
      kpis: { publishEnvironmentValid: 0 },
      errors: [
        { label: envCandidates.join(',') || '(unset)', message: 'no publish environment exists on this stack' },
      ],
    })
    process.exit(1)
  }

  if (resolvedEnv !== publishEnv) {
    console.warn(
      `  note: falling back to "${resolvedEnv}" — "${publishEnv}" does not exist on this stack.\n` +
        '  That is usually a repository-level CONTENTSTACK_PUBLISH_ENVIRONMENT secret shadowing this\n' +
        "  instance's own value. Set CONTENTSTACK_PUBLISH_ENVIRONMENT at the environment level to silence this.",
    )
  }
  publishEnv = resolvedEnv
  console.log(`✓ publish environment "${publishEnv}" resolved (${resolvedEnvUid})`)

  // ── 1. Ensure the content type ────────────────────────────────────────────
  const existing = await getContentType(base, headers, CT_UID)
  const preExisted = Boolean(existing.ok && existing.body?.content_type)
  const ct = await ensureContentTypeExists(base, headers, CT_UID, {
    title: CT_TITLE,
    schema: topUrlSchema(),
  })
  if (!ct) {
    // ensureContentTypeExists swallows the API error, so re-issue the create to
    // report why. The common cause is error_code 133 (org content-type quota),
    // which is a Track 2 problem leaking into Track 1: no-workflow-ct.mjs mints a
    // fresh `no_wf_*` content type every run and never removes one, so the org
    // eventually has no slot left for anything — including this track.
    const probe = await createContentType(base, headers, {
      uid: CT_UID,
      title: CT_TITLE,
      schema: topUrlSchema(),
    })
    const apiMsg = probe.body?.error_message ?? `HTTP ${probe.status}`
    const apiCode = probe.body?.error_code
    console.error(`Could not find or create content type "${CT_UID}": ${apiMsg}`)
    if (apiCode === 133) {
      console.error(
        'This is the organization content-type limit, not a permissions problem.\n' +
          '  Reclaim slots:  npm run automate:prune-cts           (dry run — lists what it would delete)\n' +
          '                  npm run automate:prune-cts -- --yes  (actually delete)\n' +
          `  Or point this track at a content type that already exists:\n` +
          '                  TOP_URL_CONTENT_TYPE_UID=<existing_uid> npm run automate:top-url',
      )
    } else {
      console.error(
        'Check that the management token has content-type write scope on this stack.',
      )
    }
    writeStepReport({
      planned: count,
      actual: 0,
      failed: count,
      kpis: { contentTypeReady: 0 },
      errors: [{ label: CT_UID, message: 'content type missing and not creatable' }],
    })
    process.exit(1)
  }
  console.log(
    preExisted
      ? `✓ content type ${CT_UID} already present`
      : `✓ created content type ${CT_UID}`,
  )

  const allowed = fieldUidsOf(ct)
  if (!allowed.has('url')) {
    console.log(
      `note: existing ${CT_UID} schema has no "url" field — writing the fields it does have only.`,
    )
  }

  // ── 2. Create + publish the rows ──────────────────────────────────────────
  const runStamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const isoNow = new Date().toISOString()
  const createdUids = []
  const errors = []
  let published = 0

  for (let i = 0; i < count; i++) {
    const row = buildRow(i, runStamp, isoNow)
    const fields = Object.fromEntries(
      Object.entries(row).filter(([k]) => allowed.has(k)),
    )

    const created = await createEntry(base, headers, CT_UID, fields, locale)
    const entryUid = created.body?.entry?.uid
    if (!created.ok || !entryUid) {
      errors.push({
        label: row.title,
        message: `create → ${created.status} ${JSON.stringify(created.body?.errors ?? created.body?.error_message ?? '').slice(0, 200)}`,
      })
      console.warn(`✗ create ${i + 1}/${count} failed (HTTP ${created.status})`)
      continue
    }
    createdUids.push(String(entryUid))

    const pub = await publishEntry(base, headers, CT_UID, entryUid, locale, publishEnv)
    if (!pub.ok) {
      errors.push({
        label: entryUid,
        message: `publish → ${pub.status} ${JSON.stringify(pub.body?.errors ?? pub.body?.error_message ?? '').slice(0, 200)}`,
      })
      console.warn(`✗ publish ${entryUid} failed (HTTP ${pub.status})`)
      // An auth failure is a configuration problem, not a per-entry one: it will
      // fail identically for every remaining row. Stop rather than spend more of
      // a capped entry quota on entries that provably cannot be published.
      if (pub.status === 401 || pub.status === 403) {
        console.error(
          `Aborting after ${i + 1}/${count}: publishing to "${publishEnv}" is unauthorized, so the remaining rows would be created but never published.`,
        )
        break
      }
      continue
    }
    published += 1
    console.log(`✓ ${i + 1}/${count} ${entryUid} — ${row.title}`)
  }

  // ── 3. Read back over the Delivery API (what the site actually calls) ─────
  let verify = { skipped: true, found: 0 }
  if (optionalEnv('TOP_URL_SKIP_DELIVERY_VERIFY') === 'true') {
    console.log('delivery verify: skipped via TOP_URL_SKIP_DELIVERY_VERIFY=true')
  } else if (published > 0) {
    verify = await deliveryVerify({ apiKey, publishEnv, branch, entryUids: createdUids })
  }

  writeStepReport({
    planned: count,
    actual: published,
    failed: count - published,
    kpis: {
      contentTypeReady: 1,
      contentTypeCreated: preExisted ? 0 : 1,
      entriesCreated: createdUids.length,
      entriesPublished: published,
      deliveryVerified: verify.skipped ? 0 : verify.found,
    },
    errors,
  })

  console.log(
    `\ntop-url-entries: created ${createdUids.length}/${count}, published ${published}/${count}` +
      (verify.skipped ? '' : `, delivery-visible ${verify.found}/${createdUids.length}`),
  )

  // Non-zero only if nothing landed — a partial batch still warms the site.
  if (published === 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
