import path from 'node:path'
import { copyFile, readdir, rm } from 'node:fs/promises'
import { copyTree, ensureDir, exists, readJsonc, readText, writeJson, writeText } from '../fsx.js'
import { PackError, EXIT } from '../errors.js'

const UTS_AAR = 'utsplugin-release.aar'
const DEFAULT_KOTLIN = '2.2.0'
const DEFAULT_COROUTINES = '1.8.1'

/**
 * HBuilderX 编译后会把 UTS 插件的 Kotlin 源码放到产物/导出目录的 uni_modules 下，
 * 官方离线打包要求把这些源码做成独立的 Android Library 模块。
 * @param {{ projectDir: string, resourcesDir: string }} options
 */
export async function scanUtsPlugins(options) {
  const roots = [
    path.join(options.resourcesDir, 'uni_modules'),
    path.join(options.projectDir, 'unpackage', 'resources', 'uni_modules'),
    path.join(options.projectDir, 'unpackage', 'resource', 'app-android', 'uni_modules'),
    path.join(options.projectDir, 'unpackage', 'resources', 'app-android', 'uni_modules'),
  ]

  /** @type {Map<string, any>} */
  const found = new Map()
  for (const root of roots) {
    if (!(await exists(root))) {
      continue
    }
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || found.has(entry.name)) {
        continue
      }
      const androidDir = path.join(root, entry.name, 'utssdk', 'app-android')
      if (!(await exists(androidDir))) {
        continue
      }
      const sources = await findKotlinSources(path.join(androidDir, 'src'))
      const configFile = path.join(androidDir, 'config.json')
      const config = (await exists(configFile)) ? await readJsonc(configFile).catch(() => ({})) : {}
      found.set(entry.name, {
        name: entry.name,
        androidDir,
        config,
        sourceCount: sources.length,
        usable: sources.length > 0,
      })
    }
  }
  return [...found.values()]
}

/**
 * @param {{ plugins: any[], gradleRoot: string, mainModule: string, compileSdkVersion: number,
 *   kotlinVersion?: string, coroutinesVersion?: string, logger: import('../logger.js').Logger }} options
 */
export async function integrateUtsPlugins(options) {
  const { plugins, gradleRoot, mainModule, compileSdkVersion, logger } = options
  const kotlinVersion = options.kotlinVersion || DEFAULT_KOTLIN
  const coroutinesVersion = options.coroutinesVersion || DEFAULT_COROUTINES
  const usable = plugins.filter((plugin) => plugin.usable)
  for (const plugin of plugins.filter((item) => !item.usable)) {
    logger.warn(`UTS 插件 ${plugin.name} 没有编译后的 Kotlin 源码，已跳过（先执行一次 HBuilderX 编译）`)
  }
  if (usable.length === 0) {
    return { modules: [] }
  }
  logger.detail(`UTS Kotlin 版本：${kotlinVersion}（${options.kotlinVersion ? '模板声明' : '默认兜底'}）`)

  /** @type {Array<any>} */
  const modules = []
  for (const plugin of usable) {
    const module = await createUtsModule({
      plugin,
      gradleRoot,
      mainModule,
      compileSdkVersion,
      kotlinVersion,
      coroutinesVersion,
    })
    modules.push(module)
    logger.detail(`UTS 插件 ${plugin.name} → ${module.moduleName}`)
  }

  await patchRootBuildGradle(gradleRoot, modules, kotlinVersion)
  await patchSettingsGradle(gradleRoot, modules)
  await patchMainBuildGradle({ gradleRoot, mainModule, modules, kotlinVersion, coroutinesVersion })
  await syncPluginLibs({ gradleRoot, mainModule, modules })
  await registerComponents({ gradleRoot, mainModule, modules })
  logger.success(`UTS 插件已集成：${modules.map((item) => item.name).join(', ')}`)
  return { modules }
}

/**
 * @param {string} dir
 */
async function findKotlinSources(dir) {
  if (!(await exists(dir))) {
    return []
  }
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.kt'))
}

/**
 * @param {Object} options
 */
async function createUtsModule(options) {
  const { plugin, gradleRoot, mainModule, compileSdkVersion, kotlinVersion, coroutinesVersion } = options
  const moduleName = `uts-${sanitize(plugin.name)}`
  const moduleDir = path.join(gradleRoot, moduleName)
  await rm(moduleDir, { recursive: true, force: true })
  const mainDir = path.join(moduleDir, 'src', 'main')
  await ensureDir(mainDir)

  const androidDir = plugin.androidDir
  const srcDir = path.join(androidDir, 'src')
  if (await exists(srcDir)) {
    await copyTree(srcDir, path.join(mainDir, 'java'))
  }
  if (await exists(path.join(androidDir, 'res'))) {
    await copyTree(path.join(androidDir, 'res'), path.join(mainDir, 'res'))
  }
  if (await exists(path.join(androidDir, 'assets'))) {
    await copyTree(path.join(androidDir, 'assets'), path.join(mainDir, 'assets'))
  }
  if (await exists(path.join(androidDir, 'libs'))) {
    await copyTree(path.join(androidDir, 'libs'), path.join(moduleDir, 'libs'))
  }

  const { namespace, manifest } = await readManifest(androidDir, plugin.name)
  await writeText(path.join(mainDir, 'AndroidManifest.xml'), manifest)

  const config = plugin.config ?? {}
  const minSdk = Number(config.minSdkVersion) || 21
  const abis = Array.isArray(config.abis) ? config.abis : []
  const dependencies = []
  for (const item of Array.isArray(config.dependencies) ? config.dependencies : []) {
    if (typeof item === 'string') {
      dependencies.push(`    implementation '${item}'`)
    } else if (item && typeof item.source === 'string') {
      dependencies.push(`    ${item.source}`)
    }
  }
  const applyPlugins = (Array.isArray(config.project?.plugins) ? config.project.plugins : []).map(
    (id) => `apply plugin: '${id}'`,
  )

  const abiBlock = abis.length > 0 ? `        ndk {\n            abiFilters ${abis.map((abi) => `'${abi}'`).join(', ')}\n        }\n` : ''
  const content = [
    "apply plugin: 'com.android.library'",
    "apply plugin: 'kotlin-android'",
    ...applyPlugins,
    '',
    'android {',
    `    namespace '${namespace}'`,
    `    compileSdkVersion ${compileSdkVersion}`,
    '    defaultConfig {',
    `        minSdkVersion ${minSdk}`,
    abiBlock + '        compileOptions {',
    '            sourceCompatibility JavaVersion.VERSION_1_8',
    '            targetCompatibility JavaVersion.VERSION_1_8',
    '        }',
    '    }',
    '    kotlinOptions {',
    '        jvmTarget = "1.8"',
    '    }',
    '}',
    '',
    'dependencies {',
    `    compileOnly fileTree(include: ['*.aar'], dir: '../${mainModule}/libs')`,
    "    compileOnly fileTree(include: ['*.aar', '*.jar'], dir: './libs')",
    "    compileOnly 'com.alibaba:fastjson:1.1.46.android'",
    "    compileOnly 'androidx.core:core-ktx:1.6.0'",
    `    compileOnly 'org.jetbrains.kotlin:kotlin-stdlib:${kotlinVersion}'`,
    `    compileOnly 'org.jetbrains.kotlin:kotlin-reflect:${kotlinVersion}'`,
    `    compileOnly 'org.jetbrains.kotlinx:kotlinx-coroutines-core:${coroutinesVersion}'`,
    `    compileOnly 'org.jetbrains.kotlinx:kotlinx-coroutines-android:${coroutinesVersion}'`,
    ...dependencies,
    '}',
    '',
  ].join('\n')
  await writeText(path.join(moduleDir, 'build.gradle'), content)

  return {
    name: plugin.name,
    moduleName,
    moduleDir,
    namespace,
    androidDir,
    hooksClass: config.hooksClass || '',
    components: Array.isArray(config.components) ? config.components : [],
    project: config.project ?? {},
  }
}

/**
 * @param {string} androidDir
 * @param {string} pluginName
 */
async function readManifest(androidDir, pluginName) {
  const file = path.join(androidDir, 'AndroidManifest.xml')
  const safe = javaPackageSegment(pluginName)
  if (!(await exists(file))) {
    return {
      namespace: `uts.sdk.${safe}`,
      manifest: '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n',
    }
  }
  let text = await readText(file)
  const namespace = /package="([^"]+)"/.exec(text)?.[1] || `uts.sdk.${safe}`
  text = text.replace(/\s*package="[^"]*"/, '')
  return { namespace, manifest: text }
}

/**
 * @param {string} value
 */
function javaPackageSegment(value) {
  const cleaned = String(value ?? 'plugin').replace(/[^\w]/g, '')
  const safe = cleaned || 'plugin'
  return /^\d/.test(safe) ? `_${safe}` : safe
}

/**
 * @param {string} gradleRoot
 * @param {any[]} modules
 * @param {string} kotlinVersion
 */
async function patchRootBuildGradle(gradleRoot, modules, kotlinVersion) {
  const file = path.join(gradleRoot, 'build.gradle')
  let text = await readText(file)

  const classpaths = new Set()
  const repositories = new Set()
  for (const module of modules) {
    classpaths.add(`classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:${kotlinVersion}'`)
    for (const item of Array.isArray(module.project.dependencies) ? module.project.dependencies : []) {
      classpaths.add(`classpath '${item}'`)
    }
    for (const item of Array.isArray(module.project.repositories) ? module.project.repositories : []) {
      repositories.add(String(item))
    }
  }

  let prepended = false
  if (!text.includes('kotlin-gradle-plugin')) {
    if (/(buildscript\s*\{[\s\S]*?dependencies\s*\{)/.test(text)) {
      text = text.replace(
        /(buildscript\s*\{[\s\S]*?dependencies\s*\{)/,
        (match) => `${match}\n        ${[...classpaths].join('\n        ')}`,
      )
    } else {
      // 模板没有 buildscript 时补一个，保证 kotlin-android 插件能解析
      const repoLines = [...repositories].map((item) => `        ${item}`).join('\n')
      text = `buildscript {\n    repositories {\n        google()\n        mavenCentral()\n${repoLines}\n    }\n    dependencies {\n        ${[...classpaths].join('\n        ')}\n    }\n}\n${text}`
      prepended = true
    }
  }
  if (repositories.size > 0) {
    const block = `\n        ${[...repositories].join('\n        ')}`
    if (!prepended) {
      text = text.replace(/(buildscript\s*\{[\s\S]*?repositories\s*\{)/, (match) => `${match}${block}`)
    }
    text = text.replace(/(allprojects\s*\{[\s\S]*?repositories\s*\{)/, (match) => `${match}${block}`)
  }
  await writeText(file, text)
}

/**
 * @param {string} gradleRoot
 * @param {any[]} modules
 */
async function patchSettingsGradle(gradleRoot, modules) {
  const file = path.join(gradleRoot, 'settings.gradle')
  let text = await readText(file)
  for (const module of modules) {
    if (!new RegExp(`include\\s+['"]:${escapeRegExp(module.moduleName)}['"]`).test(text)) {
      text += `\ninclude ':${module.moduleName}'`
    }
  }
  await writeText(file, `${text.trimEnd()}\n`)
}

/**
 * @param {{ gradleRoot: string, mainModule: string, modules: any[], kotlinVersion: string, coroutinesVersion: string }} options
 */
async function patchMainBuildGradle(options) {
  const file = path.join(options.gradleRoot, options.mainModule, 'build.gradle')
  let text = await readText(file)

  const dependencies = [
    ...options.modules.map((module) => `    implementation project(':${module.moduleName}')`),
    "    implementation 'androidx.core:core-ktx:1.6.0'",
    `    implementation "org.jetbrains.kotlin:kotlin-stdlib:${options.kotlinVersion}"`,
    `    implementation "org.jetbrains.kotlin:kotlin-reflect:${options.kotlinVersion}"`,
    `    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-core:${options.coroutinesVersion}"`,
    `    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:${options.coroutinesVersion}"`,
  ]
  text = insertIntoBlock(text, 'dependencies', dependencies.join('\n'))

  const hooks = options.modules.map((module) => module.hooksClass).filter(Boolean)
  if (hooks.length > 0) {
    if (!/buildFeatures\s*\{[\s\S]*?buildConfig\s+true/.test(text)) {
      text = text.replace(/(android\s*\{)/, `$1\n    buildFeatures {\n        buildConfig true\n    }`)
    }
    const escaped = hooks.map((name) => `\\"${name}\\"`).join(',')
    text = insertIntoBlock(text, 'defaultConfig', `        buildConfigField 'String[]', 'UTSHooksClassArray', '{${escaped}}'`)
  }
  await writeText(file, text)
}

/**
 * @param {{ gradleRoot: string, mainModule: string, modules: any[] }} options
 */
async function syncPluginLibs(options) {
  const mainLibs = path.join(options.gradleRoot, options.mainModule, 'libs')
  const jniLibs = path.join(options.gradleRoot, options.mainModule, 'src', 'main', 'jniLibs')
  for (const module of options.modules) {
    const libsDir = path.join(module.androidDir, 'libs')
    if (!(await exists(libsDir))) {
      continue
    }
    const entries = await readdir(libsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && /\.(aar|jar)$/i.test(entry.name)) {
        await ensureDir(mainLibs)
        await copyFile(path.join(libsDir, entry.name), path.join(mainLibs, entry.name))
        continue
      }
      if (entry.isDirectory()) {
        const abiDir = path.join(libsDir, entry.name)
        const files = await readdir(abiDir)
        const sos = files.filter((name) => name.endsWith('.so'))
        if (sos.length > 0) {
          await ensureDir(path.join(jniLibs, entry.name))
          for (const so of sos) {
            await copyFile(path.join(abiDir, so), path.join(jniLibs, entry.name, so))
          }
        }
      }
    }
  }
}

/**
 * @param {{ gradleRoot: string, mainModule: string, modules: any[] }} options
 */
async function registerComponents(options) {
  const components = options.modules.flatMap((module) => module.components)
  if (components.length === 0) {
    return
  }
  const file = path.join(
    options.gradleRoot,
    options.mainModule,
    'src',
    'main',
    'assets',
    'dcloud_uniplugins.json',
  )
  /** @type {any} */
  let data = { nativePlugins: [{ plugins: [] }] }
  if (await exists(file)) {
    data = await readJsonc(file).catch(() => data)
    data.nativePlugins ??= [{ plugins: [] }]
    data.nativePlugins[0] ??= { plugins: [] }
    if (!Array.isArray(data.nativePlugins[0].plugins)) {
      data.nativePlugins[0].plugins = []
    }
  }
  const existing = new Set(data.nativePlugins[0].plugins.map((item) => `${item.type}:${item.name}`))
  for (const component of components) {
    if (!component?.name || !component?.class) {
      continue
    }
    if (existing.has(`component:${component.name}`)) {
      continue
    }
    data.nativePlugins[0].plugins.push({ type: 'component', name: component.name, class: component.class })
  }
  await writeJson(file, data)
}

/**
 * 在指定的 Gradle 块（按花括号配对）末尾插入内容。
 * @param {string} text
 * @param {string} block
 * @param {string} snippet
 */
function insertIntoBlock(text, block, snippet) {
  const match = new RegExp(`\\b${block}\\s*\\{`).exec(text)
  if (!match) {
    throw new PackError(`模板 build.gradle 缺少 ${block} 块`, EXIT.GRADLE)
  }
  const open = match.index + match[0].length - 1
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') {
      depth += 1
    } else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) {
        return `${text.slice(0, index)}${snippet}\n${text.slice(index)}`
      }
    }
  }
  throw new PackError(`模板 build.gradle 的 ${block} 块不完整`, EXIT.GRADLE)
}

/**
 * @param {string} value
 */
function sanitize(value) {
  return String(value ?? 'plugin').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin'
}

/**
 * @param {string} value
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export { UTS_AAR }
