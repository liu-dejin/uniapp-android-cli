import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { exists, readText } from './fsx.js'

/**
 * @typedef {Object} Signing
 * @property {string} keystore
 * @property {string} keyAlias
 * @property {string} storePassword
 * @property {string} keyPassword
 */

/**
 * 密码来源优先级：命令行 → 环境变量 → keystore.properties。
 * @param {any} project
 * @param {{ storePassword?: string, keyPassword?: string }} options
 * @returns {Promise<Signing>}
 */
export async function resolveSigning(project, options = {}) {
  const signing = project.signing ?? {}
  const keystore = resolveProjectPath(project.projectDir, signing.keystore)
  const properties = await readProperties(signing.keystoreProperties, project.projectDir)
  // 别名优先取配置；允许只给 keystore.properties（团队自定义布局时更省配置）
  const keyAlias = String(signing.keyAlias ?? '') || String(properties.keyAlias ?? '')
  if (!keystore || !(await exists(keystore))) {
    throw new PackError(`找不到签名证书：${keystore || '(未配置)'}`, EXIT.SIGN, {
      hint: '检查 signing.keystore；相对路径按项目目录解析，也可以写绝对路径',
    })
  }
  if (!keyAlias) {
    throw new PackError('未配置签名别名 keyAlias', EXIT.SIGN, {
      hint: '在配置 signing.keyAlias 填写，或写进 keystoreProperties 的 keyAlias',
    })
  }

  const storePassword =
    options.storePassword ??
    envValue(signing.storePasswordEnv) ??
    properties.storePassword ??
    ''
  const keyPassword =
    options.keyPassword ??
    envValue(signing.keyPasswordEnv) ??
    properties.keyPassword ??
    storePassword

  if (!storePassword || !keyPassword) {
    throw new PackError('缺少签名密码', EXIT.SIGN, {
      hint: '设置环境变量（如 PRODIS_STORE_PASS / PRODIS_KEY_PASS），或在配置里指定 keystoreProperties',
    })
  }

  return { keystore, keyAlias, storePassword, keyPassword }
}

/**
 * 配置里的相对路径统一相对项目目录解析，避免从别的目录执行时找不到证书。
 * @param {string | undefined} projectDir
 * @param {unknown} value
 * @returns {string}
 */
function resolveProjectPath(projectDir, value) {
  const text = String(value ?? '').trim()
  if (!text) {
    return ''
  }
  return path.isAbsolute(text) ? text : path.join(String(projectDir ?? ''), text)
}

/**
 * @param {string | undefined} name
 */
function envValue(name) {
  if (!name) {
    return undefined
  }
  return process.env[name] || undefined
}

/**
 * @param {string | undefined} file
 * @param {string} projectDir
 */
async function readProperties(file, projectDir) {
  if (!file) {
    return {}
  }
  const absolute = path.isAbsolute(file) ? file : path.join(projectDir, file)
  if (!(await exists(absolute))) {
    return {}
  }
  const text = await readText(absolute)
  /** @type {Record<string, string>} */
  const result = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([\w.]+)\s*=\s*(.*)\s*$/.exec(line)
    if (match) {
      result[match[1]] = match[2]
    }
  }
  return result
}
