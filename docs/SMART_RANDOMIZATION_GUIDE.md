# Smart Randomization Guide

Advanced random operation assignment with multiple strategies for sophisticated testing patterns.

---

## 🎯 Overview

The smart randomization system provides flexible control over how operations are randomly assigned to users:

- **Pure Random**: Completely random operation/user selection (baseline)
- **Weighted**: Operations have different probabilities
- **Balanced**: Even distribution across users and operations
- **Round-Robin**: Cycle through users and operations in sequence
- **Clustered**: Group related operations together

---

## 📋 Quick Start

### Basic Usage (Pure Random)

```bash
npm run automate:smart-random
```

Creates 5 users performing 20 random operations in pure random order.

### Weighted Strategy

```bash
npm run automate:smart-random:weighted
```

Operations have different probabilities:
- **create-entry**: 40%
- **list-entries**: 30%
- **list-assets**: 20%
- **get-content-types**: 10%

Creates 8 users performing 40 operations with weighted distribution.

### Balanced Strategy

```bash
npm run automate:smart-random:balanced
```

Distributes operations evenly:
- Each user gets roughly equal number of operations
- Each operation is performed roughly equal times

Creates 10 users performing 50 operations with even distribution.

### Round-Robin Strategy

```bash
npm run automate:smart-random:roundrobin
```

Cycles through users and operations in sequence:
- User 1, User 2, User 3, ... User 1, User 2, ...
- Operation A, Operation B, Operation C, ... Operation A, ...

Creates 5 users performing 30 operations in cyclic order.

### Clustered Strategy

```bash
npm run automate:smart-random:clustered
```

Groups related operations together:
- If last operation was `create-entry`, next is likely `publish-entry`
- Simulates realistic workflows

Creates 8 users performing 40 operations with clustering.

---

## ⚙️ Configuration

### Environment Variables

```bash
# Strategy to use
RANDOMIZATION_STRATEGY=pure|weighted|balanced|roundrobin|clustered

# Number of users to create
CONTENTSTACK_USER_COUNT=10

# Number of operations to perform
CONTENTSTACK_OPERATION_COUNT=50

# Standard Contentstack variables
CONTENTSTACK_TEST_USER_EMAIL=your.email@contentstack.com
CONTENTSTACK_ORG_UID=org_xxxxxxx
CONTENTSTACK_API_KEY=your_api_key
CONTENTSTACK_MANAGEMENT_TOKEN=your_mgmt_token
```

### Custom Configuration

```bash
# Custom settings for any strategy
RANDOMIZATION_STRATEGY=weighted \
CONTENTSTACK_USER_COUNT=15 \
CONTENTSTACK_OPERATION_COUNT=100 \
node --env-file=.env scripts/automate-with-smart-randomization.mjs
```

---

## 🔍 Strategy Details

### 1. Pure Random (Default)

**When to use**: Baseline testing, stress testing, general coverage

**Characteristics**:
- Every operation equally likely to be selected
- Every user equally likely to be selected
- Results in random distribution of work

**Example distribution** (20 operations, 5 users):
```
User A: 5 ops
User B: 3 ops
User C: 4 ops
User D: 5 ops
User E: 3 ops

create-entry: 4 times
list-entries: 5 times
list-assets: 6 times
get-content-types: 5 times
```

### 2. Weighted Strategy

**When to use**: Realistic load simulation, priority-based testing

**Configuration**:
```javascript
randomizer.setOperationWeight('create-entry', 0.4)  // 40% probability
randomizer.setOperationWeight('list-entries', 0.3)  // 30% probability
randomizer.setOperationWeight('list-assets', 0.2)   // 20% probability
randomizer.setOperationWeight('get-content-types', 0.1) // 10% probability
```

**Example distribution** (40 operations, 8 users):
```
Expected: 16 create, 12 list-entries, 8 list-assets, 4 get-ct
Actual:   16 create, 13 list-entries, 7 list-assets, 4 get-ct
```

**Use case**: If your analytics show users mostly create entries (40%), list entries (30%), etc.

### 3. Balanced Strategy

**When to use**: Even testing coverage, fairness testing, load balancing

**Characteristics**:
- Each user receives roughly same operations
- Each operation performed roughly same times
- Minimizes variance in work distribution

**Example distribution** (30 operations, 6 users):
```
Each user: 5 operations ± variance
Each operation: ~7.5 times (if 4 operations)
```

**Use case**: Ensure all users are tested equally, verify fair distribution

### 4. Round-Robin Strategy

**When to use**: Sequential testing, deterministic reproducibility

**Characteristics**:
- Cycles through users in order: A, B, C, A, B, C, ...
- Cycles through operations in order
- Completely deterministic, fully reproducible

**Example pattern** (4 users, 3 operations):
```
Op 1: User A
Op 2: User B
Op 3: User C
Op 4: User A
Op 5: User B
Op 6: User C
...
```

**Use case**: Reproducible testing, debugging specific patterns

### 5. Clustered Strategy

**When to use**: Workflow simulation, realistic operation sequences

**Characteristics**:
- Related operations performed together
- After `create-entry`, likely to see `publish-entry`
- Simulates realistic user workflows

**Example sequence**:
```
1. create-entry (User A)
2. publish-entry (User B) ← Related to create
3. list-entries (User C)
4. create-entry (User D)
5. publish-entry (User A) ← Related to create
...
```

**Use case**: Test realistic user workflows, workflow transitions

---

## 📊 Reports

Each automation run generates a JSON report:

```bash
cat step-reports/automate-smart-randomization.json | jq .
```

### Report Structure

```json
{
  "mode": "smart-randomization",
  "strategy": "weighted",
  "timestamp": "2025-12-08T14:30:45.123Z",
  "configuration": {
    "users": 8,
    "operations": 40
  },
  "results": {
    "strategy": "weighted",
    "total_operations": 40,
    "total_successes": 38,
    "total_failures": 2,
    "success_rate": "95%",
    "users": [
      {
        "user": "divesh.k+2025-12-08T14-30-45@contentstack.com",
        "count": 5,
        "successes": 5,
        "failures": 0,
        "success_rate": "100%",
        "operations": {
          "create-entry": { "count": 2, "successes": 2, "failures": 0 },
          "list-entries": { "count": 2, "successes": 2, "failures": 0 },
          "list-assets": { "count": 1, "successes": 1, "failures": 0 }
        }
      },
      ...
    ],
    "operations": [
      {
        "operation": "create-entry",
        "count": 16,
        "successes": 15,
        "failures": 1,
        "user_count": 8,
        "success_rate": "94%"
      },
      ...
    ]
  }
}
```

### Key Metrics

- **success_rate**: Overall operation success percentage
- **user_count**: Number of different users for an operation
- **total_operations**: Total operations executed
- **strategy**: Which strategy was used

---

## 🔧 Advanced Configuration

### Create Custom Randomizer

```javascript
import { OperationRandomizer } from './lib/operation-randomizer.mjs'

// Create with specific operations and users
const randomizer = new OperationRandomizer(
  ['create-entry', 'publish-entry', 'list-entries'],
  [user1, user2, user3]
)

// Set strategy
randomizer.setStrategy('weighted')

// Configure weights
randomizer.setOperationWeight('create-entry', 0.6)
randomizer.setOperationWeight('publish-entry', 0.3)
randomizer.setOperationWeight('list-entries', 0.1)

// Blacklist/whitelist operations
randomizer.blacklistOperation('delete-entry')
randomizer.whitelistOperations(['create-entry', 'publish-entry'])

// Select and assign
const op = randomizer.selectNextOperation()
const user = randomizer.selectNextUser()
const assignment = randomizer.assignOperationToUser(op, user)

// Record result
randomizer.recordResult(assignment, true)

// Get summary
const summary = randomizer.getSummary()
```

### Blacklisting Operations

```javascript
// Don't test delete operations
randomizer.blacklistOperation('delete-entry')
randomizer.blacklistOperation('delete-stack')

// Now selectNextOperation() will never pick these
```

### Whitelisting Operations

```javascript
// Only test these operations
randomizer.whitelistOperations(['create-entry', 'publish-entry', 'list-entries'])

// All other operations ignored
```

---

## 📈 Comparison of Strategies

| Strategy | Use Case | Predictability | Variance | Realism |
|----------|----------|-----------------|----------|---------|
| Pure Random | Baseline stress test | Low | High | Medium |
| Weighted | Load simulation | Medium | Medium | High |
| Balanced | Fair coverage | High | Low | Low |
| Round-Robin | Debugging | Very High | None | Low |
| Clustered | Workflow simulation | Medium | Medium | Very High |

---

## 🎯 Examples

### Example 1: Weighted Load Simulation

Simulate realistic load where users mostly read (70%), sometimes create (20%), rarely list all (10%):

```bash
cat > custom-weighted.mjs << 'EOF'
import { OperationRandomizer } from './lib/operation-randomizer.mjs'

const randomizer = new OperationRandomizer(ops, users)
randomizer.setStrategy('weighted')
randomizer.setOperationWeight('list-entries', 0.7)
randomizer.setOperationWeight('create-entry', 0.2)
randomizer.setOperationWeight('get-content-types', 0.1)
EOF

node custom-weighted.mjs
```

### Example 2: Debug Specific Operation

Test only specific operation with all users:

```bash
cat > debug-create.mjs << 'EOF'
import { OperationRandomizer } from './lib/operation-randomizer.mjs'

const randomizer = new OperationRandomizer(ops, users)
randomizer.whitelistOperations(['create-entry'])
// All 20 operations will be 'create-entry'
EOF
```

### Example 3: Realistic Workflow

Simulate user doing: create → publish → list operations:

```bash
npm run automate:smart-random:clustered
```

---

## 🐛 Troubleshooting

### All operations are the same

**Issue**: Only one operation type in results

**Solution**: Check whitelist/blacklist:
```javascript
console.log(randomizer.getAvailableOperations())
```

### Unbalanced distribution with "balanced" strategy

**Issue**: Some users get more operations than others

**Normal**: Balanced strategy uses greedy approach, exact balance impossible. Typically within 10% variance.

### Reports not found

**Issue**: `step-reports/automate-smart-randomization.json` doesn't exist

**Solution**: Check that script completed successfully, check logs for errors

---

## 📚 More Information

- **Operation Randomizer**: [operation-randomizer.mjs](../scripts/lib/operation-randomizer.mjs)
- **Smart Automation Script**: [automate-with-smart-randomization.mjs](../scripts/automate-with-smart-randomization.mjs)
- **Logger System**: [logger.mjs](../scripts/lib/logger.mjs)
- **Email Generation**: [gmail-utils.mjs](../scripts/lib/gmail-utils.mjs)

---

## 🚀 Next Steps

1. **Choose a strategy** based on your testing needs
2. **Configure users and operations** via environment variables
3. **Run the automation**: `npm run automate:smart-random:<strategy>`
4. **Review the report** in `step-reports/automate-smart-randomization.json`
5. **Adjust weights/configuration** based on results

---

**Happy testing! 🎉**
