#!/usr/bin/env node
/**
 * Safe append to run-history.json with automatic conflict resolution
 *
 * Usage: node scripts/safe-append-run-history.mjs <run-record.json>
 *
 * Handles race conditions by:
 * 1. Reading the run record to append (validated JSON)
 * 2. Reading existing run-history.json (with automatic conflict marker removal)
 * 3. Appending the new run
 * 4. Validating the result is valid JSON
 * 5. Writing back atomically
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HISTORY_FILE = path.join(__dirname, '..', 'public', 'run-history.json')

/**
 * Remove git merge conflict markers from JSON
 * Keeps the "upstream" (current branch) version
 */
function removeConflictMarkers(content) {
  let result = content
  // Pattern: <<<<<<< ... =======  ... >>>>>>>
  // Keep content between <<<<<<< and =======
  result = result.replace(/<<<<<<< [^\n]*\n([\s\S]*?)\n=======\n[\s\S]*?\n>>>>>>> [^\n]*\n/g, '$1')
  // Also handle case where there are multiple nested markers
  while (result.includes('<<<<<<<') || result.includes('=======') || result.includes('>>>>>>>')) {
    const prevResult = result
    result = result.replace(/<<<<<<< [^\n]*\n([\s\S]*?)\n=======\n[\s\S]*?\n>>>>>>> [^\n]*\n/g, '$1')
    if (result === prevResult) break // Prevent infinite loop
  }
  return result
}

/**
 * Validate JSON and return parsed object, or null if invalid
 */
function tryParseJSON(content) {
  try {
    return JSON.parse(content)
  } catch (e) {
    console.error(`Invalid JSON: ${e.message}`)
    return null
  }
}

/**
 * Read run history, cleaning up any conflict markers
 */
function readRunHistory() {
  try {
    let content = fs.readFileSync(HISTORY_FILE, 'utf8')

    // If file has conflict markers, remove them
    if (content.includes('<<<<<<<')) {
      console.warn('⚠️  Found merge conflict markers in run-history.json, removing...')
      content = removeConflictMarkers(content)
    }

    // Try to parse as JSON
    const data = tryParseJSON(content)
    if (!Array.isArray(data)) {
      console.warn('⚠️  run-history.json is not an array, reinitializing')
      return []
    }
    return data
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log('Creating new run-history.json')
      return []
    }
    console.error(`Failed to read run-history.json: ${e.message}`)
    throw e
  }
}

/**
 * Main: append a run record to the history
 */
async function main() {
  // Get the run record from stdin or command-line arg
  const runRecordArg = process.argv[2]
  if (!runRecordArg) {
    console.error('Usage: node safe-append-run-history.mjs <run-record.json>')
    console.error('  Reads run record from file and appends to public/run-history.json')
    process.exit(1)
  }

  // Read the run record to append
  let runRecord
  try {
    const recordContent = fs.readFileSync(runRecordArg, 'utf8')
    runRecord = tryParseJSON(recordContent)
    if (!runRecord) {
      console.error(`✗ Invalid JSON in ${runRecordArg}`)
      process.exit(1)
    }
  } catch (e) {
    console.error(`✗ Failed to read ${runRecordArg}: ${e.message}`)
    process.exit(1)
  }

  // Read existing history (handles conflict markers automatically)
  const runs = readRunHistory()
  console.log(`✓ Read ${runs.length} existing runs`)

  // Append the new run
  runs.push(runRecord)
  console.log(`✓ Appended new run (${runRecord.runId || 'unknown'})`)

  // Validate the result is valid JSON
  try {
    JSON.stringify(runs, null, 2)
  } catch (e) {
    console.error(`✗ Result would be invalid JSON: ${e.message}`)
    process.exit(1)
  }

  // Write back atomically (temp file + rename)
  const tempFile = `${HISTORY_FILE}.tmp`
  try {
    fs.writeFileSync(tempFile, JSON.stringify(runs, null, 2) + '\n', 'utf8')
    fs.renameSync(tempFile, HISTORY_FILE)
    console.log(`✓ Wrote ${runs.length} runs to ${HISTORY_FILE}`)
  } catch (e) {
    console.error(`✗ Failed to write run-history.json: ${e.message}`)
    try { fs.unlinkSync(tempFile) } catch (_) {}
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
