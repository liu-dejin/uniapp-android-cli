import path from 'node:path'
import { PackError, EXIT } from '../errors.js'
import { copyTree, ensureDir, exists, readText, writeText } from '../fsx.js'

/**
 * @typedef {Object} AssetsContext
 * @property {string} moduleDir        simpleDemo 目录
 * @property {string} dataDir          SDK assets/data
 * @property {string} resourcesDir     构建产物 dist/build/app 或 unpackage/dist/build/app-plus
 * @property {string} appid
 * @property {string} appName
 * @property {string} versionName
 * @property {boolean} debug
 * @property {string} projectDir
 * @property {any} [manifest]          项目 manifest，用于读取图标与启动图路径
 * @property {import('../logger.js').Logger} [logger]
 */

/**
 * @param {AssetsContext} context
 */
export async function applyAssets(context) {
  const mainDir = path.join(context.moduleDir, 'src/main')
  const appsDir = path.join(mainDir, 'assets/apps')
  const assetsData = path.join(mainDir, 'assets/data')

  await copyTree(context.dataDir, assetsData)

  const wwwDir = path.join(appsDir, context.appid, 'www')
  // UTS 插件的 utssdk 是编译期资源，HBuilderX 的产物不会打进 www
  await copyTree(context.resourcesDir, wwwDir, (relative) => /^uni_modules\/[^/]+\/utssdk(\/|$)/.test(relative))
  await writeControlFile(assetsData, context)
  await patchStrings(mainDir, context.appName)
  await applyIcons(mainDir, context.projectDir, context.manifest, context.logger)
}

/**
 * @param {string} assetsData
 * @param {AssetsContext} context
 */
async function writeControlFile(assetsData, context) {
  const root = context.debug ? '<hbuilder debug="true">' : '<hbuilder>'
  const xml = `${root}\n<apps>\n    <app appid="${context.appid}" appver="${context.versionName}"/>\n</apps>\n</hbuilder>\n`
  await writeText(path.join(assetsData, 'dcloud_control.xml'), xml)
}

/**
 * @param {string} mainDir
 * @param {string} appName
 */
async function patchStrings(mainDir, appName) {
  const file = path.join(mainDir, 'res/values/strings.xml')
  const text = await readText(file)
  if (!text.includes('name="app_name"')) {
    throw new PackError('模板 strings.xml 缺少 app_name', EXIT.PREFLIGHT)
  }
  await writeText(file, text.replace(/(name="app_name">)[^<]*(<)/, `$1${escapeXml(appName)}$2`))
}

const ICON_DENSITIES = ['hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']
const CLIENT_ICON_FILES = { hdpi: '72x72.png', xhdpi: '96x96.png', xxhdpi: '144x144.png', xxxhdpi: '192x192.png' }

/**
 * 图标与启动图优先用 manifest 声明的路径（CLI 与 HBuilderX 都适用），
 * 其次回退到两种项目各自的默认目录。只配置部分密度时，用已有最高密度补齐；
 * 完全没配置时保留 SDK 模板资源，并提示使用默认图。
 * @param {string} mainDir
 * @param {string} projectDir
 * @param {any} [manifest]
 * @param {import('../logger.js').Logger} [logger]
 */
async function applyIcons(mainDir, projectDir, manifest, logger) {
  const distribute = manifest?.['app-plus']?.distribute ?? {}
  const manifestIcons = distribute.icons?.android ?? {}
  const manifestSplash = distribute.splashscreen?.android ?? {}

  const icons = await resolveDensitySources(projectDir, manifestIcons, (density) => [
    path.join(projectDir, 'src/static/app/icons', CLIENT_ICON_FILES[density]),
    path.join(projectDir, 'unpackage/res/icons', CLIENT_ICON_FILES[density]),
  ])
  const splash = await resolveDensitySources(projectDir, manifestSplash, (density) => [
    path.join(projectDir, 'src/static/app/splash', `splash-${density}.png`),
    path.join(projectDir, 'unpackage/res/splash/splash.png'),
    path.join(projectDir, 'unpackage/res/splash', `splash-${density}.png`),
  ])

  const bestIcon = bestSource(icons)
  const bestSplash = bestSource(splash)

  for (const density of ICON_DENSITIES) {
    const icon = icons[density] || bestIcon
    if (icon) {
      await copyFile(icon, path.join(mainDir, `res/drawable-${density}/icon.png`))
    }

    const splashSource = splash[density] || bestSplash
    if (splashSource) {
      await copyFile(splashSource, path.join(mainDir, `res/drawable-${density}/splash.png`))
    }
  }

  if (bestIcon) {
    await copyFile(bestIcon, path.join(mainDir, 'res/drawable/icon.png'))
  } else {
    logger?.warn('未配置应用图标（app-plus.distribute.icons.android），使用 SDK 默认图标（DCloud），发布前请替换')
  }
  if (bestSplash) {
    await copyFile(bestSplash, path.join(mainDir, 'res/drawable/splash.png'))
  } else {
    logger?.warn('未配置启动图（app-plus.distribute.splashscreen.android），使用 SDK 默认启动图，发布前请替换')
  }
}

/**
 * @param {string} projectDir
 * @param {Record<string, any>} declared
 * @param {(density: string) => string[]} defaults
 * @returns {Promise<Record<string, string>>}
 */
async function resolveDensitySources(projectDir, declared, defaults) {
  /** @type {Record<string, string>} */
  const sources = {}
  for (const density of ICON_DENSITIES) {
    const source = await firstExisting([resolveMaybeRelative(projectDir, declared[density]), ...defaults(density)])
    if (source) {
      sources[density] = source
    }
  }
  return sources
}

/**
 * @param {Record<string, string>} sources
 * @returns {string}
 */
function bestSource(sources) {
  for (const density of [...ICON_DENSITIES].reverse()) {
    if (sources[density]) {
      return sources[density]
    }
  }
  return ''
}

/**
 * @param {string} projectDir
 * @param {unknown} value
 * @returns {string}
 */
function resolveMaybeRelative(projectDir, value) {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }
  return path.isAbsolute(value) ? value : path.join(projectDir, value)
}

/**
 * @param {string[]} candidates
 * @returns {Promise<string>}
 */
async function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && (await exists(candidate))) {
      return candidate
    }
  }
  return ''
}

/**
 * @param {string} from
 * @param {string} to
 */
async function copyFile(from, to) {
  await ensureDir(path.dirname(to))
  const { copyFile: copy } = await import('node:fs/promises')
  await copy(from, to)
}

/**
 * @param {string} value
 */
function escapeXml(value) {
  return value.replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char] ?? char)
}
