import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * @typedef {{ ok: boolean, value?: string, message?: string }} Validation
 */

const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i
const APPKEY_RE = /^[0-9a-f]{32}$/i

/**
 * 空值表示「跳过」，交给构建期报错；交互时允许先不填。
 * @param {string} value
 * @returns {Validation}
 */
export function validatePackageName(value) {
  if (!value) {
    return { ok: true, value: '' }
  }
  if (!PACKAGE_RE.test(value)) {
    return { ok: false, message: '包名不合法，示例：uni.app.UNIF1A8702' }
  }
  return { ok: true, value }
}

/**
 * @param {string} value
 * @returns {Validation}
 */
export function validateAppKey(value) {
  if (!value) {
    return { ok: true, value: '' }
  }
  if (!APPKEY_RE.test(value)) {
    return { ok: false, message: 'AppKey 应为 32 位十六进制（0-9a-f）' }
  }
  return { ok: true, value: value.toLowerCase() }
}

/**
 * 文件路径允许相对项目目录；不存在则重新询问。
 * @param {string} projectDir
 * @returns {(value: string) => Validation}
 */
export function makeFileValidator(projectDir) {
  return (value) => {
    if (!value) {
      return { ok: true, value: '' }
    }
    const resolved = path.isAbsolute(value) ? value : path.resolve(projectDir, value)
    if (!existsSync(resolved)) {
      return { ok: false, message: `找不到文件：${resolved}` }
    }
    return { ok: true, value: resolved }
  }
}

/**
 * @param {string} value
 * @returns {Validation}
 */
export function validateRequired(value) {
  return value ? { ok: true, value } : { ok: false, message: '不能为空' }
}

/**
 * @param {string} value
 * @returns {Validation}
 */
export function validateConfirm(value) {
  if (!value || /^y(es)?$/i.test(value) || /^n(o)?$/i.test(value)) {
    return { ok: true, value: value.toLowerCase() }
  }
  return { ok: false, message: '输入 Y 或 n' }
}

/**
 * 最终确认必须显式回答：回车不默认同意，避免手快直接写配置。
 * @param {string} value
 * @returns {Validation}
 */
export function validateExplicitConfirm(value) {
  if (/^y(es)?$/i.test(value) || /^n(o)?$/i.test(value)) {
    return { ok: true, value: value.toLowerCase() }
  }
  return { ok: false, message: '请输入 y 或 n（回车不会默认确认）' }
}

/**
 * @param {string} value
 * @returns {Validation}
 */
export function validateCustomType(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'local' || text === 'device') {
    return { ok: true, value: text }
  }
  return { ok: false, message: '输入 local 或 device' }
}

/**
 * @param {string} value
 * @returns {Validation}
 */
export function validatePlayground(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'standard' || text === 'custom') {
    return { ok: true, value: text }
  }
  return { ok: false, message: '输入 standard 或 custom' }
}

/**
 * 项目内路径尽量写成相对路径，方便提交到仓库；项目外保留绝对路径。
 * @param {string} projectDir
 * @param {string} value
 * @returns {string}
 */
export function toProjectRelative(projectDir, value) {
  const text = String(value ?? '').trim()
  if (!text) {
    return ''
  }
  const absolute = path.isAbsolute(text) ? text : path.resolve(projectDir, text)
  const relative = path.relative(projectDir, absolute)
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join('/')
  }
  return absolute
}

const PROJECT_ONLY_USER_FIELDS = ['appKey', 'package', 'signing', 'webBuild', 'outputDir', 'outputPrefix', 'debug']

// 版本/包名等以 manifest 为准，不写进任何配置，避免旧快照覆盖项目改动
const SNAPSHOT_FIELDS = ['name', 'appid', 'versionName', 'versionCode', 'minSdkVersion', 'targetSdkVersion', 'abiFilters']

/**
 * 把 init 的结果拆成「项目级共享配置」与「本机用户配置」：
 * - 项目配置：包名、AppKey、签名路径、输出目录、webBuild，可提交到仓库；
 * - 用户配置：projectDir / type / sdkRoot / hbuilderxRoot 等本机路径；
 * - 密码永远不写入任何配置。
 * @param {Object} input
 * @param {string} input.projectDir
 * @param {'cli' | 'hbuilderx'} input.type
 * @param {string} input.packageName
 * @param {string} input.appKey
 * @param {string} input.outputDir
 * @param {string} [input.outputPrefix]
 * @param {any} [input.webBuild]
 * @param {{ keystore: string, keyAlias: string, keystoreProperties: string,
 *   storePasswordEnv?: string, keyPasswordEnv?: string }} input.signing
 * @param {any} [input.existingProjectConfig]
 * @param {any} [input.existingUserEntry]
 * @param {Record<string, any>} [input.debug]
 * @param {string} input.sdkRoot
 * @param {string} [input.hbuilderxRoot]
 * @returns {{ projectConfig: Record<string, any>, userEntry: Record<string, any> }}
 */
export function splitInitConfig(input) {
  const existingProject = input.existingProjectConfig ?? {}
  const existingUser = input.existingUserEntry ?? {}
  /** @type {Record<string, any>} */
  const projectConfig = { ...existingProject }
  for (const field of ['appid', 'name', 'versionName', 'versionCode', 'minSdkVersion', 'targetSdkVersion', 'abiFilters']) {
    delete projectConfig[field]
  }
  projectConfig.type = input.type
  if (input.packageName) {
    projectConfig.package = input.packageName
  } else {
    delete projectConfig.package
  }
  if (input.appKey) {
    projectConfig.appKey = input.appKey
  } else {
    delete projectConfig.appKey
  }
  projectConfig.outputDir = toProjectRelative(input.projectDir, input.outputDir) || 'apk'
  if (input.outputPrefix) {
    projectConfig.outputPrefix = input.outputPrefix
  }
  if (input.webBuild) {
    projectConfig.webBuild = input.webBuild
  }
  const debug = {
    ...(existingProject.debug ?? existingUser.debug ?? {}),
    ...(input.debug ?? {}),
  }
  if (Object.keys(debug).length > 0) {
    projectConfig.debug = debug
  }
  projectConfig.signing = {
    ...(existingProject.signing ?? existingUser.signing ?? {}),
    keystore: toProjectRelative(input.projectDir, input.signing.keystore),
    keyAlias: String(input.signing.keyAlias ?? ''),
    keystoreProperties: toProjectRelative(input.projectDir, input.signing.keystoreProperties),
    storePasswordEnv: input.signing.storePasswordEnv || 'UNI_PACK_STORE_PASS',
    keyPasswordEnv: input.signing.keyPasswordEnv || 'UNI_PACK_KEY_PASS',
  }

  /** @type {Record<string, any>} */
  const userEntry = {
    ...existingUser,
    projectDir: input.projectDir,
    type: input.type,
    sdkRoot: input.sdkRoot,
    hbuilderxRoot: input.hbuilderxRoot ?? existingUser.hbuilderxRoot ?? '',
  }
  for (const field of [...PROJECT_ONLY_USER_FIELDS, ...SNAPSHOT_FIELDS]) {
    delete userEntry[field]
  }

  return { projectConfig, userEntry }
}
