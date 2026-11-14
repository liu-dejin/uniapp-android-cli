import path from 'node:path'
import { exists, readText, writeText } from '../fsx.js'

/**
 * HBuilderX 项目根的 AndroidManifest.xml 是「原生配置」，云打包时会合并进最终清单。
 * 离线打包至少要把其中的权限与 application 下的 meta-data 带过去（例如 ScopedStorage）。
 * @param {Object} options
 * @param {string} options.targetFile  构建工程的 AndroidManifest.xml
 * @param {string} options.projectDir
 * @param {import('../logger.js').Logger} options.logger
 */
export async function mergeProjectManifest(options) {
  const source = path.join(options.projectDir, 'AndroidManifest.xml')
  if (!(await exists(source))) {
    return { permissions: 0, metaData: 0 }
  }

  const sourceText = await readText(source)
  let target = await readText(options.targetFile)

  const permissions = matchAll(sourceText, /<uses-permission\b[^>]*\/>/g).filter(
    (element) => !target.includes(permissionName(element)),
  )
  const metaData = matchAll(sourceText, /<meta-data\b[\s\S]*?\/>/g).filter(
    (element) => !target.includes(metaDataName(element)),
  )

  if (permissions.length > 0) {
    target = target.replace(/<application\b/, `${permissions.join('\n    ')}\n\n    <application`)
  }
  if (metaData.length > 0) {
    target = target.replace(
      /<\/application>/,
      `${metaData.map((element) => `        ${element.trim()}`).join('\n')}\n    </application>`,
    )
  }

  if (permissions.length > 0 || metaData.length > 0) {
    await writeText(options.targetFile, target)
  }
  options.logger.detail(`合并项目 AndroidManifest：权限 ${permissions.length}，meta-data ${metaData.length}`)
  return { permissions: permissions.length, metaData: metaData.length }
}

/**
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {string[]}
 */
function matchAll(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[0])
}

/**
 * @param {string} element
 */
function permissionName(element) {
  return (/android:name="([^"]+)"/.exec(element)?.[1]) ?? element
}

/**
 * @param {string} element
 */
function metaDataName(element) {
  return (/android:name="([^"]+)"/.exec(element)?.[1]) ?? element
}
