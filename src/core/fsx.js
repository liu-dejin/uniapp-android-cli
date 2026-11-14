import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * @param {string} dir
 */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

/**
 * @param {string} dir
 */
export async function emptyDir(dir) {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
}

/**
 * @param {string} file
 */
export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/**
 * @param {string} file
 * @param {unknown} value
 */
export async function writeJson(file, value) {
  await ensureDir(path.dirname(file))
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * @param {string} file
 */
export async function exists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/**
 * 递归复制，skip 返回 true 的相对路径会被跳过。
 * @param {string} from
 * @param {string} to
 * @param {(relativePath: string, isDirectory: boolean) => boolean} [skip]
 */
export async function copyTree(from, to, skip) {
  await cp(from, to, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(from, source).split(path.sep).join('/')
      if (!relative) {
        return true
      }
      return !(skip?.(relative, false) ?? false)
    },
  })
}

/**
 * @param {string} dir
 */
export async function listFiles(dir) {
  return readdir(dir, { withFileTypes: true })
}

/**
 * @param {string} file
 */
export async function readText(file) {
  return readFile(file, 'utf8')
}

/**
 * @param {string} file
 * @param {string} text
 */
export async function writeText(file, text) {
  await ensureDir(path.dirname(file))
  await writeFile(file, text, 'utf8')
}
