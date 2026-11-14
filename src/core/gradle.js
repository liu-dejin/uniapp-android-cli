import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { ensureDir, writeText } from './fsx.js'
import { run } from './process.js'

/**
 * @param {Object} options
 * @param {string} options.gradlew
 * @param {string} options.cwd
 * @param {'assembleRelease' | 'assembleDebug'} options.task
 * @param {string} options.javaHome
 * @param {string} options.androidSdkDir
 * @param {boolean} [options.offline]
 * @param {import('./logger.js').Logger} options.logger
 */
export async function runGradle(options) {
  const args = [`:simpleDemo:${options.task}`, '--no-daemon', '--console=plain']
  if (options.offline) {
    args.push('--offline')
  }

  const logLines = []
  const logFile = path.join(options.cwd, '..', 'logs', `gradle-${Date.now()}.log`)

  try {
    await run(options.gradlew, args, {
      cwd: options.cwd,
      env: {
        JAVA_HOME: options.javaHome,
        ANDROID_HOME: options.androidSdkDir,
        ANDROID_SDK_ROOT: options.androidSdkDir,
      },
      onLine: (line) => {
        logLines.push(line)
        options.logger.detail(line)
      },
    })
  } catch (error) {
    const output = logLines.join('\n')
    await ensureDir(path.dirname(logFile))
    await writeText(logFile, output)
    throw new PackError('Gradle 构建失败', EXIT.GRADLE, {
      hint: `${diagnose(output)}\n完整日志：${logFile}`,
      cause: error,
    })
  }

  await ensureDir(path.dirname(logFile))
  await writeText(logFile, logLines.join('\n'))
  options.logger.success(`Gradle ${options.task} 完成`)
  return logFile
}

/**
 * @param {string} output
 */
function diagnose(output) {
  if (/Could not resolve|Could not download|Could not GET/i.test(output)) {
    return '依赖下载失败：检查网络，或先联网成功构建一次再使用 --offline'
  }
  if (/Manifest merger failed/i.test(output)) {
    return 'AndroidManifest 合并失败：检查包名、权限与模板内容是否冲突'
  }
  if (/Duplicate class/i.test(output)) {
    return 'AAR 重复：检查 libs 目录是否有多余的重复依赖'
  }
  if (/SDK location not found|sdk\.dir/i.test(output)) {
    return 'Android SDK 路径不正确：检查配置里的 android.sdkDir 与 local.properties'
  }
  if (/Unsupported class file major version|Unsupported Java/i.test(output)) {
    return 'JDK 版本不匹配：确认 JAVA_HOME 指向 JDK 17+'
  }
  const failure = output.split('\n').filter((line) => /FAILURE|What went wrong|Caused by|error:/i.test(line)).slice(0, 6)
  return failure.length > 0 ? failure.join('\n') : '查看完整 Gradle 日志定位问题'
}
