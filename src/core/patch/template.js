import path from 'node:path'
import { copyFile } from 'node:fs/promises'
import { copyTree, ensureDir, readText, writeText } from '../fsx.js'

const MARKERS = [
  // CORE DEPS 是 SDK 运行时依赖（zip4j、okhttp 等），不是插件注入，必须保留
  /\/\/ ===== SMARTPACK (?!CORE DEPS)[\s\S]*?END =====[^\n]*\n?/g,
  /<!-- ===== SMARTPACK[\s\S]*?END ===== -->\r?\n?/g,
]

const SKIP = new Set([
  '.gradle',
  '.idea',
  'build',
  'local.properties',
  'simpleDemo/build',
  'simpleDemo/libs',
  'simpleDemo/src/main/assets/apps',
  'simpleDemo/test.jks',
  'simpleDemo/aw-pack.jks',
])

// 这些文件每次构建都会按项目改写，增量复用时也必须从干净模板重新覆盖
const PATCHED_FILES = [
  'build.gradle',
  'settings.gradle',
  'simpleDemo/build.gradle',
  'simpleDemo/src/main/AndroidManifest.xml',
]

/**
 * 从 SDK 复制一份干净模板到工作目录（首次构建或 SDK/模板变化时使用）。
 * @param {string} templateRoot
 * @param {string} targetDir
 */
export async function prepareTemplate(templateRoot, targetDir) {
  await ensureDir(targetDir)
  await copyTree(
    templateRoot,
    targetDir,
    (relative) => SKIP.has(relative) || relative.startsWith('simpleDemo/build/'),
  )
  await refreshTemplateFiles(templateRoot, targetDir)
  return targetDir
}

/**
 * 只把会被 patch 改写的几个文件恢复成模板原文，并清掉上一版插件留下的 SMARTPACK 注入块。
 * 增量构建时用它代替整棵模板复制。
 * @param {string} templateRoot
 * @param {string} targetDir
 */
export async function refreshTemplateFiles(templateRoot, targetDir) {
  for (const relative of PATCHED_FILES) {
    const source = path.join(templateRoot, relative)
    const target = path.join(targetDir, relative)
    await ensureDir(path.dirname(target))
    await copyFile(source, target)
    await stripMarkerBlocks(target)
  }
}

/**
 * @param {string} file
 */
export async function stripMarkerBlocks(file) {
  const text = await readText(file)
  let stripped = text
  for (const marker of MARKERS) {
    stripped = stripped.replace(marker, '')
  }
  if (stripped !== text) {
    await writeText(file, stripped)
  }
}
