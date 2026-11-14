import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import { PackError, EXIT } from './errors.js'
import { ensureDir, exists, readJson } from './fsx.js'

const REQUIRED = ['manifest.json', 'app-service.js', '__uniappview.html']

/**
 * @param {Object} input
 * @param {string} input.resourcesDir
 * @param {string} input.outputFile
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

  await ensureDir(path.dirname(input.outputFile))
  const zip = new yazl.ZipFile()
  await addDirectory(zip, input.resourcesDir, '')
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(input.outputFile))

  const buffer = await readFile(input.outputFile)
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  if (buffer.length < 1024 * 1024) {
    throw new PackError(`wgt 体积异常（${buffer.length} 字节），检查资源目录是否完整`, EXIT.WGT)
  }

  return { file: input.outputFile, sha256, size: buffer.length, manifest }
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

/**
 * @param {string} file
 */
export function fileHash(file) {
  return new Promise((resolve, reject) => {
    const sha = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => sha.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(sha.digest('hex')))
  })
}
