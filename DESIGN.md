# Design Documentation

## High-Level Architecture (HLA)

```mermaid
graph TB
    subgraph Contentstack["Contentstack CMS Stack"]
        CMA["CMA API<br/>(REST)"]
        DEL["Delivery API<br/>(Read-only)"]
        ORG["Org Admin<br/>Portal"]
        AUTH["Auth SDK<br/>(Validation)"]
    end
    
    subgraph Framework["Contentstack Metering Automation Framework"]
        subgraph Scripts["Scripts Layer"]
            DRIVE["drive-all.mjs<br/>(Orchestrator)"]
            LIB["lib/cma.mjs<br/>(Helpers +<br/>Self-healing)"]
            BOOTSTRAP["Bootstrap (4)<br/>CTs, Locales,<br/>Workflows, Rules"]
            PERIODIC["Periodic (8)<br/>Delete, Backfill,<br/>Create, Localize,<br/>Publish, Transition"]
            METER["Meter-Coverage (6)<br/>Edit, Delete, Stall,<br/>No-WF, Multi-Actor,<br/>Orphan"]
            ADVANCED["Advanced (6)<br/>User Inviter,<br/>Experiments,<br/>Role Manager"]
        end
        
        subgraph Reporting["Reporting Layer"]
            REPORT["lib/report.mjs<br/>(KPI Tracking)"]
            PROGRESS["lib/progress.mjs<br/>(Concurrency)"]
            DASHBOARD["RunsDashboard.jsx<br/>(Visualization)"]
        end
    end
    
    subgraph Events["Generated Events"]
        EVTS["✓ entry_created<br/>✓ entry_published<br/>✓ entry_deleted<br/>✓ entry_workflow_*<br/>✓ user_created<br/>+ more"]
        RUN["public/run-history.json<br/>(Our KPIs)"]
    end
    
    subgraph Downstream["Downstream (Not Our Repo)"]
        KAFKA["Kafka<br/>(Event consumption)"]
        MONGO["Mongo<br/>(analytics-data-sync)"]
        ES["ES<br/>(Materialization)"]
    end
    
    CMA --> DRIVE
    DEL --> SCRIPTS
    ORG --> SCRIPTS
    AUTH --> SCRIPTS
    
    DRIVE --> LIB
    DRIVE --> SCRIPTS
    SCRIPTS --> REPORT
    REPORT --> PROGRESS
    PROGRESS --> DASHBOARD
    
    SCRIPTS -->|Triggers| EVTS
    SCRIPTS -->|Generates| RUN
    
    EVTS --> KAFKA
    KAFKA --> MONGO
    MONGO --> ES
```

---

## Library & Component Architecture

```mermaid
graph TB
    subgraph Utils["Utility Libraries"]
        TOTP["lib/totp.mjs<br/>TOTP Code Generation"]
        PLACEHOLDER["lib/entry-placeholders.mjs<br/>Template Expansion"]
        SCHEMA["lib/schema-from-fields.mjs<br/>Schema Generation"]
        PATTERNS["lib/workflow-patterns.mjs<br/>5 Transition Types"]
        PROGRESS["lib/progress.mjs<br/>Concurrent Tracking"]
        REPORT["lib/report.mjs<br/>KPI Aggregation"]
    end
    
    subgraph Frontend["Frontend Libraries"]
        DELIVERY["lib/contentstackDelivery.js<br/>API Client"]
        EXCERPT["lib/entryExcerpt.js<br/>Excerpt Generation"]
        FORMAT["lib/entryFormat.js<br/>Field Formatting"]
        EVENTS["lib/siteEvents.js<br/>Event Tracking"]
    end
    
    subgraph Components["UI Components"]
        ENTRY["EntryPage<br/>Single Entry Display"]
        HOME["HomePage<br/>Entry Listing"]
        DIGEST["DigestItem<br/>Changelog Entry"]
        CANVAS["HeroCanvas<br/>Three.js 3D"]
        DASHBOARD["RunsDashboard<br/>KPI Dashboard"]
        LAYOUT["Layout<br/>App Shell"]
    end
    
    DELIVERY --> ENTRY
    DELIVERY --> HOME
    EXCERPT --> DIGEST
    FORMAT --> ENTRY
    FORMAT --> HOME
    EVENTS --> LAYOUT
    PLACEHOLDER --> Components
    SCHEMA --> Components
    PATTERNS --> Utils
    TOTP --> Utils
    PROGRESS --> REPORT
```

---

## Multi-User Simulation Flow

```mermaid
sequenceDiagram
    participant CI as CI/Manual
    participant Auto as Automation
    participant Tokens as Token Pool<br/>token1,token2,token3
    participant Stack as Contentstack
    
    CI->>Auto: Start with CONTENTSTACK_MANAGEMENT_TOKENS=...
    
    Auto->>Tokens: Token 1
    Tokens-->>Auto: Create entry (user_uid: A)
    Auto->>Stack: POST entry
    Stack-->>Auto: Entry created
    
    Auto->>Tokens: Token 2
    Tokens-->>Auto: Publish entry (user_uid: B)
    Auto->>Stack: POST publish
    Stack-->>Auto: Published (publisher: B)
    
    Auto->>Tokens: Token 3
    Tokens-->>Auto: Transition (user_uid: C)
    Auto->>Stack: POST transition
    Stack-->>Auto: Transitioned
    
    Note over Stack: Meter events carry distinct user_uids
    Note over Stack: entries_published.user_uid = {A, B, C}
```

---

## TOTP/2FA Authentication Flow

```mermaid
sequenceDiagram
    participant Script as Automation Script
    participant TOTP as lib/totp.mjs
    participant Auth as Contentstack Auth
    
    Script->>TOTP: generateTOTPToken(TOTP_SECRET)
    TOTP->>TOTP: Current time (30s window)
    TOTP->>TOTP: HMAC-SHA1(secret, time)
    TOTP-->>Script: 6-digit code
    
    Script->>Auth: POST /auth (email, password, 2FA_code)
    Auth-->>Script: authtoken (valid for weeks)
    
    Note over Script: Code valid for ~30s
    Note over Auth: authtoken valid for weeks
```

---

## Locale Experiments Flow

```mermaid
sequenceDiagram
    participant Script as locale-experiments.mjs
    participant Manifest as Manifest Config
    participant Stack as Contentstack
    
    Manifest-->>Script: Scenario config (create, populate, delete)
    
    Script->>Stack: 1. Create locale
    Stack-->>Script: Locale created
    
    Script->>Stack: 2. Populate with entries
    Stack-->>Script: Entries created
    Note over Stack: Drives entry_created events
    
    Script->>Stack: 3. Delete locale
    Stack-->>Script: Locale deleted
    Note over Stack: Drives entries_orphaned_by_locale_deleted
    
    Script->>Script: Optional: Recreate locale
```

---

## Entry Placeholder Resolution Flow

```mermaid
graph TD
    A["Entry Manifest<br/>title: Entry __TIMESTAMP__<br/>id: __UUID__<br/>score: __RANDOM_INT1,100__"] -->|Parse| B["lib/entry-placeholders.mjs"]
    
    B -->|__TIMESTAMP__| C["Current Unix<br/>timestamp"]
    B -->|__UUID__| D["Random<br/>UUID v4"]
    B -->|__RANDOM_INT__| E["Random<br/>number"]
    B -->|__RANDOM_CHOICE__| F["Pick from<br/>list"]
    B -->|__ENTRY_UID__| G["Current<br/>entry UID"]
    B -->|__TAX_TERMS__| H["Taxonomy<br/>mapping"]
    
    C --> I["Resolved Entry<br/>title: Entry 1718918400<br/>id: a3f8d5c2-4e1b-11ec-81d3<br/>score: 47"]
    D --> I
    E --> I
    F --> I
    G --> I
    H --> I
    
    I -->|Create| J["CMA API"]
    J -->|Success| K["Entry created<br/>with resolved<br/>values"]
```

---

## Frontend Integration Diagram

```mermaid
graph TB
    subgraph Frontend["Frontend (Vite + React)"]
        HOME["HomePage.jsx<br/>Entry list<br/>Digest grouping"]
        ENTRY["EntryPage.jsx<br/>Single entry<br/>Details view"]
        DASHBOARD["RunsDashboard.jsx<br/>KPI tracking<br/>Trend charts"]
        LAYOUT["Layout.jsx<br/>Navigation<br/>State"]
        
        HERO["HeroCanvas.jsx<br/>Three.js<br/>3D scene"]
        DIGEST["DigestItem.jsx<br/>Changelog<br/>Filters"]
    end
    
    subgraph Libraries["Frontend Libraries"]
        DELIVERY["lib/contentstackDelivery.js<br/>Delivery API client"]
        FORMAT["lib/entryFormat.js<br/>Field formatting"]
        EXCERPT["lib/entryExcerpt.js<br/>Excerpt generation"]
        EVENTS["lib/siteEvents.js<br/>Event tracking"]
    end
    
    subgraph External["External"]
        DELAPI["Delivery API<br/>Published entries"]
        RUNHIST["public/run-history.json<br/>Automation KPIs"]
    end
    
    LAYOUT -->|Routes| HOME
    LAYOUT -->|Routes| ENTRY
    LAYOUT -->|Routes| DASHBOARD
    
    HOME -->|Uses| DELIVERY
    ENTRY -->|Uses| DELIVERY
    ENTRY -->|Uses| FORMAT
    HOME -->|Uses| DIGEST
    DIGEST -->|Uses| EXCERPT
    HERO -->|Renders| HOME
    LAYOUT -->|Uses| EVENTS
    
    DELIVERY -->|Fetches| DELAPI
    DASHBOARD -->|Reads| RUNHIST
```

---

## Complete Data Flow: From Operation to Event

```mermaid
graph LR
    A["CMA Operation<br/>Create Entry"] -->|Executes| B["Contentstack<br/>Management API"]
    B -->|Triggers| C["Kafka Event<br/>entry_created"]
    
    D["Localize Entry"] -->|Executes| B
    D -->|Triggers| C
    
    E["Publish Entry"] -->|Executes| B
    E -->|Triggers| F["Kafka Event<br/>entry_published"]
    
    G["Transition<br/>Workflow"] -->|Executes| B
    G -->|Triggers| H["Kafka Event<br/>entry_workflow_*"]
    
    I["Delete Entry"] -->|Executes| B
    I -->|Triggers| J["Kafka Event<br/>entry_deleted"]
    
    K["Invite User"] -->|Via| L["Org Admin<br/>Portal"]
    L -->|Triggers| M["Kafka Event<br/>user_created"]
    
    C -->|Consumed by| N["Downstream<br/>Analytics Pipeline"]
    F -->|Consumed by| N
    H -->|Consumed by| N
    J -->|Consumed by| N
    M -->|Consumed by| N
    
    style A fill:#e1f5ff
    style D fill:#e1f5ff
    style E fill:#fff3e0
    style G fill:#f3e5f5
    style I fill:#ffebee
    style K fill:#e8f5e9
    style N fill:#f5f5f5
```

---

## ⭐ **4-Phase Analytics Architecture (New)**

### Local Analytics Pipeline

**The automation now includes a comprehensive 4-phase analytics system that extracts, normalizes, and visualizes 50+ KPIs.**

```mermaid
graph TD
    A["📝 Automation Run<br/>Operations + Events"] -->|Capture| B["🔍 Audit Trail<br/>50-100 entries<br/>timestamp, user, role,<br/>operation, success"]
    
    B -->|Phase 1| C["⚙️ AnalyticsEngine<br/>Extract 50+ KPIs<br/>instantiate engine<br/>on audit trail"]
    
    C -->|Save| D["💾 JSON Outputs<br/>audit-trail.json<br/>analytics.json"]
    
    D -->|Phase 2| E["📋 KPI Schema<br/>30+ fields<br/>Normalize + Validate<br/>Fill defaults"]
    
    E -->|Phase 3| F["📊 AggregateMetrics<br/>All-time totals<br/>Trends & health<br/>Reliability metrics"]
    
    F -->|Phase 4| G["📈 AdvancedDashboard<br/>5 Tabs<br/>50+ KPIs visible<br/>Interactive viz"]
    
    B -->|Also feeds| H["👥 RoleBasedUserBatch<br/>Extract role patterns<br/>User specialization<br/>Permission audit"]
    
    H -->|Combines with| G
    
    G -->|Integrates with| I["🎨 RunsDashboard.jsx<br/>Complete visualization<br/>Calendar heatmap<br/>Day analytics"]
    
    style A fill:#e8f4f8
    style C fill:#fff4e6
    style E fill:#f0e8f4
    style F fill:#f4e8e8
    style G fill:#e8f4e8
    style H fill:#f4f0e8
    style I fill:#e0f2f1
```

### Phase 1: Analytics Engine (Wire + Extract)

```
Input: Audit Trail (50-100 entries per run)
├─ timestamp, user_email, role
├─ operation, success/fail
└─ multi-user metadata

Processing:
├─ Instantiate AnalyticsEngine(auditTrail, roles)
├─ Extract 50+ KPIs automatically
├─ Persist audit trail to JSON
└─ Save analytics to separate JSON file

Output: 50+ Extracted KPIs
├─ Role-based: success_rate_by_role, operations_per_role, coverage
├─ Operation-based: success_per_op, sequences, errors
├─ User-based: reliability_ranking, specialization, workload
├─ Multi-user: collaboration_patterns, completion_rates
└─ (+ audit trail file for re-analysis)
```

### Phase 2: KPI Schema (Standardize)

```
Input: Per-script metrics (inconsistent)

Output: Standardized Schema
├─ Entry Lifecycle: created, published, deleted, localized
├─ Trimming: deleted_over_30d, deleted_15_30d, deleted_7_15d
├─ Localization: already, localize_failed
├─ Publishing: publish_failed, transitions_skipped
├─ Branches: branches_created, branch_entries, branch_localized
├─ Dynamic CTs: dyn_ct_created, dyn_ct_entries
├─ Workflows: workflow_branch_adds, publish_rules
├─ Churn: churn_all_wf, churn_branch, churn_restore, cases_ok
├─ Meter Coverage: edited_post_publish, entries_created, published_by_b
├─ Users: invited, invite_failed
└─ Capacity: cap_hit

All fields have:
├─ Type (number)
├─ Description
└─ Default (usually 0, sometimes null)
```

### Phase 3: Stack-Level Metrics

```
Input: All runs (historical)

Computation:
├─ All-Time Totals
│  ├─ run_count, entries_created, entries_published
│  ├─ entries_deleted, net_entries
│  └─ overall_success_rate, total_errors
│
├─ Trends (First half vs second half)
│  ├─ success_rate_trend: improving/degrading/stable
│  ├─ error_trend: improving/degrading/stable
│  └─ change percentages
│
├─ Health Score (0-100)
│  ├─ Based on recent 20 runs
│  ├─ success_rate (60 pts), error_rate (20 pts), consistency (20 pts)
│  └─ Status: healthy/acceptable/degraded/critical
│
├─ Reliability Metrics
│  ├─ MTBF (mean time between failures)
│  ├─ Current success streak
│  ├─ Longest success streak
│  └─ Failure rate %
│
└─ Patterns
   ├─ Top error messages (frequency count)
   ├─ Average entries per run
   └─ Duration percentiles (p50, p95, p99)
```

### Phase 4: Advanced Dashboard (Visualize)

```
Tab 1: All-Time Metrics
├─ Total runs card
├─ Entries created, published, localized cards
├─ Overall success rate (color coded)
└─ Net entries (created - deleted)

Tab 2: Health & Trends
├─ Health score circle (0-100, color coded)
├─ Component bars (success rate, error rate, consistency)
└─ Trend cards (success trend, error trend)

Tab 3: User Analysis
├─ Top users by reliability ranking
├─ User specialization cards (strengths, weak areas)
└─ Workload distribution

Tab 4: Operations
├─ Operation sequence patterns (top 10)
├─ Per-operation success rate bars
├─ User distribution per operation

Tab 5: Security
├─ Permission validation summary
├─ Violations detected (if any)
└─ Role coverage audit (% of allowed ops performed)
```

---

## Sequence Diagrams

### Bootstrap Flow

```mermaid
sequenceDiagram
    actor User as User/CI
    participant Auto as Automation
    participant Stack as Contentstack
    
    User->>Auto: --mode bootstrap
    Auto->>Stack: Create Content Types
    Stack-->>Auto: CT UIDs
    Auto->>Stack: Create Locales
    Stack-->>Auto: Locale Codes
    Auto->>Stack: Create Branches
    Stack-->>Auto: Branch UIDs
    Auto->>Stack: Create Workflows
    Stack-->>Auto: Workflow UIDs, Stages
    Auto->>Stack: Share Stack (RBAC)
    Stack-->>Auto: RBAC Records
    Auto-->>User: Bootstrap Complete
    Note over Auto: public/run-history.json appended
```

### Periodic Entry Lifecycle

```mermaid
sequenceDiagram
    actor User as User/CI
    participant Auto as Automation
    participant Stack as Contentstack
    
    User->>Auto: --mode periodic
    
    rect rgb(200, 150, 255)
    Note over Auto,Stack: Retention Phase
    Auto->>Stack: List Entries (by age)
    Stack-->>Auto: Entries by created_at
    Auto->>Stack: Delete (3 age bands)
    Stack-->>Auto: Delete Counts
    end
    
    rect rgb(200, 200, 255)
    Note over Auto,Stack: Backfill Phase
    Auto->>Stack: List Trashed
    Stack-->>Auto: Trashed Entry UIDs
    Auto->>Stack: Restore Entries
    Stack-->>Auto: Restore Counts
    end
    
    rect rgb(255, 200, 200)
    Note over Auto,Stack: Creation Phase
    Auto->>Stack: Create 10,000 Entries
    Stack-->>Auto: Entry UIDs
    Note over Stack: emit entry_created x10k
    end
    
    rect rgb(255, 220, 150)
    Note over Auto,Stack: Localization Phase
    Auto->>Stack: Localize Entries
    Stack-->>Auto: Localized (by locale)
    Note over Stack: emit entry_created x50k (5 locales)
    end
    
    rect rgb(255, 200, 255)
    Note over Auto,Stack: Publishing Phase
    Auto->>Stack: Publish/Unpublish
    Stack-->>Auto: Publish Counts
    Note over Stack: emit entry_published/unpublished
    end
    
    rect rgb(200, 255, 200)
    Note over Auto,Stack: Workflow Phase
    Auto->>Stack: Transition Entries
    Stack-->>Auto: Transition Counts
    Note over Stack: emit entry_workflow_*
    end
    
    rect rgb(255, 255, 200)
    Note over Auto,Stack: Branch & User Phases
    Auto->>Stack: Multi-branch ops
    Auto->>Stack: Invite Users (UI)
    end
    
    Auto-->>User: Periodic Complete
```

### Multi-Actor Create-Publish Sequence

```mermaid
sequenceDiagram
    actor A as Actor A<br/>(Creator)
    participant Auto as Automation
    participant Stack as Contentstack
    actor B as Actor B<br/>(Publisher)
    
    A->>Auto: login
    Auto->>Stack: authenticate
    Stack-->>Auto: authtoken A
    
    Auto->>Stack: create entries
    Stack-->>Auto: Entry UIDs
    Note over Stack: emit entry_created
    
    Note over A,B: Auto-pick B from org
    Note over A,B: Auto-assign CMS role to B
    
    Auto->>Stack: transition to approved
    Stack-->>Auto: transition ACKs
    Note over Stack: emit entry_workflow_stage_updated
    
    B->>Auto: login
    Auto->>Stack: authenticate
    Stack-->>Auto: authtoken B
    
    Auto->>Stack: publish entries
    Stack-->>Auto: publish ACKs
    Note over Stack: emit entry_published (publisher: B)
    
    Auto-->>A: Report
    Note over A: creator_uid: A<br/>publisher_uid: B<br/>entries_created: 10<br/>entries_published: 8
```

### Self-Healing: Missing CMS Role

```mermaid
sequenceDiagram
    participant Auto as Automation
    participant Stack as Contentstack
    participant OrgAdmin as Org Admin
    
    Auto->>OrgAdmin: auto-pick user
    OrgAdmin-->>Auto: user object (no CMS role)
    
    Auto->>Stack: check hasRole?
    Stack-->>Auto: false (no RBAC record)
    
    Auto->>Stack: listStackRoles()
    Stack-->>Auto: [role_uid1, role_uid2, ...]
    
    Auto->>OrgAdmin: shareStack(email, role_uid)
    OrgAdmin->>Stack: add RBAC record
    OrgAdmin-->>Auto: shareStack ACK
    
    Note over Auto: ✓ User now has CMS role
    
    Auto->>Stack: proceed with test
```

### Self-Healing: Missing Locale

```mermaid
sequenceDiagram
    participant Auto as Automation
    participant Stack as Contentstack
    
    Auto->>Stack: localize to en-gb
    Stack-->>Auto: 422 "Language not found"
    
    Auto->>Stack: listLocales()
    Stack-->>Auto: [en-us, en-ca, ...]
    
    Note over Auto: (en-gb not in list)
    
    Auto->>Stack: createLocale(code: en-gb, fallback: en-us)
    Stack-->>Auto: 201 Created
    
    Auto->>Stack: localize to en-gb (retry)
    Stack-->>Auto: 201 Localized
```

---

## Low-Level Design (LLD)

### Entry Creation with Concurrency

```javascript
CREATE_ENTRIES(concurrency = 12) {
  pool = createWorkerPool(concurrency)
  for (ct in contentTypes) {
    entries_to_create = CONTENTSTACK_PERIODIC_TOTAL / len(contentTypes)
    
    while (entries_to_create > 0) {
      batch = entries_to_create.slice(0, concurrency)
      
      for (entry in batch) parallel {
        title = generate_unique_title()
        fields = resolve_placeholders(fields)
        
        result = POST /v3/content_types/{ct}/entries {
          entry: { title, ...fields }
        }
        
        if result.ok {
          kpis.created++
        } else if result.error == 133 { // entry cap
          kpis.capHit++
          stop_creation()
        } else {
          kpis.failed++
        }
      }
      
      entries_to_create -= batch.length
      sleep(100ms) // brief pause before next batch
    }
  }
  
  report(kpis)
}
```

### Tiered Retention with Age Bands

```javascript
TIERED_RETENTION() {
  now = Date.now()
  
  bands = [
    { name: ">30d",   min_age: 30*day,  max_age: ∞,       keep: 5000  },
    { name: "15-30d", min_age: 15*day,  max_age: 30*day,  keep: 10000 },
    { name: "7-15d",  min_age: 7*day,   max_age: 15*day,  keep: 20000 },
  ]
  
  for (ct in contentTypes) {
    for (band in bands) {
      entries = GET /entries {
        query: {
          created_at: {
            $gte: now - band.max_age,
            $lt:  now - band.min_age
          }
        },
        include_count: true
      }
      
      count = entries.length
      excess = max(0, count - band.keep)
      
      if excess > 0 {
        to_delete = entries.sort_by(created_at).slice(0, excess)
        
        for (entry in to_delete) parallel {
          DELETE /entries/{uid}
          kpis.deleted++
          kpis.bands[band.name]++
        }
      }
    }
  }
  
  report(kpis)
}
```

### Workflow Transition with 5 Patterns

```javascript
WORKFLOW_TRANSITIONS(rng_seed) {
  rng = mulberry32(rng_seed) // deterministic
  
  patterns = {
    linear:      [0, 1, 2],           // Draft → Review → Approved
    skip:        [0, 2],              // Draft → Approved (skip Review)
    rework:      [0, 1, 0, 1, 2],    // Draft → Review → Draft → Review → Approved
    partialStall: [0, 1],             // Draft → Review (stuck)
    firstOnly:   [0],                 // Draft only (no transition)
  }
  
  weights = DEFAULT_PATTERN_WEIGHTS // {linear: 0.3, skip: 0.1, ...}
  
  for (entry in entries) {
    pattern = pick_weighted(patterns, weights, rng)
    stops = pattern.map(idx => stages[idx])
    
    for (stop in stops) {
      result = PUT /entries/{uid}/transition {
        _workflow: {
          workflow_uid: wf.uid,
          stage_uid: stop.uid,
          assigned_to: [user],
          comment: `auto:${pattern}:${stop.name}`
        }
      }
      
      if result.ok {
        kpis.transitions++
      } else if result.status == 422 {
        // transit not allowed from current stage
        kpis.transitionsSkipped++
      } else {
        kpis.failed++
      }
    }
  }
  
  report(kpis)
}
```

### Backfill from Trashed Entries

```javascript
BACKFILL_AGED_ENTRIES() {
  now = Date.now()
  
  bands = [
    { name: ">30d",   start_age: 30*day,  end_age: 100*day, target: 5000  },
    { name: "15-30d", start_age: 15*day,  end_age: 30*day,  target: 10000 },
    { name: "7-15d",  start_age: 7*day,   end_age: 15*day,  target: 20000 },
  ]
  
  for (band in bands) {
    trashed = GET /entries {
      query: {
        created_at: {
          $gte: now - band.end_age,
          $lt:  now - band.start_age
        },
        _metadata: { deleted_at: { $exists: true } }
      }
    }
    
    count = trashed.length
    deficit = max(0, band.target - count)
    
    if deficit == 0 {
      continue // band is full
    }
    
    to_restore = trashed.slice(0, deficit)
    
    for (entry in to_restore) parallel {
      result = PUT /entries/{uid}/restore {
        entry: { locale }
      }
      
      if result.ok {
        kpis.restored++
      }
    }
  }
  
  report(kpis)
}
```

### Multi-Locale Localization with Auto-Create

```javascript
LOCALIZE_ENTRIES() {
  targets = [en-gb, fr-fr, fr-ca, de-de, de-at] // from manifest
  
  // STEP 1: Ensure all target locales exist
  available = GET /locales
  available_codes = available.map(l => l.code)
  
  for (target in targets) {
    if NOT available_codes.includes(target) {
      locale_info = manifest.locales.find(l => l.code == target)
      
      result = POST /locales {
        locale: {
          code: target,
          name: locale_info.name,
          fallback_locale: locale_info.fallback
        }
      }
      
      if result.ok {
        available_codes.add(target)
      }
    }
  }
  
  valid_targets = targets.filter(t => available_codes.includes(t))
  
  if valid_targets.empty() {
    return // no valid locales
  }
  
  // STEP 2: Localize entries
  for (ct in contentTypes) {
    entries = GET /entries {
      limit: 10, // max per CT
      desc: created_at
    }
    
    for (entry in entries) {
      for (locale in valid_targets) parallel {
        localized_title = `[${locale.upper()}] ${entry.title}`
        
        result = PUT /entries/{uid}/localize {
          entry: {
            locale: locale,
            title: localized_title,
            ...other_fields
          }
        }
        
        if result.ok {
          kpis.localized++
        } else {
          kpis.failed++
        }
      }
    }
  }
  
  report(kpis)
}
```

---

## Code Structure

```
scripts/
├── drive-all.mjs                    # Main orchestrator
├── lib/
│  ├── cma.mjs                       # CMA helpers + self-healing
│  ├── progress.mjs                  # Progress tracking
│  ├── report.mjs                    # KPI reporting
│  ├── workflow-patterns.mjs          # Pattern library
│  ├── entry-placeholders.mjs         # Placeholder resolution
│  ├── schema-from-fields.mjs         # CT schema generation
│  └── totp.mjs                       # 2FA
├── [Bootstrap scripts]
│  ├── bootstrap-from-manifest.mjs
│  ├── seed-locales-branches.mjs
│  ├── seed-workflows.mjs
│  └── seed-publishing-rules.mjs
├── [Periodic scripts]
│  ├── delete-old-entries.mjs
│  ├── backfill-aged-entries.mjs
│  ├── periodic-entries-from-manifest.mjs
│  ├── localize-entries.mjs
│  ├── bulk-publish-cycle.mjs
│  ├── churn-orphans.mjs
│  └── branch-lifecycle.mjs
├── [Meter-coverage scripts]
│  ├── edit-after-publish.mjs
│  ├── permanent-deletes.mjs
│  ├── aged-stalls.mjs
│  ├── no-workflow-ct.mjs
│  ├── multi-actor-create-publish.mjs
│  └── branch-locale-deletion.mjs
├── [User management]
│  └── invite-users.mjs
├── [Manifests]
│  ├── content-types.manifest.json
│  ├── workflows.manifest.json
│  ├── locales-branches.manifest.json
│  └── publishing-rules.manifest.json
└── [Config]
    └── .env.example
```

---

## Error Handling Strategy

### Graceful Degradation

- **Single entry fails** → log + continue (don't block batch)
- **Batch fails** → skip batch + continue (don't block CT)
- **CT fails** → skip CT + continue (don't block automation)
- **Workflow missing** → auto-create + retry
- **Locale missing** → auto-create + retry
- **User has no role** → auto-assign + retry

### Retryable vs Terminal Errors

| Error | HTTP | Retryable | Action |
|-------|------|-----------|--------|
| Rate limit | 429 | Yes | Sleep + retry |
| Entry cap hit | 133 | No | Log + stop |
| Invalid field | 422 | No | Log + skip |
| Not found | 404 | No | Auto-create (if applicable) + retry |
| Permission denied | 401 | No | Auto-assign role + retry |
| Server error | 5xx | Yes | Exponential backoff |

---

## Performance Metrics

### Throughput Targets

| Operation | Volume | Concurrency | Batch Size | Est. Duration |
|-----------|--------|-------------|------------|---------------|
| Create entries | 10,000 | 12 | 12 | ~5 min |
| Localize | 5,000 | 6 | 50 | ~8 min |
| Publish | 6,000 | 10 | 100 | ~3 min |
| Delete | 6,000 | 10 | 100 | ~3 min |
| Transitions | 2,000 | 8 | 8 | ~2 min |
| **Total periodic** | — | — | — | **~25 min** |

### Memory & CPU

- Single run: ~200MB heap, 1 CPU core
- CI runner: 2GB, 2 CPU (headroom for Playwright)
- No persistent connections (stateless)

---

## Security Considerations

### Token Management

- **Management token**: stored in CI secrets, used for CMA operations
- **User authtoken**: obtained via login (user/pass), cached in memory, cleared on exit
- **Never commit credentials**

### Rate Limiting

- Contentstack CMA: 10 req/sec (soft), 60 req/min (hard)
- Automation respects: 50ms sleep between requests + exponential backoff on 429
- Concurrent workers queue on limits (no thundering herd)

### Audit Trail

- Every operation logs to console + run-history.json
- GitHub Actions logs are retained for 90 days
- Runs tagged with timestamp, runner, commit SHA

---

## Testing Strategy

### Unit Tests

- Helper functions (cma.mjs, progress.mjs, etc.)
- Placeholder resolution logic
- Schema generation

### Integration Tests

- Bootstrap flow (create → verify)
- Periodic flow (delete → create → localize → publish)
- Self-healing scenarios (missing locale, missing role)

### Staging/Prod

- Dry-run mode (--dry-run flag)
- Isolated stack for testing
- Monitoring dashboard to verify metering events

