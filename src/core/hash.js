import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/**
 * 流式计算文件摘要，避免把几十 MB 的 APK/wgt 整个读进内存。
 * @param {string} file
 * @param {string} [algorithm]
 * @returns {Promise<string>}
 */
export function fileHash(file, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm)
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}
