import os from 'node:os'
import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { exists, readJson, writeJson } from './fsx.js'
import { detectProject, isUniappProject } from './project.js'

export const CONFIG_DIR = path.join(os.homedir(), '.uniapp-android-cli')
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
export const PROJECT_CONFIG_FILE = 'uni-pack.config.json'

/** @returns {any} */
export function defaultConfig() {
  return {
    version: 1,
    sdk: {
      root: '',
      searchDirs: [],
      template: 'HBuilder-Integrate-AS',
      libsDir: 'SDK/libs',
      dataDir: 'SDK/assets/data',
    },
    hbuilderx: {
      root: '',
      searchDirs: [],
    },
    android: {
      sdkDir: '',
      buildTools: '',
      jdk: '',
    },
    workDir: path.join(CONFIG_DIR, 'work'),
    projects: {},
  }
}

/** @returns {Promise<any>} */
export async function loadConfig() {
  const base = defaultConfig()
  if (!(await exists(CONFIG_FILE))) {
    return base
  }
  const user = await readJson(CONFIG_FILE)
  return mergeConfig(base, user)
}

/**
 * @param {any} base
 * @param {any} override
 */
export function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    sdk: { ...base.sdk, ...(override?.sdk ?? {}) },
    hbuilderx: { ...base.hbuilderx, ...(override?.hbuilderx ?? {}) },
    android: { ...base.android, ...(override?.android ?? {}) },
    projects: { ...(base.projects ?? {}), ...(override?.projects ?? {}) },
  }
}

/** @param {any} config */
export async function saveConfig(config) {
  await writeJson(CONFIG_FILE, config)
}

/**
 * @param {any} config
 * @param {string} [nameOrPath]
 * @param {string} [cwd]
 */
export async function resolveProject(config, nameOrPath, cwd = process.cwd()) {
  const projects = config.projects ?? {}
  const target = nameOrPath ?? cwd

  if (projects[target]) {
    return finalizeProject(config, target, projects[target])
  }

  const absolute = path.resolve(target)
  const byPath = Object.entries(projects).find(([, entry]) => {
    const dir = path.resolve(String(entry.projectDir ?? ''))
    return dir.toLowerCase() === absolute.toLowerCase()
  })
  if (byPath) {
    return finalizeProject(config, byPath[0], byPath[1])
  }

  // 支持用项目名/目录名/唯一子串代替长路径，例如 -p PRO_PHONE 或 -p phone
  const wanted = normalizeProjectName(target)
  if (wanted && !target.includes('/') && !target.includes('\\')) {
    const entries = Object.entries(projects)
    const exact = entries.filter(
      ([key, entry]) =>
        normalizeProjectName(key) === wanted || normalizeProjectName(path.basename(String(entry.projectDir ?? ''))) === wanted,
    )
    if (exact.length === 1) {
      return finalizeProject(config, exact[0][0], exact[0][1])
    }
    if (exact.length > 1) {
      throw projectAmbiguous(target, exact)
    }
    const partial = entries.filter(
      ([key, entry]) =>
        normalizeProjectName(key).includes(wanted) ||
        normalizeProjectName(path.basename(String(entry.projectDir ?? ''))).includes(wanted),
    )
    if (partial.length === 1) {
      return finalizeProject(config, partial[0][0], partial[0][1])
    }
    if (partial.length > 1) {
      throw projectAmbiguous(target, partial)
    }
  }

  if (!nameOrPath) {
    if (!(await isUniappProject(absolute))) {
      throw new PackError('当前目录不是 uni-app 项目，请用 --project 指定项目目录或先在配置里登记', EXIT.CONFIG)
    }
    return finalizeProject(config, path.basename(absolute), { projectDir: absolute })
  }

  if (!(await isUniappProject(absolute))) {
    throw new PackError(`找不到项目：${nameOrPath}（既不是已登记的项目名，也不是 uni-app 项目目录）`, EXIT.CONFIG, {
      hint: '用 uni-pack projects 查看已登记项目，或 --project 传完整路径',
    })
  }
  return finalizeProject(config, path.basename(absolute), { projectDir: absolute })
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeProjectName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * @param {string} target
 * @param {Array<[string, any]>} entries
 * @returns {PackError}
 */
function projectAmbiguous(target, entries) {
  return new PackError(`项目名不唯一：${target}`, EXIT.CONFIG, {
    hint: `候选：${entries.map(([key, entry]) => `${key}（${entry.projectDir}）`).join('；')}`,
  })
}

/**
 * CLI 的 Vue 2 项目通常用 build:app-plus（产物 dist/build/app-plus），
 * Vue 3 项目用 build:app-android（产物 dist/build/app）。
 * @param {string} type
 * @param {string} projectDir
 * @returns {Promise<any>}
 */
export async function resolveDefaultWebBuild(type, projectDir) {
  if (type === 'hbuilderx') {
    return { mode: 'hbuilderx', outputDir: 'unpackage/dist/build/app-plus' }
  }
  const packageFile = path.join(projectDir, 'package.json')
  const pkg = (await exists(packageFile)) ? await readJson(packageFile).catch(() => ({})) : {}
  const scripts = pkg.scripts ?? {}
  if (!scripts['build:app-android'] && scripts['build:app-plus']) {
    return { command: 'pnpm', args: ['run', 'build:app-plus'], outputDir: 'dist/build/app-plus' }
  }
  return { command: 'pnpm', args: ['run', 'build:app-android'], outputDir: 'dist/build/app' }
}

/**
 * @param {any} config
 * @param {string} name
 * @param {any} entry
 */
async function finalizeProject(config, name, entry) {
  const projectDir = path.resolve(String(entry.projectDir ?? process.cwd()))
  const localFile = path.join(projectDir, PROJECT_CONFIG_FILE)
  const local = (await exists(localFile)) ? await readJson(localFile) : {}
  const layout = await detectProject(projectDir)
  const detectedType = layout.type === 'unknown' ? 'cli' : layout.type
  const type = String(local.type ?? entry.type ?? detectedType)

  // 输出目录跟着项目走；全局 outputDir 不再参与，避免多项目互相覆盖。
  const outputDir = String(local.outputDir ?? entry.outputDir ?? path.join(projectDir, 'apk'))

  const defaultWebBuild = await resolveDefaultWebBuild(type, projectDir)

  const merged = {
    name,
    projectDir,
    inputDir: layout.inputDir,
    ...entry,
    ...local,
    type,
    outputDir: path.isAbsolute(outputDir) ? outputDir : path.resolve(projectDir, outputDir),
    signing: { ...(entry.signing ?? {}), ...(local.signing ?? {}) },
    debug: { ...(entry.debug ?? {}), ...(local.debug ?? {}) },
    webBuild: {
      ...defaultWebBuild,
      ...(entry.webBuild ?? {}),
      ...(local.webBuild ?? {}),
    },
  }

  return { config, project: merged }
}
