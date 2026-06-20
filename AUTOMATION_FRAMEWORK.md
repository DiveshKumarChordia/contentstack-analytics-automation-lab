# Contentstack Metering Automation Framework

**Production-grade automation for comprehensive Contentstack Content Management API testing, meter coverage, and realistic content lifecycle simulation.**

## Overview

This framework automates complex content lifecycle patterns in Contentstack to:
- **Drive meter events** across all dimensions (users, branches, locales, workflows, stages)
- **Test multi-user scenarios** with auto-created and auto-managed users
- **Simulate realistic content aging** with entry restoration and tiered retention
- **Cover unmeasured analytics dimensions** (in-progress, deleted, stalled, multi-actor, orphan handling)
- **Self-heal on missing prerequisites** (auto-create locales, workflows, CMS roles, etc.)

**No manual setup required** — the automation creates and manages everything it needs.

---

## Architecture

### Complete Automation Flow (All 24+ Scripts)

```mermaid
graph TD
    A["CI/Manual Trigger"] -->|--mode bootstrap| B["BOOTSTRAP PHASE"]
    A -->|--mode periodic| C["PERIODIC PHASE"]
    A -->|--mode full| D["BOOTSTRAP + PERIODIC"]
    
    D --> B
    D --> C
    
    B --> B1["bootstrap-from-manifest.mjs<br/>Create CTs"]
    B --> B2["seed-locales-branches.mjs<br/>Create locales + branches"]
    B --> B3["seed-workflows.mjs<br/>Create workflows"]
    B --> B4["seed-publishing-rules.mjs<br/>Create rules"]
    
    B1 --> E["Foundation Ready"]
    B2 --> E
    B3 --> E
    B4 --> E
    
    C --> C1["delete-old-entries.mjs<br/>Tiered retention"]
    C --> C2["backfill-aged-entries.mjs<br/>Restore from trash"]
    C --> C3["periodic-entries-from-manifest.mjs<br/>Create 10k entries"]
    C --> C4["localize-entries.mjs<br/>5 locales"]
    C --> C5["bulk-publish-cycle.mjs<br/>Publish/unpublish"]
    C --> C6["seed-workflows.mjs<br/>5 transition patterns"]
    C --> C7["churn-orphans.mjs<br/>Edge cases"]
    C --> C8["branch-lifecycle.mjs<br/>30-branch lineage"]
    
    C1 --> M["Meter-Coverage<br/>Scenarios (6x)"]
    C2 --> M
    C3 --> M
    C4 --> M
    C5 --> M
    C6 --> M
    C7 --> M
    C8 --> M
    
    M --> M1["edit-after-publish.mjs<br/>entries_in_progress"]
    M --> M2["permanent-deletes.mjs<br/>entries_deleted"]
    M --> M3["aged-stalls.mjs<br/>stalled_by_stage"]
    M --> M4["no-workflow-ct.mjs<br/>entries_without_workflow"]
    M --> M5["multi-actor-create-publish.mjs<br/>entries_published.user_uid"]
    M --> M6["branch-locale-deletion.mjs<br/>snapshot orphan"]
    
    M1 --> U["User Management"]
    M2 --> U
    M3 --> U
    M4 --> U
    M5 --> U
    M6 --> U
    
    U --> U1["invite-users.mjs<br/>Invite 10 users<br/>+ assign roles"]
    
    U1 --> A["⭐ Analytics (4 Phases)"]
    
    A --> A1["Phase 1:<br/>enhanced-report.mjs<br/>Wire analytics engine"]
    A1 --> A2["Phase 2:<br/>kpi-schema.mjs<br/>Standardize KPIs"]
    A2 --> A3["Phase 3:<br/>aggregate-metrics.mjs<br/>Stack-level metrics"]
    A3 --> A4["Phase 4:<br/>AdvancedAnalyticsDashboard<br/>Visualize 50+ KPIs"]
    
    A4 --> R["Reporting & Visualization"]
    
    R --> R1["CalendarHeatmap<br/>Day overview"]
    R --> R2["DayAnalytics<br/>Detailed breakdown"]
    R --> R3["AdvancedDashboard<br/>5 tabs, 50+ KPIs"]
    R1 --> R4["RunsDashboard.jsx<br/>Complete analytics coverage"]
    R2 --> R4
    R3 --> R4
    
    style E fill:#c8e6c9
    style M fill:#fff9c4
    style U fill:#bbdefb
    style A fill:#f4e6e8
    style A1 fill:#fff0f5
    style A2 fill:#fff0f5
    style A3 fill:#fff0f5
    style A4 fill:#fff0f5
    style R fill:#f8bbd0
```

### High-Level Flow

```mermaid
graph TD
    A["GitHub Actions / Manual Trigger"] --> B["drive-all.mjs<br/>(Orchestrator)"]
    B --> C{Mode}
    C -->|bootstrap| D["Phase 1: Bootstrap<br/>Create CTs, Locales, Branches<br/>Workflows, Publishing Rules"]
    C -->|periodic| E["Phase 2: Periodic<br/>Delete, Backfill, Create 10k<br/>Localize 5x, Publish/Unpublish<br/>Transitions, Churn, Branch"]
    C -->|full| F["Bootstrap + Periodic"]
    F --> D
    F --> E
    D --> G["Phase 3: User Management<br/>Invite 10 Users + Assign Roles"]
    E --> G
    G --> H["Phase 4: Report KPIs<br/>public/run-history.json"]
```

### Data Flow (This Repo Only)

**This repository performs CMA operations AND comprehensive local analytics. Downstream systems handle additional pipeline.**

```mermaid
graph LR
    subgraph OurRepo["OUR REPO: Automation Operations"]
        CREATE["Create Entries"]
        DELETE["Delete Entries"]
        RESTORE["Restore Entries"]
        TRANS["Transition Workflows"]
        PUBLISH["Publish/Unpublish"]
        LOCALIZE["Localize Entries"]
        INVITE["User Invitations"]
        BRANCH["Branch Operations"]
    end
    
    subgraph Events["Triggers Events"]
        E1["entry_created"]
        E2["entry_deleted"]
        E3["entry_restored"]
        E4["entry_workflow_*"]
        E5["entry_published"]
        E6["entry_created<br/>(locale dim)"]
        E7["user_created"]
        E8["branch_*"]
    end
    
    subgraph Analytics4Phase["⭐ NEW: 4-PHASE ANALYTICS (Local)"]
        P1["Phase 1:<br/>Audit Trail<br/>+ KPI Extraction"]
        P2["Phase 2:<br/>KPI Schema<br/>Standardization"]
        P3["Phase 3:<br/>Stack-Level<br/>Metrics"]
        P4["Phase 4:<br/>Dashboard<br/>Visualization"]
        P1 --> P2 --> P3 --> P4
    end
    
    subgraph Downstream["DOWNSTREAM (External Systems)"]
        KAFKA["Kafka<br/>(consumed by)"]
        MONGO["Mongo<br/>(analytics-data-sync)"]
        EXT["Dashboards<br/>Reporting"]
    end
    
    CREATE --> E1
    DELETE --> E2
    RESTORE --> E3
    TRANS --> E4
    PUBLISH --> E5
    LOCALIZE --> E6
    INVITE --> E7
    BRANCH --> E8
    
    E1 --> KAFKA
    E2 --> KAFKA
    E3 --> KAFKA
    E4 --> KAFKA
    E5 --> KAFKA
    E6 --> KAFKA
    E7 --> KAFKA
    E8 --> KAFKA
    
    E1 -.->|Feed Audit Trail| P1
    E2 -.->|Feed Audit Trail| P1
    E3 -.->|Feed Audit Trail| P1
    E4 -.->|Feed Audit Trail| P1
    E5 -.->|Feed Audit Trail| P1
    E6 -.->|Feed Audit Trail| P1
    E7 -.->|Feed Audit Trail| P1
    E8 -.->|Feed Audit Trail| P1
    
    KAFKA --> MONGO
    MONGO --> EXT
```

---

## All 24+ Scripts

### Orchestration

| Script | Purpose | Mode | Output |
|--------|---------|------|--------|
| `drive-all.mjs` | Master orchestrator | bootstrap/periodic/full | KPI report + run-history.json |

### Bootstrap Phase (Foundation Setup)

| Script | Purpose | Triggers | Output |
|--------|---------|----------|--------|
| `bootstrap-from-manifest.mjs` | Create content types from manifest | One-time | CT UIDs, field counts |
| `seed-locales-branches.mjs` | Create locales (w/ fallback) + branches | One-time | Locale codes, branch UIDs |
| `seed-workflows.mjs` | Create workflows + stages | One-time | Workflow UIDs, stage counts |
| `seed-publishing-rules.mjs` | Create publish rules for workflows | One-time | Rule counts, stage mappings |

### Periodic Phase (Lifecycle Operations)

| Script | Purpose | Volume | Events |
|--------|---------|--------|--------|
| `delete-old-entries.mjs` | Tiered retention (3 age bands, keep targets) | 3-10k | entry_deleted |
| `backfill-aged-entries.mjs` | Restore from trash if below targets | 0-2k | entry_restored |
| `periodic-entries-from-manifest.mjs` | Bulk create entries (concurrent) | 10,000 | entry_created x10k |
| `localize-entries.mjs` | Multi-locale localization (auto-create missing) | 50,000 | entry_created x50k |
| `bulk-publish-cycle.mjs` | Publish/unpublish cycle | 6,000 | entry_published/unpublished |
| `seed-workflows.mjs` | Transition entries (5 patterns) | 2,000 | entry_workflow_* |
| `churn-orphans.mjs` | Edge cases (disable, detach, restore) | variable | various |
| `branch-lifecycle.mjs` | 30-branch lineage + dynamic CTs | variable | branch_* |

### Meter-Coverage Scenarios (6x)

| Script | Meter | Purpose | Volume |
|--------|-------|---------|--------|
| `edit-after-publish.mjs` | entries_in_progress | Publish → edit (no republish) | 100 |
| `permanent-deletes.mjs` | entries_deleted | Hard delete (not soft) | 100 |
| `aged-stalls.mjs` | stalled_by_stage | Entries stuck in mid-stages | 20 |
| `no-workflow-ct.mjs` | entries_without_workflow | Create on bare CT | 50 |
| `multi-actor-create-publish.mjs` | entries_published.user_uid | Creator ≠ Publisher | 10 |
| `branch-locale-deletion.mjs` | snapshot orphan axes | Branch/locale delete | 10 |

### User Management

| Script | Purpose | Method | Output |
|--------|---------|--------|--------|
| `invite-users.mjs` | Invite 10 users + assign CMS roles | Playwright UI automation | User UIDs, role assignments |

### Standalone / One-Off

| Script | Purpose | Trigger | Output |
|--------|---------|---------|--------|
| `create-and-publish-entry.mjs` | Create and publish single entry | Manual: `npm run automate:entry` | Entry UID |
| `ensure-stack-user-role.mjs` | Ensure user has CMS role | Manual: `npm run automate:ensure-role` | Role assignment status |
| `locale-experiments.mjs` | Destructive locale testing | Manual: `npm run automate:locale-experiments` (gated) | Orphan event counts |
| `warm-launch-urls.mjs` | Warm Delivery API cache | Manual: `npm run warm:launch-urls` | Response time stats |

---

## Advanced Features

### Multi-User Simulation

**Round-robin actions across multiple management tokens:**

```bash
CONTENTSTACK_MANAGEMENT_TOKENS=token1,token2,token3
```

Each request carries the token owner's user_uid in metering events. Drives `entries_published.user_uid` distinct dimension and tests multi-author scenarios.

### Authentication: 4 Paths

1. **Cached Authtoken** (fastest) — Skip login, use long-lived token from prior session
2. **Email + Password + TOTP** (2FA) — Compute 6-digit code, auto-authenticate
3. **Email + Password** (no 2FA) — Direct auth (fails if 2FA enabled)
4. **TFA Token** (one-off) — Use current 6-digit code (~30s valid)

Required for workflow transitions (management tokens cannot transition entries).

### Entry Placeholders

**Dynamic field value generation using templates:**

- `__TIMESTAMP__` → Unix timestamp
- `__UUID__` → Random UUID v4
- `__RANDOM_INT(min,max)__` → Random integer
- `__RANDOM_CHOICE(a,b,c)__` → Pick from list
- `__ENTRY_UID__` → Current entry UID
- `__TAX_TERMS_*__` → Taxonomy term mapping

Usage in manifest:
```json
{
  "title": "Entry __TIMESTAMP__",
  "id": "__UUID__",
  "score": "__RANDOM_INT(1,100)__"
}
```

### Locale Experiments (Destructive)

**Test locale fallback chains and orphaning scenarios:**

```bash
CONTENTSTACK_RUN_LOCALE_EXPERIMENTS=1 npm run automate:locale-experiments
```

- Never runs in normal cron (must be explicitly enabled)
- Creates locales, populates entries, deletes, verifies orphaning
- Drives `entries_orphaned_by_locale_deleted` events
- Defined in `scripts/locale-experiments.manifest.json`

### Workflow Patterns (5 Types)

Transition patterns for testing different workflow scenarios:

| Pattern | Stages | Represents |
|---------|--------|------------|
| Linear | [0→1→2] | Standard flow: Draft → Review → Approved |
| Skip | [0→2] | Fast-track: Draft → Approved |
| Rework | [0→1→0→1→2] | Revisions: Back and forth |
| PartialStall | [0→1] | Stuck: Draft → Review (no progress) |
| FirstOnly | [0] | No transition: Stays in first stage |

Weighted distribution (default): Linear 30%, Skip 10%, Rework 20%, Stall 20%, FirstOnly 20%.

---

## Self-Healing Logic

### Missing Prerequisites Auto-Creation

| Failure Scenario | Auto-Healing | Location |
|-----------------|--------------|----------|
| Locale doesn't exist | Create with fallback chain | `localize-entries.mjs` |
| Workflow not found | Create with default stages | `aged-stalls.mjs` |
| Content type missing | Create with schema | `lib/cma.mjs` helper |
| User has no CMS role | Assign role via shareStack | `multi-actor.mjs`, `invite-users.mjs` |
| No trashed entries | Graceful skip | `backfill-aged-entries.mjs` |
| Workflow < 2 stages | Skip scenario | `aged-stalls.mjs` |

### Auto-Created Resources

- **Locales:** en-gb, fr-fr, fr-ca, de-de, de-at (with fallback chains)
- **Workflows:** Editorial Review, Marketing Approval, Quick Publish
- **Content Types:** demo_plain_text, demo_json_rte, demo_reference, demo_group, demo_blocks + dynamics
- **Branches:** 30-branch lineage (bl-{timestamp}-1 through bl-{timestamp}-30)
- **Users:** 10 new invitations per run (invite-{timestamp}-{random}@test.contentstack.com)
- **CMS Roles:** Auto-assigned to all users (Developer/Contributor role)

---

## Meter Coverage

### Dimensions Covered

| Meter | Dimension | Script | Driver Event |
|-------|-----------|--------|--------------|
| entries_created | locale | localize-entries.mjs | Localization by non-master locale |
| entries_created | content_type | periodic-entries-from-manifest.mjs | Create per CT |
| entries_created | branch | branch-lifecycle.mjs | Create on lineage branches |
| entries_published | user_uid | multi-actor-create-publish.mjs | Different creator/publisher |
| entries_in_progress | — | edit-after-publish.mjs | Publish then edit without republish |
| entries_deleted | — | permanent-deletes.mjs | Hard delete (not soft) |
| entries_without_workflow | — | no-workflow-ct.mjs | Create on bare CT |
| stalled_by_stage | workflow_uid | aged-stalls.mjs | Entries stuck in mid-stages |
| snapshot Axis 3 (branch) | branch_uid | branch-lifecycle.mjs | Lineage branch delete |
| snapshot Axis 4 (locale) | locale_code | branch-locale-deletion.mjs | Locale delete post-stage |
| org_users | — | invite-users.mjs | User invitation + role assignment |

---

## Configuration

### Required Environment Variables

```bash
# Stack Auth
CONTENTSTACK_API_KEY=your_api_key
CONTENTSTACK_MANAGEMENT_TOKEN=your_token
CONTENTSTACK_PUBLISH_ENVIRONMENT=production

# User Auth (for transitions, publishing, UI automation)
CONTENTSTACK_USER_EMAIL=user@example.com
CONTENTSTACK_USER_PASSWORD=password
```

### Optional Tuning (All have sensible defaults)

```bash
# Retention Policies
CONTENTSTACK_RETENTION_TARGET_OVER_30D=5000       # Keep 5k entries > 30d old
CONTENTSTACK_RETENTION_TARGET_15_30D=10000        # Keep 10k entries 15-30d old
CONTENTSTACK_RETENTION_TARGET_7_15D=20000         # Keep 20k entries 7-15d old

# Concurrency & Volumes
CONTENTSTACK_PERIODIC_CONCURRENCY=12              # Parallel creates per CT
CONTENTSTACK_DELETE_CONCURRENCY=10                # Parallel deletes
CONTENTSTACK_BRANCH_LINEAGE_COUNT=30              # Branches in lineage
CONTENTSTACK_BRANCH_ENTRIES_PER_CT=50             # Entries per branch
CONTENTSTACK_INVITE_COUNT=10                      # Users to invite per run

# Ratios
CONTENTSTACK_PUBLISH_RATIO=0.6                    # Fraction of entries to publish
CONTENTSTACK_UNPUBLISH_RATIO=0.15                 # Fraction to unpublish
CONTENTSTACK_BRANCH_CHURN_PERCENTAGE=0.2          # Disable/detach ratio (not delete)
```

---

## Running the Automation

### Bootstrap (One-time setup)

```bash
node --env-file=.env scripts/drive-all.mjs --mode bootstrap
```

Creates all content foundations (CTs, locales, branches, workflows).

### Periodic (Every 5 minutes in CI)

```bash
node --env-file=.env scripts/drive-all.mjs --mode periodic
```

Drives full lifecycle: delete → backfill → create → localize → publish → transition → churn → branch.

### Full (Bootstrap + Periodic)

```bash
node --env-file=.env scripts/drive-all.mjs --mode full
```

---

## Monitoring & Analytics

### Dashboard

Navigate to `/runs` after first run to see:
- **Runs & Reliability:** success rates, green streaks, p95 duration
- **Entries Lifecycle:** created/deleted/localized counts
- **Publish & Locale:** publish/unpublish/transition metrics
- **Workflow & Churn:** churn operations, edge cases
- **Branch Lifecycle:** branch/entry/CT counts
- **Meter-Coverage Scenarios:** per-scenario KPIs
- **Errors & Coverage:** failure tracking, gaps

### Run History

Appended to `public/run-history.json` after each run:
- Timestamp, mode, instance
- Per-step planned/actual/failed counts
- Aggregated KPIs
- Error audit log

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| "Language was not found (422)" | Locale missing | Auto-created; reload |
| "Workflow not found" | Workflow missing | Auto-created; reload |
| "Access denied (401)" | User lacks CMS role | Auto-assigned; retry |
| "Entries > 30d deleted" | Retention trimmed aged data | Backfill restores from trash |
| "Localize failed (422)" | Non-existent target locale | Auto-create + retry next run |
| "No trashed entries" | Never created entries to delete | Skip scenario gracefully |

---

## Architecture Decisions

### Why Auto-Create Instead of Fail?

Production systems must handle missing prerequisites gracefully. Pre-creating every resource via separate setup steps is brittle and error-prone. **Self-healing at the point of use** is more reliable:
- Locale missing → create it (1 API call)
- Workflow missing → create it (1 API call)
- User has no role → assign it (1 API call)

### Why No Teardown?

`analytics-data-sync` nightly cron scans Mongo for aged snapshots. Deleting branches/entries/CTs after each run means **no aged data exists** for the next run. Instead:
- Set `cleanup=false` (entries + branches persist)
- Tiered retention keeps data bounded
- Backfill restores from trash if band falls below target

### Why 30-Branch Lineage?

10x volume target:
- 3 branches × 5 entries = 15 entries (baseline)
- 30 branches × 50 entries = 1,500 entries + dynamic CTs
- Plus 10k periodic entries per run
- Plus restoration from trash
= Rich, realistic dataset for meter coverage

### Why Playwright for User Invitations?

Contentstack org-admin APIs don't expose user invitation endpoints. Playwright UI automation:
- Works with existing org-admin interface
- No company-repo modifications needed
- Auto-discovers users from org pool
- Auto-assigns CMS roles immediately

---

## Dependencies

- **Node 24+** (async/await, native fetch, top-level await)
- **Contentstack Management API** (REST, auth via token or user session)
- **Playwright** (for org-admin UI automation)
- **Fetch API** (Node 18+ native)

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Periodic Automation

on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch:        # Manual trigger

jobs:
  periodic:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run automate:drive:ci -- --mode periodic
        env:
          CONTENTSTACK_API_KEY: ${{ secrets.CONTENTSTACK_API_KEY }}
          CONTENTSTACK_MANAGEMENT_TOKEN: ${{ secrets.CONTENTSTACK_MANAGEMENT_TOKEN }}
          CONTENTSTACK_USER_EMAIL: ${{ secrets.CONTENTSTACK_USER_EMAIL }}
          CONTENTSTACK_USER_PASSWORD: ${{ secrets.CONTENTSTACK_USER_PASSWORD }}
          CONTENTSTACK_PUBLISH_ENVIRONMENT: production
```

---

## License

Internal Contentstack project. See LICENSE file.
