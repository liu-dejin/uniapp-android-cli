import path from 'node:path'
import { copyTree, ensureDir, readText, writeText } from '../fsx.js'

const MARKERS = [
  /\/\/ ===== SMARTPACK[\s\S]*?END =====[^\n]*\n?/g,
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

/**
 * 从 SDK 复制一份干净模板到工作目录，并清掉上一版插件留下的 SMARTPACK 注入块。
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

  for (const file of [
    path.join(targetDir, 'build.gradle'),
    path.join(targetDir, 'simpleDemo/build.gradle'),
    path.join(targetDir, 'simpleDemo/src/main/AndroidManifest.xml'),
  ]) {
    await stripMarkerBlocks(file)
  }

  return targetDir
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
