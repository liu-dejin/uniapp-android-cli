import { spawn } from 'node:child_process'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

/**
 * @typedef {Object} RunOptions
 * @property {string} [cwd]
 * @property {Record<string, string | undefined>} [env]
 * @property {boolean} [allowFailure]
 * @property {(line: string) => void} [onLine]
 * @property {(chunk: string, stream: 'stdout' | 'stderr') => void} [onChunk]
 * @property {'inherit' | 'pipe'} [stdio]
 */

/**
 * 子进程的 chunk 边界可能落在一行中间（尤其 Gradle 输出被 JVM 分块写出），
 * 这里按 \n 缓冲残行，flush 时把最后一段不完整的行也交出去。
 * @param {(line: string) => void} onLine
 * @returns {{ push: (chunk: string) => void, flush: () => void }}
 */
export function createLineSplitter(onLine) {
  let pending = ''
  return {
    push(chunk) {
      pending += chunk
      let index = pending.indexOf('\n')
      while (index >= 0) {
        const line = pending.slice(0, index).replace(/\r$/, '')
        pending = pending.slice(index + 1)
        if (line.trim()) {
          onLine(line)
        }
        index = pending.indexOf('\n')
      }
    },
    flush() {
      const line = pending.replace(/\r$/, '')
      pending = ''
      if (line.trim()) {
        onLine(line)
      }
    },
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {RunOptions} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function run(command, args, options = {}) {
  const isWindows = process.platform === 'win32'
  const resolved = isWindows && !path.extname(command) ? `${command}.cmd` : command
  const isScript = isWindows && /\.(bat|cmd)$/i.test(resolved)
  return new Promise((resolve, reject) => {
    const child = spawn(resolved, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: isScript,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
    const splitters = {
      stdout: options.onLine ? createLineSplitter(options.onLine) : null,
      stderr: options.onLine ? createLineSplitter(options.onLine) : null,
    }

    /**
     * @param {'stdout' | 'stderr'} stream
     * @param {Buffer} chunk
     */
    const consume = (stream, chunk) => {
      const text = decoders[stream].write(chunk)
      if (stream === 'stdout') {
        stdout += text
      } else {
        stderr += text
      }
      options.onChunk?.(text, stream)
      splitters[stream]?.push(text)
    }

    child.stdout?.on('data', (chunk) => consume('stdout', chunk))
    child.stderr?.on('data', (chunk) => consume('stderr', chunk))

    child.on('error', reject)
    child.on('close', (code) => {
      for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
        const tail = decoders[stream].end()
        if (tail) {
          if (stream === 'stdout') {
            stdout += tail
          } else {
            stderr += tail
          }
          options.onChunk?.(tail, stream)
          splitters[stream]?.push(tail)
        }
        splitters[stream]?.flush()
      }

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
