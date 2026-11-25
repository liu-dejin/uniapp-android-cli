import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { ensureDir, readJson, writeJson } from './fsx.js'
import { GradleLogAggregator, formatFailureHint } from './gradleLog.js'
import { run } from './process.js'

/** 配置缓存兼容性记录在工作目录根部，不兼容一次后不再重试。 */
export const GRADLE_FLAGS_FILE = 'gradle-flags.json'

/**
 * @typedef {Object} RunGradleOptions
 * @property {string} gradlew
 * @property {string} cwd
 * @property {'assembleRelease' | 'assembleDebug'} task
 * @property {string} javaHome
 * @property {string} androidSdkDir
 * @property {boolean} [offline]
 * @property {boolean} [daemon]          默认 true；CI 可用 --no-daemon 关闭
 * @property {boolean} [buildCache]      默认 true
 * @property {boolean} [configurationCache] 默认自动尝试
 * @property {{ storePassword: string, keyPassword: string }} [signing] 只通过环境变量传给 Gradle，不落盘
 * @property {import('./logger.js').Logger} logger
 */

/**
 * @param {{ task: 'assembleRelease' | 'assembleDebug', offline?: boolean, daemon?: boolean,
 *   buildCache?: boolean, configurationCache?: boolean }} options
 * @returns {string[]}
 */
export function buildGradleArgs(options) {
  const args = [`:simpleDemo:${options.task}`, '--console=plain']
  if (options.daemon === false) {
    args.push('--no-daemon')
  }
  if (options.buildCache !== false) {
    args.push('--build-cache')
  }
  args.push('--parallel')
  if (options.offline) {
    args.push('--offline')
  }
  if (options.configurationCache) {
    args.push('--configuration-cache')
  }
  return args
}

/**
 * Gradle 8 / AGP 版本组合不总支持配置缓存；命中这些文案时回退普通构建。
 * @param {string} output
 * @returns {boolean}
 */
export function isConfigurationCacheFailure(output) {
  if (!output) {
    return false
  }
  return new RegExp(
    [
      'configuration cache problems found',
      'not compatible with the configuration cache',
      'problems were found storing the configuration cache',
      'Configuration cache state could not be cached',
      'Configuration cache entry discarded with',
      'Invocation of Task\\.project',
    ].join('|'),
    'i',
  ).test(output)
}

/**
 * @param {Pick<RunGradleOptions, 'javaHome' | 'androidSdkDir' | 'signing'>} options
 * @returns {Record<string, string>}
 */
export function buildGradleEnv(options) {
  return {
    JAVA_HOME: options.javaHome,
    ANDROID_HOME: options.androidSdkDir,
    ANDROID_SDK_ROOT: options.androidSdkDir,
    ...(options.signing
      ? {
          UNI_PACK_STORE_PASS: options.signing.storePassword,
          UNI_PACK_KEY_PASS: options.signing.keyPassword,
        }
      : {}),
  }
}

/**
 * @typedef {Object} GradleAttempt
 * @property {string[]} lines
 * @property {Array<{ label: string, count: number, sample: string[] }>} groups
 * @property {unknown} failure
 * @property {Error | null} logWriteError
 * @property {string} logFile
 */

/**
 * @param {RunGradleOptions & { args: string[], logFile: string }} options
 * @returns {Promise<GradleAttempt>}
 */
async function executeGradleAttempt(options) {
  const verbose = Boolean(options.logger.verbose)
  const lines = []

  const stream = createWriteStream(options.logFile)
  /** @type {{ error: Error | null }} */
  const logWrite = { error: null }
  stream.on('error', (error) => {
    logWrite.error = error
  })
  const aggregator = verbose ? null : new GradleLogAggregator({ onLine: (line) => stream.write(`${line}\n`) })

  /** @type {unknown} */
  let failure = null
  try {
    await run(options.gradlew, options.args, {
      cwd: options.cwd,
      env: buildGradleEnv(options),
      // 非 verbose 时只写聚合后的日志；verbose 时原样流式落盘
      onChunk: verbose ? (chunk) => stream.write(chunk) : undefined,
      onLine: (line) => {
        lines.push(line)
        if (verbose) {
          options.logger.detail(line)
        } else {
          aggregator?.push(line)
        }
      },
    })
  } catch (error) {
    failure = error
  }

  const groups = aggregator ? aggregator.finish() : []
  await closeStream(stream)
  return { lines, groups, failure, logWriteError: logWrite.error, logFile: options.logFile }
}

/**
 * @param {RunGradleOptions} options
 */
export async function runGradle(options) {
  const workRoot = path.dirname(options.cwd)
  const logDir = path.join(workRoot, 'logs')
  await ensureDir(logDir)

  const flagsFile = path.join(workRoot, GRADLE_FLAGS_FILE)
  const flags = await readJson(flagsFile).catch(() => ({}))
  const tryConfigurationCache = options.configurationCache !== false && flags.configurationCache !== false

  const baseArgs = buildGradleArgs({
    task: options.task,
    offline: options.offline,
    daemon: options.daemon,
    buildCache: options.buildCache,
    configurationCache: false,
  })
  const stamp = Date.now()
  let attempt = await executeGradleAttempt({
    ...options,
    args: tryConfigurationCache ? [...baseArgs, '--configuration-cache'] : baseArgs,
    logFile: path.join(logDir, `gradle-${stamp}.log`),
  })

  if (attempt.failure && tryConfigurationCache && isConfigurationCacheFailure(attempt.lines.join('\n'))) {
    options.logger.warn('Gradle 配置缓存与该工程不兼容，已回退为普通构建（后续构建不再尝试）')
    await writeJson(flagsFile, { ...flags, configurationCache: false })
    attempt = await executeGradleAttempt({
      ...options,
      args: baseArgs,
      logFile: path.join(logDir, `gradle-${stamp}-no-cc.log`),
    })
  }

  if (attempt.logWriteError) {
    options.logger.warn(`Gradle 日志写入失败：${attempt.logWriteError.message}`)
  }
  if (!options.logger.verbose) {
    printWarningSummary(attempt.groups, options.logger)
  }

  if (attempt.failure) {
    throw new PackError('Gradle 构建失败', EXIT.GRADLE, {
      hint: formatFailureHint({ lines: attempt.lines, logFile: attempt.logFile }),
      cause: attempt.failure,
    })
  }

  options.logger.success(`Gradle ${options.task} 完成`)
  options.logger.info(`完整日志：${attempt.logFile}`)
  return attempt.logFile
}

/**
 * @param {Array<{ label: string, count: number, sample: string[] }>} groups
 * @param {import('./logger.js').Logger} logger
 */
function printWarningSummary(groups, logger) {
  if (groups.length === 0) {
    return
  }
  const total = groups.reduce((sum, group) => sum + group.count, 0)
  // 一次 warn 输出整段摘要：warn 走 stderr、info 走 stdout，分开输出会被缓冲打乱顺序
  const lines = [`Gradle 告警：${total} 条同类告警已聚合为 ${groups.length} 类（看原始栈请用 --verbose 重跑）`]
  for (const group of groups) {
    lines.push(`  ${group.label} ×${group.count}`)
    if (group.sample[0]) {
      lines.push(`    样例：${group.sample[0]}`)
    }
  }
  logger.warn(lines.join('\n'))
}

/**
 * @param {import('node:fs').WriteStream} stream
 * @returns {Promise<void>}
 */
function closeStream(stream) {
  return new Promise((resolve) => stream.end(resolve))
}
