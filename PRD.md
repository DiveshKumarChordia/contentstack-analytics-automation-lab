# Product Requirements Document (PRD)

**Contentstack Metering Automation Framework**

---

## 1. Product Overview

### Purpose
Automate comprehensive Contentstack CMA testing and realistic content lifecycle simulation to drive comprehensive meter events across all dimensions, providing the data and events needed for downstream analytics systems to track and measure platform usage.

### Problem Statement
- Analytics dashboards (CMS Content Lifecycle, Workflow Health, Team Adoption) depend on metering events from CMA operations
- Current testing is shallow: only fresh entries, single users, no branching, no locales
- **Gap:** aged entries, multi-user workflows, branch lifecycle, soft/hard deletions, orphaning scenarios are untested
- **Risk:** meters may silently undercount or misdimension real user activity

### Solution
Build self-healing automation that:
1. **Creates realistic content lifecycle** (10,000 entries/run, 10x branching, multi-locale)
2. **Drives meter events** across all dimensions (user_uid, branch, locale, workflow, stage, lifecycle)
3. **Covers unmeasured scenarios** (in-progress, deleted, stalled, orphaned, multi-actor)
4. **Auto-heals missing prerequisites** (creates locales, workflows, users, roles on demand)
5. **Runs every 5 minutes** in CI, maintaining a rich dataset for nightly analytics materialization

---

## 2. Requirements

### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|-------------------|
| **FE-1** | Bootstrap: Create content foundations | P0 | Content types, locales (with fallback chains), branches, workflows exist on stack |
| **FE-2** | Periodic: Create 10,000 entries per run | P0 | Entries created in all CTs, reported in KPIs, triggers entry_created events |
| **FE-3** | Periodic: Localize entries to 5 non-master locales | P1 | 5 locales exist with proper fallback chains, entries localized, triggers entry_created x5 per entry |
| **FE-4** | Periodic: Publish/unpublish entries | P1 | 60% published, 15% unpublished, triggers entry_published/unpublished events |
| **FE-5** | Periodic: Transition entries through 5 workflow patterns | P1 | Linear, Skip, Rework, PartialStall, FirstOnly patterns applied, transitions tracked, events fired |
| **FE-6** | Periodic: Multi-branch lifecycle (30-branch lineage) | P1 | 30 lineage branches created, entries + locales on each, no teardown (data persists) |
| **FE-7** | Periodic: Meter-coverage scenarios (6 types) | P2 | Edit-after-publish, Permanent-deletes, Aged-stalls, No-workflow-ct, Multi-actor, Branch-locale-deletion all run and report |
| **FE-8** | Periodic: Invite 10 users + assign CMS roles | P2 | 10 new users invited via org-admin UI, CMS roles auto-assigned, no manual setup required |
| **FE-9** | Tiered retention: Delete aged entries | P1 | 3 age bands (>30d, 15-30d, 7-15d) with targets (5k, 10k, 20k), excess deleted, oldest first |
| **FE-10** | Backfill: Restore from trash if below targets | P1 | Trashed entries in each band restored if count < target, preserves created_at, maintains aged state |
| **FE-11** | Self-heal: Auto-create missing locales | P0 | Missing locales created with fallback chains, then used for localization |
| **FE-12** | Self-heal: Auto-create missing workflows | P0 | Missing workflows created with default stages, then used for transitions |
| **FE-13** | Self-heal: Auto-assign CMS roles to users | P0 | Users without CMS roles auto-assigned via shareStack, then can perform operations |
| **FE-14** | Dashboard: Visualize run metrics | P1 | Runs dashboard at /runs shows KPIs, per-step counts, error logs, trend charts |
| **FE-15** | CI/CD: Run every 5 minutes via GitHub Actions | P0 | Scheduled cron job, environment secrets for auth, KPIs appended to run-history |

### Non-Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|-------------------|
| **NF-1** | Performance: Complete periodic run in < 30 min | P1 | Single-run completes within 30 min, parallel concurrency defaults tuned |
| **NF-2** | Reliability: 95%+ step success rate | P1 | < 5% step failures in rolling 24h window, failures logged with root cause |
| **NF-3** | Observability: Per-step KPI tracking | P0 | Every script reports planned/actual/failed counts, aggregated to run-history.json |
| **NF-4** | Scalability: Handle 10k entry creation | P1 | Concurrent workers (default 12) don't block, rate limiting respected, no OOM |
| **NF-5** | Safety: No destructive side effects | P0 | Teardown disabled, aged data persists, old entries restored not recreated |
| **NF-6** | Security: Credentials in CI secrets | P0 | No hardcoded tokens, management token rotated quarterly, logs scrubbed of secrets |
| **NF-7** | Idempotence: Bootstrap can run multiple times | P1 | Re-running bootstrap skips existing resources, no duplicates created |

### Out of Scope

- User authentication via email link (no email server integration)
- Custom meter definitions (uses existing Contentstack meters)
- Multi-stack automation (single stack per run)
- Browser-based entry creation (CMA only)
- Webhook triggering of automation (scheduled only)

---

## 3. User Stories

### Story 1: Analytics Team Validates Meter Coverage

**As a** metrics engineer validating CMS analytics  
**I want** the automation to drive all meter dimensions (user, branch, locale, workflow, stage)  
**So that** I can confidently say analytics dashboards capture all real user activity

**Acceptance Criteria:**
- Automation runs every 5 min, drives 10k+ entries per run
- All 6 meter-coverage scenarios pass (edit-after-publish, permanent-deletes, etc.)
- Dashboard shows 95%+ step success rate over 24h window
- No meter gaps: every dimension tracked in at least one scenario

### Story 2: On-Call Engineer Monitors Automation Health

**As a** platform on-call engineer  
**I want** a dashboard showing automation run health (success rate, KPI trends, error log)  
**So that** I can quickly diagnose and fix any issues in the metering pipeline

**Acceptance Criteria:**
- Dashboard available at /runs (public)
- Shows last 60 runs with trend charts
- Color-coding: green (95%+ ok), yellow (50-95%), red (< 50%)
- Error log searchable by step name

### Story 3: New Developer Understands the Automation

**As a** new engineer joining the team  
**I want** comprehensive documentation (README, design, architecture, PRD)  
**So that** I can quickly understand what the automation does and how to modify it

**Acceptance Criteria:**
- AUTOMATION_FRAMEWORK.md covers all scripts, meter mapping, config
- DESIGN.md includes HLD, LLD, sequence diagrams, code structure
- PRD explains business requirements and acceptance criteria
- All diagrams in ASCII or SVG (no external tools needed)

### Story 4: Automation Runs Without Manual Setup

**As a** DevOps engineer provisioning a new Contentstack stack  
**I want** the automation to self-heal (auto-create locales, workflows, roles)  
**So that** I don't need to pre-stage resources; the automation just works

**Acceptance Criteria:**
- Bootstrap runs on a blank stack (no CTs, locales, workflows pre-created)
- Automation detects missing prerequisites and creates them
- Periodic runs even if a locale or workflow is missing (auto-create + retry)
- No manual intervention needed after secrets setup

---

## 4. Success Metrics

### Phase 1: Delivery (Week 1-2)

- ✅ All 15 FE requirements implemented
- ✅ 12 self-healing scenarios working (missing locale, workflow, role, etc.)
- ✅ Dashboard visualizing 6+ KPIs
- ✅ Documentation (AUTOMATION_FRAMEWORK, DESIGN, PRD) complete

### Phase 2: Validation (Week 3-4)

- ✅ 95%+ step success rate over 7-day rolling window
- ✅ All 6 meter-coverage scenarios pass 10+ runs
- ✅ Periodic run time < 30 min consistently
- ✅ No data loss (aged entries restored, no teardown)

### Phase 3: Operations (Week 5+)

- ✅ Automation runs every 5 min without manual intervention
- ✅ Analytics dashboards populated with events from all dimensions
- ✅ On-call engineer can diagnose issues via dashboard within 5 min
- ✅ Zero "meter gap" escalations

---

## 5. Technical Constraints

| Constraint | Rationale | Impact |
|-----------|-----------|--------|
| **Node 24+** | Native fetch, async/await, top-level await required | CI runner must have Node 24 installed |
| **No teardown** | analytics-data-sync nightly cron needs aged data | Branches/entries persist; tiered retention bounds growth |
| **Concurrent limits** | Contentstack CMA rate limit 10 req/sec soft | Default concurrency tuned (12 creates, 10 deletes, etc.) |
| **User session required** | Workflow transitions need authtoken (mgmt token can't transition) | Automation logs in as user; CONTENTSTACK_USER_EMAIL + _PASSWORD required |
| **Playwright for UI** | CMA has no invite endpoint; org-admin UI only way | Playwright dependency for invite-users.mjs; headless mode by default |
| **No email reading** | Auth-service sends acceptance tokens via email only | Leverage auto-accept logic (user active + no orgs = auto-accept) |

---

## 6. Risk Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Automation runs accumulate data indefinitely | HIGH | Tiered retention deletes oldest excess; targets tuned to 35k total entries |
| Missing locale blocks all localization | MEDIUM | Auto-create locale + retry; graceful skip if still fails |
| User lacks CMS role, can't publish | MEDIUM | Auto-assign role via shareStack; skip scenario if fails |
| Workflow missing, can't transition | MEDIUM | Auto-create workflow with default stages; skip scenario if fails |
| 429 rate limit causes cascade failure | MEDIUM | Exponential backoff on 429; sleep(50ms) between requests; max 12 concurrent |
| Entry cap (org limit) hit, stops creation | LOW | Graceful stop, log capHit KPI, resume next run with deletion phase |
| CI secrets leaked in logs | CRITICAL | Logs scrubbed; secrets only in GitHub Actions environment |

---

## 7. Timeline & Milestones

| Milestone | Target Date | Deliverables |
|-----------|-------------|--------------|
| MVP | Week 2 | Bootstrap + Periodic phases working, 8/15 FE reqs, basic dashboard |
| Full Coverage | Week 3 | All 15 FE reqs, 6 meter-coverage scenarios, self-healing enabled |
| Production Ready | Week 4 | 95%+ success rate, comprehensive documentation, on-call runbook |
| Maintenance | Week 5+ | Monitor + tune, address escalations, iterate on coverage gaps |

---

## 8. Rollout Plan

### Phase A: Staging (Internal Test Stack)

- Deploy automation to staging environment
- Run 24h validation (100+ runs, check for regressions)
- Verify all 6 meter-coverage scenarios pass
- Confirm all meter dimensions covered in automation KPIs

### Phase B: Production

- Deploy to prod CI (GitHub Actions scheduled job)
- Monitor dashboard for 7 days (check success rate, KPI stability)
- Tune concurrency/retention targets based on metrics
- Hand off to on-call team with runbook

### Phase C: Maintenance

- Weekly review of run-history.json for anomalies
- Quarterly token rotation (management token + user credentials)
- Monthly documentation updates
- Incident response: escalation to analytics team if meter gaps detected

---

## 9. Open Questions & Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Delete oldest or random?** | Oldest first | Maintains time-series integrity for aged analytics |
| **Restore or recreate aged entries?** | Restore from trash | Preserves original created_at, maintains "aged" status for metrics |
| **User invitation method?** | Playwright UI automation | Free, no company-repo changes, existing test-automation patterns |
| **Churn as delete or disable?** | Disable/detach as % | Preserves data for analytics-data-sync Mongo snapshot scan |
| **How many users per run?** | 10 new (org pool grows) | ~5 users/day growth, bounded by org seat cap; tests multi-user dimension |

---

## 10. Success Criteria Checklist

- [ ] All 15 functional requirements implemented
- [ ] All 7 non-functional requirements met
- [ ] 95%+ step success rate over 7 days
- [ ] 6 meter-coverage scenarios passing
- [ ] Dashboard showing 6+ KPI categories
- [ ] Documentation complete (README, DESIGN, PRD)
- [ ] CI/CD running every 5 min without manual intervention
- [ ] On-call runbook written
- [ ] Analytics team validates meter coverage is complete

---

**Owner:** Analytics Platform Team  
**Last Updated:** 2026-06-21  
**Status:** Active

