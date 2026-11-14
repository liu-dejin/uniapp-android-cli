export const EXIT = {
  OK: 0,
  CONFIG: 2,
  PREFLIGHT: 3,
  WEB_BUILD: 4,
  GRADLE: 5,
  SIGN: 6,
  DEVICE: 7,
  WGT: 8,
}

export class PackError extends Error {
  /**
   * @param {string} message
   * @param {number} [code]
   * @param {{ hint?: string, cause?: unknown }} [options]
   */
  constructor(message, code = EXIT.CONFIG, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'PackError'
    this.code = code
    this.hint = options.hint
  }
}

/**
 * @param {unknown} error
 * @returns {{ code: number, message: string, hint?: string }}
 */
export function toFailure(error) {
  if (error instanceof PackError) {
    return { code: error.code, message: error.message, hint: error.hint }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 1, message }
}
