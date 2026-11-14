import path from 'node:path'
import { PackError, EXIT } from '../errors.js'
import { copyTree, ensureDir, exists, readText, writeText } from '../fsx.js'

/**
 * @typedef {Object} AssetsContext
 * @property {string} moduleDir        simpleDemo 目录
 * @property {string} dataDir          SDK assets/data
 * @property {string} resourcesDir     构建产物 dist/build/app
 * @property {string} appid
 * @property {string} appName
 * @property {string} versionName
 * @property {boolean} debug
 * @property {string} projectDir
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
  await applyIcons(mainDir, context.projectDir)
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

/**
 * @param {string} mainDir
 * @param {string} projectDir
 */
async function applyIcons(mainDir, projectDir) {
  const iconDir = path.join(projectDir, 'src/static/app/icons')
  const splashDir = path.join(projectDir, 'src/static/app/splash')
  if (!(await exists(iconDir))) {
    return
  }

  const icons = { hdpi: '72x72.png', xhdpi: '96x96.png', xxhdpi: '144x144.png', xxxhdpi: '192x192.png' }
  for (const [density, file] of Object.entries(icons)) {
    const source = path.join(iconDir, file)
    if (await exists(source)) {
      await copyFile(source, path.join(mainDir, `res/drawable-${density}/icon.png`))
    }
  }
  const fallbackIcon = path.join(iconDir, '192x192.png')
  if (await exists(fallbackIcon)) {
    await copyFile(fallbackIcon, path.join(mainDir, 'res/drawable/icon.png'))
  }

  const splashes = { hdpi: 'splash-hdpi.png', xhdpi: 'splash-xhdpi.png', xxhdpi: 'splash-xxhdpi.png' }
  for (const [density, file] of Object.entries(splashes)) {
    const source = path.join(splashDir, file)
    if (await exists(source)) {
      await copyFile(source, path.join(mainDir, `res/drawable-${density}/splash.png`))
    }
  }
  const fallbackSplash = path.join(splashDir, 'splash-xxhdpi.png')
  if (await exists(fallbackSplash)) {
    await copyFile(fallbackSplash, path.join(mainDir, 'res/drawable/splash.png'))
  }
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
