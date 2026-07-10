# Contentstack automation

## Overview

### Original scripts (content types + entries)

- **`npm run automate:manifest`** — Creates content types from [`scripts/content-types.manifest.json`](scripts/content-types.manifest.json) (if missing) and runs **seed** `entries`. Resolves `__REF__` and `__TAX_TERMS__` placeholders; records entry UIDs in memory in manifest order.
- **`npm run automate:entries:periodic`** — **Does not** create content types. For each `contentTypes[]` item with `periodic.enabled`, creates `count` new entries (default **1**) from `periodic.entryTemplate` or the last seed entry, with a **unique** `title`. Resolves `__REF__` via the Management API (`first` / `latest` entry per referenced type).
- **`npm run warm:launch-urls`** — Lists entries via the Delivery API, then **GET**s each corresponding Launch URL.

### New scripts (workflows, locales, branches, bulk publish)

These extend coverage to the metering events the cma-api emits, so the downstream analytics dashboards (Workflow Health, Content Lifecycle, Team Adoption) get realistic data.

- **`npm run automate:workflows`** — Reads [`scripts/workflows.manifest.json`](scripts/workflows.manifest.json). Creates workflows on the stack (idempotent — skips by name match), then drives entry stage transitions according to the manifest's `transitionPolicy`. Each transition emits an `entry_workflow_stage_added` (first time) or `entry_workflow_stage_updated` (subsequent) meter event.
- **`npm run automate:locales-branches`** — Reads [`scripts/locales-branches.manifest.json`](scripts/locales-branches.manifest.json). Creates locales (`POST /v3/locales`) and branches (`POST /v3/stacks/branches`, async; polls until ready). Both idempotent — already-present items are skipped. Flags: `--dry-run`, `--only locales`, `--only branches`.
- **`npm run automate:bulk-publish`** — Picks N random entries from the configured content types and bulk-publishes via `POST /v3/bulk/publish`, then bulk-unpublishes a smaller subset via `POST /v3/bulk/unpublish`. Drives `entry_published` / `entry_unpublished` meters that feed the Content Lifecycle dashboard's Created-vs-Published chart. Sample sizes and target locales/environments are env-tunable (see `.env.example`).
- **`npm run automate:delete`** — Deletes entries older than N days (default 7) across the configured content types, with a per-run cap (default 50) and a keep-newest floor per content type (default 10). Drives `entry_deleted` meter events and keeps the org-level entry cap from blocking new creates. Runs first in `automate:drive --mode periodic`.
- **`npm run automate:localize`** — For each content type, picks the newest N entries (default 10) in the master locale and creates localized versions in `fr-fr`, `de-de`, `en-gb` (configurable). Drives `entry_created` events keyed by the target locale — the only way to give the dashboard's Locale filter axis real variation. Idempotent — entries already localized are skipped via `GET /entries/{uid}/locales`. Runs in `automate:drive --mode periodic` between create and bulk-publish.
- **`npm run automate:locale-experiments`** — Destructive scenario runner that creates fallback chains, populates entries, then deletes locales in declared orders to test cma-api's behavior. Drives `entries_orphaned_by_locale_deleted` meter events. NEVER runs in the periodic cron — gated behind `CONTENTSTACK_RUN_LOCALE_EXPERIMENTS=1`. Scenarios declared in [`scripts/locale-experiments.manifest.json`](scripts/locale-experiments.manifest.json): leaf delete, middle-of-chain delete, recreate-after-delete, fallback-first delete. Flags: `--dry-run`, `--only <scenario-id>`.

### Meter Consistency Test Matrix (dedicated stack per case)

- **`npm run automate:meter-matrix`** — Reads the 46-row Meter Consistency Test Matrix baked into [`scripts/meter-consistency-matrix.mjs`](scripts/meter-consistency-matrix.mjs), and for **every row creates a brand-new stack** (`POST /v3/stacks`), provisions exactly what that scenario needs (content type, a second branch/locale/environment, a workflow), then drives the row's specific create/publish/delete/workflow actions inside it. One case per stack, every run creates fresh stacks — even re-running the same case again never reuses a prior one. This gives the analytics team a clean, uncontaminated stack to point each meter-consistency check at.
  - `--list` — print the matrix without calling any API.
  - `--only entries_created,entries_deleted` — restrict to one or more categories.
  - `--case entries_published:5` — run a single row.
  - `--limit 3` — cap how many selected cases actually run (smoke test).
  - Auth: same fully-automated user-session chain as `automate:workflows` (`CONTENTSTACK_USER_AUTHTOKEN`, or `CONTENTSTACK_USER_EMAIL`/`CONTENTSTACK_USER_PASSWORD`/`CONTENTSTACK_USER_TOTP_SECRET`) — stack creation requires a **user** authtoken, since management tokens are minted per-stack, after the stack already exists. Organization UID is auto-derived from the logged-in user; set `CONTENTSTACK_ORG_UID` to override.
  - Output: `step-reports/meter-consistency-matrix.json` (latest run snapshot: every case's stack name/api_key/ok/detail) and `step-reports/meter-consistency-matrix-history.jsonl` (append-only, one line per case ever run).
  - A handful of rows describe a time-window boundary condition ("outside range") that CMA can't backdate into existence — those still seed the entry for real and carry a `note` in the report explaining that the assertion is validated by re-querying with a narrower window, not by the seed step itself. Two more rows describe an internal `_workflow.uid: null`/`""` anomaly that isn't reachable through the public CMA — those seed the closest real equivalent (never transitioned) and are flagged with a `note` too.

### Orchestrator

- **`npm run automate:drive`** — Single-entry orchestrator over all of the above. Runs each step as a child process so a single flaky step doesn't abort the cron. Three modes:
  - `--mode periodic` (default): delete-old → create → bulk publish/unpublish → workflow transitions. Safe to call every 5 minutes via cron.
  - `--mode bootstrap`: content-types → locales+branches → workflows (creation only). Idempotent setup; use on a fresh stack.
  - `--mode full`: bootstrap then periodic in one go.

  Shortcuts: `npm run automate:drive:bootstrap`, `npm run automate:drive:full`.

### How to set up 2FA-enabled user-session auth (for workflow transitions)

When `CONTENTSTACK_USER_TOTP_SECRET` is set, the seeder computes the rotating
6-digit code at runtime using RFC 6238 — same algorithm Google Authenticator,
Authy, and 1Password use. No npm dependencies are added; we use Node's
built-in `crypto`.

To obtain the secret:

1. Log in to the Contentstack web UI and open **User Settings → Security → Two-Factor Authentication**.
2. **Disable** 2FA if currently enabled.
3. **Re-enable** 2FA. When the QR code appears, click **"Can't scan? Enter manually"** (or **"Show key"** — wording varies). This reveals the base32 secret — looks like `JBSWY3DPEHPK3PXP`, 16–32 chars, only `A–Z` and `2–7`.
4. **Copy that secret** somewhere safe BEFORE completing the setup. Add it to your `.env` as:
   ```
   CONTENTSTACK_USER_TOTP_SECRET=JBSWY3DPEHPK3PXP
   ```
5. Continue 2FA setup as usual (enter the current code into Contentstack to verify, and also add the secret to your authenticator app so day-to-day login still works).

**Alternative if you don't want to reset 2FA:** if you set up Contentstack 2FA via 1Password or Authy, those apps let you reveal the setup key:

- **1Password**: open the entry → click the eye icon next to "One-Time Password" → look for "Setup key" in the details
- **Authy**: long-press the Contentstack entry → "Show key"

Either of those gives you the same base32 secret without resetting on Contentstack.

**Don't have or want the TOTP secret?** Use the long-lived authtoken path instead — log in once via the UI, copy the `authtoken` cookie from DevTools, paste into `CONTENTSTACK_USER_AUTHTOKEN`. Refresh manually every few weeks when it expires.

### Auth split — what each scope can do

**Important:** Contentstack uses two distinct auth modes, and certain operations only work with one of them.

| Operation | Mgmt token | User authtoken | Notes |
|---|:---:|:---:|---|
| Content types CRUD | ✅ | ✅ | `automate:manifest` uses mgmt token |
| Entries CRUD (create / update / delete / publish / unpublish) | ✅ | ✅ | `automate:entry`, `automate:bulk-publish`, `automate:delete` |
| Locales CRUD | ✅ | ✅ | `automate:locales-branches` |
| Branches CRUD | ✅* | ✅ | * Plan-gated. If the stack's plan/token lacks Branches, you'll see a 401 — the seeder logs a warning and continues. |
| Workflows: **create / read / update workflow definitions** | ✅ | ✅ | `automate:workflows` create phase uses mgmt token |
| Workflows: **change an entry's stage** (transit) | ❌ | ✅ | Mgmt tokens are explicitly forbidden from stage changes per Contentstack docs. The transition phase logs in via `CONTENTSTACK_USER_EMAIL` + `CONTENTSTACK_USER_PASSWORD` (POST `/v3/user-session`) and uses the resulting authtoken. If those creds aren't set, the transition phase is skipped with a warning. |
| Entry Locking on workflow stages | plan-gated | plan-gated | `entry_lock` is silently omitted by the seeder unless explicitly opted in via the manifest. Stacks without the "Workflow Stage Entry Locking" plan feature return code 337 even when sending `entry_lock:'none'`. |

Requires **Node.js 20+** (`node --env-file=.env`).

## Manifest

- **`useDefaultTitleSchema: true`** — Adds the standard unique `title` text field, then any **`fields[]`** expanded to real CMA schema ([shorthand module](scripts/lib/schema-from-fields.mjs)).
- **`schema[]`** — If set, used as-is (full override); no automatic title field unless included.
- **Order** — Referenced content types must appear **before** types that use `__REF__:their_uid:first|latest`.
- **`periodic`** — Optional block:
  - `enabled: true`
  - **`count`** — optional **number**. If set (e.g. `1`), it **overrides** both **`CONTENTSTACK_PERIODIC_COUNT`** and **`defaults.periodicCount`**. Omit `count` to use env (*highest priority among globals*), then `defaults.periodicCount`, then `1`.
  - `entryTemplate` — optional; falls back to last item in `entries[]`.
- **`periodicOnly: true`** — Skipped by `automate:manifest` bootstrap (types created elsewhere).

### Shorthand `fields` (`data_type`)

Supported shorthand: `text`, `textarea`, `markdown` (emitted as CMA `text` + `field_metadata.markdown`), `number`, `boolean`, `date` (emitted as CMA `isodate`), `link`, `file`, `json_rte` / `json`, `rich_text`, `reference`, `group`, `blocks`, `taxonomy` (see env below).

Unsupported or stack-specific shapes: use full **`schema[]`** on the content type.

### Placeholders (seed entries)

| Pattern | Meaning |
|---------|---------|
| `__REF__:<content_type_uid>:first` | First entry UID recorded for that type in this bootstrap run |
| `__REF__:<content_type_uid>:latest` | Latest entry UID in this run |
| `__TAX_TERMS__:<field_uid>` | Expands to term UIDs from env `CONTENTSTACK_TAXONOMY_TERMS_<FIELDUID>` (uppercase, non-alphanumerics → `_`), comma-separated |

### Taxonomy fields

For each taxonomy field `uid` (e.g. `categories`):

- `CONTENTSTACK_TAXONOMY_UID_CATEGORIES` — taxonomy definition UID in the stack, **or** set a single `CONTENTSTACK_TAXONOMY_UID` if one taxonomy applies to all shorthand fields.
- `CONTENTSTACK_TAXONOMY_TERMS_CATEGORIES` — comma-separated **term** UIDs for seed/periodic payloads using `__TAX_TERMS__:categories`.

### Environment variables (scripts)

Variables you **do not use** can be omitted. **`Recommended`** rows should match your stack even though the scripts supply fallbacks. **`Optional`** rows are for specific features only (e.g. taxonomy env when you have no taxonomy fields).

**Required** (any `npm run automate:*` that talks to the CMA):

| Variable | Purpose |
|----------|---------|
| `CONTENTSTACK_MANAGEMENT_TOKEN` | Management token |
| `VITE_CONTENTSTACK_API_KEY` or `CONTENTSTACK_API_KEY` | Stack API key |
| `VITE_CONTENTSTACK_ENVIRONMENT` or `CONTENTSTACK_PUBLISH_ENVIRONMENT` | Publish target + environment filters |

**Recommended** (not validated as “missing” by the scripts, but you should set them for your stack; defaults only match some stacks):

| Variable | Purpose |
|----------|---------|
| `CONTENTSTACK_MANAGEMENT_HOST` | CMA base for your region; see [`scripts/lib/cma.mjs`](scripts/lib/cma.mjs) (`https://api.contentstack.io` if unset) |
| `CONTENTSTACK_BRANCH` | Branch uid (`main`, etc.); if unset, no `branch` header is sent |
| `CONTENTSTACK_LOCALE` | Entry locale; defaults to `en-us` if unset |

**Optional** (feature toggles / only when needed):

| Variable | Purpose |
|----------|---------|
| `CONTENTSTACK_MANIFEST_PATH` | Override path to manifest JSON |
| `CONTENTSTACK_PERIODIC_COUNT` | Entries per `periodic.enabled` type per run when manifest **`periodic.count` is omitted** |
| `CONTENTSTACK_MANIFEST_SKIP_SEEDS` | `true`: bootstrap without seed POSTs (see manifest `skipSeedEntries`) |
| `CONTENTSTACK_MANIFEST_SKIP_DUPLICATE_SEEDS` | Not `false`: skip duplicate seed titles and hydrate refs (see **Idempotency**) |
| `CONTENTSTACK_AUTO_ENTRY_TITLE` | **`automate:entry`** title override |
| `CONTENTSTACK_TAXONOMY_UID_*` / `CONTENTSTACK_TAXONOMY_TERMS_*` | Taxonomy shorthand / `__TAX_TERMS__` only (see **Taxonomy fields**) |
| `CONTENTSTACK_MANAGEMENT_TOKENS` | **Plural**, comma-separated. Round-robin across multiple management tokens (one per user) so the metering pipeline sees multiple `user_uid`s. Fallback: single `CONTENTSTACK_MANAGEMENT_TOKEN`. |
| `CONTENTSTACK_WORKFLOWS_MANIFEST_PATH` | Override path for `seed-workflows.mjs` |
| `CONTENTSTACK_LOCALES_BRANCHES_MANIFEST_PATH` | Override path for `seed-locales-branches.mjs` |
| `CONTENTSTACK_BULK_PUBLISH_CONTENT_TYPES` | CSV. Scope `bulk-publish-cycle.mjs` to these content types (else derived from content-types manifest) |
| `CONTENTSTACK_BULK_PUBLISH_SAMPLE` / `CONTENTSTACK_BULK_UNPUBLISH_SAMPLE` | Entries to publish / unpublish per `bulk-publish-cycle.mjs` run (defaults 10 / 2) |
| `CONTENTSTACK_BULK_PUBLISH_LOCALES` / `CONTENTSTACK_BULK_PUBLISH_ENVIRONMENTS` | CSV overrides for bulk-publish target locales / environments |

## Extended manifests (workflows, locales, branches)

### `scripts/workflows.manifest.json`

```json
{
  "workflows": [
    {
      "name": "Editorial Review",
      "enabled": true,
      "contentTypes": ["demo_plain_text"],
      "stages": [
        { "name": "Draft",     "color": "#9c27b0", "next": ["In Review"] },
        { "name": "In Review", "color": "#ff9800", "next": ["Approved", "Draft"] },
        { "name": "Approved",  "color": "#4caf50", "next": ["$all"] }
      ]
    }
  ],
  "transitionPolicy": {
    "enabled": true,
    "perEntryMaxStages": 4,
    "distribution": { "finish": 0.5, "stallMiddle": 0.3, "firstOnly": 0.2 }
  }
}
```

- **`stages[].uid`** — Optional; auto-derived from `name` as a slug if omitted.
- **`stages[].next`** — Array of stage names or `"$all"`. The seeder resolves names to UIDs before posting.
- **`transitionPolicy.distribution`** — How the seeder buckets existing entries:
  - `finish` → walk through all stages to terminal (multi-transit; lots of audit log entries)
  - `stallMiddle` → stop at a middle stage (drives "Stalled by Stage" KPI)
  - `firstOnly` → assign first stage only (emits `entry_workflow_stage_added` but no `_updated`)
- **`perEntryMaxStages`** — Cap on transitions per entry to avoid excessive API calls.

### `scripts/locales-branches.manifest.json`

```json
{
  "locales": [
    { "code": "en-gb", "name": "English - UK", "fallbackLocale": "en-us" }
  ],
  "branches": [
    { "uid": "develop", "source": "main" }
  ]
}
```

- Both arrays are independent — empty either to skip that step.
- `fallbackLocale` must already exist on the stack at the time the new locale is created.
- Branch creation is **async**. The seeder polls `listBranches` for up to 90s before declaring success.

## Front-end / Launch

**Optional:** set **`VITE_CONTENTSTACK_CONTENT_TYPE_UIDS`** to a comma-separated list of types to list; if **omitted**, the app defaults to **`top_url_lines`** only. Mirror the same in **Launch** when you use it.

## GitHub Actions (every 5 minutes, UTC)

Workflow: [`.github/workflows/contentstack-periodic-entries.yml`](.github/workflows/contentstack-periodic-entries.yml).

The workflow runs **`npm run automate:entries:periodic:ci`** (no `--env-file=.env`; the runner has no `.env` file). Locally use **`npm run automate:entries:periodic`** with a `.env` file.

### Multi-instance (recommended): GitHub Environments + matrix

Each **instance** is one Contentstack automation target (any combination of org, stack, publish environment, CDN host, Launch URL). The workflow uses a **matrix** over [GitHub Environment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) names so the **same secret names** can hold **different values** per instance—no `ORG1_CONTENTSTACK_API_KEY` prefixes.

**Supported shapes** (examples):

1. Two stacks on the **same** delivery CDN host — delivery host may match; stack API key, delivery token, management token, and publish environment uid still differ per instance where needed.
2. Same Contentstack **org**, two **stacks** — two environments; keys and tokens differ per stack.
3. Same **stack**, two **publish environments** — two environments; publish/environment uid differs; Launch URL and warm-up per env; CMA/delivery credentials may or may not match.
4. **Different CDNs** — set `VITE_CONTENTSTACK_DELIVERY_HOST` and `CONTENTSTACK_MANAGEMENT_HOST` per instance as required.

**Setup**

1. **Repository variable** **`CONTENTSTACK_PERIODIC_ENVIRONMENTS_JSON`** — JSON array of environment names, e.g. `["contentstack-dev22","contentstack-prod"]`. If omitted, the workflow defaults to `["default"]` (create a GitHub Environment named **`default`** with your secrets, or set this variable).
2. Under **Settings → Environments**, create **one environment per name** in that array.
3. On **each** environment, add **secrets** (same keys, instance-specific values):

| Secret | Purpose |
|--------|---------|
| **`CONTENTSTACK_MANAGEMENT_TOKEN`** | Required for CMA |
| **`CONTENTSTACK_API_KEY`** or **`VITE_CONTENTSTACK_API_KEY`** | Stack API key (at least one) |
| **`CONTENTSTACK_PUBLISH_ENVIRONMENT`** or **`VITE_CONTENTSTACK_ENVIRONMENT`** | Publish target uid |
| **`LAUNCH_SITE_URL`** | Public site URL for warm-up GET (if unset, that GET is skipped with a notice) |

**Optional** on each environment: `CONTENTSTACK_MANAGEMENT_HOST`, `CONTENTSTACK_BRANCH`, `CONTENTSTACK_LOCALE`, `CONTENTSTACK_MANIFEST_PATH`, `CONTENTSTACK_PERIODIC_COUNT`, taxonomy secrets, `VITE_CONTENTSTACK_DELIVERY_HOST`, `VITE_CONTENTSTACK_DELIVERY_TOKEN`, **`VITE_CONTENTSTACK_CONTENT_TYPE_UIDS`** (only if this instance needs a different list than the repo default).

**Shared content type UIDs (warm-up)** — Often the same for every instance (e.g. `demo_plain_text,demo_json_rte,…`). Set **repository variable** **`VITE_CONTENTSTACK_CONTENT_TYPE_UIDS`** once. The warm-up step uses **`secrets.VITE_CONTENTSTACK_CONTENT_TYPE_UIDS` on that environment first**, then falls back to the repo variable, then the shell default `top_url_lines`.

**CMA-only vs warm-up** — `automate:entries:periodic:ci` does **not** need Delivery API variables. **`VITE_CONTENTSTACK_DELIVERY_*`** on the environment are **only** for the optional warm-up GETs (and mirror what the Vite app / Launch uses). Local `.env` still uses the same names for convenience.

**Manual run for one instance** — Use **Actions → workflow → Run workflow** and set **instance** to a single GitHub Environment name, or call the workflow dispatch API with `inputs.instance`.

**Annotations:** A successful run may still show a GitHub notice about Node versions used *by* `actions/checkout` and `actions/setup-node`. That is separate from your workflow's `node-version: '20'` for `npm ci` / the script; it does not mean the job failed.

Cron `*/5 * * * *` runs in **UTC** (every five minutes). **`strategy.fail-fast: false`** lets one instance fail without canceling the others.

After the periodic script succeeds, the workflow **GETs** (optional):

1. **Launch** — `LAUNCH_SITE_URL` for that environment (no repo-wide default; avoids warming the wrong site).
2. **Delivery API** — same URLs as the browser if **`VITE_CONTENTSTACK_DELIVERY_HOST`**, **`VITE_CONTENTSTACK_DELIVERY_TOKEN`**, and API key are set on that environment; UIDs from env secret or repo variable as above.

**Manifests per instance** — If stacks need different manifests, set **`CONTENTSTACK_MANIFEST_PATH`** on the corresponding GitHub Environment so each job resolves its own file in the repo.

**Write volume** — Every five minutes produces more entries over time; watch **Management API rate limits** and stack hygiene (retention / cleanup).

### Contentstack Automation Hub (alternative to GitHub `schedule`)

If you prefer running on a timer **inside Contentstack** (or GitHub’s cron is slow or unavailable), use **[Automation Hub](https://www.contentstack.com/docs/developers/automation-hub-guides/about-automation-hub)** so the **same** GitHub workflow still executes (same `npm` script; secrets live on each **GitHub Environment** as for Actions).

**Pattern**

1. **Trigger:** [Scheduler by Automate](https://www.contentstack.com/docs/developers/automation-hub-connectors/scheduler-by-automation-hub) — set your interval (e.g. every five minutes) in the Automation Hub UI.
2. **Action:** [HTTP Action](https://www.contentstack.com/docs/developers/automation-hub-connectors/http-action) — **POST** to the GitHub **workflow dispatch** API so only `workflow_dispatch` runs (not a duplicate custom script).

**HTTP Action settings**

| Field | Value |
|-------|--------|
| Method | `POST` |
| URL | `https://api.github.com/repos/<owner>/<repo>/actions/workflows/contentstack-periodic-entries.yml/dispatches` |
| Headers | `Accept: application/vnd.github+json`, `Content-Type: application/json`, `Authorization: Bearer <GITHUB_PAT>` |
| Body (JSON) | `{"ref":"main","inputs":{"instance":""}}` — use your default branch if not `main`; leave `instance` empty to run all environments in **`CONTENTSTACK_PERIODIC_ENVIRONMENTS_JSON`**, or set it to one environment name to run that instance only |

Replace `<owner>` / `<repo>` (e.g. `DiveshKumarChordia` / `top-url-website-making`). The workflow **file name** (`contentstack-periodic-entries.yml`) is valid as the workflow identifier in this API. In the HTTP Action, turn on **Throw error status** (or equivalent) for 4xx/5xx so failed dispatches show in Automation Hub execution logs.

**GitHub token**

- Create a **fine-grained PAT** with **Actions: Read and write** on this repository, or a **classic** PAT with `repo` / workflow scope as required by your org policy.
- Store the PAT in Automation Hub (connector **Account** / **secrets**), not in the repo.

**Avoid double runs**

If Automation Hub fires on the same cadence as GitHub’s `schedule` cron, you will create **twice** as many entries. Either:

- Rely on **Automation Hub only** and remove or comment out the `schedule:` block in [`.github/workflows/contentstack-periodic-entries.yml`](.github/workflows/contentstack-periodic-entries.yml), **or**
- Keep GitHub cron and do **not** add a parallel Automation Hub schedule.

**Purely native alternative (advanced)**

You can chain **Contentstack Management — Entries** actions (create/publish) in Automation Hub without GitHub, but that **does not** run [`scripts/periodic-entries-from-manifest.mjs`](scripts/periodic-entries-from-manifest.mjs) or read [`scripts/content-types.manifest.json`](scripts/content-types.manifest.json); you would re-implement each content type and payload in the UI. The **HTTP → GitHub dispatch** approach keeps one source of truth.

## Management token scope

Token must allow **content type create** (bootstrap), **entry create** and **publish**, branch access, and taxonomy assignment if used.

## Modular blocks entry shape

Manifest Shorthand entries may use `{ "block_type": "hero", ... }`; the script converts them to Contentstack’s `{ "hero": { ... } }` shape before POST.

## Idempotency

- Re-running **`automate:manifest`** skips existing content types. Seed **`entries`** run again by default; duplicate **unique** `title` values return 422.
- **Default behavior:** if `CONTENTSTACK_MANIFEST_SKIP_DUPLICATE_SEEDS` is not `false`, duplicate-title seeds are **skipped** and the in-memory `__REF__` registry is **hydrated** from existing entries on that type (so later types in the manifest can still resolve references).
- **Content types only:** set `skipSeedEntries: true` on the manifest root or **`CONTENTSTACK_MANIFEST_SKIP_SEEDS=true`** to never POST seed entries.
- **`automate:entries:periodic`** always uses fresh titles.

## References

- [Content Management API](https://www.contentstack.com/docs/developers/apis/content-management-api)
- [JSON schema for creating a content type](https://www.contentstack.com/docs/developers/create-content-types/json-schema-for-creating-a-content-type)
