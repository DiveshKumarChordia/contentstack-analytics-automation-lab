# Operation Assignment System - Complete Guide

## 🎯 What's New

Instead of random users doing random operations, users now have **pre-assigned operations encoded in their email address**. This gives complete visibility into:

- **Which operations each user is supposed to do**
- **Which operations each user actually performed**
- **When and why operations failed**
- **Complete audit trail per user**

---

## Email Format Explained

### Old Format (Random)
```
divesh.k+2025-12-08T14-30-45@contentstack.com
```
- Just a timestamp
- No info about what user will do
- No tracking of assignments

### New Format (Assigned)
```
divesh.k+run-2025-dec-08-0230pm-ops-create-publish-workflow@contentstack.com
```

**Breaking it down:**
```
divesh.k                           = base email
+run-2025-dec-08-0230pm           = run ID with human-readable time/date
-ops-create-publish-workflow       = operations assigned to this user
@contentstack.com                  = domain
```

**Components:**

1. **run-2025-dec-08-0230pm**
   - `2025` = year
   - `dec` = month (readable: jan, feb, mar, ..., dec)
   - `08` = day
   - `0230pm` = time (02:30 PM)
   - When this automation run started

2. **create-publish-workflow**
   - `create` = create-entry operation
   - `publish` = publish-entry operation
   - `workflow` = workflow-transition operation
   - What this user should do

---

## Complete Example

### Run Started: December 8, 2025 at 2:30 PM

30 users created with random operation assignments:

```
User 1:  divesh.k+run-2025-dec-08-0230pm-ops-create-publish@contentstack.com
         Assigned: create, publish (2 ops)

User 2:  divesh.k+run-2025-dec-08-0230pm-ops-delete-workflow-localize@contentstack.com
         Assigned: delete, workflow, localize (3 ops)

User 3:  divesh.k+run-2025-dec-08-0230pm-ops-list-assets@contentstack.com
         Assigned: list, assets (2 ops)

...

User 30: divesh.k+run-2025-dec-08-0230pm-ops-publish-bulk-pub@contentstack.com
         Assigned: publish, bulk-pub (2 ops)
```

---

## How It Works

### Phase 1: Create Users with Assignments

```javascript
const result = await createUsersWithOperationAssignments({
  baseEmail: 'divesh.k@contentstack.com',
  orgUid: 'org_123',
  userCount: 30,
  operations: [
    'create-entry',
    'delete-entry',
    'publish-entry',
    'workflow-transition',
    'localize-entries',
    'list-entries',
  ],
  assignmentStrategy: 'random'  // random, round-robin, or all
})

// Returns:
// {
//   users: [UserWithAssignment[], ...],
//   plan: OperationAssignmentPlan,
//   runId: 'run-2025-dec-08-0230pm',
//   stats: { avgOpsPerUser: 2.5, minOpsPerUser: 1, maxOpsPerUser: 5 },
//   assignment_summary: [{ userId, email, assignedOps }, ...]
// }
```

### Phase 2: Track Operations

```javascript
// Create batch tracker
const batch = new UserBatch(users, runId)

// User performs operation
const user = batch.getRandomUser()
// Email: divesh.k+run-2025-dec-08-0230pm-ops-create-publish-workflow@...

// Record what happened
try {
  const result = await createEntry(user)
  batch.recordUserOperation(user.email, 'create-entry', true, result)
  // Tracked: User DID create-entry ✓ (was assigned)
} catch (e) {
  batch.recordUserOperation(user.email, 'create-entry', false, e)
  // Tracked: User FAILED create-entry (was assigned)
}
```

### Phase 3: Generate Report

```javascript
const summary = batch.getSummary()
// Returns detailed report with:
// - Each user's assigned ops
// - Each user's performed ops
// - Each user's success rate
// - Missing ops (assigned but not done)
// - Extra ops (done but not assigned)
```

---

## Assignment Strategies

### 1. Random (Default)

Each user gets **random subset** of operations:

```javascript
plan.assignRandomly(minOps, maxOps)
// Default: 2-5 ops per user
```

**Distribution:**
```
User 1: create, publish (2 ops)
User 2: delete, workflow, localize (3 ops)
User 3: list (1 op)
User 4: publish, assets, workflow (3 ops)
User 5: bulk-pub, localize (2 ops)
```

### 2. Round-Robin

**Distribute operations evenly** across users:

```javascript
plan.assignRoundRobin()
```

**Distribution (with 6 ops, 3 users):**
```
User 1: create, delete (ops 1-2)
User 2: publish, workflow (ops 3-4)
User 3: localize, list (ops 5-6)
```

### 3. All

**Each user does all operations:**

```javascript
plan.assignAll()
```

**Distribution:**
```
User 1: create, delete, publish, workflow, localize, list
User 2: create, delete, publish, workflow, localize, list
User 3: create, delete, publish, workflow, localize, list
...
```

---

## Usage Examples

### Example 1: Create 30 Users, Run 100 Operations

```bash
npm run automate:assigned-users
```

Creates 30 users, each with 2-5 random operations, then performs 100 operations.

### Example 2: Create 50 Users, Run 200 Operations

```bash
npm run automate:assigned-users:50
```

### Example 3: Custom Configuration

```bash
CONTENTSTACK_USER_COUNT=20 \
CONTENTSTACK_OPERATION_COUNT=75 \
node --env-file=.env scripts/automate-with-assigned-users.mjs
```

### Example 4: Programmatic Use

```javascript
import { createUsersWithOperationAssignments, UserBatch } from './lib/user-factory-v2.mjs'

// Create users
const result = await createUsersWithOperationAssignments({
  baseEmail: 'divesh.k@contentstack.com',
  orgUid: 'org_123',
  userCount: 30,
  assignmentStrategy: 'round-robin'
})

const { users, runId } = result

// Create tracker
const batch = new UserBatch(users, runId)

// Perform operations
for (let i = 0; i < 100; i++) {
  const user = batch.getRandomUser()
  const op = operations[Math.floor(Math.random() * operations.length)]
  
  try {
    const result = await performOperation(op, user)
    batch.recordUserOperation(user.email, op, true, result)
  } catch (e) {
    batch.recordUserOperation(user.email, op, false, e.message)
  }
}

// Get final report
const report = batch.getSummary()
console.log(report)
```

---

## Report Output

### Full Report Structure

```json
{
  "timestamp": "2025-12-08T14:30:45Z",
  "runId": "run-2025-dec-08-0230pm",
  "configuration": {
    "users_created": 30,
    "operations_attempted": 100,
    "operations_performed": 95,
    "assignment_strategy": "random"
  },
  "results": {
    "successful": 88,
    "failed": 7,
    "success_rate": "93%",
    "coverage_rate": "85%"
  },
  "user_assignments": [
    {
      "userId": "user-0",
      "email": "divesh.k+run-2025-dec-08-0230pm-ops-create-publish@contentstack.com",
      "assignedOps": ["create-entry", "publish-entry"],
      "count": 2
    },
    {
      "userId": "user-1",
      "email": "divesh.k+run-2025-dec-08-0230pm-ops-delete-workflow@contentstack.com",
      "assignedOps": ["delete-entry", "workflow-transition"],
      "count": 2
    },
    ...
  ],
  "user_summaries": [
    {
      "email": "divesh.k+run-2025-dec-08-0230pm-ops-create-publish@...",
      "assigned_ops": ["create-entry", "publish-entry"],
      "performed_ops": 2,
      "successful": 2,
      "failed": 0,
      "success_rate": "100%",
      "missing_ops": [],
      "extra_ops": []
    },
    ...
  ],
  "operation_coverage": {
    "create-entry": {
      "total": 12,
      "successful": 11,
      "failed": 1,
      "users": ["user-0", "user-2", "user-5", ...]
    },
    "publish-entry": {
      "total": 15,
      "successful": 14,
      "failed": 1,
      "users": ["user-0", "user-1", "user-4", ...]
    },
    ...
  },
  "audit_trail_sample": [
    {
      "timestamp": "2025-12-08T14:31:00Z",
      "user": "user-0+...",
      "operation": "create-entry",
      "assigned": true,
      "success": true
    },
    {
      "timestamp": "2025-12-08T14:31:01Z",
      "user": "user-2+...",
      "operation": "publish-entry",
      "assigned": true,
      "success": true
    },
    ...
  ],
  "audit_trail_count": 95
}
```

---

## Key Metrics

### Per User Metrics
```
User: divesh.k+run-2025-dec-08-0230pm-ops-create-publish-workflow@...
├─ Assigned ops: create, publish, workflow (3 ops)
├─ Performed ops: 3 total
│  ├─ Successful: 3
│  └─ Failed: 0
├─ Success rate: 100%
├─ Missing ops: [] (all assigned ops done)
└─ Extra ops: [] (no unexpected operations)
```

### Per Operation Metrics
```
Operation: create-entry
├─ Total performed: 12
├─ Successful: 11 (92%)
├─ Failed: 1 (8%)
└─ Users who performed: 6
   ├─ user-0 (3 times)
   ├─ user-2 (2 times)
   ├─ user-5 (2 times)
   └─ ...
```

### Overall Metrics
```
Run ID: run-2025-dec-08-0230pm
├─ Users: 30
├─ Total assigned ops: 85
├─ Operations attempted: 100
├─ Operations performed: 95
├─ Successful: 88 (93%)
├─ Failed: 7 (7%)
├─ Coverage: 95/85 = 112% (some ops done by multiple users)
└─ Duration: 2 minutes 15 seconds
```

---

## Tracking & Auditing

### Audit Trail

Shows every operation performed with full context:

```
Timestamp            | User           | Operation       | Assigned? | Success
2025-12-08T14:31:00 | user-0+...    | create-entry    | ✓         | ✓
2025-12-08T14:31:01 | user-2+...    | publish-entry   | ✓         | ✓
2025-12-08T14:31:02 | user-5+...    | workflow-trans. | ✗         | ✗ Failed
2025-12-08T14:31:03 | user-1+...    | delete-entry    | ✓         | ✓
...
```

### Coverage Analysis

Which operations were done by which users:

```
create-entry:
  ├─ user-0 (3 times) ✓
  ├─ user-2 (2 times) ✓
  ├─ user-5 (1 time) ✗ FAILED
  └─ user-8 (2 times) ✓

publish-entry:
  ├─ user-0 (1 time) ✓
  ├─ user-1 (3 times) ✓
  └─ user-4 (2 times) ✓

workflow-transition:
  ├─ user-2 (2 times) ✗ FAILED twice
  ├─ user-3 (1 time) ✓
  └─ user-6 (2 times) ✓
```

---

## Benefits

### ✅ Complete Visibility
- Know exactly what each user was supposed to do
- Know exactly what each user actually did
- Identify failures at user + operation level

### ✅ Accountability
- Email shows run time and assigned operations
- Can correlate user email → assigned ops → actual performance
- Audit trail shows who did what when

### ✅ Testing
- Test multi-user scenarios systematically
- Verify operations work with different user load
- Identify operation-specific failures (fails for user A, works for user B)

### ✅ Reporting
- Beautiful reports showing coverage and success rates
- Per-user performance summary
- Per-operation performance summary
- Human-readable dates and operation names

---

## Operation Name Mapping

Short names used in emails:

```
Full Name                    → Email Code
create-entry                 → create
delete-entry                 → delete
publish-entry                → publish
unpublish-entry              → unpub
bulk-publish-cycle           → bulk-pub
bulk-unpublish               → bulk-unpub
workflow-transition          → workflow
localize-entries             → localize
list-entries                 → list
list-assets                  → assets
get-content-types            → content-types
edit-after-publish           → edit-pub
permanent-deletes            → perm-delete
aged-stalls                  → stalls
no-workflow-ct               → no-workflow
multi-actor-create-publish   → multi-actor
branch-locale-deletion       → delete-branch
invite-users                 → invite
```

---

## Date/Time Format

Human-readable format for run IDs:

```
2025-12-08T14:30:45  →  2025-dec-08-0230pm
 │   │   │  │  │ │        │   │  │  │ │
 year month day hr min sec  year month day time(12h)
```

**Examples:**
```
Jan 15, 2025 9:15 AM   → 2025-jan-15-0915am
Dec 25, 2025 2:45 PM   → 2025-dec-25-0245pm
Aug 3, 2025 11:59 PM   → 2025-aug-03-1159pm
May 20, 2025 12:01 AM  → 2025-may-20-1201am
```

---

## Integration with Drive-All Pipeline

To integrate into your main pipeline:

```javascript
// In drive-all.mjs

import { createUsersWithOperationAssignments, UserBatch } from './lib/user-factory-v2.mjs'

async function automateWithAssignedUsers() {
  // Create 30-50 users with operation assignments
  const result = await createUsersWithOperationAssignments({
    baseEmail: process.env.CONTENTSTACK_TEST_USER_EMAIL,
    orgUid: process.env.CONTENTSTACK_ORG_UID,
    userCount: 30,
    assignmentStrategy: 'random'
  })

  const { users, runId } = result
  const batch = new UserBatch(users, runId)

  // Run all operations with assigned users
  await performChurnOperations(batch)
  await performTransitionOperations(batch)
  await performEntryOperations(batch)

  // Generate and write report
  const summary = batch.getSummary()
  await writeDetailedReport(summary)
}
```

---

## Troubleshooting

### "Missing ops" for a user

```json
{
  "user": "divesh.k+run-2025-dec-08-0230pm-ops-create-publish@...",
  "assigned_ops": ["create-entry", "publish-entry"],
  "performed_ops": 1,
  "missing_ops": ["publish-entry"]
}
```

**Action:** Check why user didn't perform publish-entry. Was it:
- Not attempted? (operation selection bias)
- Failed when attempted? (check audit trail for errors)
- Skipped by strategy? (operation assignment verification)

### High failure rate for operation

```json
{
  "operation": "workflow-transition",
  "total": 12,
  "successful": 3,
  "failed": 9,
  "success_rate": "25%"
}
```

**Action:** Investigate why workflow-transition fails:
- Check audit trail for error messages
- Verify workflow exists and is configured properly
- Test with specific user directly

### User not in audit trail

```
User created: divesh.k+run-2025-dec-08-0230pm-ops-create-publish@...
Audit trail search: NO MATCHES
```

**Action:** User was created but never selected for operations:
- Check random selection logic
- Verify user is in the batch
- Ensure operation count is sufficient

---

## Quick Reference

```bash
# Create 30 users, 100 ops (random assignment)
npm run automate:assigned-users

# Create 30 users explicitly
npm run automate:assigned-users:30

# Create 50 users, 200 ops
npm run automate:assigned-users:50

# Custom: 20 users, 75 ops
CONTENTSTACK_USER_COUNT=20 CONTENTSTACK_OPERATION_COUNT=75 \
node --env-file=.env scripts/automate-with-assigned-users.mjs

# Check assignment before running
node -e "
import {generateRunId, encodeOperationName, generateEmailWithOps} from './scripts/lib/user-assignment.mjs';
const runId = generateRunId();
const ops = ['create', 'publish', 'workflow'];
console.log(generateEmailWithOps('divesh.k@contentstack.com', runId, ops));
"
```

---

## Files Reference

- **user-assignment.mjs** - Email generation, operation encoding, assignment planning
- **user-factory-v2.mjs** - User creation with assignments, batch tracking
- **automate-with-assigned-users.mjs** - Complete automation script with reporting
- **docs/ASSIGNED_USERS_GUIDE.md** - This guide
