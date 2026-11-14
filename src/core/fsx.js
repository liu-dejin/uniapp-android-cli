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
 * HBuilderX 的 manifest.json 是 JSONC：带注释、末尾逗号。字符串里的 // 不能被当成注释。
 * @param {string} text
 * @returns {any}
 */
export function parseJsonc(text) {
  const source = text.replace(/^﻿/, '')
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      output += char
      continue
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1
      }
      output += '\n'
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1
      }
      index += 1
      continue
    }
    if (char === ',') {
      let lookahead = index + 1
      while (lookahead < source.length) {
        if (/\s/.test(source[lookahead])) {
          lookahead += 1
          continue
        }
        if (source[lookahead] === '/' && source[lookahead + 1] === '/') {
          lookahead += 2
          while (lookahead < source.length && source[lookahead] !== '\n') {
            lookahead += 1
          }
          continue
        }
        if (source[lookahead] === '/' && source[lookahead + 1] === '*') {
          lookahead += 2
          while (lookahead < source.length && !(source[lookahead] === '*' && source[lookahead + 1] === '/')) {
            lookahead += 1
          }
          lookahead += 2
          continue
        }
        break
      }
      if (source[lookahead] === '}' || source[lookahead] === ']') {
        continue
      }
    }
    output += char
  }
  return JSON.parse(output)
}

/**
 * @param {string} file
 * @returns {Promise<any>}
 */
export async function readJsonc(file) {
  return parseJsonc(await readFile(file, 'utf8'))
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
