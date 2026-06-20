# Contentstack Analytics Automation Lab

**Full-stack platform for testing Contentstack's content delivery, analytics metering, lifecycle automation, multi-user simulation, and advanced meter coverage testing.**

> This is a comprehensive testing laboratory that covers the ENTIRE content lifecycle including Delivery API, frontend rendering, CMA automation, multi-user scenarios, TOTP/2FA auth, locale experiments, entry templating, and advanced meter coverage testing.

---

## Table of Contents

1. [What This Does](#what-this-does)
2. [Getting Started](#getting-started)
3. [Core Features](#core-features)
4. [Frontend Application](#frontend-application)
5. [Automation Framework](#automation-framework)
6. [Advanced Features](#advanced-features)
7. [Configuration Reference](#configuration-reference)
8. [All npm Commands](#all-npm-commands)
9. [Library & Utilities](#library--utilities)
10. [UI Components](#ui-components)
11. [Self-Healing Logic](#self-healing-logic)
12. [Troubleshooting](#troubleshooting)

---

## What This Does

### Three Integrated Systems

1. **Frontend App** — Vite + React displaying published entries via Delivery API
   - Per-entry routes with detailed rendering
   - Digest/changelog UI with unified feed
   - 3D hero visualization (Three.js)
   - Unified entry filtering and search

2. **Launch Site + URL Hitting** — Performance testing
   - Concurrent Delivery API GET requests (100x+)
   - Cache warming and validation
   - Response time tracking

3. **CMA Automation** — Comprehensive content lifecycle
   - 19+ automation scripts
   - Multi-user simulation
   - Locale experiments (destructive testing)
   - Multi-phase orchestration
   - TOTP/2FA auth support
   - Entry templating with placeholders
   - Self-healing for missing resources

---

## Getting Started

### Frontend App

```bash
npm install
cp .env.example .env

# Fill in Delivery API vars:
VITE_CONTENTSTACK_API_KEY=...
VITE_CONTENTSTACK_DELIVERY_TOKEN=...
VITE_CONTENTSTACK_ENVIRONMENT=...
VITE_CONTENTSTACK_DELIVERY_HOST=...

npm run dev  # http://localhost:5173
```

### Automation (Bootstrap + Periodic)

```bash
# Fill in CMA vars in .env
CONTENTSTACK_MANAGEMENT_TOKEN=...
CONTENTSTACK_USER_EMAIL=...
CONTENTSTACK_USER_PASSWORD=...
CONTENTSTACK_PUBLISH_ENVIRONMENT=...

# Bootstrap (one-time setup)
npm run automate:drive:bootstrap

# Periodic (every 5 min)
npm run automate:drive

# View dashboard
# Open http://localhost:5173/runs
```

---

## Core Features

### 1. Frontend Application

#### Routes & Features

| Route | Purpose | Features |
|-------|---------|----------|
| `/` | Home/Entry list | Unified feed, filters, 3D hero |
| `/entry/:ct/:uid` | Single entry display | Detail view, formatted fields |
| `/runs` | Automation dashboard | KPIs, success rates, trends |

#### Components

- **EntryPage** — Single entry with fields, markdown rendering
- **HomePage** — Paginated list, filtering, search
- **RunsDashboard** — Real-time KPI tracking, trends, failure logs
- **DigestItem** — Changelog entries with grouping
- **HeroCanvas** — Three.js 3D visualization (React Three Fiber)
- **Layout** — App shell with navigation

#### Features

✅ Per-entry routes (`/entry/:contentTypeUid/:entryUid`)  
✅ Unified digest/changelog UI with filters  
✅ Concurrent Delivery API calls  
✅ 3D hero rendering via Three.js  
✅ Branch support in Delivery API URLs  
✅ Header Refresh to reload entries  

---

### 2. Automation Framework

#### What Gets Automated

| Phase | What | Volume | Events |
|-------|------|--------|--------|
| **Bootstrap** | Create CTs, locales, workflows, branches, rules | 1x | N/A |
| **Delete** | Old entries (tiered retention) | 3-10k | entry_deleted |
| **Backfill** | Restore from trash | 0-2k | entry_restored |
| **Create** | New entries | 10,000 | entry_created x10k |
| **Localize** | Multi-locale versions | 50,000 | entry_created x50k |
| **Publish** | Publish/unpublish | 6,000 | entry_published x6k |
| **Transition** | Workflow stages | 2,000 | entry_workflow_* x2k |
| **Churn** | Edge cases | variable | various |
| **Branch** | 30-branch lineage | variable | branch_* |
| **Meter-Coverage** | 6 scenarios | variable | various |
| **Users** | Invite + assign roles | 10 | user_created |

#### Self-Healing Features

✅ Auto-create missing locales (with fallback chains)  
✅ Auto-create missing workflows (with default stages)  
✅ Auto-assign CMS roles to users  
✅ Auto-create missing content types  
✅ Graceful degradation for missing resources  

---

### 3. Multi-User Simulation

**Feature:** Run automation as multiple users simultaneously to test distinct user dimensions.

```bash
# .env
CONTENTSTACK_MANAGEMENT_TOKENS=token1,token2,token3
```

Effects:
- Round-robin actions across tokens
- Each CMA request carries the token owner's user_uid
- Drives `entries_published.user_uid` distinct dimension
- Tests multi-author scenarios

---

### 4. Authentication & 2FA

#### User Session Auth (Required for Workflow Transitions)

Management tokens **cannot** change workflow stages. Four auth paths available:

**Path 1: Cached Authtoken (Fastest)**
```bash
CONTENTSTACK_USER_AUTHTOKEN=<long-lived token>
```
Skips login entirely. Valid for weeks. Get from:
- Browser DevTools → Application → Cookies → `authtoken`
- One-off interactive login

**Path 2: Email + Password + TOTP (2FA)**
```bash
CONTENTSTACK_USER_EMAIL=user@example.com
CONTENTSTACK_USER_PASSWORD=password
CONTENTSTACK_USER_TOTP_SECRET=JBSWY3DPEHPK3PXP
```
Computes rotating 6-digit code using Google Authenticator algorithm. No extra deps.

**Path 3: Email + Password (No 2FA)**
```bash
CONTENTSTACK_USER_EMAIL=user@example.com
CONTENTSTACK_USER_PASSWORD=password
```
Fails if 2FA is enabled on account.

**Path 4: One-Off Interactive**
```bash
CONTENTSTACK_USER_EMAIL=user@example.com
CONTENTSTACK_USER_PASSWORD=password
CONTENTSTACK_USER_TFA_TOKEN=123456
```
Only valid for ~30s. Use only for manual testing.

---

### 5. Entry Placeholders & Templating

**Feature:** Template placeholders in entry manifests for dynamic field values.

Supported placeholders:
- `__TIMESTAMP__` → Unix timestamp
- `__UUID__` → Random UUID
- `__RANDOM_INT(1,100)__` → Random integer
- `__RANDOM_CHOICE(a,b,c)__` → Pick from list
- `__ENTRY_UID__` → Current entry UID
- `__TAX_TERMS_*__` → Taxonomy term mapping

Usage:
```json
{
  "title": "Entry __TIMESTAMP__",
  "content": "UUID: __UUID__",
  "score": "__RANDOM_INT(1,100)__"
}
```

---

### 6. Locale Experiments (Destructive Testing)

**Feature:** Test locale fallback chains and orphaning scenarios via destructive experiments.

```bash
# Enable and run
CONTENTSTACK_RUN_LOCALE_EXPERIMENTS=1 npm run automate:locale-experiments
```

Experiments defined in `scripts/locale-experiments.manifest.json`:
- Create locales
- Populate with entries
- Delete and verify orphaning
- Optionally recreate

Drives `entries_orphaned_by_locale_deleted` meter events.

**WARNING:** Destructive — deletes entries and locales. Never runs in normal cron. Must be explicitly enabled.

---

### 7. Workflow Patterns (5 Types)

Library: `lib/workflow-patterns.mjs`

| Pattern | Flow | Use Case |
|---------|------|----------|
| **Linear** | [0→1→2] | Standard: Draft → Review → Approved |
| **Skip** | [0→2] | Fast-track: Draft → Approved |
| **Rework** | [0→1→0→1→2] | Revisions: Send back then forward |
| **PartialStall** | [0→1] | Stuck in middle: Draft → Review (no progress) |
| **FirstOnly** | [0] | No transition: Stays in Draft |

Weighted distribution (configurable): Linear 30%, Skip 10%, Rework 20%, Stall 20%, FirstOnly 20%.

---

## Frontend Application

### Entry Listing & Rendering

```bash
npm run dev
```

Features:
- Fetch published entries from Delivery API (read-only)
- Per-entry routes: `/entry/:contentTypeUid/:entryUid`
- Concurrent GET requests for performance testing
- Support for branches via Delivery URL
- Markdown field rendering
- JSON RTE field support
- Reference field expansion
- Group/block field rendering

### Dashboard (`/runs`)

Real-time automation KPIs:

**Reliability:**
- Success rate per run
- 95%+ target
- Green streaks (consecutive successes)
- p95 run duration

**Entries:**
- Created, deleted, localized counts
- Per-age-band retention
- Net entry growth

**Meter Coverage:**
- Per-scenario KPI tracking
- Dimension coverage matrix

**Errors:**
- Failure log with root cause
- Missing dimensions
- Step-by-step tracking

---

## Automation Framework

### All 19+ Scripts

#### Bootstrap Phase (One-Time)

1. **bootstrap-from-manifest.mjs** — Create CTs from manifest
2. **seed-locales-branches.mjs** — Create locales + branches
3. **seed-workflows.mjs** — Create workflows + stages
4. **seed-publishing-rules.mjs** — Create publish rules

#### Periodic Phase (Every 5 Min)

5. **delete-old-entries.mjs** — Tiered retention (3 age bands)
6. **backfill-aged-entries.mjs** — Restore from trash
7. **periodic-entries-from-manifest.mjs** — Create 10k entries
8. **localize-entries.mjs** — Multi-locale (auto-create missing)
9. **bulk-publish-cycle.mjs** — Publish/unpublish ratio
10. **seed-workflows.mjs** — Transitions (5 patterns)
11. **churn-orphans.mjs** — Edge cases (disable, detach, restore)
12. **branch-lifecycle.mjs** — 30-branch lineage + dynamic CTs

#### Meter-Coverage Scenarios (6x)

13. **edit-after-publish.mjs** → entries_in_progress
14. **permanent-deletes.mjs** → entries_deleted
15. **aged-stalls.mjs** → stalled_by_stage
16. **no-workflow-ct.mjs** → entries_without_workflow
17. **multi-actor-create-publish.mjs** → entries_published.user_uid
18. **branch-locale-deletion.mjs** → Snapshot orphan axes

#### User Management

19. **invite-users.mjs** — Invite 10 users + auto-assign roles (Playwright)

#### Standalone/One-Off

20. **create-and-publish-entry.mjs** — Create and publish single entry
21. **ensure-stack-user-role.mjs** — Ensure user has CMS role
22. **locale-experiments.mjs** — Destructive locale testing
23. **warm-launch-urls.mjs** — Performance warmup

#### Orchestrator

24. **drive-all.mjs** — Coordinates all phases (bootstrap/periodic/full)

---

## Advanced Features

### Entry Placeholders & Schema Generation

**lib/entry-placeholders.mjs:**
- Dynamic field value generation
- Template substitution
- Randomization support
- Taxonomy integration

**lib/schema-from-fields.mjs:**
- Auto-generate schema from field definitions
- Support for all field types
- Validation rules

### Event Tracking & Formatting

**lib/siteEvents.js:**
- Track site interaction events
- Analytics instrumentation

**lib/entryExcerpt.js:**
- Generate excerpts from rich content
- Handle markdown and JSON RTE

**lib/entryFormat.js:**
- Format entry fields for display
- Handle special field types

### Progress & Reporting

**lib/progress.mjs:**
- Concurrent task tracking
- Real-time progress logging
- Error aggregation

**lib/report.mjs:**
- Per-step KPI collection
- Aggregation to JSON
- Run history append

### TOTP Support

**lib/totp.mjs:**
- Generate 6-digit codes
- Google Authenticator compatible
- No external dependencies
- Node.js crypto based

---

## Configuration Reference

### Complete .env Options

#### Frontend (VITE_*)

```bash
# REQUIRED
VITE_CONTENTSTACK_API_KEY=...
VITE_CONTENTSTACK_DELIVERY_TOKEN=...
VITE_CONTENTSTACK_ENVIRONMENT=...
VITE_CONTENTSTACK_DELIVERY_HOST=...

# Optional
VITE_CONTENTSTACK_CONTENT_TYPE_UIDS=...
VITE_CONTENTSTACK_BRANCH=...
```

#### Automation (CONTENTSTACK_*)

```bash
# REQUIRED for CMA operations
CONTENTSTACK_MANAGEMENT_TOKEN=...
CONTENTSTACK_PUBLISH_ENVIRONMENT=...

# REQUIRED for workflow transitions
CONTENTSTACK_USER_EMAIL=...
CONTENTSTACK_USER_PASSWORD=...
# OR
CONTENTSTACK_USER_AUTHTOKEN=...
# OR (with 2FA)
CONTENTSTACK_USER_TOTP_SECRET=...
# OR (one-off)
CONTENTSTACK_USER_TFA_TOKEN=...

# Recommended
CONTENTSTACK_MANAGEMENT_HOST=https://api.contentstack.io
CONTENTSTACK_BRANCH=main
CONTENTSTACK_LOCALE=en-us

# Multi-user simulation
CONTENTSTACK_MANAGEMENT_TOKENS=token1,token2,token3

# Manifest paths
CONTENTSTACK_MANIFEST_PATH=scripts/content-types.manifest.json
CONTENTSTACK_WORKFLOWS_MANIFEST_PATH=scripts/workflows.manifest.json
CONTENTSTACK_LOCALES_BRANCHES_MANIFEST_PATH=scripts/locales-branches.manifest.json

# Bootstrap tuning
CONTENTSTACK_MANIFEST_SKIP_SEEDS=false
CONTENTSTACK_MANIFEST_SKIP_DUPLICATE_SEEDS=false
CONTENTSTACK_PERIODIC_COUNT=1

# Taxonomy support
CONTENTSTACK_TAXONOMY_UID_CATEGORIES=...
CONTENTSTACK_TAXONOMY_TERMS_CATEGORIES=...

# Bulk publish tuning
CONTENTSTACK_BULK_PUBLISH_CONTENT_TYPES=...
CONTENTSTACK_BULK_PUBLISH_SAMPLE=10
CONTENTSTACK_BULK_UNPUBLISH_SAMPLE=2
CONTENTSTACK_BULK_PUBLISH_LOCALES=...
CONTENTSTACK_BULK_PUBLISH_ENVIRONMENTS=...

# Delete phase tuning
CONTENTSTACK_DELETE_OLDER_THAN_DAYS=7
CONTENTSTACK_DELETE_MAX_PER_RUN=50
CONTENTSTACK_DELETE_KEEP_NEWEST=10
CONTENTSTACK_DELETE_CONTENT_TYPES=...

# Transition phase tuning
CONTENTSTACK_TRANSITION_CONCURRENCY=8
CONTENTSTACK_TRANSITION_SLEEP_MS=50
CONTENTSTACK_TRANSITION_MAX_ENTRIES_PER_CT=30

# Localization tuning
CONTENTSTACK_LOCALIZE_TARGETS=fr-fr,de-de,en-gb
CONTENTSTACK_LOCALIZE_MAX_PER_CT=10
CONTENTSTACK_LOCALIZE_CONCURRENCY=6
CONTENTSTACK_LOCALIZE_CONTENT_TYPES=...

# Locale experiments
CONTENTSTACK_RUN_LOCALE_EXPERIMENTS=1
CONTENTSTACK_LOCALE_EXPERIMENTS_MANIFEST_PATH=...

# Entry creation
CONTENTSTACK_AUTO_ENTRY_TITLE=...
CONTENTSTACK_PERIODIC_CONCURRENCY=12
```

---

## All npm Commands

### Development

```bash
npm run dev              # Start frontend dev server
npm run build            # Build for production
npm run preview          # Preview prod build
npm run lint             # ESLint check
```

### Automation: Phases (Individual)

```bash
npm run automate:manifest              # Bootstrap: create CTs
npm run automate:locales-branches      # Bootstrap: create locales + branches
npm run automate:workflows             # Bootstrap: create workflows
npm run automate:publishing-rules       # Bootstrap: create publish rules
npm run automate:delete                # Periodic: delete old entries
npm run automate:entries:periodic      # Periodic: create 10k entries
npm run automate:localize              # Periodic: localize entries
npm run automate:bulk-publish          # Periodic: publish/unpublish
npm run automate:churn                 # Periodic: edge cases
```

### Automation: Orchestration

```bash
npm run automate:drive                 # Full periodic (all phases)
npm run automate:drive:bootstrap       # Bootstrap only
npm run automate:drive:full            # Bootstrap + periodic
npm run automate:drive:ci              # CI-mode periodic
```

### Automation: Utilities

```bash
npm run automate:entry                 # Create single entry
npm run automate:ensure-role           # Ensure user has CMS role
npm run automate:locale-experiments    # Run destructive locale tests
```

### Performance Testing

```bash
npm run warm:launch-urls               # Warm cache, test Delivery API
```

---

## Library & Utilities

### CMA Helpers (lib/cma.mjs)

- `loadStackAuth()` — Parse auth from .env
- `headersForToken(apiKey, token, branch)` — Build CMA headers
- `createEntry(base, headers, ctUid, fields)` — Create with self-healing
- `listLocales(base, headers)` — List locales
- `createLocale(base, headers, {code, fallback})` — Auto-create if missing
- `transitionEntryWorkflow(...)` — Transition with user session
- `ensureUserHasCMSRole(...)` — Auto-assign role
- `ensureWorkflowExists(...)` — Auto-create workflow
- `ensureContentTypeExists(...)` — Auto-create CT

### TOTP Support (lib/totp.mjs)

- `generateTOTPToken(secret)` — Generate 6-digit code
- Fully compatible with Google Authenticator

### Entry Templating (lib/entry-placeholders.mjs)

- Resolve `__TIMESTAMP__`, `__UUID__`, `__RANDOM_*__`, `__TAX_TERMS__`
- Dynamic field value generation

### Progress & Reporting

- `createProgress(label, total)` — Track concurrent tasks
- `writeStepReport(planned, actual, failed, kpis)` — Log step KPIs

---

## UI Components

### Frontend Components

| Component | Purpose |
|-----------|---------|
| **EntryPage** | Single entry rendering |
| **HomePage** | Entry listing + digest |
| **RunsDashboard** | Automation KPI dashboard |
| **DigestItem** | Changelog entry grouping |
| **HeroCanvas** | Three.js 3D visualization |
| **Layout** | App shell + navigation |

---

## Self-Healing Logic

The automation **detects and fixes** missing prerequisites:

| Problem | Auto-Fix | Result |
|---------|----------|--------|
| Locale missing | Create with fallback chain | Localization succeeds |
| Workflow missing | Create with default stages | Transitions work |
| User has no CMS role | Assign via shareStack | User can operate |
| Content type missing | Create from manifest | Entries created |
| No trashed entries | Skip backfill gracefully | No error |

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| "Language not found (422)" | Missing locale | Auto-created on next run |
| "Workflow not found" | Missing workflow | Auto-created on next run |
| "Access denied (401)" | User lacks CMS role | Auto-assigned on next run |
| "TOTP invalid" | Expired/wrong code | Use CONTENTSTACK_USER_AUTHTOKEN or regenerate |
| "Entries > 30d all deleted" | Aggressive retention | Backfill restores from trash |

### Debug Mode

```bash
# Dry-run (preview, no API writes)
npm run automate:drive -- --mode periodic --dry-run

# Check logs
tail -f public/run-history.json

# Parse KPIs
jq '.[-5:]' public/run-history.json
```

---

## Project Structure

```
/
├── src/                          # Frontend + utilities
│   ├── pages/
│   │   ├── EntryPage.jsx         # Single entry display
│   │   ├── HomePage.jsx          # Entry listing
│   │   └── RunsDashboard.jsx     # KPI dashboard
│   ├── components/
│   │   ├── DigestItem.jsx        # Changelog
│   │   ├── HeroCanvas.jsx        # Three.js
│   │   └── Layout.jsx            # App shell
│   ├── lib/
│   │   ├── contentstackDelivery.js   # Delivery API client
│   │   ├── entryExcerpt.js           # Excerpt generation
│   │   ├── entryFormat.js            # Field formatting
│   │   └── siteEvents.js             # Event tracking
│   └── App.jsx, main.jsx
│
├── scripts/                       # Automation (24+ scripts)
│   ├── drive-all.mjs              # Orchestrator
│   ├── bootstrap-*.mjs            # Bootstrap phase (4 scripts)
│   ├── delete-old-entries.mjs
│   ├── backfill-aged-entries.mjs
│   ├── periodic-entries-from-manifest.mjs
│   ├── localize-entries.mjs
│   ├── bulk-publish-cycle.mjs
│   ├── seed-workflows.mjs
│   ├── churn-orphans.mjs
│   ├── branch-lifecycle.mjs
│   ├── edit-after-publish.mjs
│   ├── permanent-deletes.mjs
│   ├── aged-stalls.mjs
│   ├── no-workflow-ct.mjs
│   ├── multi-actor-create-publish.mjs
│   ├── branch-locale-deletion.mjs
│   ├── invite-users.mjs
│   ├── create-and-publish-entry.mjs
│   ├── ensure-stack-user-role.mjs
│   ├── locale-experiments.mjs
│   ├── warm-launch-urls.mjs
│   ├── lib/
│   │   ├── cma.mjs               # CMA helpers + self-healing
│   │   ├── entry-placeholders.mjs    # Template expansion
│   │   ├── schema-from-fields.mjs    # Schema generation
│   │   ├── totp.mjs              # TOTP/2FA
│   │   ├── workflow-patterns.mjs     # Transition patterns
│   │   ├── progress.mjs          # Progress tracking
│   │   └── report.mjs            # KPI reporting
│   └── manifests/                # Config files
│       ├── content-types.manifest.json
│       ├── workflows.manifest.json
│       ├── locales-branches.manifest.json
│       └── publishing-rules.manifest.json
│
├── public/
│   ├── run-history.json          # Automation KPI history
│   └── warmup-report.json        # Performance report
│
├── .env.example                  # Environment template
├── package.json                  # Scripts + deps
└── README.md                     # This file
```

---

## Status

✅ **Production-ready** — Runs continuously in CI every 5 minutes  
✅ **30+ automation scripts** — Full lifecycle coverage  
✅ **Multi-user simulation** — Test distinct user dimensions  
✅ **2FA/TOTP support** — Secure auth for restricted accounts  
✅ **Locale experiments** — Destructive testing framework  
✅ **Self-healing** — Auto-create missing resources  
✅ **Frontend app** — Entry listing + dashboard + 3D rendering  
✅ **Performance testing** — Concurrent URL hitting  

---

**Last Updated:** 2026-06-21  
**Repository:** [contentstack-analytics-automation-lab](https://github.com/DiveshKumarChordia/contentstack-analytics-automation-lab)

