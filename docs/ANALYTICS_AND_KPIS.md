# Comprehensive Analytics & KPI System

Detailed KPI extraction from audit trails without redundant logging. All analytics are derived from the audit trail data collected during test execution.

---

## 🎯 Overview

**Architecture**: Audit Trail → AnalyticsEngine → KPIs + Visualization Data

**Key Principle**: No redundant logging files. All data comes from audit trail, one source of truth.

**Output**: JSON reports + Visualization-ready data structures

---

## 📊 Available KPIs

### SYSTEM-LEVEL KPIs

**Overall Performance**
- Total operations executed
- Successful operations count
- Failed operations count
- Overall success rate (%)
- Execution duration
- Throughput (ops/second)

**Breakdown**
- Single-user operations count
- Multi-user operations count
- Unique users count
- Unique roles count
- Unique operations count

**Load Distribution**
- Average operations per user
- Min/Max operations per user
- Standard deviation
- Fairness score (0-100)
- Distribution explanation

---

### ROLE-BASED KPIs

**Per-Role Metrics**
- Users with role (count)
- Total operations performed by role
- Successful operations
- Failed operations
- Success rate (%)
- Average operations per user in role

**Operation Breakdown by Role**
- Which operations role performed
- Frequency of each operation
- Success rate per operation
- Execution count per operation

**Role Coverage**
- Coverage percentage (performed vs allowed)
- Performed operations count
- Allowed operations count
- Unperformed allowed operations list

**Permission Validation**
- Permission violations count
- Violations by role
- Violations by operation
- Sample violations with details

---

### OPERATION-BASED KPIs

**Per-Operation Metrics**
- Total executions
- Successful executions
- Failed executions
- Success rate (%)
- Unique users count
- Roles involved (list)

**Operation Sequences**
- Most common operation pairs (A → B)
- Sequence frequency
- User workflow patterns
- Dependencies (inferred)

---

### USER-BASED KPIs

**User Reliability Ranking**
- Rank (1-N)
- User email
- Role
- Success rate (%)
- Total operations count

**User Performance**
- Total operations per user
- Successful operations
- Failed operations
- Success rate (%)
- Unique operations performed
- Operations per second

**User Specialization**
- Strengths (100% success operations)
- Good at (80%+ success)
- Weak in (<50% success)
- Operation-specific success rates

**User Workload**
- Operations distribution
- Role assignment
- Time to completion
- Peak activity periods

---

### MULTI-USER OPERATION KPIs

**Completion Metrics**
- Total executions
- Successful completions
- Failed completions
- Success rate (%)

**Step Analysis**
- Steps completed
- Roles involved
- Per-step success rates
- Bottleneck identification

**Collaboration Patterns**
- Which role combinations work best
- Most reliable collaborations
- Common failure patterns

---

## 📈 Visualization Data

### Available Visualizations

1. **Role Success Rates** (Bar Chart)
   - X-axis: Roles
   - Y-axis: Success rate (%)
   - Size: Number of operations

2. **Operation Success Rates** (Bar Chart)
   - X-axis: Operations
   - Y-axis: Success rate (%)
   - Size: Execution count

3. **User Workload** (Scatter Plot)
   - X-axis: User
   - Y-axis: Operations
   - Color: Role
   - Size: Success rate

4. **Role-Operation Heatmap** (2D Grid)
   - X-axis: Operations
   - Y-axis: Roles
   - Color intensity: Success rate
   - Cell value: Execution count

5. **System Metrics** (KPI Cards)
   - Overall success rate
   - Throughput
   - Load fairness
   - Coverage metrics

---

## 🔄 How to Generate Reports

### Generate from Any Audit Trail

```bash
# Generate from role-based automation
npm run analytics:from-roles

# Generate from smart randomization
npm run analytics:from-smart-random

# Generate from custom file
npm run analytics:generate step-reports/custom-audit-trail.json
```

### Output Files

```
step-reports/
├── analytics-report.json          # Comprehensive KPI data
└── visualization-data.json        # Ready for charting/visualization
```

---

## 📋 Report Structure

### analytics-report.json

```json
{
  "system": {
    "summary": {
      "total_operations": 95,
      "successful_operations": 88,
      "failed_operations": 7,
      "overall_success_rate": 93
    },
    "breakdown": {
      "single_user_operations": 90,
      "multi_user_operations": 5
    },
    "unique_counts": {
      "users": 30,
      "roles": 5,
      "operations": 10
    },
    "duration": {
      "start": "2025-12-08T14:30:00Z",
      "end": "2025-12-08T14:35:30Z",
      "duration_seconds": 330,
      "throughput_ops_per_second": "0.29"
    }
  },

  "load_distribution": {
    "average_ops_per_user": 3,
    "min_ops": 2,
    "max_ops": 5,
    "std_deviation": 1,
    "fairness_score": 85,
    "distribution_explanation": "Excellent distribution"
  },

  "roles": {
    "owner": {
      "role": "Owner",
      "level": 5,
      "users_with_role": 1,
      "total_operations": 12,
      "successful_operations": 12,
      "failed_operations": 0,
      "success_rate": 100,
      "operations_breakdown": { ... },
      "error_patterns": {},
      "avg_operations_per_user": 12
    },
    ...
  },

  "role_coverage": {
    "owner": {
      "role": "Owner",
      "allowed_operations": 12,
      "performed_operations": ["create-entry", "delete-entry", ...],
      "coverage_percentage": 100,
      "unperformed_allowed_ops": []
    },
    ...
  },

  "permission_validation": {
    "validations": {
      "total_operations_checked": 95,
      "permission_violations": 0,
      "valid_operations": 95,
      "violations_by_role": {},
      "violations_by_operation": {}
    },
    "violations": []
  },

  "operations": {
    "create-entry": {
      "operation": "create-entry",
      "total_executions": 20,
      "successful": 19,
      "failed": 1,
      "success_rate": 95,
      "unique_users": 15,
      "roles_involved": ["owner", "admin", "editor", "contributor"]
    },
    ...
  },

  "operation_sequences": {
    "create-entry → publish-entry": 8,
    "list-entries → create-entry": 5,
    ...
  },

  "users": {
    "divesh.k+run-...-role-editor@...": {
      "user": "divesh.k+...",
      "role": "editor",
      "total_operations": 5,
      "successful": 5,
      "failed": 0,
      "success_rate": 100,
      "unique_operations": 3,
      "operations_performed": ["create-entry", "publish-entry", "list-entries"],
      "first_operation_at": "2025-12-08T14:30:05Z",
      "last_operation_at": "2025-12-08T14:35:00Z",
      "duration_seconds": 295,
      "ops_per_second": "0.02"
    },
    ...
  },

  "user_reliability_ranking": [
    {
      "rank": 1,
      "user": "divesh.k+...",
      "role": "admin",
      "success_rate": 100,
      "operations": 8
    },
    ...
  ],

  "user_specialization": {
    "divesh.k+...": {
      "role": "editor",
      "strengths": [
        { "operation": "create-entry", "executions": 2 }
      ],
      "good_at": [
        { "operation": "publish-entry", "success_rate": 80, "executions": 5 }
      ],
      "weak_in": []
    },
    ...
  },

  "multi_user_operations": {
    "total_multi_user_ops": 4,
    "operations": {
      "review-and-publish": {
        "operation": "review-and-publish",
        "total_executions": 1,
        "successful": 1,
        "failed": 0,
        "success_rate": 100,
        "steps_completed": ["step-1", "step-2", "step-3"],
        "roles_involved": ["editor", "admin"],
        "step_success_rates": {
          "step-1": { "count": 1, "successful": 1, "success_rate": 100 },
          ...
        }
      },
      ...
    }
  }
}
```

---

## 📊 Key Metrics Reference

| Metric | Range | Good | Excellent | Example |
|--------|-------|------|-----------|---------|
| Success Rate | 0-100% | >80% | >95% | 93% |
| Fairness Score | 0-100 | >60 | >80 | 85 |
| Coverage | 0-100% | >80% | 100% | 100% |
| Throughput | ops/sec | >0.1 | >0.5 | 0.29 |

---

## 🔍 Analysis Patterns

### Pattern 1: Identify High-Risk Operations

```
SELECT operations WHERE success_rate < 70%
SORT BY failed_operations DESC
SHOW: operation, success_rate, failure_count
```

**Insight**: Operations with low success rates need investigation.

### Pattern 2: Find User Bottlenecks

```
SELECT users WHERE success_rate < 80%
ORDER BY failed_operations DESC
SHOW: user, role, success_rate, weak_in operations
```

**Insight**: Users struggling with specific roles/operations.

### Pattern 3: Validate Permission Boundaries

```
CHECK: permission_violations count
IF > 0: LIST violations by role and operation
```

**Insight**: Ensure role enforcement is working correctly.

### Pattern 4: Find Workflow Patterns

```
SELECT operation_sequences WHERE frequency > 3
ORDER BY frequency DESC
```

**Insight**: Understand common user workflow patterns.

### Pattern 5: Multi-User Operation Health

```
SELECT multi_user_operations
WHERE success_rate < 90%
SHOW: operation, step_success_rates, bottlenecks
```

**Insight**: Find failure points in collaborative workflows.

---

## 💡 Use Cases

### Use Case 1: QA Validation

Generate analytics after test run:
```bash
npm run automate:with-roles
npm run analytics:from-roles
```

Check:
- Overall success rate > 95%?
- Permission violations = 0?
- Fairness score > 80?
- All roles covered?

### Use Case 2: Performance Optimization

```bash
npm run analytics:from-roles | grep "throughput"
```

Track throughput over multiple runs to identify bottlenecks.

### Use Case 3: User Training

From user_specialization KPIs:
- Find users weak in specific operations
- Recommend training based on weak_in patterns
- Track improvement over time

### Use Case 4: Role Assignment Validation

From role_coverage KPIs:
- Verify all allowed operations are performed
- Identify unused permissions
- Validate role boundaries

### Use Case 5: Load Testing

From load_distribution KPIs:
- Monitor fairness score
- Ensure even work distribution
- Detect user overload

---

## 🚀 Advanced Analytics

### Custom Analysis Script

```javascript
import { AnalyticsEngine } from './lib/analytics-engine.mjs'
import { ROLES } from './lib/role-based-users.mjs'

const trail = JSON.parse(fs.readFileSync('audit-trail.json'))
const engine = new AnalyticsEngine(trail, ROLES)

// Custom analysis
const roleAnalytics = engine.getRoleAnalytics()
const roleFailures = Object.entries(roleAnalytics)
  .filter(([_, data]) => data.success_rate < 90)
  .map(([role, data]) => ({
    role: data.role,
    success_rate: data.success_rate,
    failures: data.failed_operations
  }))

console.log('Roles with <90% success:', roleFailures)
```

### Trend Analysis

Track KPIs across multiple runs:
```bash
for run in run{1,2,3}; do
  npm run analyze -- step-reports/$run.json | jq '.system.summary'
done
```

---

## 📈 Visualization Examples

### Example 1: Role Success Rate Bar Chart

```
100% |     ██   ██
     |     ██   ██   ██
     |  ██ ██   ██   ██
     | ███████████████
     |
   0% |_________________
      Owner Admin Editor Contributor Viewer
```

### Example 2: Role-Operation Heatmap

```
       create publish delete list
Owner    ██     ██      ██    ██
Admin    ██     ██      ░░    ██
Editor   ██     ██      ░░    ██
Contrib  ██     ░░      ░░    ██
Viewer   ░░     ░░      ░░    ██

██ = High success, ░░ = Low/No coverage
```

### Example 3: User Reliability Distribution

```
Success Rate Distribution:
100% |                    █
90%  |              █    ██
80%  |           █  ██  ███
70%  |         █ ██  █ ███
     |_________________________
      0     5    10    15   20
      User Count
```

---

## 🔧 Configuration

### No Configuration Needed!

The AnalyticsEngine automatically extracts all KPIs from the audit trail. No configuration required.

### Output Customization

Generate specific reports:

```bash
# Full report
node scripts/generate-analytics-report.mjs audit-trail.json

# Then extract specific sections:
jq '.roles' analytics-report.json
jq '.users | map(.success_rate)' analytics-report.json
jq '.operation_sequences' analytics-report.json
```

---

## 📚 Related Documentation

- [Role-Based Guide](ROLE_BASED_GUIDE.md) - Role definitions and operations
- [Smart Randomization Guide](SMART_RANDOMIZATION_GUIDE.md) - Randomization strategies
- [Analytics Engine](../scripts/lib/analytics-engine.mjs) - Source code
- [Report Generator](../scripts/generate-analytics-report.mjs) - Report script

---

## ✨ Summary

**What We Have**:
- ✓ Audit trails from every automation run
- ✓ 40+ different KPIs extracted automatically
- ✓ Visualization-ready data structures
- ✓ No redundant logging files
- ✓ Single source of truth (audit trail)

**What We Can Do**:
- ✓ Track user reliability over time
- ✓ Validate role permissions
- ✓ Identify workflow patterns
- ✓ Monitor system fairness
- ✓ Detect bottlenecks
- ✓ Analyze multi-user operations

**Next Steps**:
1. Run automation: `npm run automate:with-roles`
2. Generate analytics: `npm run analytics:from-roles`
3. Review KPIs in JSON reports
4. Create visualizations from data

---

**Let's analyze! 📊**
