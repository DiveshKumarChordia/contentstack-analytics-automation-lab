/**
 * Structured logging with request tracing support.
 * All logs include requestId, step name, and timestamp for full context propagation.
 */

import { createWriteStream } from 'node:fs'
import { resolve } from 'node:path'

export class StructuredLogger {
  constructor(stepName, options = {}) {
    this.stepName = stepName
    this.requestId = options.requestId || this.generateRequestId()
    this.logs = []
    this.logStream = options.logStream || null
    this.verbose = options.verbose !== false
  }

  generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  log(level, message, context = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      step: this.stepName,
      requestId: this.requestId,
      message,
      ...context,
    }

    // Console output (human-readable)
    if (this.verbose) {
      const timestamp = entry.timestamp.split('T')[1].split('.')[0]
      const prefix = `[${timestamp}] [${level}] [${this.stepName}]`
      if (level === 'ERROR' || level === 'WARN') {
        console.error(`${prefix} ${message}`, context)
      } else {
        console.log(`${prefix} ${message}`, Object.keys(context).length ? context : '')
      }
    }

    // JSON output (machine-readable)
    console.log(JSON.stringify(entry))

    // Stream output (for file persistence)
    if (this.logStream) {
      this.logStream.write(JSON.stringify(entry) + '\n')
    }

    this.logs.push(entry)
  }

  info(message, context = {}) {
    this.log('INFO', message, context)
  }

  warn(message, context = {}) {
    this.log('WARN', message, context)
  }

  error(message, error, context = {}) {
    const errorContext = {
      errorName: error?.name || 'Unknown',
      errorMessage: error?.message || String(error),
      errorStack: error?.stack
        ? error.stack.split('\n').slice(0, 3).map(l => l.trim())
        : [],
      ...context,
    }
    this.log('ERROR', message, errorContext)
  }

  getLogTrail() {
    return this.logs
      .map(
        (l) =>
          `[${l.timestamp}] ${l.level.padEnd(5)} ${l.message}${
            Object.keys(l).length > 6 ? ' ' + JSON.stringify(l) : ''
          }`,
      )
      .join('\n')
  }

  getSummary() {
    const counts = { INFO: 0, WARN: 0, ERROR: 0 }
    for (const log of this.logs) {
      counts[log.level] = (counts[log.level] || 0) + 1
    }
    return {
      requestId: this.requestId,
      step: this.stepName,
      totalLogs: this.logs.length,
      counts,
      duration: this.logs.length
        ? new Date(this.logs[this.logs.length - 1].timestamp).getTime() -
          new Date(this.logs[0].timestamp).getTime()
        : 0,
    }
  }

  static withFile(stepName, logFile) {
    const stream = createWriteStream(resolve(process.cwd(), logFile), { flags: 'a' })
    return new StructuredLogger(stepName, { logStream: stream })
  }
}

// Context management for request ID propagation
let currentRequestId = null

export function setRequestId(id) {
  currentRequestId = id
}

export function getRequestId() {
  return currentRequestId
}
