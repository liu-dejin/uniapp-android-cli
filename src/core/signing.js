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
  const keystore = String(signing.keystore ?? '')
  const keyAlias = String(signing.keyAlias ?? '')
  if (!keystore || !(await exists(keystore))) {
    throw new PackError(`找不到签名证书：${keystore || '(未配置)'}`, EXIT.SIGN)
  }
  if (!keyAlias) {
    throw new PackError('未配置签名别名 keyAlias', EXIT.SIGN)
  }

  const properties = await readProperties(signing.keystoreProperties, project.projectDir)

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
