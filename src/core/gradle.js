import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { ensureDir } from './fsx.js'
import { GradleLogAggregator, formatFailureHint } from './gradleLog.js'
import { run } from './process.js'

/**
 * @typedef {Object} RunGradleOptions
 * @property {string} gradlew
 * @property {string} cwd
 * @property {'assembleRelease' | 'assembleDebug'} task
 * @property {string} javaHome
 * @property {string} androidSdkDir
 * @property {boolean} [offline]
 * @property {{ storePassword: string, keyPassword: string }} [signing] 只通过环境变量传给 Gradle，不落盘
 * @property {import('./logger.js').Logger} logger
 */

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
 * @param {RunGradleOptions} options
 */
export async function runGradle(options) {
  const args = [`:simpleDemo:${options.task}`, '--no-daemon', '--console=plain']
  if (options.offline) {
    args.push('--offline')
  }

  const logFile = path.join(options.cwd, '..', 'logs', `gradle-${Date.now()}.log`)
  await ensureDir(path.dirname(logFile))

  const verbose = Boolean(options.logger.verbose)
  const lines = []

  const stream = createWriteStream(logFile)
  /** @type {{ error: Error | null }} */
  const logWrite = { error: null }
  stream.on('error', (error) => {
    logWrite.error = error
  })
  const aggregator = verbose ? null : new GradleLogAggregator({ onLine: (line) => stream.write(`${line}\n`) })

  /** @type {unknown} */
  let failure = null
  try {
    await run(options.gradlew, args, {
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

  const writeError = logWrite.error
  if (writeError) {
    options.logger.warn(`Gradle 日志写入失败：${writeError.message}`)
  }
  if (!verbose) {
    printWarningSummary(groups, options.logger)
  }

  if (failure) {
    throw new PackError('Gradle 构建失败', EXIT.GRADLE, {
      hint: formatFailureHint({ lines, logFile }),
      cause: failure,
    })
  }

  options.logger.success(`Gradle ${options.task} 完成`)
  options.logger.info(`完整日志：${logFile}`)
  return logFile
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
