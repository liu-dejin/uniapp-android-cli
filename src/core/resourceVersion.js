import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { readJson } from './fsx.js'

/**
 * 前端产物 manifest 里的版本字段（构建产物里是 version.name / version.code）。
 * @typedef {Object} ResourceVersion
 * @property {string} versionName
 * @property {number} versionCode
 */

/**
 * @param {any} manifest 前端产物的 manifest.json
 * @returns {ResourceVersion}
 */
export function readResourceVersion(manifest) {
  const version = manifest?.version ?? {}
  return {
    versionName: String(version.name ?? ''),
    versionCode: Number(version.code ?? 0),
  }
}

/**
 * 前端产物只是 dist 里的一份静态资源：bump 版本后如果没重新编译（或用了 --skip-web），
 * 会打出「新版本号 + 旧资源」，签名与体积检查都发现不了，只能靠版本一致性闸门。
 * @param {ResourceVersion} resource
 * @param {{ versionName: string, versionCode: number }} expected 项目 manifest 解析出的版本
 * @returns {{ ok: boolean, message: string }}
 */
export function compareResourceVersion(resource, expected) {
  const versionName = String(expected.versionName ?? '')
  const versionCode = Number(expected.versionCode ?? 0)
  const ok = resource.versionName === versionName && resource.versionCode === versionCode
  return {
    ok,
    message: ok
      ? ''
      : `前端产物版本 ${resource.versionName || '(空)'}(${resource.versionCode}) 与项目 manifest 版本 ${versionName}(${versionCode}) 不一致`,
  }
}

/**
 * 版本不一致时给出可执行的修复方向。
 * @param {string} resourcesDir
 * @returns {string}
 */
function mismatchHint(resourcesDir) {
  return [
    '前端资源是旧版本，继续打包会得到「新版本号 + 旧资源」的 APK/wgt。',
    `要么重新构建：pnpm build:app-android（产物写入 ${resourcesDir}）`,
    '要么确认 dist 已是最新后再用 --skip-web；确实要跳过校验加 --skip-resource-check。',
  ].join('\n')
}

/**
 * 读取 <resourcesDir>/manifest.json 并断言版本与项目 manifest 一致。
 * @param {Object} options
 * @param {string} options.resourcesDir
 * @param {{ versionName: string, versionCode: number }} options.expected
 * @param {boolean} [options.skip]
 * @param {import('./logger.js').Logger} options.logger
 * @returns {Promise<ResourceVersion & { skipped: boolean }>}
 */
export async function assertResourceVersion(options) {
  const manifestFile = path.join(options.resourcesDir, 'manifest.json')
  let manifest
  try {
    manifest = await readJson(manifestFile)
  } catch (error) {
    throw new PackError(`无法读取前端产物 manifest：${manifestFile}`, EXIT.WEB_BUILD, {
      hint: '确认前端产物目录完整，或去掉 --skip-web 重新构建',
      cause: error,
    })
  }

  const resource = readResourceVersion(manifest)
  const result = compareResourceVersion(resource, options.expected)
  if (result.ok) {
    return { ...resource, skipped: false }
  }
  if (options.skip) {
    options.logger.warn(`已跳过资源版本校验：${result.message}`)
    return { ...resource, skipped: true }
  }
  throw new PackError(result.message, EXIT.WEB_BUILD, { hint: mismatchHint(options.resourcesDir) })
}
