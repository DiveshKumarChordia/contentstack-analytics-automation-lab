# Random Test Users with Gmail Plus Addressing

Complete guide to creating and managing unique test users per operation.

---

## Overview

### The Pattern

Gmail's plus addressing allows you to create infinite unique email variations:

```
base@gmail.com
base+suffix1@gmail.com  (routed to base@gmail.com)
base+suffix2@gmail.com  (routed to base@gmail.com)
base+timestamp@gmail.com (routed to base@gmail.com)
```

### How We Use It

```
divesh.k@contentstack.com (base email)
divesh.k+2025-12-08T14-30-45@contentstack.com (unique user 1)
divesh.k+2025-12-08T14-35-12@contentstack.com (unique user 2)
divesh.k+2025-12-08T14-40-33@contentstack.com (unique user 3)
```

**All emails route to**: `divesh.k@contentstack.com`  
**But treated as**: Unique users in Contentstack system  

---

## Architecture

### 1. **gmail-utils.mjs** - Email Generation & User Pool

```javascript
import {
  generateUniqueEmail,        // Create email: divesh.k+timestamp@domain
  parseNameFromEmail,         // Extract: firstName, lastName
  UserPool,                   // Manage created users
  UserIterator,               // Round-robin access
} from './lib/gmail-utils.mjs'

// Generate unique email
const email = generateUniqueEmail('divesh.k@contentstack.com')
// → divesh.k+2025-12-08T14-30-45@contentstack.com

// Parse name
const { firstName, lastName } = parseNameFromEmail(email)
// → { firstName: 'Divesh', lastName: 'K' }

// User pool for random access
const pool = new UserPool('divesh.k@contentstack.com')
pool.addUser(email, password, authtoken, user_uid, org_uid)
const randomUser = pool.getRandomUser()

// User iterator for round-robin
const iterator = new UserIterator('divesh.k@contentstack.com')
iterator.addUser(user1)
iterator.addUser(user2)
const nextUser = iterator.getNext()  // user1
const nextUser2 = iterator.getNext() // user2
```

### 2. **user-factory.mjs** - Create Users with CMS Roles

```javascript
import {
  createTestUser,            // Create single user
  createMultipleTestUsers,   // Bulk create + pool
  activateUserAndLogin,      // Get authtoken
  getUserHeaders,            // Get headers for API calls
} from './lib/user-factory.mjs'

// Create single user
const user = await createTestUser({
  baseEmail: 'divesh.k@contentstack.com',
  orgUid: 'org_123',
  orgRoleUid: null,        // (optional, defaults to member)
  stackRoleUid: null,      // (optional, defaults to developer)
})

// Creates user with:
// ✓ Unique email (plus addressed)
// ✓ Org-level member role
// ✓ Stack-level developer role
// ✓ Proper auth SDK validation

// Create multiple users (returns UserPool)
const pool = await createMultipleTestUsers(10, {
  baseEmail: 'divesh.k@contentstack.com',
  orgUid: 'org_123',
})

// Get random user
const randomUser = pool.getRandomUser()

// Activate and get authtoken
const activeUser = await activateUserAndLogin(user, perishableToken)

// Use in API calls
const headers = getUserHeaders(activeUser)
const response = await fetch(url, { headers, ...options })
```

### 3. **automate-with-random-users.mjs** - Run Operations

Script that creates N users and performs M random operations:

```bash
# Default: 5 users, 20 operations
npm run automate:random-users

# 5 users, 25 operations  
npm run automate:random-users:5

# 10 users, 50 operations
npm run automate:random-users:10

# Custom
node --env-file=.env scripts/automate-with-random-users.mjs --users 15 --operations 100
```

---

## Setup & Configuration

### Environment Variables

```bash
# Required
CONTENTSTACK_TEST_USER_EMAIL=divesh.k@contentstack.com
CONTENTSTACK_ORG_UID=org_123
CONTENTSTACK_API_KEY=csx...
CONTENTSTACK_MANAGEMENT_TOKEN=...

# Optional
CONTENTSTACK_USER_COUNT=5          # Users to create per run
CONTENTSTACK_OPERATION_COUNT=20    # Operations per run
```

### .env File

```bash
# Add to .env
CONTENTSTACK_TEST_USER_EMAIL=divesh.k@contentstack.com
CONTENTSTACK_ORG_UID=your-org-uid
CONTENTSTACK_API_KEY=your-api-key
CONTENTSTACK_MANAGEMENT_TOKEN=your-mgmt-token
```

---

## Usage Examples

### Example 1: Create 10 Random Users, Run 50 Operations

```javascript
import { createMultipleTestUsers } from './lib/user-factory.mjs'
import { readEmailsFromGmail } from './lib/gmail-reader.mjs'

// 1. Create 10 users
const pool = await createMultipleTestUsers(10, {
  baseEmail: 'divesh.k@contentstack.com',
  orgUid: 'org_123'
})

// 2. Perform 50 random operations
for (let i = 0; i < 50; i++) {
  const user = pool.getRandomUser()
  
  // Activate user if not already
  if (!user.authtoken) {
    const emails = await readEmailsFromGmail('divesh.k@contentstack.com')
    const inviteEmail = emails.find(e => e.to === user.email)
    const { perishableToken } = extractTokens(inviteEmail.body)
    await activateUserAndLogin(user, perishableToken)
  }
  
  // Perform operation with this user
  const headers = getUserHeaders(user)
  await createEntry(headers, entryData)
}
```

### Example 2: Round-Robin User Assignment

```javascript
import { UserIterator } from './lib/gmail-utils.mjs'

const users = await createMultipleTestUsers(5, options)
const iterator = new UserIterator('divesh.k@contentstack.com')

// Add all users to iterator
users.getAllUsers().forEach(u => iterator.addUser(u))

// Use in round-robin fashion
for (let i = 0; i < 50; i++) {
  const user = iterator.getNext()  // Cycles: user1→user2→user3→user4→user5→user1...
  await performOperation(user, operationData)
}
```

### Example 3: Conditional Random Selection

```javascript
const pool = await createMultipleTestUsers(10, options)

// Sometimes random, sometimes specific user
for (let operation of operations) {
  let user
  
  if (operation.requiresAdmin) {
    // Use specific admin user
    user = pool.getUserByEmail('divesh.k+admin@contentstack.com')
  } else {
    // Use random user
    user = pool.getRandomUser()
  }
  
  await performOperation(user, operation)
}
```

---

## How It Works Under The Hood

### User Creation Flow

```
1. generateUniqueEmail()
   ↓ divesh.k+2025-12-08T14-30-45@contentstack.com
   
2. inviteUserToOrganization()
   ↓ Creates org invitation
   ↓ Sends email to: divesh.k@contentstack.com (Gmail plus routing)
   
3. ensureUserHasCMSRole()
   ↓ Assigns stack-level RBAC role
   
4. Add to UserPool
   ↓ await activateUserAndLogin(user, perishableToken)
   ↓ Gets authtoken
   
5. Ready for operations!
```

### Email Reading Flow (Optional)

If you need to read invitation emails:

```
1. User is invited, email sent to base address
2. Read from divesh.k@contentstack.com inbox via IMAP
3. Find email for: divesh.k+2025-12-08T14-30-45@contentstack.com
4. Extract tokens from email body
5. Activate user with tokens
6. Login and get authtoken
```

---

## Auth SDK Compliance

All created users follow auth SDK CMS role rules:

### ✅ What We Do

- **Org-level access**: Every user invited to organization with member role
- **Stack-level access**: Every user gets explicit RBAC role on stack
- **Role hierarchy**: Proper role assignment (member → developer → admin)
- **Permission validation**: Auth SDK validates all role assignments

### ✅ Verified Endpoints

These work with our created users:

```javascript
// Organization APIs (require org membership)
GET /v4/organizations/{orgUid}/roles
GET /v4/organizations/{orgUid}/share/users
POST /v4/organizations/{orgUid}/share

// Stack APIs (require stack RBAC role)
GET /v3/content_types
GET /v3/entries
POST /v3/entries
DELETE /v3/entries/{entryUid}

// User APIs
GET /v3/user
POST /v3/user-session
```

---

## Monitoring & Reporting

### User Pool Statistics

```javascript
const pool = await createMultipleTestUsers(10, options)

// Get stats
console.log(pool.getStats())
// {
//   totalUsers: 10,
//   createdAt: [
//     { email: 'divesh.k+2025-12-08T14-30-45@...', created_at: '2025-12-08T14:30:45Z' },
//     ...
//   ]
// }

// Get all users
const allUsers = pool.getAllUsers()

// Get user by email or uid
const user = pool.getUserByEmail('divesh.k+2025-12-08T14-30-45@contentstack.com')
const user2 = pool.getUserByUid('user_123')

// Get recent users
const recent = pool.getUsersCreatedInLastMinutes(5)
```

### Operation Reporting

The automate script generates reports:

```json
{
  "timestamp": "2025-12-08T14:30:45Z",
  "configuration": {
    "users_created": 10,
    "operations_performed": 50,
    "base_email": "divesh.k@contentstack.com",
    "organization": "org_123"
  },
  "results": {
    "successful": 48,
    "failed": 2,
    "success_rate": "96%"
  },
  "user_distribution": {
    "divesh.k+2025-12-08T14-30-45@...": 5,
    "divesh.k+2025-12-08T14-35-12@...": 4,
    ...
  },
  "operation_distribution": {
    "create-entry": { "ok": 10, "failed": 0 },
    "list-entries": { "ok": 12, "failed": 1 },
    ...
  }
}
```

---

## Advantages

### vs Static Users

| Aspect | Static Users | Random Users |
|--------|---|---|
| User count | Fixed (pre-provisioned) | Unlimited (on-demand) |
| Setup | Manual provisioning | Automated creation |
| State accumulation | Issues build up | Fresh per run |
| User uniqueness | Limited diversity | Every user is unique |
| Email management | Separate inbox per user | Single shared inbox |
| Cost | High (many emails) | Free (Gmail plus addressing) |

### vs Playwright UI Automation

| Aspect | Playwright | Our System |
|---|---|---|
| Speed | Slow (browser overhead) | Fast (pure API) |
| Reliability | Fragile (UI selectors) | Robust (API contract) |
| User creation | UI automation | Direct API calls |
| Email reading | UI in browser | IMAP/Gmail API |
| Scalability | Single browser | Unlimited users |
| Maintenance | High (UI changes) | Low (stable API) |

---

## Integration with Drive-All Pipeline

```javascript
// In drive-all.mjs

import { createMultipleTestUsers } from './lib/user-factory.mjs'

async function automateWithRandomUsers() {
  // Create 5-10 test users per pipeline run
  const userPool = await createMultipleTestUsers(process.env.AUTOMATION_USER_COUNT || 5)
  
  // Pass user pool to each operation
  await performChurnOperations(userPool)
  await performTransitionOperations(userPool)
  await performInviteOperations(userPool)
  await performEntryOperations(userPool)
  
  // Each operation uses random user from pool
}
```

---

## Troubleshooting

### "No users in pool" Error

```javascript
// Problem: Trying to use user before creating them
const pool = new UserPool('divesh.k@contentstack.com')
const user = pool.getRandomUser()  // ✗ Error!

// Solution: Create users first
const pool = await createMultipleTestUsers(5, options)
const user = pool.getRandomUser()  // ✓ Works!
```

### Email Delivery Delays

```javascript
// If reading emails, add retry logic
let emails = []
let attempts = 0
while (emails.length === 0 && attempts < 5) {
  emails = await readEmailsFromGmail(baseEmail)
  if (emails.length === 0) {
    await sleep(5000)  // Wait 5s between attempts
  }
  attempts++
}
```

### Token Extraction Issues

```javascript
// Debug email content
const email = await readEmailFromGmail(user.email)
console.log('Email body:', email.body)

// Adjust regex patterns
const perishableToken = email.body.match(/\/accept\/([a-zA-Z0-9_-]{20,})/)?.[1]
const acceptanceToken = email.body.match(/org_invitation_token=([a-zA-Z0-9_-]+)/)?.[1]

if (!perishableToken) {
  console.error('Could not extract perishable token from email')
  console.log('Raw email:', email.body)
}
```

---

## Next Steps

1. ✅ Set up environment variables
2. ✅ Run `npm run automate:random-users` to test
3. ✅ Review generated reports
4. ✅ Integrate into CI/CD pipeline
5. ✅ Scale to 50+ users per run if needed
6. ✅ Monitor operation success rates

---

## References

- [gmail-utils.mjs](../scripts/lib/gmail-utils.mjs) - Email generation & user pool
- [user-factory.mjs](../scripts/lib/user-factory.mjs) - User creation with roles
- [automate-with-random-users.mjs](../scripts/automate-with-random-users.mjs) - Automation script
