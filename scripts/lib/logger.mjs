/**
 * logger.mjs — Structured logging for automation scripts
 *
 * Features:
 * - Timestamped log messages
 * - Log levels: DEBUG, INFO, WARN, ERROR
 * - Colored output for better readability
 * - JSON export for structured logs
 * - Categories for organizing logs
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
}

/**
 * Logger class
 */
export class Logger {
  constructor(category = 'automation', minLevel = 'INFO') {
    this.category = category
    this.minLevel = LOG_LEVELS[minLevel] || LOG_LEVELS.INFO
    this.logs = []
  }

  /**
   * Format timestamp as HH:MM:SS
   */
  _timestamp() {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  }

  /**
   * Log message at specified level
   */
  _log(level, message, data = null) {
    if (LOG_LEVELS[level] < this.minLevel) return

    const timestamp = this._timestamp()
    const emoji = {
      DEBUG: '🔍',
      INFO: 'ℹ️',
      WARN: '⚠️',
      ERROR: '❌',
    }[level]

    const color = {
      DEBUG: COLORS.dim,
      INFO: COLORS.blue,
      WARN: COLORS.yellow,
      ERROR: COLORS.red,
    }[level]

    const logEntry = {
      timestamp,
      level,
      category: this.category,
      message,
      data: data || undefined,
    }

    this.logs.push(logEntry)

    // Console output
    let output = `${emoji} ${COLORS.dim}${timestamp}${COLORS.reset} ${color}[${this.category}]${COLORS.reset} ${message}`
    if (data) {
      output += ` ${COLORS.dim}${JSON.stringify(data)}${COLORS.reset}`
    }
    console.log(output)
  }

  debug(message, data = null) {
    this._log('DEBUG', message, data)
  }

  info(message, data = null) {
    this._log('INFO', message, data)
  }

  warn(message, data = null) {
    this._log('WARN', message, data)
  }

  error(message, data = null) {
    this._log('ERROR', message, data)
  }

  /**
   * Get all logs as JSON
   */
  toJSON() {
    return this.logs
  }

  /**
   * Clear logs
   */
  clear() {
    this.logs = []
  }

  /**
   * Get summary
   */
  getSummary() {
    const counts = {
      DEBUG: 0,
      INFO: 0,
      WARN: 0,
      ERROR: 0,
    }

    for (const log of this.logs) {
      counts[log.level]++
    }

    return {
      total: this.logs.length,
      by_level: counts,
    }
  }
}

/**
 * Global loggers
 */
const loggers = new Map()

export function getLogger(category = 'automation') {
  if (!loggers.has(category)) {
    loggers.set(category, new Logger(category))
  }
  return loggers.get(category)
}

/**
 * Example usage:
 *
 * import { getLogger } from './lib/logger.mjs'
 *
 * const log = getLogger('user-factory')
 *
 * log.info('Creating users...', { count: 10 })
 * log.debug('User details', { email: 'test@example.com', role: 'admin' })
 * log.warn('Slow operation', { duration_ms: 5000 })
 * log.error('Failed to create user', { email: 'test@example.com', error: 'Already exists' })
 *
 * // Get logs
 * console.log(log.getSummary())
 * console.log(log.toJSON())
 */
