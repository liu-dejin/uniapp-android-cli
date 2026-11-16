import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { exists, readJson, readJsonc, readText } from './fsx.js'

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
 * @typedef {Object} ProjectLayout
 * @property {'cli' | 'hbuilderx' | 'unknown'} type
 * @property {string} inputDir       uni-app 源码目录（CLI 为 src，HBuilderX 为项目根）
 * @property {string} manifestFile   manifest.json 路径
 */

/**
 * 两种项目的结构差异：
 * - CLI（vite starter）：src/manifest.json，产物 dist/build/app
 * - HBuilderX：根目录 manifest.json（JSONC），产物 unpackage/dist/build/app-plus
 * @param {string} projectDir
 * @returns {Promise<ProjectLayout>}
 */
export async function detectProject(projectDir) {
  const srcManifest = path.join(projectDir, 'src/manifest.json')
  if (await exists(srcManifest)) {
    return { type: 'cli', inputDir: path.join(projectDir, 'src'), manifestFile: srcManifest }
  }
  const rootManifest = path.join(projectDir, 'manifest.json')
  if (await exists(rootManifest)) {
    return { type: 'hbuilderx', inputDir: projectDir, manifestFile: rootManifest }
  }
  return { type: 'unknown', inputDir: projectDir, manifestFile: '' }
}

/**
 * @param {string} projectDir
 * @returns {Promise<boolean>}
 */
export async function isUniappProject(projectDir) {
  return (await detectProject(projectDir)).type !== 'unknown'
}

/**
 * 读取项目 manifest：优先生成后的 src/manifest.json，其次已构建产物，最后项目根目录。
 * HBuilderX 的 manifest.json 含注释与末尾逗号，走 JSONC 解析。
 * @param {string} projectDir
 * @returns {Promise<{ manifest: any, file: string, type: ProjectLayout['type'], inputDir: string }>}
 */
export async function readProjectManifest(projectDir) {
  const layout = await detectProject(projectDir)
  if (layout.type !== 'unknown') {
    return {
      manifest: await readJsonc(layout.manifestFile),
      file: layout.manifestFile,
      type: layout.type,
      inputDir: layout.inputDir,
    }
  }

  const candidates = [
    { file: path.join(projectDir, 'dist/build/app/manifest.json'), type: 'cli', inputDir: path.join(projectDir, 'src') },
    {
      file: path.join(projectDir, 'unpackage/dist/build/app-plus/manifest.json'),
      type: 'hbuilderx',
      inputDir: projectDir,
    },
    { file: path.join(projectDir, 'unpackage/dist/build/app/manifest.json'), type: 'hbuilderx', inputDir: projectDir },
  ]
  for (const candidate of candidates) {
    if (await exists(candidate.file)) {
      return {
        manifest: await readJson(candidate.file),
        file: candidate.file,
        type: /** @type {ProjectLayout['type']} */ (candidate.type),
        inputDir: candidate.inputDir,
      }
    }
  }

  throw new PackError(`找不到 manifest.json：${projectDir}`, EXIT.CONFIG, {
    hint: '确认目录是 uni-app 项目（CLI 项目有 src/manifest.json，HBuilderX 项目根目录有 manifest.json）',
  })
}

/**
 * HBuilderX 项目常常不在 manifest.json 里写包名（云打包时单独填），
 * 项目根的 AndroidManifest.xml 是最后可用的兜底来源。
 * HBuilderX 实际打包会把包名转小写，AppKey 又按包名绑定，这里保持一致。
 * @param {string} projectDir
 * @returns {Promise<string>}
 */
export async function readProjectPackage(projectDir) {
  const file = path.join(projectDir, 'AndroidManifest.xml')
  if (!(await exists(file))) {
    return ''
  }
  const value = /package="([^"]+)"/.exec(await readText(file))?.[1] ?? ''
  return value.toLowerCase()
}

/**
 * HBuilderX 的 Vue 3 项目会在 manifest 里写 "vueVersion": "3"；没有该字段按 Vue 2 处理。
 * @param {any} manifest
 * @returns {2 | 3}
 */
export function readVueVersion(manifest) {
  return String(manifest?.vueVersion ?? '').trim() === '3' ? 3 : 2
}

/**
 * CLI 项目通常不在 manifest 写 vueVersion，改从 package.json 的 vue / @dcloudio 版本推断。
 * @param {string} projectDir
 * @param {any} manifest
 * @param {'cli' | 'hbuilderx' | 'unknown'} type
 * @returns {Promise<2 | 3>}
 */
export async function detectVueVersion(projectDir, manifest, type = 'cli') {
  const declared = String(manifest?.vueVersion ?? '').trim()
  if (declared === '2' || declared === '3') {
    return declared === '3' ? 3 : 2
  }
  if (type === 'hbuilderx') {
    return 2
  }

  const packageFile = path.join(projectDir, 'package.json')
  if (await exists(packageFile)) {
    const pkg = await readJson(packageFile).catch(() => ({}))
    const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    const candidates = [dependencies.vue, dependencies['@dcloudio/uni-app']].map((value) => String(value ?? ''))
    if (candidates.some((value) => /^2\./.test(value))) {
      return 2
    }
    if (candidates.some((value) => /^3\./.test(value))) {
      return 3
    }
  }
  return 3
}

/**
 * @param {...any} values
 */
function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return undefined
}

/**
 * manifest 是唯一来源，fallbacks 只在该字段缺失时兜底。
 * 配置里的同名字段可能是 init 时的快照，直接覆盖会让改过 manifest 的项目静默打旧版本。
 * @param {any} manifest
 * @param {any} [fallbacks]
 * @param {{ validate?: boolean }} [options]
 * @returns {ProjectManifest}
 */
export function normalizeManifest(manifest, fallbacks = {}, options = {}) {
  const distribute = manifest?.['app-plus']?.distribute ?? {}
  const android = distribute.android ?? {}
  const manifestAbi = Array.isArray(android.abiFilters) && android.abiFilters.length > 0 ? android.abiFilters : undefined

  const permissions = extractPermissionNames(android.permissions ?? [])
  const features = extractFeatureNames(android.permissions ?? [])

  const result = {
    appid: String(firstPresent(manifest?.appid, fallbacks.appid) ?? ''),
    name: String(firstPresent(manifest?.name, fallbacks.name) ?? ''),
    versionName: String(firstPresent(manifest?.versionName, fallbacks.versionName) ?? '1.0.0'),
    versionCode: Number(firstPresent(manifest?.versionCode, manifest?.version?.code, fallbacks.versionCode) ?? 1),
    packageName: String(firstPresent(android.packagename, fallbacks.package) ?? ''),
    abiFilters: firstPresent(manifestAbi, fallbacks.abiFilters, ['armeabi-v7a', 'arm64-v8a']),
    minSdkVersion: Number(firstPresent(android.minSdkVersion, fallbacks.minSdkVersion, 21)),
    targetSdkVersion: Number(firstPresent(android.targetSdkVersion, fallbacks.targetSdkVersion, 30)),
    permissions,
    features,
    modules: Object.keys(manifest?.['app-plus']?.modules ?? {}),
  }

  if (options.validate !== false) {
    validateManifest(result)
  }
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
    throw new PackError(`包名不合法：${manifest.packageName || '(空)'}`, EXIT.CONFIG, {
      hint: '在 manifest.json 的 app-plus.distribute.android.packagename 填写，或 init 时用 --package 指定',
    })
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
