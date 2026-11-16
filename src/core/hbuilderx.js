import os from 'node:os'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { PackError, EXIT } from './errors.js'
import { exists, readJson } from './fsx.js'
import { run } from './process.js'

const VUE3_COMPILER = {
  vueVersion: 3,
  dir: path.join('plugins', 'uniapp-cli-vite'),
  entry: path.join('node_modules', '@dcloudio', 'vite-plugin-uni', 'bin', 'uni.js'),
  args: ['build', '-p', 'app'],
  platform: 'app',
}
const VUE2_COMPILER = {
  vueVersion: 2,
  dir: path.join('plugins', 'uniapp-cli'),
  entry: path.join('bin', 'uniapp-cli.js'),
  args: [],
  platform: 'app-plus',
}

/**
 * Vue 2 与 Vue 3 的 HBuilderX 编译入口不同，按 manifest.vueVersion 选择。
 * @param {number | string | undefined} vueVersion
 */
export function selectHbuilderxCompiler(vueVersion) {
  return Number(vueVersion) === 2 ? VUE2_COMPILER : VUE3_COMPILER
}

/**
 * about/package.json 的版本形如 5.34.2026102909；编译器写进 manifest 的是前两段。
 * @param {string} version
 * @returns {string}
 */
export function normalizeHbuilderxVersion(version) {
  const parts = String(version ?? '').split('.')
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : String(version ?? '')
}

/**
 * @param {string} dir
 * @returns {Promise<{ root: string, version: string } | null>}
 */
async function probeInstall(dir) {
  const dirs = [dir, path.join(dir, 'HBuilderX')]
  for (const candidate of dirs) {
    const about = path.join(candidate, 'plugins', 'about', 'package.json')
    const hasCompiler =
      (await exists(path.join(candidate, VUE3_COMPILER.dir))) ||
      (await exists(path.join(candidate, VUE2_COMPILER.dir)))
    if (!(await exists(about)) || !hasCompiler) {
      continue
    }
    const pkg = await readJson(about).catch(() => ({}))
    if (pkg.name !== 'about') {
      continue
    }
    return { root: candidate, version: normalizeHbuilderxVersion(pkg.version) }
  }
  return null
}

/**
 * @param {string} dir
 * @returns {Promise<Array<{ root: string, version: string }>>}
 */
async function scanRoot(dir) {
  /** @type {Array<{ root: string, version: string }>} */
  const found = []
  const direct = await probeInstall(dir)
  if (direct) {
    found.push(direct)
  }
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !/hbuilderx/i.test(entry.name)) {
      continue
    }
    const install = await probeInstall(path.join(dir, entry.name))
    if (install) {
      found.push(install)
    }
  }
  return found
}

/**
 * @param {string[]} [extraDirs]
 * @returns {Promise<Array<{ root: string, version: string }>>}
 */
export async function listHbuilderxInstalls(extraDirs = []) {
  /** @type {string[]} */
  const roots = [
    ...extraDirs,
    process.env.HBUILDERX_HOME,
    process.env.HX_APP_ROOT,
    'C:/Program Files',
    'C:/Program Files (x86)',
    'C:/Soft',
    'D:/',
    'D:/Soft',
    'D:/soft',
    'D:/sort',
    'E:/',
    os.homedir(),
    path.join(os.homedir(), 'AppData', 'Local'),
  ]
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .map((item) => String(item))

  const seen = new Set()
  /** @type {Array<{ root: string, version: string }>} */
  const installs = []
  for (const root of roots) {
    for (const install of await scanRoot(path.resolve(String(root)))) {
      const key = install.root.toLowerCase()
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      installs.push(install)
    }
  }
  installs.sort((a, b) => compareVersion(b.version, a.version))
  return installs
}

/**
 * @param {string} a
 * @param {string} b
 */
function compareVersion(a, b) {
  const left = String(a).split('.').map(Number)
  const right = String(b).split('.').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

/**
 * 项目上次用 HBuilderX 编译时写进产物 manifest 的版本，用来挑对应版本的 HBuilderX。
 * @param {string} projectDir
 * @returns {Promise<string>}
 */
export async function readLastBuiltVersion(projectDir) {
  const file = path.join(projectDir, 'unpackage/dist/build/app-plus/manifest.json')
  if (!(await exists(file))) {
    return ''
  }
  const manifest = await readJson(file).catch(() => ({}))
  return String(manifest?.['app-plus']?.['uni-app']?.compilerVersion ?? '')
}

/**
 * 解析顺序：显式指定 → 环境变量 → 上次构建版本对应的安装 → 最新安装。
 * @param {any} config
 * @param {{ project?: any, explicit?: string, projectDir?: string }} [options]
 * @returns {Promise<{ root: string, version: string } | null>}
 */
export async function resolveHbuilderx(config, options = {}) {
  const projectDir = String(options.projectDir ?? options.project?.projectDir ?? '')
  const explicit = [
    options.explicit,
    options.project?.hbuilderxRoot,
    config?.hbuilderx?.root,
    process.env.HBUILDERX_HOME,
    process.env.HX_APP_ROOT,
  ].filter((item) => typeof item === 'string').filter((item) => item.trim() !== '')

  for (const candidate of explicit) {
    const install = await probeInstall(path.resolve(candidate))
    if (install) {
      return install
    }
  }

  const installs = await listHbuilderxInstalls([...(config?.hbuilderx?.searchDirs ?? [])])
  if (installs.length === 0) {
    return null
  }
  if (projectDir) {
    const lastVersion = await readLastBuiltVersion(projectDir)
    const matched = installs.find((install) => install.version === lastVersion)
    if (matched) {
      return matched
    }
  }
  return installs[0]
}

/**
 * 用 HBuilderX 自带的 node + uni-app 编译器构建，产物结构与 HBuilderX 发行一致。
 * @param {Object} options
 * @param {string} options.root
 * @param {string} options.version
 * @param {string} options.inputDir
 * @param {string} options.outputDir
 * @param {number | string} [options.vueVersion] 2 或 3；默认 3
 * @param {import('./logger.js').Logger} options.logger
 */
export async function runHbuilderxBuild(options) {
  const { root, version, inputDir, outputDir, logger } = options
  const compiler = selectHbuilderxCompiler(options.vueVersion ?? 3)
  const pluginDir = path.join(root, compiler.dir)
  const entry = path.join(pluginDir, compiler.entry)
  if (!(await exists(entry))) {
    throw new PackError(`HBuilderX 缺少 Vue ${compiler.vueVersion} 编译器：${entry}`, EXIT.WEB_BUILD, {
      hint: `确认 manifest.json 的 vueVersion 是否正确，或升级 HBuilderX 后重试`,
    })
  }

  const node = await resolveNode(root)
  logger.step(`构建前端资源：HBuilderX ${version}（Vue ${compiler.vueVersion}）`)
  try {
    await run(node, [entry, ...compiler.args], {
      cwd: pluginDir,
      env: {
        HX_Version: version,
        RUN_BY_HBUILDERX: '1',
        UNI_HBUILDERX_PLUGINS: path.join(root, 'plugins'),
        UNI_CLI_CONTEXT: pluginDir,
        UNI_INPUT_DIR: inputDir,
        UNI_OUTPUT_DIR: outputDir,
        UNI_PLATFORM: compiler.platform,
        NODE_ENV: 'production',
      },
      onLine: (line) => logger.detail(line),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new PackError('前端构建失败（HBuilderX 编译器）', EXIT.WEB_BUILD, {
      hint: `${detail}\n可用 HBuilderX 打开项目手工编译一次，确认项目本身能编译通过`,
      cause: error,
    })
  }
}

/**
 * @param {string} root
 * @returns {Promise<string>}
 */
async function resolveNode(root) {
  const candidates = [
    path.join(root, 'plugins', 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'),
    path.join(root, 'plugins', 'node', 'node.exe'),
  ]
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate
    }
  }
  return process.execPath
}
