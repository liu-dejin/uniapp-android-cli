import { spawn } from 'node:child_process'
import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { run } from './process.js'

/** HBuilderX launch 命令要求 5.0+。 */
const MIN_MAJOR = 5

/**
 * @typedef {{ major: number, minor: number, patch: number, raw: string }} CliVersion
 */

/**
 * `cli ver` 可能带 ANSI 颜色，输出形如 5.34.2026102909。
 * @param {string} output
 * @returns {CliVersion | null}
 */
export function parseHbuilderxCliVersion(output) {
  const text = String(output ?? '').replace(/\u001b\[[0-9;]*m/g, '')
  const match = /(\d+)\.(\d+)\.(\d+)(?:\.\d+)?/.exec(text)
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: match[0],
  }
}

/**
 * @param {CliVersion | null} version
 * @returns {boolean}
 */
export function supportsLaunch(version) {
  return Boolean(version && version.major >= MIN_MAJOR)
}

/**
 * @param {string} root HBuilderX 安装目录
 * @returns {string}
 */
export function cliPath(root) {
  return path.join(root, process.platform === 'win32' ? 'cli.exe' : 'cli')
}

/**
 * @param {Object} options
 * @param {string} options.projectDir
 * @param {string} [options.deviceId]
 * @param {'standard' | 'custom'} [options.playground]
 * @param {'local' | 'device'} [options.customType]
 * @param {string} [options.packageName]
 * @param {boolean} [options.ui]
 * @returns {string[]}
 */
export function buildLaunchArgs(options) {
  const args = ['launch', 'app-android', '--project', options.projectDir]
  if (options.deviceId) {
    args.push('--deviceId', options.deviceId)
  }
  if (options.playground === 'custom') {
    args.push('--playground', 'custom', '--customType', options.customType ?? 'local')
    if (options.packageName) {
      args.push('--packageName', options.packageName)
    }
  }
  if (options.ui) {
    args.push('--ui', 'true')
  }
  return args
}

/**
 * `cli ver` 能返回版本才认为主程序在运行；未运行时尝试 `cli open` 并等待。
 * @param {Object} options
 * @param {string} options.cli
 * @param {import('./logger.js').Logger} options.logger
 * @param {Record<string, string | undefined>} [options.env]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<CliVersion>}
 */
export async function ensureHbuilderxRunning(options) {
  const probe = async () => {
    const { stdout, stderr } = await run(options.cli, ['ver'], { allowFailure: true, env: options.env })
    return parseHbuilderxCliVersion(`${stdout}${stderr}`)
  }

  let version = await probe()
  if (!version) {
    options.logger.info('HBuilderX 未运行，执行 cli open 启动（首次可能需要几十秒）…')
    await run(options.cli, ['open'], { allowFailure: true, env: options.env })
    const deadline = Date.now() + (options.timeoutMs ?? 90000)
    while (Date.now() < deadline) {
      await sleep(2000)
      version = await probe()
      if (version) {
        break
      }
    }
  }

  if (!version) {
    throw new PackError('无法连接 HBuilderX CLI', EXIT.DEVICE, {
      hint: [
        '确认 HBuilderX 5.0+ 已安装并能正常启动（uni-pack init 里的 hbuilderx.root）',
        '手动打开 HBuilderX 后重试，或执行 cli open',
        '不要以管理员身份运行 HBuilderX：普通权限的 cli 无法连接高权限进程（命名管道 EPERM）',
      ].join('\n'),
    })
  }
  if (!supportsLaunch(version)) {
    throw new PackError(`HBuilderX ${version.raw} 版本过低，launch 需要 5.0+`, EXIT.DEVICE, {
      hint: '升级 HBuilderX 后重试',
    })
  }
  return version
}

/**
 * 前台运行 `cli launch`，继承终端输出（HBuilderX 会把项目 console 日志打到终端）。
 * @param {Object} options
 * @param {string} options.cli
 * @param {string[]} options.args
 * @param {Record<string, string | undefined>} [options.env]
 * @returns {Promise<number>}
 */
export function runLaunch(options) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.cli, options.args, {
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, ...options.env },
    })
    const stop = () => {
      child.kill()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    child.on('error', (error) => {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      reject(error)
    })
    child.on('close', (code) => {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      resolve(code ?? 1)
    })
  })
}

/**
 * @param {number} milliseconds
 */
function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
