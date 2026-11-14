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
  await copyTree(context.resourcesDir, wwwDir)
  await writeControlFile(assetsData, context)
  await patchStrings(mainDir, context.appName)
  await applyIcons(mainDir, context.projectDir, context.manifest)
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
 * 其次回退到两种项目各自的默认目录。
 * @param {string} mainDir
 * @param {string} projectDir
 * @param {any} [manifest]
 */
async function applyIcons(mainDir, projectDir, manifest) {
  const distribute = manifest?.['app-plus']?.distribute ?? {}
  const manifestIcons = distribute.icons?.android ?? {}
  const manifestSplash = distribute.splashscreen?.android ?? {}

  for (const density of ICON_DENSITIES) {
    const source = await firstExisting([
      resolveMaybeRelative(projectDir, manifestIcons[density]),
      path.join(projectDir, 'src/static/app/icons', CLIENT_ICON_FILES[density]),
      path.join(projectDir, 'unpackage/res/icons', CLIENT_ICON_FILES[density]),
    ])
    if (source) {
      await copyFile(source, path.join(mainDir, `res/drawable-${density}/icon.png`))
    }

    const splash = await firstExisting([
      resolveMaybeRelative(projectDir, manifestSplash[density]),
      path.join(projectDir, 'src/static/app/splash', `splash-${density}.png`),
      path.join(projectDir, 'unpackage/res/splash/splash.png'),
      path.join(projectDir, 'unpackage/res/splash', `splash-${density}.png`),
    ])
    if (splash) {
      await copyFile(splash, path.join(mainDir, `res/drawable-${density}/splash.png`))
    }
  }

  const fallbackIcon = await firstExisting([
    resolveMaybeRelative(projectDir, manifestIcons.xxxhdpi),
    path.join(projectDir, 'src/static/app/icons/192x192.png'),
    path.join(projectDir, 'unpackage/res/icons/192x192.png'),
  ])
  if (fallbackIcon) {
    await copyFile(fallbackIcon, path.join(mainDir, 'res/drawable/icon.png'))
  }

  const fallbackSplash = await firstExisting([
    resolveMaybeRelative(projectDir, manifestSplash.xxhdpi),
    path.join(projectDir, 'src/static/app/splash/splash-xxhdpi.png'),
    path.join(projectDir, 'unpackage/res/splash/splash.png'),
  ])
  if (fallbackSplash) {
    await copyFile(fallbackSplash, path.join(mainDir, 'res/drawable/splash.png'))
  }
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
