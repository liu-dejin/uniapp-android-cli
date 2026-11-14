import path from 'node:path'
import { copyFile, readdir } from 'node:fs/promises'
import { PackError, EXIT } from '../errors.js'
import { ensureDir, exists, readJson, readText, writeText } from '../fsx.js'

/**
 * HBuilderX 的 nativeplugins 在离线打包时需要手工集成：AAR 放进 libs，
 * module 类型的插件还要在 dcloud_properties.xml 里注册。
 * @param {Object} options
 * @param {string} options.projectDir
 * @param {string} options.moduleDir   simpleDemo 目录
 * @param {string} options.libsDir     构建工程的 simpleDemo/libs
 * @param {import('../logger.js').Logger} options.logger
 */
export async function applyNativePlugins(options) {
  const sourceDir = path.join(options.projectDir, 'nativeplugins')
  if (!(await exists(sourceDir))) {
    return { plugins: [] }
  }

  const entries = await readdir(sourceDir, { withFileTypes: true }).catch(() => [])
  /** @type {Array<{ name: string, features: Array<{ name: string, value: string }>, dependencies: string[] }>} */
  const plugins = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const pluginDir = path.join(sourceDir, entry.name)
    const packageFile = path.join(pluginDir, 'package.json')
    if (!(await exists(packageFile))) {
      options.logger.warn(`原生插件 ${entry.name} 没有 package.json，离线打包需手工集成`)
      continue
    }
    const pkg = await readJson(packageFile).catch(() => ({}))
    const android = pkg?._dp_nativeplugin?.android
    if (!android) {
      options.logger.detail(`原生插件 ${entry.name} 不含 Android 集成信息`)
      continue
    }

    const copied = await copyPluginLibs(path.join(pluginDir, 'android'), options.libsDir)
    const features = (Array.isArray(android.plugins) ? android.plugins : [])
      .filter((item) => item && item.class)
      .map((item) => ({ name: String(item.name ?? pkg.name ?? entry.name), value: String(item.class) }))
    const dependencies = (Array.isArray(android.dependencies) ? android.dependencies : []).map(String)
    plugins.push({ name: String(pkg.id ?? pkg.name ?? entry.name), features, dependencies })
    options.logger.detail(`原生插件 ${entry.name}：AAR ${copied} 个，feature ${features.length} 个`)
  }

  if (plugins.length === 0) {
    return { plugins }
  }

  await registerFeatures(options.moduleDir, plugins, options.logger)
  await injectDependencies(options.moduleDir, plugins, options.logger)
  return { plugins }
}

/**
 * @param {string} androidDir
 * @param {string} libsDir
 * @returns {Promise<number>}
 */
async function copyPluginLibs(androidDir, libsDir) {
  if (!(await exists(androidDir))) {
    return 0
  }
  const files = await readdir(androidDir, { recursive: true, withFileTypes: true }).catch(() => [])
  let copied = 0
  for (const file of files) {
    if (!file.isFile() || !/\.(aar|jar)$/i.test(file.name)) {
      continue
    }
    const source = path.join(file.parentPath ?? file.path, file.name)
    await ensureDir(libsDir)
    await copyFile(source, path.join(libsDir, file.name))
    copied += 1
  }
  return copied
}

/**
 * @param {string} moduleDir
 * @param {Array<{ features: Array<{ name: string, value: string }> }>} plugins
 * @param {import('../logger.js').Logger} logger
 */
async function registerFeatures(moduleDir, plugins, logger) {
  const file = path.join(moduleDir, 'src/main/assets/data/dcloud_properties.xml')
  if (!(await exists(file))) {
    logger.warn('找不到 dcloud_properties.xml，原生插件未注册')
    return
  }
  let text = await readText(file)
  const additions = []
  for (const plugin of plugins) {
    for (const feature of plugin.features) {
      if (text.includes(`name="${feature.name}"`)) {
        continue
      }
      additions.push(`\t\t<feature name="${feature.name}" value="${feature.value}"/>`)
    }
  }
  if (additions.length === 0) {
    return
  }
  if (!text.includes('</features>')) {
    throw new PackError('dcloud_properties.xml 结构异常，无法注册原生插件', EXIT.PREFLIGHT)
  }
  text = text.replace('</features>', `${additions.join('\n')}\n\t</features>`)
  await writeText(file, text)
}

/**
 * @param {string} moduleDir
 * @param {Array<{ dependencies: string[] }>} plugins
 * @param {import('../logger.js').Logger} logger
 */
async function injectDependencies(moduleDir, plugins, logger) {
  const dependencies = [...new Set(plugins.flatMap((plugin) => plugin.dependencies))]
  if (dependencies.length === 0) {
    return
  }
  const file = path.join(moduleDir, 'build.gradle')
  let text = await readText(file)
  const lines = dependencies
    .filter((dependency) => !text.includes(dependency))
    .map((dependency) => `    implementation '${dependency}'`)
  if (lines.length === 0) {
    return
  }
  if (!/dependencies\s*\{/.test(text)) {
    logger.warn('模板 build.gradle 没有 dependencies 块，原生插件依赖未注入')
    return
  }
  text = text.replace(/dependencies\s*\{/, (match) => `${match}\n${lines.join('\n')}`)
  await writeText(file, text)
}
