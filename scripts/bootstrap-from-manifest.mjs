/**
 * Create content types (if missing) and create + publish entries from a JSON manifest.
 * Run: npm run automate:manifest
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  loadStackAuth,
  managementHeaders,
  defaultTitleOnlySchema,
  contentTypeExists,
  createContentType,
  createAndPublishEntry,
  listEntries,
  sleep,
} from './lib/cma.mjs'
import { expandFields } from './lib/schema-from-fields.mjs'
import { EntryUidRegistry, resolveEntryPlaceholders } from './lib/entry-placeholders.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function loadManifest(manifestPath) {
  const raw = await readFile(manifestPath, 'utf8')
  const data = JSON.parse(raw)
  if (!data.contentTypes || !Array.isArray(data.contentTypes)) {
    throw new Error('Manifest must contain a contentTypes array')
  }
  return data
}

function resolveSchema(ct) {
  if (Array.isArray(ct.schema) && ct.schema.length > 0) {
    return ct.schema
  }
  if (ct.useDefaultTitleSchema) {
    const titlePart = defaultTitleOnlySchema()
    if (Array.isArray(ct.fields) && ct.fields.length > 0) {
      return [...titlePart, ...expandFields(ct.fields)]
    }
    return titlePart
  }
  throw new Error(
    `Content type "${ct.uid}": set useDefaultTitleSchema: true (optionally with fields[]), fields[] with useDefaultTitleSchema, or provide schema[]`,
  )
}

function isDuplicateTitleError(body) {
  const errs = body?.errors
  if (!errs || typeof errs !== 'object') return false
  const titleErr = errs.title
  if (!Array.isArray(titleErr)) return false
  return titleErr.some(
    (m) =>
      typeof m === 'string' &&
      (m.includes('unique') || m.includes('not unique')),
  )
}

async function hydrateRegistryFromStack(
  base,
  headers,
  contentTypeUid,
  locale,
  registry,
) {
  const { ok, body } = await listEntries(base, headers, contentTypeUid, {
    locale,
    limit: 100,
    asc: 'created_at',
  })
  if (!ok || !Array.isArray(body.entries)) return
  for (const e of body.entries) {
    if (e?.uid) registry.record(contentTypeUid, e.uid)
  }
}

async function main() {
  const { apiKey, token, base, branch, locale, publishEnv } = loadStackAuth()
  const headers = managementHeaders(apiKey, token, branch)

  const manifestRelative =
    process.env.CONTENTSTACK_MANIFEST_PATH ||
    path.join(__dirname, 'content-types.manifest.json')
  const manifestPath = path.isAbsolute(manifestRelative)
    ? manifestRelative
    : path.resolve(process.cwd(), manifestRelative)

  console.log('Manifest:', manifestPath)
  const manifest = await loadManifest(manifestPath)
  const { contentTypes } = manifest
  const skipSeedEntries =
    manifest.skipSeedEntries === true ||
    process.env.CONTENTSTACK_MANIFEST_SKIP_SEEDS === 'true'
  const skipDup =
    process.env.CONTENTSTACK_MANIFEST_SKIP_DUPLICATE_SEEDS !== 'false' &&
    manifest.skipDuplicateSeedTitles !== false

  if (skipSeedEntries) {
    console.log(
      'skipSeedEntries: only content types are ensured; seed entries in the manifest are skipped.',
    )
  }

  const registry = new EntryUidRegistry()

  for (const ct of contentTypes) {
    if (ct.periodicOnly) {
      console.log('Skipping content type (periodic only):', ct.uid)
      continue
    }
    if (!ct.uid || !ct.title) {
      console.error('Each content type needs uid and title:', ct)
      process.exit(1)
    }
    const schema = resolveSchema(ct)
    const exists = await contentTypeExists(base, headers, ct.uid)
    await sleep(200)
    if (!exists) {
      const created = await createContentType(base, headers, {
        uid: ct.uid,
        title: ct.title,
        schema,
      })
      await sleep(300)
      if (!created.ok) {
        console.error(
          `Failed to create content type ${ct.uid}:`,
          created.status,
          created.body,
        )
        process.exit(1)
      }
      console.log('Created content type', ct.uid)
    } else {
      console.log('Content type already exists, skipping create:', ct.uid)
    }

    if (skipSeedEntries) {
      continue
    }

    const entries = Array.isArray(ct.entries) ? ct.entries : []
    for (const rawFields of entries) {
      const fields = resolveEntryPlaceholders(rawFields, registry)
      const result = await createAndPublishEntry(
        base,
        headers,
        ct.uid,
        fields,
        locale,
        publishEnv,
      )
      await sleep(250)
      if (!result.ok) {
        const dup =
          result.status === 422 &&
          skipDup &&
          result.body &&
          isDuplicateTitleError(result.body)
        if (dup) {
          console.warn(
            `Skipping seed for ${ct.uid} (title already exists). Hydrating registry from stack.`,
          )
          await hydrateRegistryFromStack(
            base,
            headers,
            ct.uid,
            locale,
            registry,
          )
          await sleep(200)
          continue
        }
        // Org-level entry cap (error_code 133, "Max entries limit reached for
        // your organization") is plan-level — not actionable from this script
        // and not a code defect. Log and continue so the rest of the pipeline
        // (workflows, publishing, transitions) still operates on existing
        // entries. Hydrate the registry so __REF__ resolution still works.
        if (result.status === 422 && result.body?.error_code === 133) {
          console.warn(
            `Org entry cap reached — skipping new seed for ${ct.uid} (code 133, non-fatal). Continuing with existing entries.`,
          )
          await hydrateRegistryFromStack(
            base,
            headers,
            ct.uid,
            locale,
            registry,
          )
          await sleep(200)
          continue
        }
        console.error(
          `Entry failed for ${ct.uid} (${result.step}):`,
          result.status,
          result.body,
        )
        process.exit(1)
      }
      registry.record(ct.uid, result.entryUid)
      console.log('Created + published entry', result.entryUid, 'in', ct.uid)
    }
  }

  console.log(
    'Done. Set VITE_CONTENTSTACK_CONTENT_TYPE_UIDS in .env and Launch to list these UIDs (comma-separated).',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
