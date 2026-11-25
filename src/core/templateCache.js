import { createHash } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { exists, readJson, writeJson } from './fsx.js'

export const TEMPLATE_STATE_FILE = '.uni-pack-template.json'

const FINGERPRINT_FILES = [
  'build.gradle',
  'settings.gradle',
  'gradle/wrapper/gradle-wrapper.properties',
  'simpleDemo/build.gradle',
  'simpleDemo/src/main/AndroidManifest.xml',
]

/**
 * SDK 换版本、模板被手工改过（mtime/大小变化）时都要重新复制模板。
 * @param {{ root: string, templateRoot: string, version?: string | null }} sdk
 * @returns {Promise<{ fingerprint: string, files: Array<{ file: string, size: number, mtimeMs: number }> }>}
 */
export async function templateFingerprint(sdk) {
  /** @type {Array<{ file: string, size: number, mtimeMs: number }>} */
  const files = []
  for (const relative of FINGERPRINT_FILES) {
    const file = path.join(sdk.templateRoot, relative)
    try {
      const info = await stat(file)
      files.push({ file: relative, size: info.size, mtimeMs: Math.round(info.mtimeMs) })
    } catch {
      files.push({ file: relative, size: -1, mtimeMs: -1 })
    }
  }
  const payload = JSON.stringify({
    root: sdk.root,
    templateRoot: sdk.templateRoot,
    version: String(sdk.version ?? ''),
    files,
  })
  return { fingerprint: createHash('sha256').update(payload).digest('hex'), files }
}

/**
 * @param {string} gradleRoot
 * @returns {Promise<{ fingerprint?: string, templateRoot?: string, version?: string, builtAt?: string } | null>}
 */
export async function readTemplateState(gradleRoot) {
  return readJson(path.join(gradleRoot, TEMPLATE_STATE_FILE)).catch(() => null)
}

/**
 * @param {string} gradleRoot
 * @param {Record<string, unknown>} state
 */
export async function writeTemplateState(gradleRoot, state) {
  await writeJson(path.join(gradleRoot, TEMPLATE_STATE_FILE), state)
}

/**
 * 增量构建前清掉会残留的输入：当前 appid 的 www、SDK 模板 assets 数据、上次的 AAR/so。
 * build/、.gradle/、simpleDemo/build/ 保留，Gradle 才能命中 UP-TO-DATE。
 * @param {{ gradleRoot: string, appid: string }} options
 * @returns {Promise<string[]>} 已清理的路径
 */
export async function cleanIncrementalInputs(options) {
  const relative = [
    path.join('simpleDemo', 'src', 'main', 'assets', 'apps', options.appid),
    path.join('simpleDemo', 'src', 'main', 'assets', 'data'),
    path.join('simpleDemo', 'src', 'main', 'assets', 'dcloud_uniplugins.json'),
    path.join('simpleDemo', 'libs'),
    path.join('simpleDemo', 'src', 'main', 'jniLibs'),
  ]
  const removed = []
  for (const item of relative) {
    const target = path.join(options.gradleRoot, item)
    if (await exists(target)) {
      await rm(target, { recursive: true, force: true })
      removed.push(item)
    }
  }
  return removed
}
