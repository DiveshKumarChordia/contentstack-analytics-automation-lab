# Role-Based Users with Multi-User Operations

**⚠️ CRITICAL: These are TEST SIMULATION ROLES, NOT actual CMS roles.**

This system creates test users with simulated roles for automation testing purposes. These test simulation roles (Owner, Admin, Editor, Contributor, Viewer) are COMPLETELY SEPARATE from actual Contentstack CMS stack-level roles (Developer, Content Manager, Viewer).

**Test Simulation Roles** (this system):
- For testing different user types and permission boundaries
- Created on-the-fly for test scenarios
- Used to validate multi-user workflows
- DO NOT map to actual CMS stack roles

**Actual CMS Stack Roles** (real Contentstack):
- Control actual API access on stacks
- Determined by stack sharing in Contentstack UI
- Independent of our test simulation system
- Our test users get assigned these separately for API access

---

Complete guide to testing with different test simulation roles and collaborative operations.

---

## 🎯 What This Enables

### Single-User Operations (Role-Based)
Each user can only perform operations allowed by their role:

```
Owner         → All operations (5 level)
Admin         → All except delete stack (4 level)
Editor        → Create, publish, localize, list (3 level)
Contributor   → Create, edit, list only (2 level)
Viewer        → Read-only access (1 level)
```

### Multi-User Operations (Collaborative)
Operations requiring multiple roles:

```
review-and-publish
├─ Editor creates entry
└─ Admin reviews and publishes

collaborative-create
├─ Contributor creates entry
└─ Editor refines and publishes

owner-approval-publish
├─ Editor creates entry
├─ Admin reviews entry
└─ Owner approves and publishes

bulk-localize-publish
├─ Editor localizes entries
└─ Admin publishes in bulk
```

---

## Email Format

### Role Encoded
```
divesh.k+run-2025-dec-08-0230pm-role-admin-ops-create-publish@contentstack.com
                                    └───┘
                                 User role
```

**Role abbreviations:**
```
owner       = Owner
admin       = Admin
editor      = Editor/Content Editor
contributor = Contributor
viewer      = Viewer
```

### Full Email Examples

```
Owner:
  divesh.k+run-2025-dec-08-0230pm-role-owner-ops-create-delete-publish@...

Admin:
  divesh.k+run-2025-dec-08-0230pm-role-admin-ops-create-publish-workflow@...

Editor:
  divesh.k+run-2025-dec-08-0230pm-role-editor-ops-create-publish-localize@...

Contributor:
  divesh.k+run-2025-dec-08-0230pm-role-contributor-ops-create-edit@...

Viewer:
  divesh.k+run-2025-dec-08-0230pm-role-viewer-ops-list-assets@...
```

---

## Role Permissions

### Owner (Level 5)
**Operations:** 14 total
```
├─ create-entry
├─ delete-entry
├─ publish-entry
├─ unpublish-entry
├─ bulk-publish-cycle
├─ workflow-transition
├─ localize-entries
├─ list-entries
├─ list-assets
├─ invite-users
├─ manage-roles
└─ delete-stack (Owner only!)
```

### Admin (Level 4)
**Operations:** 11 total (everything except delete-stack)
```
├─ create-entry
├─ delete-entry
├─ publish-entry
├─ unpublish-entry
├─ bulk-publish-cycle
├─ workflow-transition
├─ localize-entries
├─ list-entries
├─ list-assets
├─ invite-users
└─ manage-roles
```

### Editor (Level 3)
**Operations:** 8 total (content management only)
```
├─ create-entry
├─ edit-after-publish
├─ publish-entry
├─ unpublish-entry
├─ workflow-transition
├─ localize-entries
├─ list-entries
└─ list-assets
```

### Contributor (Level 2)
**Operations:** 4 total (create & edit only)
```
├─ create-entry
├─ edit-after-publish
├─ list-entries
└─ list-assets
```

### Viewer (Level 1)
**Operations:** 2 total (read-only)
```
├─ list-entries
└─ list-assets
```

---

## Distribution Strategies

### Pyramid (Default)
```
Realistic distribution for most organizations:
├─ Owner: 1 (3%)
├─ Admin: 3 (10%)
├─ Editor: 9 (30%)
├─ Contributor: 12 (40%)
└─ Viewer: 5 (17%)
Total: 30 users
```

**Use when:** You want a realistic org structure

### Balanced
```
Equal distribution:
├─ Owner: 6
├─ Admin: 6
├─ Editor: 6
├─ Contributor: 6
└─ Viewer: 6
Total: 30 users
```

**Use when:** You want to test all roles equally

### Admin Heavy
```
For testing admin operations:
├─ Owner: 1 (3%)
├─ Admin: 12 (40%)
├─ Editor: 9 (30%)
├─ Contributor: 6 (20%)
└─ Viewer: 2 (7%)
Total: 30 users
```

**Use when:** You want more admins for management testing

### Viewer Heavy
```
For testing read-only scenarios:
├─ Owner: 1 (3%)
├─ Admin: 3 (10%)
├─ Editor: 4 (15%)
├─ Contributor: 7 (25%)
└─ Viewer: 15 (50%)
Total: 30 users
```

**Use when:** You want more viewers for permission testing

---

## Usage Examples

### Example 1: Create Role-Based Users (Pyramid)

```bash
npm run automate:with-roles
```

Creates:
- 30 users with pyramid distribution
- 1 owner, 3 admins, 9 editors, 12 contributors, 5 viewers
- Performs 50+ single-user operations
- Performs 4 multi-user operations

### Example 2: Balanced Distribution

```bash
npm run automate:with-roles:balanced
```

Creates:
- 30 users equally distributed across roles
- Tests all roles equally

### Example 3: Admin-Heavy

```bash
npm run automate:with-roles:admin-heavy
```

Creates:
- 30 users with more admins
- Tests admin operations thoroughly

### Example 4: Viewer-Heavy

```bash
npm run automate:with-roles:viewer-heavy
```

Creates:
- 30 users with many viewers
- Tests permission boundaries

### Example 5: Custom Configuration

```bash
DISTRIBUTION=balanced CONTENTSTACK_USER_COUNT=50 \
npm run automate:with-roles
```

Creates:
- 50 users with balanced distribution
- ~10 of each role

---

## Programmatic Usage

```javascript
import { createRoleBasedUsers } from './lib/role-based-factory.mjs'
import { MULTI_USER_OPERATIONS } from './lib/role-based-users.mjs'

// Create users
const result = await createRoleBasedUsers({
  baseEmail: 'divesh.k@contentstack.com',
  orgUid: 'org_123',
  userCount: 30,
  distribution: 'pyramid'  // or 'balanced', 'admin_heavy', 'viewer_heavy'
})

const { users, batch } = result

// Get users by role
const admins = batch.getUsersByRole('admin')
const editors = batch.getUsersByRole('editor')

// Perform single-user operation
const user = batch.getRandomUserWithRole('editor')
user.recordOperation('create-entry', true)

// Perform multi-user operation
const result = await batch.executeMultiUserOperation('review-and-publish')
// Automatically finds Editor and Admin users and runs the workflow

// Get reports
const summary = batch.getSummary()
const auditTrail = batch.getAuditTrail()
```

---

## Multi-User Operations

### review-and-publish
```
Steps:
  1. Editor creates entry
  2. Editor transitions workflow
  3. Admin publishes entry

Email roles:
  Editor:  divesh.k+run-...-role-editor-ops-create-publish@...
  Admin:   divesh.k+run-...-role-admin-ops-publish-workflow@...

Result:
  Entry created by editor, reviewed, then published by admin
```

### collaborative-create
```
Steps:
  1. Contributor creates entry
  2. Editor edits/refines

Use case:
  Junior contributor creates draft, senior editor polishes
```

### owner-approval-publish
```
Steps:
  1. Editor creates entry
  2. Admin reviews (workflow transition)
  3. Owner approves and publishes

Use case:
  Formal approval workflow with multiple sign-offs
```

### bulk-localize-publish
```
Steps:
  1. Editor localizes entries to multiple languages
  2. Admin publishes all localized versions in bulk

Use case:
  Multi-language publishing workflow
```

### delete-and-purge
```
Steps:
  1. Owner deletes entry (highest privilege operation)

Use case:
  Only owner can permanently delete content
```

---

## Reports

### Per-Role Coverage

```json
{
  "role_coverage": {
    "owner": {
      "count": 1,
      "total_ops": 5,
      "successful": 5,
      "failed": 0,
      "success_rate": "100%"
    },
    "admin": {
      "count": 3,
      "total_ops": 18,
      "successful": 17,
      "failed": 1,
      "success_rate": "94%"
    },
    "editor": {
      "count": 9,
      "total_ops": 35,
      "successful": 33,
      "failed": 2,
      "success_rate": "94%"
    },
    ...
  }
}
```

### Multi-User Operation Coverage

```json
{
  "multi_user_operations": {
    "total": 4,
    "coverage": {
      "review-and-publish": {
        "total_completed": 1,
        "required_roles": ["editor", "admin"]
      },
      "collaborative-create": {
        "total_completed": 1,
        "required_roles": ["contributor", "editor"]
      },
      ...
    }
  }
}
```

### Audit Trail Sample

```
Timestamp            | Role        | Operation           | Assigned? | Success
2025-12-08T14:31:00 | editor      | create-entry        | ✓         | ✓
2025-12-08T14:31:01 | contributor | create-entry        | ✓         | ✓
2025-12-08T14:31:02 | admin       | publish-entry       | ✓         | ✓
2025-12-08T14:31:03 | viewer      | list-entries        | ✓         | ✓
2025-12-08T14:31:04 | editor      | workflow-transition | ✓         | ✓
2025-12-08T14:31:05 | admin       | delete-entry        | ✓         | ✗ FAILED
...
```

---

## Key Scenarios

### Scenario 1: Permission Boundaries
```
Test what each role can and cannot do:
✓ Viewer can list entries
✗ Viewer cannot create entries
✓ Contributor can create entries
✗ Contributor cannot publish
✓ Editor can publish
✗ Editor cannot delete stack
✓ Owner can delete stack
```

### Scenario 2: Collaborative Workflows
```
Test multi-user workflows:
1. Contributor creates draft
2. Editor reviews and refines
3. Admin approves
4. Owner publishes (if needed)
```

### Scenario 3: Role Escalation
```
Test permission boundaries:
Start with Viewer → Contributor → Editor → Admin → Owner
Verify each level gains new capabilities
```

### Scenario 4: Operation Failure by Role
```
Test error handling:
Admin tries to delete-stack → ERROR (not owner)
Owner tries to invite-user with invalid role → ERROR
Viewer tries to create-entry → ERROR (read-only)
```

---

## Integration

### With Drive-All Pipeline

```javascript
// In drive-all.mjs

import { createRoleBasedUsers } from './lib/role-based-factory.mjs'

async function automateWithRoles() {
  // Create role-based users
  const result = await createRoleBasedUsers({
    baseEmail: process.env.CONTENTSTACK_TEST_USER_EMAIL,
    orgUid: process.env.CONTENTSTACK_ORG_UID,
    userCount: 30,
    distribution: 'pyramid'
  })

  const { batch } = result

  // Run operations by role
  await runEditorOperations(batch)
  await runAdminOperations(batch)
  await runMultiUserWorkflows(batch)

  // Generate report
  const summary = batch.getSummary()
  await writeDetailedRoleReport(summary)
}
```

---

## Quick Reference

```bash
# Pyramid (default, realistic)
npm run automate:with-roles

# Balanced (equal roles)
npm run automate:with-roles:balanced

# Admin-heavy (test admin features)
npm run automate:with-roles:admin-heavy

# Viewer-heavy (test permissions)
npm run automate:with-roles:viewer-heavy

# Custom
DISTRIBUTION=balanced CONTENTSTACK_USER_COUNT=50 npm run automate:with-roles
```

---

## Files

- **role-based-users.mjs** - Core role definitions and multi-user operation logic
- **role-based-factory.mjs** - User creation with role distribution
- **automate-with-roles.mjs** - Automation script with role-based testing
- **docs/ROLE_BASED_GUIDE.md** - This guide
