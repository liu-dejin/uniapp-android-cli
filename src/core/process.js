import { spawn } from 'node:child_process'

/**
 * @typedef {Object} RunOptions
 * @property {string} [cwd]
 * @property {Record<string, string | undefined>} [env]
 * @property {boolean} [allowFailure]
 * @property {(line: string) => void} [onLine]
 * @property {'inherit' | 'pipe'} [stdio]
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {RunOptions} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function run(command, args, options = {}) {
  const isScript = process.platform === 'win32' && /\.(bat|cmd)$/i.test(command)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: isScript,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    /** @param {Buffer} chunk */
    const consume = (chunk) => {
      const text = chunk.toString()
      if (!options.onLine) {
        return text
      }
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          options.onLine(line)
        }
      }
      return text
    }

    child.stdout?.on('data', (chunk) => {
      stdout += consume(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += consume(chunk)
    })

    child.on('error', reject)
    child.on('close', (code) => {
      const exitCode = code ?? 1
      if (exitCode !== 0 && !options.allowFailure) {
        const error = new Error(`${command} 退出码 ${exitCode}`)
        // @ts-expect-error 附加诊断信息
        error.stdout = stdout
        // @ts-expect-error 附加诊断信息
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ code: exitCode, stdout, stderr })
    })
  })
}
