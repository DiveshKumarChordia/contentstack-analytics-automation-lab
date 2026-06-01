/**
 * Create + publish entries only (no content types). For cron / GitHub Actions every N minutes.
 * Run: npm run automate:entries:periodic
 */

import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  loadStackAuth,
  managementHeaders,
  createAndPublishEntry,
  getLatestEntryUid,
  getFirstEntryUid,
  sleep,
  optionalEnv,
} from './lib/cma.mjs'
import {
  EntryUidRegistry,
  resolveEntryPlaceholdersAsync,
  deepClone,
} from './lib/entry-placeholders.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function loadManifest(manifestPath) {
  const raw = await readFile(manifestPath, 'utf8')
  const data = JSON.parse(raw)
  if (!data.contentTypes || !Array.isArray(data.contentTypes)) {
    throw new Error('Manifest must contain a contentTypes array')
  }
  return data
}

function uniqueTitle() {
  const iso = new Date().toISOString().replace(/[:.]/g, '-')
  const rnd = randomBytes(3).toString('hex')
  return `auto ${iso} ${rnd}`
}

function defaultPeriodicCount(manifest) {
  const fromEnv = optionalEnv('CONTENTSTACK_PERIODIC_COUNT')
  if (fromEnv && /^\d+$/.test(fromEnv)) return Number.parseInt(fromEnv, 10)
  if (
    manifest.defaults &&
    typeof manifest.defaults.periodicCount === 'number'
  ) {
    return manifest.defaults.periodicCount
  }
  return 1
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

  console.log('Periodic entries — manifest:', manifestPath)
  const manifest = await loadManifest(manifestPath)
  const globalDefaultCount = defaultPeriodicCount(manifest)

  const registry = new EntryUidRegistry()

  async function fetchRef(ctUid, which) {
    if (which === 'latest') {
      return getLatestEntryUid(base, headers, ctUid, locale, publishEnv)
    }
    return getFirstEntryUid(base, headers, ctUid, locale, publishEnv)
  }

  let ran = 0
  for (const ct of manifest.contentTypes) {
    const p = ct.periodic
    if (!p || !p.enabled) continue
    ran += 1

    const count =
      typeof p.count === 'number' ? p.count : globalDefaultCount

    const templateSource =
      p.entryTemplate ??
      (Array.isArray(ct.entries) && ct.entries.length > 0
        ? ct.entries[ct.entries.length - 1]
        : null)

    if (!templateSource) {
      console.warn(
        `Skipping periodic for ${ct.uid}: set periodic.entryTemplate or seed entries[]`,
      )
      continue
    }

    for (let i = 0; i < count; i += 1) {
      const merged = deepClone(templateSource)
      merged.title = uniqueTitle()
      const fields = await resolveEntryPlaceholdersAsync(
        merged,
        registry,
        fetchRef,
      )

      const result = await createAndPublishEntry(
        base,
        headers,
        ct.uid,
        fields,
        locale,
        publishEnv,
      )
      await sleep(300)
      if (!result.ok) {
        // Org-level entry cap (error_code 133): plan limit, not a script bug.
        // Stop adding more for this content type but exit 0 so the
        // orchestrator's downstream steps (publishing, workflow transitions)
        // still run on existing entries.
        if (result.status === 422 && result.body?.error_code === 133) {
          console.warn(
            `Org entry cap reached for ${ct.uid} — skipping remaining periodic entries (code 133, non-fatal).`,
          )
          break
        }
        console.error(
          `Periodic entry failed for ${ct.uid} (${result.step}):`,
          result.status,
          result.body,
        )
        process.exit(1)
      }
      registry.record(ct.uid, result.entryUid)
      console.log(
        'Periodic: created + published',
        result.entryUid,
        'in',
        ct.uid,
      )
    }
  }

  if (ran === 0) {
    console.log(
      'No content types with periodic.enabled; set periodic in the manifest or use automate:manifest for bootstrap.',
    )
  }

  console.log('Periodic run complete.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
