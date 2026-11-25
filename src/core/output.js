import { appendFile, copyFile, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { ensureDir, replaceHardLink, writeJson } from './fsx.js'
import { fileHash } from './hash.js'

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
 * @typedef {Object} PublishApkOptions
 * @property {string} apk                     Gradle 产出的 APK
 * @property {string} outputDir               项目 apk 目录
 * @property {string} baseName                <展示名>_<版本>_<版本号>
 * @property {'release' | 'debug'} mode
 * @property {string} workDir                 构建工作目录，用于写 .uni-pack-build.json
 * @property {Record<string, unknown>} [record]
 * @property {import('./logger.js').Logger} [logger]
 * @property {number} [prune]                 只保留最近 n 个时间戳包（0 表示只留 latest）
 */

/**
 * 发布 APK：时间戳副本 + latest 硬链 + 同名清单 + builds.jsonl + 可选清理。
 * @param {PublishApkOptions} options
 */
export async function publishApk(options) {
  await ensureDir(options.outputDir)
  const stamp = timestamp()
  const fileName = `${options.baseName}_${options.mode}_${stamp}.apk`
  const target = path.join(options.outputDir, fileName)
  const latest = path.join(options.outputDir, `${options.baseName}_${options.mode}_latest.apk`)

  await copyFile(options.apk, target)

  let latestLinked = true
  try {
    await replaceHardLink(target, latest)
  } catch (error) {
    latestLinked = false
    const detail = error instanceof Error ? error.message : String(error)
    options.logger?.warn(`latest 硬链失败（${detail}），已回退为复制`)
    await copyFile(target, latest)
  }

  const size = (await stat(target)).size
  const sha256 = await fileHash(target)
  const builtAt = new Date().toISOString()
  const record = {
    ...(options.record ?? {}),
    mode: options.mode,
    apk: target,
    latest,
    sha256,
    size,
    builtAt,
  }

  const recordFile = `${target}.json`
  await writeJson(recordFile, record)
  await appendFile(path.join(options.outputDir, 'builds.jsonl'), `${JSON.stringify(record)}\n`, 'utf8')
  await writeJson(path.join(options.workDir, '.uni-pack-build.json'), record)

  if (options.prune !== undefined) {
    await pruneApks({ outputDir: options.outputDir, mode: options.mode, keep: options.prune, logger: options.logger })
  }

  return { target, latest, sha256, size, recordFile, latestLinked }
}

/**
 * 按时间保留最近 n 个时间戳包（同目录、同一 mode），latest 与 builds.jsonl 不动。
 * @param {Object} options
 * @param {string} options.outputDir
 * @param {'release' | 'debug'} [options.mode] 只清理该 mode；不传时两种都清
 * @param {number} options.keep
 * @param {import('./logger.js').Logger} [options.logger]
 * @returns {Promise<string[]>} 删除的文件名
 */
export async function pruneApks(options) {
  const keep = Number(options.keep)
  if (!Number.isInteger(keep) || keep < 0) {
    throw new PackError(`--prune 需要一个非负整数，收到：${String(options.keep)}`, EXIT.CONFIG, {
      hint: '例如 --prune 5 表示每个 mode 只保留最近 5 个时间戳 APK，latest 永远保留',
    })
  }

  const entries = await readdir(options.outputDir, { withFileTypes: true }).catch(() => [])
  const modePattern = options.mode ? escapeRegExp(options.mode) : 'release|debug'
  const pattern = new RegExp(`^(.+)_(${modePattern})_(\\d{8}_\\d{4})\\.apk$`)
  /** @type {Map<'release' | 'debug', Array<{ name: string, stamp: string }>>} */
  const groups = new Map()
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const match = pattern.exec(entry.name)
    if (!match) {
      continue
    }
    const mode = /** @type {'release' | 'debug'} */ (match[2])
    const list = groups.get(mode) ?? []
    list.push({ name: entry.name, stamp: match[3] })
    groups.set(mode, list)
  }

  const deleted = []
  for (const list of groups.values()) {
    list.sort((left, right) => right.stamp.localeCompare(left.stamp))
    for (const item of list.slice(keep)) {
      const apk = path.join(options.outputDir, item.name)
      await rm(apk, { force: true })
      await rm(`${apk}.json`, { force: true })
      deleted.push(item.name)
    }
  }

  if (deleted.length > 0) {
    options.logger?.info(`已清理 ${deleted.length} 个旧 APK（保留最近 ${keep} 个时间戳包）`)
  }
  return deleted
}

/**
 * @param {string} value
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
