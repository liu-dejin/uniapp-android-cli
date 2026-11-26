import { existsSync } from 'node:fs'
import path from 'node:path'
import { validateConfirm } from './initConfig.js'
import { resolveSdkRootInput } from './sdk.js'

/**
 * @typedef {{ ok: boolean, value?: string, message?: string }} EnvValidation
 */

const EXE = process.platform === 'win32' ? '.exe' : ''

/**
 * 离线 SDK 必须能解析到含 HBuilder-Integrate-AS 的目录（支持解压后多一层同名目录）。
 * @returns {(value: string) => Promise<EnvValidation>}
 */
export function makeSdkRootValidator() {
  return async (value) => {
    if (!value) {
      return { ok: false, message: '离线 SDK 不能为空，请填写解压后的 Android-SDK@x.yy 目录' }
    }
    const root = await resolveSdkRootInput(value)
    if (!root) {
      return { ok: false, message: '该目录下没有 HBuilder-Integrate-AS，检查离线 SDK 路径' }
    }
    return { ok: true, value: root }
  }
}

/**
 * @returns {(value: string) => EnvValidation}
 */
export function makeHbuilderxValidator() {
  return (value) => {
    if (!value) {
      return { ok: true, value: '' }
    }
    const root = path.resolve(value)
    const found = [root, path.join(root, 'HBuilderX')].some((candidate) =>
      existsSync(path.join(candidate, 'plugins', 'about', 'package.json')),
    )
    if (!found) {
      return { ok: false, message: '不是 HBuilderX 安装目录（缺少 plugins/about/package.json）' }
    }
    return { ok: true, value: root }
  }
}

/**
 * @returns {(value: string) => EnvValidation}
 */
export function makeAndroidSdkValidator() {
  return (value) => {
    if (!value) {
      return { ok: true, value: '' }
    }
    const root = path.resolve(value)
    const adb = path.join(root, 'platform-tools', `adb${EXE}`)
    const buildTools = path.join(root, 'build-tools')
    if (!existsSync(adb) || !existsSync(buildTools)) {
      return { ok: false, message: 'Android SDK 下缺少 platform-tools/adb 或 build-tools' }
    }
    return { ok: true, value: root }
  }
}

/**
 * @returns {(value: string) => EnvValidation}
 */
export function makeJdkValidator() {
  return (value) => {
    if (!value) {
      return { ok: true, value: '' }
    }
    const root = path.resolve(value)
    if (!existsSync(path.join(root, 'bin', `java${EXE}`))) {
      return { ok: false, message: 'JDK 目录下缺少 bin/java，确认是 JDK 17+ 根目录' }
    }
    return { ok: true, value: root }
  }
}

/**
 * 机器级路径问答：路径缺失时强制补，已探测到则询问是否修改。
 * @param {Object} options
 * @param {{ ask: (options: any) => Promise<string> }} options.prompt
 * @param {'cli' | 'hbuilderx'} options.type
 * @param {import('./logger.js').Logger} options.logger
 * @param {{ sdkPath: string, hbuilderxPath: string, androidSdkPath: string, jdkPath: string }} options.defaults
 * @returns {Promise<{ sdkPath: string, hbuilderxPath: string, androidSdkPath: string, jdkPath: string }>}
 */
export async function askEnvironmentPaths(options) {
  const { prompt, type, logger } = options
  let sdkPath = options.defaults.sdkPath || ''
  let hbuilderxPath = options.defaults.hbuilderxPath || ''
  let androidSdkPath = options.defaults.androidSdkPath || ''
  let jdkPath = options.defaults.jdkPath || ''

  const missingSdk = !sdkPath
  const missingHbuilderx = type === 'hbuilderx' && !hbuilderxPath
  logger.step('本机环境')
  logger.info(`离线 SDK：${sdkPath || '(未找到)'}`)
  if (type === 'hbuilderx') {
    logger.info(`HBuilderX：${hbuilderxPath || '(未找到)'}`)
  }
  logger.info(`Android SDK：${androidSdkPath || '(未找到)'}`)
  logger.info(`JDK：${jdkPath || '(未找到)'}`)

  let editEnv = missingSdk || missingHbuilderx
  if (!editEnv) {
    const answer = await prompt.ask({ question: '要修改以上本机路径吗？[y/N]', validate: validateConfirm })
    editEnv = /^y/.test(answer)
  }
  if (!editEnv) {
    return { sdkPath, hbuilderxPath, androidSdkPath, jdkPath }
  }

  sdkPath = await prompt.ask({
    question: '离线 SDK 根目录（含 HBuilder-Integrate-AS）',
    defaultValue: sdkPath,
    validate: makeSdkRootValidator(),
  })
  if (type === 'hbuilderx') {
    hbuilderxPath = await prompt.ask({
      question: 'HBuilderX 安装目录（留空跳过）',
      defaultValue: hbuilderxPath,
      validate: makeHbuilderxValidator(),
    })
  }
  androidSdkPath = await prompt.ask({
    question: 'Android SDK 根目录（留空自动探测）',
    defaultValue: androidSdkPath,
    validate: makeAndroidSdkValidator(),
  })
  jdkPath = await prompt.ask({
    question: 'JDK 根目录（留空自动探测）',
    defaultValue: jdkPath,
    validate: makeJdkValidator(),
  })
  return { sdkPath, hbuilderxPath, androidSdkPath, jdkPath }
}
