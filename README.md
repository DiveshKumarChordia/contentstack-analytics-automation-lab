# Contentstack Analytics Testing & Automation Lab

**Comprehensive full-stack platform for testing Contentstack's content delivery, analytics metering, lifecycle automation, multi-user simulation, and advanced meter coverage testing.**

> This is a full-stack testing laboratory for Contentstack that covers the ENTIRE content lifecycle: from creation through metering to analytics validation. It includes frontend app (Vite + React), performance testing (URL warming/hitting), automation framework (24+ scripts), multi-user simulation, TOTP/2FA auth, entry templating, locale experiments, and all meter dimensions.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [What's Included](#whats-included)
3. [Quick Start](#quick-start)
4. [Team Onboarding](#team-onboarding)
5. [Core Architecture](#core-architecture)
6. [Frontend Application](#frontend-application)
7. [Performance Testing](#performance-testing)
8. [Automation Framework](#automation-framework)
9. [Advanced Features](#advanced-features)
10. [All 24+ Scripts Reference](#all-24-scripts-reference)
11. [Configuration Reference](#configuration-reference)
12. [All npm Commands](#all-npm-commands)
13. [Libraries & Utilities](#libraries--utilities)
14. [UI Components](#ui-components)
15. [Self-Healing Logic](#self-healing-logic)
16. [Monitoring & Analytics](#monitoring--analytics)
17. [CI/CD Integration](#cicd-integration)
18. [Low-Level Design & Algorithms](#low-level-design--algorithms)
19. [Project Structure](#project-structure)
20. [Troubleshooting](#troubleshooting)

---

## Project Overview

### Purpose

This project is a **full-stack testing and automation laboratory** for Contentstack that validates:

- **Content Delivery:** Published entries served via Delivery API (frontend app)
- **Performance:** Launch site warmup and URL hitting for cache/perf testing
- **Analytics Metering:** CMA operations drive meter events that feed analytics dashboards
- **Meter Coverage:** ALL meter dimensions tested (users, branches, locales, workflows, stages, deletions)
- **Lifecycle Simulation:** Realistic content patterns (aging, branching, multi-user, orphaning)
- **Multi-User Scenarios:** Round-robin automation across multiple users
- **Advanced Auth:** TOTP/2FA support for restricted accounts
- **Entry Templating:** Dynamic field value generation via placeholders
- **Locale Experiments:** Destructive testing framework for fallback chains

### The Problem

Analytics dashboards (CMS Content Lifecycle, Workflow Health, Team Adoption) depend on accurate meter events from Contentstack CMA operations. Current testing is shallow:

- ❌ Only fresh entries (no aged data)
- ❌ Single user (no multi-user dimensions)
- ❌ No branching (no lineage events)
- ❌ No deletions (no deletion metering)
- ❌ No orphaning scenarios (no cleanup validation)
- ❌ Manual setup required (content types, locales, workflows)
- ❌ No multi-user testing
- ❌ No locale fallback validation
- ❌ No entry templating

### The Solution

Three integrated components:

1. **Frontend App** — Vite + React displaying published entries from Delivery API with digest/changelog UI and 3D hero
2. **Performance Testing** — Cache warming, URL hitting, concurrent Delivery API testing
3. **Automation Framework** — CMA lifecycle automation driving ALL meter dimensions with 24+ scripts, multi-user simulation, locale experiments, TOTP/2FA support, entry templating, and self-healing

Together they create a **production-grade testing environment** running continuously (every 5 minutes in CI) to generate comprehensive meter events for analytics validation.

---

## What's Included

```mermaid
graph TB
    subgraph Frontend["FRONTEND (Vite + React)"]
        APP["Entry Listing App<br/>Delivery API integration<br/>Per-entry routes"]
        DIGEST["Digest/Changelog UI<br/>Unified feed, filters"]
        HERO["3D Hero<br/>Three.js/React Three Fiber"]
    end
    
    subgraph Performance["PERFORMANCE TESTING"]
        LAUNCH["Launch Site Warming<br/>Cache priming"]
        HITTING["URL Hitting<br/>100x+ concurrent GETs"]
        WARMUP["Delivery Warmup<br/>Perf validation"]
    end
    
    subgraph Automation["AUTOMATION FRAMEWORK (24+ Scripts)"]
        BOOTSTRAP["Bootstrap Phase (4 scripts)<br/>Create CTs, locales, workflows, rules"]
        PERIODIC["Periodic Phase (8 scripts)<br/>Delete, Backfill, Create, Localize,<br/>Publish, Transition, Churn, Branch"]
        METER["Meter-Coverage (6 scenarios)<br/>Edit, Delete, Stall, No-WF,<br/>Multi-Actor, Orphan"]
        ADVANCED["Advanced (6+ scripts)<br/>Locale experiments, user inviter,<br/>single-entry creator, role manager"]
    end
    
    subgraph Features["ADVANCED FEATURES"]
        MULTIUSER["Multi-User Simulation<br/>Round-robin tokens<br/>Distinct user_uid"]
        AUTH["Authentication (4 Paths)<br/>Authtoken, Email+Pwd,<br/>2FA/TOTP, TFA Token"]
        PLACEHOLDER["Entry Placeholders<br/>__TIMESTAMP__, __UUID__,<br/>__RANDOM_*, __TAX_TERMS__"]
        LOCALE["Locale Experiments<br/>Destructive testing<br/>Fallback chains"]
        WORKFLOW["Workflow Patterns (5)<br/>Linear, Skip, Rework,<br/>Stall, FirstOnly"]
    end
    
    Frontend --> APP
    Frontend --> DIGEST
    Frontend --> HERO
    Performance --> LAUNCH
    Performance --> HITTING
    Performance --> WARMUP
    Automation --> BOOTSTRAP
    Automation --> PERIODIC
    Automation --> METER
    Automation --> ADVANCED
    Features --> MULTIUSER
    Features --> AUTH
    Features --> PLACEHOLDER
    Features --> LOCALE
    Features --> WORKFLOW
```

---

## Quick Start

### Frontend App (5 min)

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

### Automation (Bootstrap + Periodic, 40 min)

```bash
# Fill in CMA vars in .env
CONTENTSTACK_MANAGEMENT_TOKEN=...
CONTENTSTACK_USER_EMAIL=...
CONTENTSTACK_USER_PASSWORD=...
CONTENTSTACK_PUBLISH_ENVIRONMENT=...

# Bootstrap (one-time setup)
npm run automate:drive:bootstrap

# Periodic (10k entries, all meter coverage)
npm run automate:drive

# View dashboard
# Open http://localhost:5173/runs
```

### Performance Testing (5 min)

```bash
npm run warm:launch-urls
# Results: public/warmup-report.json
```

---

## Team Onboarding

### For Frontend Developers

**Goal:** Understand how the React app uses Contentstack Delivery API to list and display published entries.

**Quick Start:**

```bash
# 1. Copy env template
cp .env.example .env

# 2. Fill in Delivery API credentials
VITE_CONTENTSTACK_API_KEY=your_api_key
VITE_CONTENTSTACK_DELIVERY_TOKEN=your_token
VITE_CONTENTSTACK_ENVIRONMENT=production
VITE_CONTENTSTACK_DELIVERY_HOST=https://cdn.contentstack.io

# 3. Start dev server
npm install
npm run dev

# 4. Open http://localhost:5173
# You'll see published entries with digest UI and 3D hero
```

**Key Files:**
- `src/pages/EntryPage.jsx` — Single entry display via route `/entry/:contentTypeUid/:entryUid`
- `src/pages/HomePage.jsx` — Entry listing with pagination and filters
- `src/pages/RunsDashboard.jsx` — Automation KPI dashboard
- `src/components/DigestItem.jsx` — Changelog entry grouping
- `src/components/HeroCanvas.jsx` — Three.js 3D visualization
- `src/components/Layout.jsx` — App shell and navigation
- `src/lib/contentstackDelivery.js` — Delivery API client
- `vite.config.js` — Vite + React setup

**Environment Variables (Frontend):**

| Variable | Purpose | Required |
|----------|---------|----------|
| `VITE_CONTENTSTACK_API_KEY` | Stack API key | Yes |
| `VITE_CONTENTSTACK_DELIVERY_TOKEN` | Delivery API token (read-only) | Yes |
| `VITE_CONTENTSTACK_ENVIRONMENT` | Target environment uid | Yes |
| `VITE_CONTENTSTACK_DELIVERY_HOST` | CDN URL (e.g., `https://cdn.contentstack.io`) | Yes |
| `VITE_CONTENTSTACK_CONTENT_TYPE_UIDS` | CSV of CTs to list | No (defaults to top_url_lines) |
| `VITE_CONTENTSTACK_BRANCH` | Branch (if using branches) | No |

**Features:**
✅ Per-entry routes (`/entry/:contentTypeUid/:entryUid`)  
✅ Unified digest/changelog UI with filters  
✅ Concurrent Delivery API calls  
✅ 3D hero rendering via Three.js  
✅ Branch support in Delivery API URLs  
✅ Header Refresh to reload entries  

---

### For QA/Performance Engineers

**Goal:** Understand how to warm the launch site and test Delivery API performance.

**Quick Start:**

```bash
# 1. Set env vars
export VITE_CONTENTSTACK_CONTENT_TYPE_UIDS=demo_plain_text,demo_json_rte
export LAUNCH_SITE_URL=https://yoursite.com
export APP_DELIVERY_HOST=https://cdn.contentstack.io

# 2. Run warmup
npm run warm:launch-urls

# 3. Check results
cat public/warmup-report.json
```

**Scripts:**
- `npm run warm:launch-urls` — Warms Launch site + concurrent Delivery API hits
- Results logged to console + `public/warmup-report.json`

**What It Tests:**
- Delivery API response time
- Cache hit/miss headers
- Entry list endpoint (100x concurrent GETs)
- Single-entry endpoint (100x concurrent GETs)
- Launch site availability

---

### For Automation Engineers

**Goal:** Understand CMA automation, meter coverage, self-healing, and advanced features.

**Quick Start:**

```bash
# 1. Set all CMA + automation vars in .env
cp .env.example .env
# Fill in: CONTENTSTACK_API_KEY, CONTENTSTACK_MANAGEMENT_TOKEN, 
#          CONTENTSTACK_USER_EMAIL, CONTENTSTACK_USER_PASSWORD, etc.

# 2. Bootstrap (one-time: create CTs, locales, workflows, branches)
npm run automate:drive:bootstrap

# 3. Run periodic (10k entries, all meter coverage)
npm run automate:drive

# 4. Monitor dashboard
# Open http://localhost:5173/runs (shows KPIs, success rate, trends)

# 5. Check run history
jq '.[-5:]' public/run-history.json
```

**Key Concepts:**
- **Self-healing:** Automation auto-creates missing locales, workflows, user roles (no manual setup)
- **Meter coverage:** 6 scenarios testing all dimension combinations
- **Data preservation:** No teardown — aged data kept for analytics
- **Volume:** 10,000 entries/run × 5 locales × multiple CTs = 250,000+ events/run
- **Multi-user:** Round-robin simulation across multiple management tokens
- **Advanced auth:** Support for TOTP/2FA via Google Authenticator algorithm
- **Entry templating:** Dynamic field values using __TIMESTAMP__, __UUID__, etc.
- **Locale experiments:** Destructive testing of fallback chains (optional, gated)

**Key Files:**
- `scripts/drive-all.mjs` — Orchestrator (bootstrap/periodic/full modes)
- `scripts/lib/cma.mjs` — CMA helpers + self-healing logic
- `scripts/` — 24+ specialized scripts (see All Scripts Reference)

---

### For Analytics/Data Engineers

**Goal:** Understand meter event generation and coverage validation.

**Key Points:**
- Automation creates realistic content patterns (branching, locales, workflows, aging, orphaning)
- Every CMA operation triggers events (entry_created, entry_published, entry_workflow_*, etc.)
- This repo GENERATES comprehensive meter events; downstream systems (analytics-data-sync, Kafka, ES) consume them
- We ensure all meter dimensions are covered; downstream dashboards are fed by this data

**Meter Coverage (What Gets Tested):**

| Meter | Dimension | Driver | Tested |
|-------|-----------|--------|--------|
| entries_created | locale | localize-entries.mjs | ✅ 5 locales × 10k |
| entries_created | content_type | periodic-entries.mjs | ✅ All CTs |
| entries_created | branch | branch-lifecycle.mjs | ✅ 30-branch lineage |
| entries_published | user_uid | multi-actor.mjs | ✅ 2+ users |
| entries_in_progress | — | edit-after-publish.mjs | ✅ Scenario |
| entries_deleted | — | permanent-deletes.mjs | ✅ Scenario |
| entries_without_workflow | — | no-workflow-ct.mjs | ✅ Scenario |
| stalled_by_stage | workflow_uid | aged-stalls.mjs | ✅ 5+ stages |
| snapshot (branch axis) | branch_uid | branch-lifecycle.mjs | ✅ Orphan |
| snapshot (locale axis) | locale_code | branch-locale-deletion.mjs | ✅ Orphan |
| org_users | — | invite-users.mjs | ✅ 10/run |

**Verification:**
- Check `public/run-history.json` for per-run KPIs
- Monitor dashboard at `/runs` for trends
- Verify CMA operations succeeded via run-history.json success rate
- Confirm all meter dimensions covered in KPIs

---

### For DevOps/Infrastructure

**Goal:** Deploy automation to CI, manage secrets, monitor health.

**CI Setup (GitHub Actions):**

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
          CONTENTSTACK_PUBLISH_ENVIRONMENT: production
          CONTENTSTACK_USER_EMAIL: ${{ secrets.CONTENTSTACK_USER_EMAIL }}
          CONTENTSTACK_USER_PASSWORD: ${{ secrets.CONTENTSTACK_USER_PASSWORD }}
```

**Secrets to Configure (GitHub → Settings → Secrets and variables → Actions):**
- `CONTENTSTACK_API_KEY`
- `CONTENTSTACK_MANAGEMENT_TOKEN`
- `CONTENTSTACK_PUBLISH_ENVIRONMENT`
- `CONTENTSTACK_USER_EMAIL`
- `CONTENTSTACK_USER_PASSWORD`

**Monitoring:**
- Dashboard at `/runs` shows 95%+ success rate, KPI trends
- Run history appended to `public/run-history.json`
- Alert if > 5% step failures in rolling 24h window

---

## Core Architecture

### System Flow & Architecture

#### 1. High-Level System Architecture

```mermaid
graph TB
    subgraph Repo["THIS REPO"]
        subgraph FrontEnd["Frontend Layer"]
            FE["Frontend App<br/>(Vite + React)"]
            PERF["Performance Testing<br/>(URL Hitting)"]
        end
        
        subgraph AutoMation["Automation Framework<br/>(24+ Scripts)"]
            subgraph Bootstrap["Bootstrap Phase (1x setup)"]
                BS1["bootstrap-from-manifest"]
                BS2["seed-locales-branches"]
                BS3["seed-workflows"]
                BS4["seed-publishing-rules"]
            end
            
            subgraph Periodic["Periodic Phase (5min)"]
                P1["delete-old-entries<br/>(tiered retention)"]
                P2["backfill-aged-entries<br/>(restore from trash)"]
                P3["periodic-entries-from-manifest<br/>(10k entries)"]
                P4["localize-entries<br/>(5 locales)"]
                P5["bulk-publish-cycle<br/>(60% pub, 15% unpub)"]
                P6["seed-workflows<br/>(5 patterns)"]
                P7["churn-orphans<br/>(branch lifecycle)"]
                P8["branch-lifecycle<br/>(30-branch lineage)"]
            end
            
            subgraph Coverage["Meter-Coverage Phase (6 scenarios)"]
                C1["edit-after-publish"]
                C2["permanent-deletes"]
                C3["aged-stalls"]
                C4["no-workflow-ct"]
                C5["multi-actor-create-publish"]
                C6["branch-locale-deletion"]
            end
            
            subgraph UserMgmt["User Management"]
                U1["invite-users<br/>(10 new/run)"]
            end
            
            subgraph Utilities["Utilities & Standalone"]
                U2["create-and-publish-entry"]
                U3["ensure-stack-user-role"]
                U4["locale-experiments"]
                U5["warm-launch-urls"]
                ORCH["drive-all.mjs<br/>(Orchestrator)"]
            end
            
            subgraph Libraries["Libraries & Utils"]
                LIB1["cma.mjs<br/>(CMA + self-heal)"]
                LIB2["totp.mjs"]
                LIB3["entry-placeholders"]
                LIB4["workflow-patterns"]
                LIB5["schema-from-fields"]
                LIB6["progress + report"]
            end
        end
    end
    
    subgraph Stack["Contentstack Stack"]
        CMAAPI["Management API<br/>REST"]
        DELAPI["Delivery API<br/>REST"]
        ORGADMIN["Org Admin<br/>Portal"]
    end
    
    subgraph Events["Generated Events"]
        KAFKA["Kafka<br/>entry_created, entry_published,<br/>entry_deleted, entry_workflow_*<br/>org_user_invited, org_user_role_*"]
    end
    
    subgraph Downstream["Downstream Systems<br/>(External)"]
        MONGO["Mongo<br/>(analytics-data-sync)"]
        ES["Elasticsearch<br/>(METRIC_DATA_INDEX)"]
        DASH["CMS Dashboards<br/>(Content Lifecycle,<br/>Workflow Health,<br/>Team Adoption)"]
    end
    
    FE -->|Reads published| DELAPI
    PERF -->|100x concurrent GETs| DELAPI
    
    ORCH -->|Orchestrates| Bootstrap
    ORCH -->|Orchestrates| Periodic
    ORCH -->|Orchestrates| Coverage
    ORCH -->|Orchestrates| UserMgmt
    
    Bootstrap -->|Uses| Libraries
    Periodic -->|Uses| Libraries
    Coverage -->|Uses| Libraries
    UserMgmt -->|Uses| Libraries
    
    Bootstrap -->|Creates/Queries| CMAAPI
    Periodic -->|Creates/Updates/Deletes| CMAAPI
    Coverage -->|Drives meter scenarios| CMAAPI
    UserMgmt -->|Invites| ORGADMIN
    
    CMAAPI -.->|Triggers| KAFKA
    ORGADMIN -.->|Triggers| KAFKA
    
    KAFKA -->|Events flow| MONGO
    MONGO -->|Snapshot scan| ES
    ES -->|Powers| DASH
    
    style Bootstrap fill:#e1f5ff
    style Periodic fill:#e1f5ff
    style Coverage fill:#fff3e0
    style UserMgmt fill:#f3e5f5
    style Libraries fill:#e8f5e9
    style FrontEnd fill:#fce4ec
```

#### 2. Complete Automation Workflow & Dependencies

```mermaid
graph LR
    CI["CI Trigger<br/>(every 5 min)"]
    
    ORCH["drive-all.mjs<br/>Orchestrator"]
    
    subgraph Init["BOOTSTRAP (one-time)"]
        B1["1. bootstrap-from-manifest<br/>(create CTs, fields)"] --> B2["2. seed-locales-branches<br/>(create locales + 30-branch lineage)"]
        B2 --> B3["3. seed-workflows<br/>(create 5 workflow pattern templates)"]
        B3 --> B4["4. seed-publishing-rules<br/>(setup publishing rules)"]
    end
    
    subgraph Maint["MAINTENANCE (every run)"]
        M0["0. Ensure CMS roles<br/>(auto-assign to users)"]
        M0 --> M1["1. delete-old-entries<br/>(tiered retention: >30d=5k, 15-30d=10k, 7-15d=20k)"]
        M1 --> M2["2. backfill-aged-entries<br/>(restore from trash if below target)"]
        M2 --> M3["3. periodic-entries-from-manifest<br/>(create 10k entries × 5 CTs)"]
    end
    
    subgraph Lifecycle["LIFECYCLE (every run)"]
        L1["4. localize-entries<br/>(5 non-master locales w/ fallback)"] --> L2["5. bulk-publish-cycle<br/>(60% pub, 15% unpub)"]
        L2 --> L3["6. branch-lifecycle<br/>(30-branch lineage, 10x entry churn)"]
        L3 --> L4["7. churn-orphans<br/>(orphan cleanup %)"]
        L4 --> L5["8. seed-workflows with transitions<br/>(Linear, Skip, Rework, PartialStall, FirstOnly)"]
    end
    
    subgraph Meter["METER-COVERAGE (6 scenarios, sequential)"]
        MC1["• edit-after-publish<br/>(entry_published → entry_updated)"] --> MC2["• permanent-deletes<br/>(entry_deleted events)"]
        MC2 --> MC3["• aged-stalls<br/>(entries in-progress > 30d)"]
        MC3 --> MC4["• no-workflow-ct<br/>(entries on CTs without workflow)"]
        MC4 --> MC5["• multi-actor-create-publish<br/>(round-robin token users)"]
        MC5 --> MC6["• branch-locale-deletion<br/>(orphan events via branch/locale delete)"]
    end
    
    subgraph Users["USER-MANAGEMENT"]
        UM["invite-users (10 per run)<br/>+ CMS role assignment"]
    end
    
    subgraph Output["OUTPUT & REPORTING"]
        HIST["run-history.json<br/>(append KPIs)"]
        DASH["RunsDashboard at /runs<br/>(show trends, errors)"]
    end
    
    CI --> ORCH
    ORCH -->|Run once| Init
    ORCH -->|Run every cycle| Maint
    Maint --> Lifecycle
    Lifecycle --> Meter
    Meter --> Users
    Users --> HIST
    HIST --> DASH
    
    style CI fill:#ffecb3
    style Init fill:#e1f5ff
    style Maint fill:#e1f5ff
    style Lifecycle fill:#fff3e0
    style Meter fill:#f3e5f5
    style Users fill:#e8f5e9
    style Output fill:#fff9c4
```

#### 3. Entry Placeholder Resolution Flow (LLD)

```mermaid
graph TD
    START["Entry from manifest<br/>with placeholder fields"] --> PARSE["Parse field values<br/>for placeholders<br/>(__TIMESTAMP__, __UUID__,<br/>__RANDOM_INT__, __RANDOM_CHOICE__,<br/>__ENTRY_UID__, __TAX_TERMS__)"]
    
    PARSE --> CHECK{"Placeholder<br/>found?"}
    CHECK -->|__TIMESTAMP__| TS["Resolve to ISO<br/>current timestamp"]
    CHECK -->|__UUID__| UUID["Resolve to<br/>uuidv4()"]
    CHECK -->|__RANDOM_INT__| RINT["Resolve to Math.random()<br/>within bounds"]
    CHECK -->|__RANDOM_CHOICE__| RCHOICE["Resolve to<br/>choice from array"]
    CHECK -->|__ENTRY_UID__| EUID["Resolve to<br/>entry.uid<br/>(for references)"]
    CHECK -->|__TAX_TERMS__| TAX["Resolve to<br/>taxonomy terms<br/>from config"]
    CHECK -->|No placeholder| NOOP["Use value as-is"]
    
    TS --> BUILD["Build final field<br/>with resolved value"]
    UUID --> BUILD
    RINT --> BUILD
    RCHOICE --> BUILD
    EUID --> BUILD
    TAX --> BUILD
    NOOP --> BUILD
    
    BUILD --> ENTRY["Create/update entry<br/>with resolved fields"]
    ENTRY --> TRIGGER["Trigger entry_created<br/>or entry_updated<br/>event"]
    
    style START fill:#fff3e0
    style PARSE fill:#e1f5ff
    style CHECK fill:#ffe0b2
    style TS fill:#c8e6c9
    style UUID fill:#c8e6c9
    style RINT fill:#c8e6c9
    style RCHOICE fill:#c8e6c9
    style EUID fill:#c8e6c9
    style TAX fill:#c8e6c9
    style NOOP fill:#c8e6c9
    style BUILD fill:#f8bbd0
    style ENTRY fill:#ffccbc
    style TRIGGER fill:#fff9c4
```

#### 4. Frontend Integration & React Component Architecture

```mermaid
graph TB
    subgraph Frontend["Frontend (Vite + React)<br/>Port 5173"]
        Router["React Router<br/>Routes"]
        
        subgraph Pages["Pages"]
            HomePage["HomePage.jsx<br/>Paginated entry list,<br/>filters, digest grouping"]
            EntryPage["EntryPage.jsx<br/>Single entry detail,<br/>field rendering"]
            RunsDash["RunsDashboard.jsx<br/>Automation KPIs,<br/>trends, errors"]
        end
        
        subgraph Components["Components"]
            Layout["Layout.jsx<br/>(shell, nav)"]
            Digest["DigestItem.jsx<br/>(changelog grouping)"]
            Hero["HeroCanvas.jsx<br/>(Three.js 3D)"]
        end
        
        subgraph Libs["Libraries"]
            DeliveryLib["contentstackDelivery.js<br/>(Delivery API client)"]
            FormatLib["entryFormat.js<br/>(field formatting)"]
            ExcerptLib["entryExcerpt.js<br/>(entry summarization)"]
            EventsLib["siteEvents.js<br/>(analytics tracking)"]
        end
    end
    
    subgraph External["External APIs"]
        DeliveryAPI["Contentstack<br/>Delivery API<br/>(published entries)"]
        StaticFiles["Static Files<br/>(run-history.json,<br/>warmup-report.json)"]
    end
    
    Router --> HomePage
    Router --> EntryPage
    Router --> RunsDash
    Router --> Layout
    
    HomePage --> Digest
    HomePage --> Layout
    EntryPage --> Layout
    RunsDash --> Layout
    
    HomePage --> DeliveryLib
    EntryPage --> DeliveryLib
    Digest --> FormatLib
    HomePage --> ExcerptLib
    EntryPage --> ExcerptLib
    
    HomePage --> EventsLib
    EntryPage --> EventsLib
    RunsDash --> EventsLib
    
    DeliveryLib -->|Concurrent GETs<br/>100x+ calls| DeliveryAPI
    RunsDash -->|Reads JSON| StaticFiles
    
    Pages --> Hero
    
    style Pages fill:#fce4ec
    style Components fill:#f3e5f5
    style Libs fill:#e8f5e9
    style External fill:#e0e0e0
```

#### 5. Complete Data Flow: CMA Operation → Events → Analytics Dashboard

```mermaid
graph LR
    subgraph Origins["CMA Operations<br/>(Automation generates)"]
        O1["📝 entry_created<br/>(10k/run)"]
        O2["🌍 entry_localized<br/>(5 locales)"]
        O3["📤 entry_published<br/>(60% of entries)"]
        O4["🔄 entry_workflow_*<br/>(5 patterns)"]
        O5["🗑️ entry_deleted<br/>(aged entries)"]
        O6["👤 org_user_invited<br/>(10 new/run)"]
    end
    
    subgraph Transport["Kafka Transport"]
        KAFKA["Kafka Cluster<br/>(Topic per operation)"]
    end
    
    subgraph Snapshot["Mongo Snapshot<br/>(analytics-data-sync)"]
        MONGO["Mongo collections<br/>cms-content-lifecycle,<br/>cms-workflow-health,<br/>cms-team-adoption,<br/>organization"]
    end
    
    subgraph Index["Elasticsearch<br/>METRIC_DATA_INDEX"]
        ES1["Dimension: user_uid<br/>(multi-user tracking)"]
        ES2["Dimension: branch<br/>(30-branch lineage)"]
        ES3["Dimension: locale<br/>(5 locales + master)"]
        ES4["Dimension: workflow_stage<br/>(5 patterns)"]
        ES5["Metric: entries_created"]
        ES6["Metric: entries_published"]
        ES7["Metric: entries_in_progress"]
        ES8["Metric: entries_stalled"]
    end
    
    subgraph Dashboard["Contentstack CMS Dashboards"]
        D1["📊 Content Lifecycle<br/>(entries_created, published, deleted)"]
        D2["⚙️ Workflow Health<br/>(in-progress, stalled_by_stage,<br/>transition patterns)"]
        D3["👥 Team Adoption<br/>(entries_per_author,<br/>user_activity_ratio)"]
    end
    
    O1 -->|triggered| KAFKA
    O2 -->|triggered| KAFKA
    O3 -->|triggered| KAFKA
    O4 -->|triggered| KAFKA
    O5 -->|triggered| KAFKA
    O6 -->|triggered| KAFKA
    
    KAFKA -->|consume| MONGO
    MONGO -->|nightly cron| ES1
    MONGO -->|nightly cron| ES2
    MONGO -->|nightly cron| ES3
    MONGO -->|nightly cron| ES4
    MONGO -->|nightly cron| ES5
    MONGO -->|nightly cron| ES6
    MONGO -->|nightly cron| ES7
    MONGO -->|nightly cron| ES8
    
    ES1 --> D1
    ES5 --> D1
    ES6 --> D1
    ES7 --> D1
    
    ES2 --> D2
    ES3 --> D2
    ES4 --> D2
    ES8 --> D2
    
    ES2 --> D3
    ES1 --> D3
    
    style Origins fill:#fff3e0
    style Transport fill:#e0e0e0
    style Snapshot fill:#b3e5fc
    style Index fill:#c8e6c9
    style Dashboard fill:#f8bbd0
```

---

## Frontend Application

### Routes & Features

| Route | Purpose | Features |
|-------|---------|----------|
| `/` | Home/Entry list | Unified feed, filters, pagination, 3D hero |
| `/entry/:ct/:uid` | Single entry display | Detail view, formatted fields, markdown |
| `/runs` | Automation dashboard | KPIs, success rates, trends, error logs |

### Components

- **EntryPage** — Single entry with fields, markdown rendering, reference expansion
- **HomePage** — Paginated list, filtering, search, digest grouping
- **RunsDashboard** — Real-time KPI tracking, trends, failure logs
- **DigestItem** — Changelog entries with grouping and filters
- **HeroCanvas** — Three.js 3D visualization (React Three Fiber)
- **Layout** — App shell with navigation

### Features

✅ Per-entry routes (`/entry/:contentTypeUid/:entryUid`)  
✅ Unified digest/changelog UI with filters  
✅ Concurrent Delivery API calls (100x+)  
✅ 3D hero rendering via Three.js  
✅ Branch support in Delivery API URLs  
✅ Header Refresh to reload entries  
✅ Markdown field rendering  
✅ Reference field expansion  
✅ Group/block field rendering  

---

## Performance Testing

### URL Hitting & Warmup

**Feature:** Warm cache and test Delivery API performance concurrently.

```bash
npm run warm:launch-urls
```

**What Gets Tested:**
- Delivery API entry list endpoint (100x concurrent requests)
- Single-entry endpoint (100x concurrent requests)
- Cache hit/miss headers
- Response time percentiles (p50, p95, p99)
- Launch site availability

**Reports:**
- **Console:** Real-time request counts, status codes, cache hits
- **public/warmup-report.json:** Aggregated stats (avg time, p95, cache hits, failures)

---

## Automation Framework

### All 24+ Scripts

**[See "All 24+ Scripts Reference" section below for complete list]**

---

## Advanced Features

### 1. Multi-User Simulation

**Round-robin actions across multiple management tokens:**

```bash
CONTENTSTACK_MANAGEMENT_TOKENS=token1,token2,token3
```

Effects:
- Rotate through tokens for each CMA request
- Each request carries token owner's user_uid in metering events
- Drives `entries_published.user_uid` distinct dimension
- Tests multi-author scenarios without needing separate user credentials

---

### 2. Authentication: 4 Paths for Workflow Transitions

**Management tokens CANNOT change workflow stages. Four auth paths available:**

**Path 1: Cached Authtoken (Fastest)**
```bash
CONTENTSTACK_USER_AUTHTOKEN=<long-lived token>
```
- Skips login entirely
- Valid for weeks
- Get from: Browser DevTools → Application → Cookies → `authtoken`
- Or: One-off interactive login

**Path 2: Email + Password + TOTP (2FA)**
```bash
CONTENTSTACK_USER_EMAIL=user@example.com
CONTENTSTACK_USER_PASSWORD=password
CONTENTSTACK_USER_TOTP_SECRET=JBSWY3DPEHPK3PXP
```
- Computes rotating 6-digit code using Google Authenticator algorithm
- No external dependencies (uses Node.js built-in crypto)
- To obtain TOTP secret:
  1. Contentstack UI → User Settings → Security → Two-Factor Auth
  2. Disable 2FA if enabled
  3. Re-enable 2FA → QR code appears
  4. Click "Can't scan? / Show key" to reveal base32 secret
  5. Copy before completing setup
  6. Add to authenticator app AND to .env

**Path 3: Email + Password (No 2FA)**
```bash
CONTENTSTACK_USER_EMAIL=user@example.com
CONTENTSTACK_USER_PASSWORD=password
```
- Fails if 2FA is enabled on account
- Only for accounts without 2FA

**Path 4: One-Off Interactive (Manual)**
```bash
CONTENTSTACK_USER_EMAIL=user@example.com
CONTENTSTACK_USER_PASSWORD=password
CONTENTSTACK_USER_TFA_TOKEN=123456
```
- Use current 6-digit code (~30s valid)
- Only for manual testing

---

### 3. Entry Placeholders & Templating

**Dynamic field value generation using templates:**

Supported placeholders:
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
  "score": "__RANDOM_INT(1,100)__",
  "category": "__RANDOM_CHOICE(a,b,c)__"
}
```

---

### 4. Locale Experiments (Destructive Testing)

**Test locale fallback chains and orphaning scenarios:**

```bash
# Enable and run (never runs in normal cron)
CONTENTSTACK_RUN_LOCALE_EXPERIMENTS=1 npm run automate:locale-experiments
```

**What It Does:**
1. Create locales specified in manifest
2. Populate with entries
3. Delete locales (creates orphans)
4. Verify orphaning events
5. Optionally recreate locales

**Manifest:** `scripts/locale-experiments.manifest.json`

**Events Driven:** `entries_orphaned_by_locale_deleted`

**WARNING:** Destructive — deletes entries and locales. Must be explicitly enabled.

---

### 5. Workflow Patterns (5 Types)

**Test different workflow transition scenarios:**

| Pattern | Flow | Use Case | Weight |
|---------|------|----------|--------|
| **Linear** | [0→1→2] | Standard: Draft → Review → Approved | 30% |
| **Skip** | [0→2] | Fast-track: Draft → Approved | 10% |
| **Rework** | [0→1→0→1→2] | Revisions: Send back then forward | 20% |
| **PartialStall** | [0→1] | Stuck in middle: Draft → Review (no progress) | 20% |
| **FirstOnly** | [0] | No transition: Stays in Draft | 20% |

---

## All 24+ Scripts Reference

### Orchestration

| Script | Purpose | Mode |
|--------|---------|------|
| `drive-all.mjs` | Master orchestrator | bootstrap/periodic/full |

### Bootstrap Phase (Foundation)

| Script | Purpose | Triggers |
|--------|---------|----------|
| `bootstrap-from-manifest.mjs` | Create content types from manifest | One-time |
| `seed-locales-branches.mjs` | Create locales (with fallback) + branches | One-time |
| `seed-workflows.mjs` | Create workflows + stages | One-time |
| `seed-publishing-rules.mjs` | Create publish rules for workflows | One-time |

### Periodic Phase (Lifecycle)

| Script | Purpose | Volume |
|--------|---------|--------|
| `delete-old-entries.mjs` | Tiered retention (3 age bands) | 3-10k |
| `backfill-aged-entries.mjs` | Restore from trash if below targets | 0-2k |
| `periodic-entries-from-manifest.mjs` | Bulk create entries (concurrent) | 10,000 |
| `localize-entries.mjs` | Multi-locale (auto-create missing) | 50,000 |
| `bulk-publish-cycle.mjs` | Publish/unpublish cycle | 6,000 |
| `seed-workflows.mjs` | Transition entries (5 patterns) | 2,000 |
| `churn-orphans.mjs` | Edge cases (disable, detach, restore) | variable |
| `branch-lifecycle.mjs` | 30-branch lineage + dynamic CTs | variable |

### Meter-Coverage Scenarios (6x)

| Script | Meter | Purpose |
|--------|-------|---------|
| `edit-after-publish.mjs` | entries_in_progress | Publish → edit |
| `permanent-deletes.mjs` | entries_deleted | Hard delete |
| `aged-stalls.mjs` | stalled_by_stage | Mid-stage stalls |
| `no-workflow-ct.mjs` | entries_without_workflow | Bare CT |
| `multi-actor-create-publish.mjs` | entries_published.user_uid | 2 users |
| `branch-locale-deletion.mjs` | snapshot orphan axes | Branch/locale delete |

### User Management

| Script | Purpose | Method |
|--------|---------|--------|
| `invite-users.mjs` | Invite 10 users + assign CMS roles | Playwright UI automation |

### Standalone/One-Off

| Script | Purpose | Trigger |
|--------|---------|---------|
| `create-and-publish-entry.mjs` | Create and publish single entry | `npm run automate:entry` |
| `ensure-stack-user-role.mjs` | Ensure user has CMS role | `npm run automate:ensure-role` |
| `locale-experiments.mjs` | Destructive locale testing | `npm run automate:locale-experiments` |
| `warm-launch-urls.mjs` | Warm Delivery API cache | `npm run warm:launch-urls` |

---

## Configuration Reference

### Complete .env Options

**[See .env.example for all 60+ options with detailed comments]**

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
npm run automate:entries:periodic:ci   # Periodic: CI mode
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

## Libraries & Utilities

### CMA Helpers (lib/cma.mjs)

Core functions:
- `loadStackAuth()` — Parse auth from .env
- `headersForToken()` — Build CMA headers
- `createEntry()` — Create with self-healing
- `listLocales()` — List locales
- `createLocale()` — Auto-create if missing
- `transitionEntryWorkflow()` — Transition with user session
- `ensureUserHasCMSRole()` — Auto-assign role
- `ensureWorkflowExists()` — Auto-create workflow
- `ensureContentTypeExists()` — Auto-create CT

### Advanced Libraries

**lib/totp.mjs:** TOTP code generation (Google Authenticator compatible, no external deps)

**lib/entry-placeholders.mjs:** Template expansion (__TIMESTAMP__, __UUID__, __RANDOM_*, __TAX_TERMS__)

**lib/schema-from-fields.mjs:** Auto-generate schema from field definitions

**lib/workflow-patterns.mjs:** 5 transition pattern types with weighted distribution

**lib/progress.mjs:** Concurrent task tracking, real-time progress logging

**lib/report.mjs:** Per-step KPI collection, run-history append

### Frontend Libraries

**lib/contentstackDelivery.js:** Delivery API client

**lib/entryExcerpt.js:** Excerpt generation from rich content

**lib/entryFormat.js:** Field formatting for display

**lib/siteEvents.js:** Event tracking and analytics

---

## UI Components

| Component | Purpose | Features |
|-----------|---------|----------|
| **EntryPage** | Single entry rendering | Markdown, references, groups |
| **HomePage** | Entry listing | Pagination, filters, digest |
| **RunsDashboard** | KPI dashboard | Trends, errors, success rate |
| **DigestItem** | Changelog entry | Grouping, filtering |
| **HeroCanvas** | 3D visualization | Three.js, responsive |
| **Layout** | App shell | Navigation, state |

---

## Self-Healing Logic

**The automation detects and fixes missing prerequisites:**

| Problem | Auto-Fix | Result |
|---------|----------|--------|
| Locale missing | Create with fallback chain | Localization succeeds |
| Workflow missing | Create with default stages | Transitions work |
| User lacks CMS role | Assign via shareStack | User can operate |
| Content type missing | Create from manifest | Entries created |
| No trashed entries | Skip backfill gracefully | No error |

---

## Monitoring & Analytics

### Dashboard (`/runs`)

Real-time automation KPIs:

**Reliability:**
- Success rate per run (aim: 95%+)
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

### Run History

KPIs appended to `public/run-history.json` after each run:
- Timestamp, mode
- Per-step planned/actual/failed counts
- Aggregated KPIs
- Error audit log

---

## CI/CD Integration

[See above for GitHub Actions setup]

---

## Low-Level Design & Algorithms

### Entry Creation with Concurrency

- Batch creation with configurable concurrency (default 12)
- Graceful handling of org entry cap (133 error)
- Progress tracking per content type

### Tiered Retention Algorithm

- 3 age bands: >30d (keep 5k), 15-30d (keep 10k), 7-15d (keep 20k)
- Delete oldest excess per band
- Bounded growth while maintaining aged dataset

### Backfill from Trash

- Restore trashed entries if band falls below target
- Preserve original created_at timestamp
- Maintain "aged" status for analytics

### Workflow Transitions with 5 Patterns

- Linear, Skip, Rework, PartialStall, FirstOnly
- Weighted distribution (30%, 10%, 20%, 20%, 20%)
- Per-stage error handling

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
│   │   ├── contentstackDelivery.js   # Delivery API
│   │   ├── entryExcerpt.js           # Excerpts
│   │   ├── entryFormat.js            # Formatting
│   │   └── siteEvents.js             # Events
│   └── App.jsx, main.jsx
│
├── scripts/                       # Automation (24+ scripts)
│   ├── drive-all.mjs              # Orchestrator
│   ├── bootstrap-*.mjs (4)         # Bootstrap phase
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
│   │   ├── totp.mjs              # TOTP code generation
│   │   ├── entry-placeholders.mjs    # Template expansion
│   │   ├── schema-from-fields.mjs    # Schema generation
│   │   ├── workflow-patterns.mjs     # Transition patterns
│   │   ├── progress.mjs          # Progress tracking
│   │   └── report.mjs            # KPI reporting
│   └── manifests/                # Config files
│       ├── content-types.manifest.json
│       ├── workflows.manifest.json
│       ├── locales-branches.manifest.json
│       ├── locale-experiments.manifest.json
│       └── publishing-rules.manifest.json
│
├── public/
│   ├── run-history.json          # Automation KPI history
│   └── warmup-report.json        # Performance report
│
├── .env.example                  # Environment template (60+ options)
├── package.json                  # Scripts + deps
└── README.md                     # This file
```

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| "Language not found (422)" | Missing locale | Auto-created on next run |
| "Workflow not found" | Missing workflow | Auto-created on next run |
| "Access denied (401)" | User lacks CMS role | Auto-assigned on next run |
| "TOTP invalid" | Expired/wrong code | Use CONTENTSTACK_USER_AUTHTOKEN or regenerate |
| "Entries > 30d all deleted" | Aggressive retention | Backfill restores from trash |
| "No trashed entries" | Never created entries | Skip backfill gracefully |
| "Entry cap hit (133)" | Org limit reached | Graceful stop, resume next run |

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

## Status

✅ **Production-ready** — Runs continuously in CI every 5 minutes  
✅ **24+ automation scripts** — Full lifecycle coverage  
✅ **Multi-user simulation** — Test distinct user dimensions  
✅ **TOTP/2FA support** — Secure auth for restricted accounts  
✅ **Locale experiments** — Destructive testing framework  
✅ **Entry templating** — Dynamic field value generation  
✅ **Self-healing** — Auto-create missing resources  
✅ **Frontend app** — Entry listing + dashboard + 3D rendering  
✅ **Performance testing** — 100x+ concurrent URL hitting  
✅ **All 60+ config options** — Comprehensive tuning  

---

**Last Updated:** 2026-06-21  
**Repository:** [contentstack-analytics-automation-lab](https://github.com/DiveshKumarChordia/contentstack-analytics-automation-lab)

