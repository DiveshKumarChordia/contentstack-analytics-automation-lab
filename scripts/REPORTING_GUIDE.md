# Enhanced Reporting Guide

## Using writeStepReport() for Better Logging

The enhanced reporting system helps track what happened in each automation step.

### Basic Usage

```javascript
import { writeStepReport } from './lib/report.mjs'

// At the end of your script:
await writeStepReport({
  planned: 100,        // How many we intended to do
  actual: 95,          // How many actually succeeded
  failed: 5,           // How many failed
  kpis: {
    created: 95,       // Named counters
    failed: 5,
    duration_ms: 12000,
  },
  errors: [
    { label: 'rate-limit', message: 'HTTP 429 on batch 3' },
    { label: 'timeout', message: 'Request took >30s' },
  ],
})
```

### Entry Count Snapshots (CRITICAL!)

Track what entries looked like BEFORE and AFTER tiered retention:

```javascript
import { listEntries } from './lib/cma.mjs'

async function captureEntryCount(base, headers, contentTypes) {
  const counts = {}
  for (const ct of contentTypes) {
    const { body } = await listEntries(base, headers, ct, { includeCount: true })
    counts[ct] = body?.entries_count || 0
  }
  return counts
}

async function main() {
  // BEFORE: Capture initial state
  const beforeCounts = await captureEntryCount(base, headers, ['demo_plain_text', 'demo_reference'])
  
  // ... do your operations ...
  
  // AFTER: Capture final state
  const afterCounts = await captureEntryCount(base, headers, ['demo_plain_text', 'demo_reference'])
  
  // REPORT: Include both
  await writeStepReport({
    planned: 100,
    actual: 95,
    failed: 5,
    entryCountBefore: beforeCounts,  // NEW!
    entryCountAfter: afterCounts,    // NEW!
    kpis: { created: 95, deleted: 0 },
  })
}
```

### Log Trails for Debugging

Capture a detailed log of what happened:

```javascript
const logs = []

function log(msg) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${msg}`
  console.log(line)
  logs.push(line)  // Capture for report
}

async function main() {
  log('Step 1: Loading stack auth')
  const { apiKey, base } = loadStackAuth()
  
  log(`Step 2: Creating 100 entries on ${ct}`)
  for (let i = 0; i < 100; i++) {
    try {
      const { ok, body } = await createEntry(base, headers, ct, { title: `Entry ${i}` })
      if (!ok) {
        log(`  Entry ${i}: FAILED (${body?.error || 'unknown'})`)
        failed++
      }
    } catch (e) {
      log(`  Entry ${i}: ERROR (${e.message})`)
      failed++
    }
  }
  
  // REPORT: Include the log trail
  await writeStepReport({
    planned: 100,
    actual: 100 - failed,
    failed,
    logTrail: logs.join('\n'),  // NEW!
    kpis: { created: 100 - failed },
  })
}
```

## Understanding the Report Output

### Validation Warnings
If you see this:
```
⚠️ Validation warnings (Planned ≠ Actual + Failed)
- branch lifecycle: Planned=30 but actual+failed=1
```

It means:
- You planned 30 operations
- But only reported 1 actual + 0 failed = 1 total
- **Missing 29 operations!** Check your log trail for what happened

### Entry Count Snapshots
```
📊 Entry count snapshots (tiered retention)

delete old entries:
| Content Type | Before | After | Change |
|---|--:|--:|--:|
| demo_plain_text | 5280 | 5000 | ↓ 280 |
| demo_reference  | 5420 | 5000 | ↓ 420 |
```

Tells you exactly what the tiered retention did.

### Error Audit Log
Shows every single failure with its cause so you can see patterns:
```
⚠️ Error audit log
| Step | Case | Message |
|---|---|---|
| churn orphan cases | disable→enable | HTTP 422: Unprocessable Entity |
| branch lifecycle | create | Access denied (insufficient perms) |
```

## Best Practices

1. **Always capture before/after** for operations that modify state
2. **Validate math**: planned = actual + failed (always!)
3. **Log at key checkpoints** so you can trace execution flow
4. **Include error details** — the error message is your debugging trail
5. **Use KPI counters** for any metric that matters (throughput, latency, etc)

## Example: delete-old-entries.mjs

```javascript
async function main() {
  const { base, headers } = ...
  const cts = ['demo_plain_text', 'demo_reference', ...]
  
  // 1. BEFORE counts
  console.log('Capturing entry counts (BEFORE tiered retention)...')
  const before = {}
  for (const ct of cts) {
    const { body } = await listEntries(base, headers, ct, { includeCount: true })
    before[ct] = body?.entries_count || 0
  }
  console.log(`  Total before: ${Object.values(before).reduce((a,b)=>a+b)}`)
  
  // 2. DO THE WORK
  let deleted = 0
  let failed = 0
  for (const ct of cts) {
    const { ok, body } = await deleteOldEntries(base, headers, ct, { maxAge: 30 })
    if (ok) deleted += body.count
    else failed++
  }
  
  // 3. AFTER counts
  const after = {}
  for (const ct of cts) {
    const { body } = await listEntries(base, headers, ct, { includeCount: true })
    after[ct] = body?.entries_count || 0
  }
  console.log(`  Total after: ${Object.values(after).reduce((a,b)=>a+b)}`)
  
  // 4. REPORT
  await writeStepReport({
    planned: cts.length,
    actual: deleted,
    failed,
    entryCountBefore: before,
    entryCountAfter: after,
    kpis: {
      deleted,
      total_before: Object.values(before).reduce((a,b)=>a+b),
      total_after: Object.values(after).reduce((a,b)=>a+b),
    },
  })
}
```

Now the report will show:
- ✓ How many CTs we touched (planned)
- ✓ How many entries were deleted (actual)
- ✓ What each CT looked like before/after
- ✓ Exact count of deletion impact per content type

This makes debugging SO much easier! 🚀
