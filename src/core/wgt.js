import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import { PackError, EXIT } from './errors.js'
import { ensureDir, exists, readJson, replaceHardLink, writeJson } from './fsx.js'
import { fileHash } from './hash.js'

const REQUIRED = ['manifest.json', 'app-service.js', '__uniappview.html']

/**
 * 产物基名：<appid>-<versionName>。版本名里可能有斜杠等字符，统一替换成下划线。
 * @param {{ appid: string, versionName: string }} options
 * @returns {string}
 */
export function wgtBaseName(options) {
  const appid = String(options.appid ?? '').trim()
  const version = String(options.versionName ?? '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return version ? `${appid}-${version}` : appid
}

/**
 * @param {Object} input
 * @param {string} input.resourcesDir
 * @param {string} input.outputDir
 * @param {string} input.appid
 * @param {string} input.versionName
 * @param {number} input.versionCode
 * @returns {Promise<{ file: string, meta: string, latest: string, sha256: string, size: number, manifest: any }>}
 */
export async function writeWgt(input) {
  const manifest = await readJson(path.join(input.resourcesDir, 'manifest.json'))
  const missing = []
  for (const file of REQUIRED) {
    if (!(await exists(path.join(input.resourcesDir, file)))) {
      missing.push(file)
    }
  }
  if (missing.length > 0) {
    throw new PackError(`wgt 缺少文件：${missing.join(', ')}`, EXIT.WGT)
  }
  if (!manifest?.id) {
    throw new PackError('wgt 的 manifest.json 缺少 id', EXIT.WGT)
  }

  const baseName = wgtBaseName({ appid: input.appid, versionName: input.versionName })
  const outputFile = path.join(input.outputDir, `${baseName}.wgt`)
  const metaFile = path.join(input.outputDir, `${baseName}.json`)
  const latest = path.join(input.outputDir, `${input.appid}.wgt`)

  await ensureDir(input.outputDir)
  const zip = new yazl.ZipFile()
  await addDirectory(zip, input.resourcesDir, '')
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(outputFile))

  const size = (await stat(outputFile)).size
  if (size < 1024 * 1024) {
    throw new PackError(`wgt 体积异常（${size} 字节），检查资源目录是否完整`, EXIT.WGT)
  }
  const sha256 = await fileHash(outputFile)

  await writeJson(metaFile, {
    appid: input.appid,
    versionName: input.versionName,
    versionCode: input.versionCode,
    file: path.basename(outputFile),
    size,
    sha256,
    builtAt: new Date().toISOString(),
  })
  // 固定名保持旧路径可用：硬链到最新版本，零复制且不会被覆盖
  await replaceHardLink(outputFile, latest)

  return { file: outputFile, meta: metaFile, latest, sha256, size, manifest }
}

/**
 * @param {yazl.ZipFile} zip
 * @param {string} dir
 * @param {string} prefix
 */
async function addDirectory(zip, dir, prefix) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name)
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await addDirectory(zip, absolute, relative)
    } else {
      zip.addFile(absolute, relative)
    }
  }
}
