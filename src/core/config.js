import os from 'node:os'
import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { exists, readJson, writeJson } from './fsx.js'

export const CONFIG_DIR = path.join(os.homedir(), '.uniapp-android-cli')
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
export const PROJECT_CONFIG_FILE = 'uni-pack.config.json'

/** @returns {any} */
export function defaultConfig() {
  return {
    version: 1,
    sdk: {
      root: '',
      template: 'HBuilder-Integrate-AS',
      libsDir: 'SDK/libs',
      dataDir: 'SDK/assets/data',
    },
    android: {
      sdkDir: '',
      buildTools: '35.0.0',
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

  if (!nameOrPath) {
    const currentHasManifest = await exists(path.join(absolute, 'src/manifest.json'))
    if (!currentHasManifest) {
      throw new PackError('当前目录不是 uni-app 项目，请用 --project 指定项目目录或先在配置里登记', EXIT.CONFIG)
    }
    return finalizeProject(config, path.basename(absolute), { projectDir: absolute })
  }

  const hasManifest = await exists(path.join(absolute, 'src/manifest.json'))
  if (!hasManifest) {
    throw new PackError(`找不到项目：${nameOrPath}（既不是已登记的项目名，也不是含 src/manifest.json 的目录）`, EXIT.CONFIG)
  }
  return finalizeProject(config, path.basename(absolute), { projectDir: absolute })
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

  // 输出目录跟着项目走；全局 outputDir 不再参与，避免多项目互相覆盖。
  const outputDir = String(local.outputDir ?? entry.outputDir ?? path.join(projectDir, 'apk'))

  const merged = {
    name,
    projectDir,
    ...entry,
    ...local,
    outputDir: path.isAbsolute(outputDir) ? outputDir : path.resolve(projectDir, outputDir),
    signing: { ...(entry.signing ?? {}), ...(local.signing ?? {}) },
    debug: { ...(entry.debug ?? {}), ...(local.debug ?? {}) },
    webBuild: {
      command: 'pnpm',
      args: ['run', 'build:app-android'],
      outputDir: 'dist/build/app',
      ...(entry.webBuild ?? {}),
      ...(local.webBuild ?? {}),
    },
  }

  return { config, project: merged }
}
