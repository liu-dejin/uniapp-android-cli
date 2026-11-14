import { createHash } from 'node:crypto'
import { copyFile, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { ensureDir, writeJson } from './fsx.js'

/**
 * @param {string} dir
 * @param {'release' | 'debug'} mode
 */
export async function findApk(dir, mode) {
  if (!dir) {
    throw new PackError('未指定 Gradle 输出目录', EXIT.GRADLE)
  }
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const candidates = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.apk'))
  const preferred =
    candidates.find((entry) => entry.name === `simpleDemo-${mode}.apk`) ??
    candidates.find((entry) => entry.name === `app-${mode}.apk`) ??
    candidates.find((entry) => entry.name.includes(mode)) ??
    candidates[0]
  if (!preferred) {
    throw new PackError(`Gradle 未产出 APK：${dir}`, EXIT.GRADLE)
  }
  return path.join(dir, preferred.name)
}

/**
 * @param {Object} options
 * @param {string} options.apk
 * @param {string} options.outputDir
 * @param {string} options.baseName
 * @param {string} options.mode
 * @param {string} options.workDir
 * @param {Record<string, unknown>} [options.record]
 */
export async function publishApk(options) {
  await ensureDir(options.outputDir)
  const stamp = timestamp()
  const fileName = `${options.baseName}_${options.mode}_${stamp}.apk`
  const target = path.join(options.outputDir, fileName)
  const latest = path.join(options.outputDir, `${options.baseName}_${options.mode}_latest.apk`)

  await copyFile(options.apk, target)
  await copyFile(options.apk, latest)

  const sha256 = createHash('sha256').update(await readFile(target)).digest('hex')
  await writeJson(path.join(options.workDir, '.uni-pack-build.json'), {
    ...(options.record ?? {}),
    mode: options.mode,
    apk: target,
    latest,
    sha256,
    builtAt: new Date().toISOString(),
  })

  return { target, latest, sha256 }
}

function timestamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
}

/**
 * @param {string} projectName
 * @param {string} versionName
 * @param {number} versionCode
 */
export function apkBaseName(projectName, versionName, versionCode) {
  const safe = projectName.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app'
  return `${safe}_${versionName}_${versionCode}`
}
