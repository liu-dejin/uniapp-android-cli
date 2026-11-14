import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { exists, readJson } from './fsx.js'

/**
 * @typedef {Object} ProjectManifest
 * @property {string} appid
 * @property {string} name
 * @property {string} versionName
 * @property {number} versionCode
 * @property {string} packageName
 * @property {string[]} abiFilters
 * @property {number} minSdkVersion
 * @property {number} targetSdkVersion
 * @property {string[]} permissions
 * @property {string[]} features
 * @property {string[]} modules
 */

/**
 * 读取项目 manifest：优先生成后的 src/manifest.json，其次已构建产物，最后项目根目录。
 * @param {string} projectDir
 * @returns {Promise<{ manifest: any, file: string }>}
 */
export async function readProjectManifest(projectDir) {
  const candidates = [
    path.join(projectDir, 'src/manifest.json'),
    path.join(projectDir, 'dist/build/app/manifest.json'),
    path.join(projectDir, 'manifest.json'),
  ]
  for (const file of candidates) {
    if (await exists(file)) {
      return { manifest: await readJson(file), file }
    }
  }
  throw new PackError(`找不到 manifest.json：${projectDir}（先执行一次前端构建生成 src/manifest.json）`, EXIT.CONFIG)
}

/**
 * @param {any} manifest
 * @param {any} [overrides]
 * @returns {ProjectManifest}
 */
export function normalizeManifest(manifest, overrides = {}) {
  const distribute = manifest?.['app-plus']?.distribute ?? {}
  const android = distribute.android ?? {}
  const versionCodeRaw = manifest?.versionCode ?? manifest?.version?.code ?? 1

  const permissions = extractPermissionNames(android.permissions ?? [])
  const features = extractFeatureNames(android.permissions ?? [])

  const result = {
    appid: String(overrides.appid ?? manifest?.appid ?? ''),
    name: String(overrides.name ?? manifest?.name ?? ''),
    versionName: String(overrides.versionName ?? manifest?.versionName ?? '1.0.0'),
    versionCode: Number(overrides.versionCode ?? versionCodeRaw),
    packageName: String(overrides.package ?? android.packagename ?? ''),
    abiFilters: overrides.abiFilters ?? android.abiFilters ?? ['armeabi-v7a', 'arm64-v8a'],
    minSdkVersion: Number(overrides.minSdkVersion ?? android.minSdkVersion ?? 21),
    targetSdkVersion: Number(overrides.targetSdkVersion ?? android.targetSdkVersion ?? 30),
    permissions,
    features,
    modules: Object.keys(manifest?.['app-plus']?.modules ?? {}),
  }

  validateManifest(result)
  return result
}

/**
 * @param {ProjectManifest} manifest
 */
function validateManifest(manifest) {
  if (!/^__UNI__[0-9A-F]+$/i.test(manifest.appid)) {
    throw new PackError(`appid 不合法：${manifest.appid || '(空)'}，应为 __UNI__XXXXXX`, EXIT.CONFIG)
  }
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(manifest.packageName)) {
    throw new PackError(`包名不合法：${manifest.packageName || '(空)'}`, EXIT.CONFIG)
  }
  if (!Number.isInteger(manifest.versionCode) || manifest.versionCode <= 0) {
    throw new PackError(`versionCode 不合法：${manifest.versionCode}`, EXIT.CONFIG)
  }
  if (!manifest.versionName) {
    throw new PackError('versionName 为空', EXIT.CONFIG)
  }
}

/**
 * @param {string[]} entries
 * @returns {string[]}
 */
export function extractPermissionNames(entries) {
  /** @type {string[]} */
  const names = []
  for (const entry of entries) {
    const match = /<uses-permission[^>]*android:name="([^"]+)"/.exec(entry)
    if (match) {
      names.push(match[1])
    }
  }
  return names
}

/**
 * @param {string[]} entries
 * @returns {string[]} 形如 "android.hardware.touchscreen|false"
 */
export function extractFeatureNames(entries) {
  /** @type {string[]} */
  const features = []
  for (const entry of entries) {
    const match = /<uses-feature[^>]*android:name="([^"]+)"[^>]*android:required="(true|false)"/.exec(entry)
    if (match) {
      features.push(`${match[1]}|${match[2]}`)
    }
  }
  return features
}
