const SECRET_KEYS = /password|passwd|pwd|secret|token/i

/** @typedef {{ verbose: boolean, json: boolean }} LoggerOptions */

export class Logger {
  /** @param {Partial<LoggerOptions>} [options] */
  constructor(options = {}) {
    this.verbose = Boolean(options.verbose)
    this.json = Boolean(options.json)
  }

  /** @param {string} message */
  step(message) {
    if (!this.json) {
      console.log(`\n▸ ${message}`)
    }
  }

  /** @param {string} message */
  info(message) {
    if (!this.json) {
      console.log(`  ${message}`)
    }
  }

  /** @param {string} message */
  detail(message) {
    if (!this.json && this.verbose) {
      console.log(`    ${message}`)
    }
  }

  /** @param {string} message */
  warn(message) {
    if (!this.json) {
      console.warn(`  ! ${message}`)
    }
  }

  /** @param {string} message */
  success(message) {
    if (!this.json) {
      console.log(`  ✓ ${message}`)
    }
  }

  /**
   * @param {unknown} value
   * @param {unknown[]} [secrets]
   */
  redact(value, secrets = []) {
    let text = typeof value === 'string' ? value : JSON.stringify(value)
    for (const secret of secrets) {
      if (typeof secret === 'string' && secret.length > 0) {
        text = text.split(secret).join('***')
      }
    }
    return text
  }

  /**
   * @param {string} message
   * @param {unknown} payload
   */
  output(message, payload) {
    if (this.json) {
      console.log(JSON.stringify({ message, ...(payload ?? {}) }, null, 2))
    }
  }
}

/**
 * @param {Record<string, unknown>} object
 */
export function redactObject(object) {
  /** @type {Record<string, unknown>} */
  const result = {}
  for (const [key, value] of Object.entries(object)) {
    result[key] = SECRET_KEYS.test(key) ? '***' : value
  }
  return result
}
