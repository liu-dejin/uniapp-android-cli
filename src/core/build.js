import { copyFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { emptyDir, ensureDir, exists } from './fsx.js'
import { runGradle } from './gradle.js'
import { resolveHbuilderx } from './hbuilderx.js'
import { patchAndroidManifest } from './patch/manifest.js'
import { patchAppGradle, patchRootGradle } from './patch/gradle.js'
import { applyAssets } from './patch/assets.js'
import { applyNativePlugins } from './patch/nativePlugins.js'
import { mergeProjectManifest } from './patch/projectManifest.js'
import { prepareTemplate } from './patch/template.js'
import { UTS_AAR, integrateUtsPlugins, scanUtsPlugins } from './patch/utsPlugins.js'
import {
  detectVueVersion,
  normalizeManifest,
  readProjectManifest,
  readProjectPackage,
} from './project.js'
import {
  BASE_AARS,
  DEBUG_AAR,
  MODULE_AARS,
  findSdkForVersion,
  readTemplateDefaults,
  resolveAndroidTools,
  resolveJavaHome,
  resolveSdk,
} from './sdk.js'
import { resolveSigning } from './signing.js'
import { assertVersionMatch, readCompilerVersion, readSdkVersion, versionMismatchError } from './version.js'
import { runWebBuild } from './webBuild.js'
import { apkBaseName, findApk, publishApk } from './output.js'

/**
 * @param {Object} input
 * @param {any} input.config
 * @param {any} input.project
 * @param {'release' | 'debug'} input.mode
 * @param {any} input.options
 * @param {import('./logger.js').Logger} input.logger
 */
export async function buildProject(input) {
  const { config, project, mode, options, logger } = input
  const debug = mode === 'debug'

  const { manifest, file, type, inputDir } = await readProjectManifest(project.projectDir)
  project.type = type
  project.inputDir = inputDir

  const resolved = normalizeManifest(manifest, {
    appid: project.appid,
    name: project.name,
    package: project.package || (await readProjectPackage(project.projectDir)),
    versionName: project.versionName,
    versionCode: project.versionCode,
    minSdkVersion: project.minSdkVersion,
    targetSdkVersion: project.targetSdkVersion,
    abiFilters: project.abiFilters,
  })
  const vueVersion = await detectVueVersion(project.projectDir, manifest, type)
  logger.info(`项目 ${resolved.name}（${resolved.appid}）v${resolved.versionName}(${resolved.versionCode})`)
  logger.detail(
    `manifest: ${file}（${type === 'hbuilderx' ? 'HBuilderX' : 'CLI'} 项目，Vue ${vueVersion}）`,
  )

  const hbuilderx = type === 'hbuilderx' ? await resolveHbuilderx(config, { project }) : null
  if (type === 'hbuilderx' && !hbuilderx && !options.skipWeb) {
    throw new PackError('找不到 HBuilderX，无法编译 HBuilderX 项目的源码', EXIT.PREFLIGHT, {
      hint: [
        '任选一种方式指定：',
        '  1) uni-pack init -p <项目> --hbuilderx <HBuilderX 目录>',
        '  2) 在配置 hbuilderx.root 里填写 HBuilderX 安装目录',
        '  3) 设置环境变量 HBUILDERX_HOME',
      ].join('\n'),
    })
  }

  const compiler = await readCompilerVersion(project, { hbuilderxRoot: hbuilderx?.root })
  if (compiler.version) {
    logger.info(`编译器版本：${compiler.version}（${compiler.source}）`)
  }

  let sdk = await resolveSdk(config, { project, version: compiler.version ?? undefined })
  let sdkVersion = await readSdkVersion(sdk.root)
  // 全局 sdk.root 可能是别的项目留下的；项目没单独指定时按编译器版本自动切到匹配的 SDK。
  if (compiler.version && sdkVersion && compiler.version !== sdkVersion && !project.sdkRoot) {
    const matched = await findSdkForVersion(config, compiler.version)
    if (matched) {
      sdk = await resolveSdk(config, { project: { ...project, sdkRoot: matched } })
      sdkVersion = await readSdkVersion(sdk.root)
      logger.info(`按项目版本切换离线 SDK：${sdk.root}`)
    }
  }
  logger.detail(`离线 SDK：${sdk.root}`)

  const versions = { compiler: compiler.version, sdk: sdkVersion }
  const versionCheck = assertVersionMatch(versions)
  if (!versionCheck.ok && !options.skipVersionCheck) {
    throw versionMismatchError(versions, { type })
  }
  if (versionCheck.ok) {
    logger.info(`版本一致：uni-app ${versions.compiler} / SDK ${versions.sdk}`)
  } else {
    logger.warn(`版本不一致：uni-app ${versions.compiler ?? '未知'} / SDK ${versions.sdk ?? '未知'}（已跳过检查）`)
  }

  let resourcesDir = path.resolve(
    project.projectDir,
    String(project.webBuild?.outputDir ?? (type === 'hbuilderx' ? 'unpackage/dist/build/app-plus' : 'dist/build/app')),
  )
  if (options.skipWeb) {
    if (!(await exists(path.join(resourcesDir, 'app-service.js')))) {
      throw new PackError('--skip-web 但前端产物不存在，请先构建', EXIT.WEB_BUILD)
    }
    logger.info(`跳过前端构建，使用 ${resourcesDir}`)
  } else {
    resourcesDir = (await runWebBuild(project, logger, { hbuilderx: hbuilderx ?? undefined, vueVersion })).dir
  }

  const utsPlugins = await scanUtsPlugins({ projectDir: project.projectDir, resourcesDir })
  const hasUts = utsPlugins.some((plugin) => plugin.usable)
  if (utsPlugins.length > 0) {
    logger.info(`UTS 插件：${utsPlugins.map((plugin) => plugin.name).join(', ')}`)
  }

  const signing = await resolveSigning(project, options)
  const templateDefaults = await readTemplateDefaults(sdk.templateRoot)
  const compileSdkVersion = Number(project.compileSdkVersion ?? templateDefaults.compileSdkVersion ?? 35)
  const buildToolsVersion = firstNonEmpty(
    project.buildToolsVersion,
    config.android?.buildTools,
    templateDefaults.buildToolsVersion,
  )
  const tools = await resolveAndroidTools(config, { preferredBuildTools: buildToolsVersion })
  const javaHome = await resolveJavaHome(config)
  const workRoot = path.join(config.workDir, sanitize(project.name ?? 'project'))
  const gradleRoot = path.join(workRoot, 'gradle')

  logger.step('准备构建工程')
  await emptyDir(gradleRoot)
  await prepareTemplate(sdk.templateRoot, gradleRoot)
  const aars = await copyAars({
    sdk,
    targetDir: path.join(gradleRoot, 'simpleDemo/libs'),
    debug,
    modules: resolved.modules,
    uts: hasUts,
    vueVersion,
    logger,
  })
  logger.success(`模板与 AAR 就绪（${aars.count} 个）`)

  logger.step('写入项目配置')
  await patchRootGradle(path.join(gradleRoot, 'build.gradle'), config.android.sdkDir)
  await patchAppGradle(path.join(gradleRoot, 'simpleDemo/build.gradle'), {
    packageName: resolved.packageName,
    versionName: resolved.versionName,
    versionCode: resolved.versionCode,
    minSdkVersion: resolved.minSdkVersion,
    targetSdkVersion: resolved.targetSdkVersion,
    compileSdkVersion,
    buildToolsVersion: tools.buildTools,
    abiFilters: resolved.abiFilters,
    signing,
  })
  const androidManifest = path.join(gradleRoot, 'simpleDemo/src/main/AndroidManifest.xml')
  await patchAndroidManifest(androidManifest, {
    packageName: resolved.packageName,
    appKey: String(project.appKey ?? ''),
    permissions: resolved.permissions,
    features: resolved.features.map((entry) => {
      const [name, required] = entry.split('|')
      return { name, required }
    }),
    debug,
  })
  await mergeProjectManifest({ targetFile: androidManifest, projectDir: project.projectDir, logger })
  await copyFile(signing.keystore, path.join(gradleRoot, 'simpleDemo/aw-pack.jks'))
  await applyAssets({
    moduleDir: path.join(gradleRoot, 'simpleDemo'),
    dataDir: sdk.dataDir,
    resourcesDir,
    appid: resolved.appid,
    appName: resolved.name,
    versionName: resolved.versionName,
    debug,
    projectDir: project.projectDir,
    manifest,
  })
  await applyNativePlugins({
    projectDir: project.projectDir,
    moduleDir: path.join(gradleRoot, 'simpleDemo'),
    libsDir: path.join(gradleRoot, 'simpleDemo/libs'),
    logger,
  })
  await integrateUtsPlugins({
    plugins: utsPlugins,
    gradleRoot,
    mainModule: 'simpleDemo',
    compileSdkVersion,
    logger,
  })
  logger.success('配置写入完成')

  logger.step(`Gradle ${debug ? 'assembleDebug' : 'assembleRelease'}`)
  await runGradle({
    gradlew: sdk.gradlew,
    cwd: gradleRoot,
    task: debug ? 'assembleDebug' : 'assembleRelease',
    javaHome,
    androidSdkDir: config.android.sdkDir,
    offline: Boolean(options.offline),
    logger,
  })

  const apkDir = path.join(gradleRoot, 'simpleDemo/build/outputs/apk', mode)
  const apk = await findApk(apkDir, mode)
  await verifySignature(tools.apksigner, apk, logger)

  const baseName = apkBaseName(project.name ?? resolved.name, resolved.versionName, resolved.versionCode)
  const published = await publishApk({
    apk,
    outputDir: path.resolve(String(options.out ?? project.outputDir)),
    baseName,
    mode,
    workDir: workRoot,
    record: {
      appid: resolved.appid,
      packageName: resolved.packageName,
      versionName: resolved.versionName,
      versionCode: resolved.versionCode,
      projectType: type,
      vueVersion,
      compilerVersion: versions.compiler,
      sdkVersion: versions.sdk,
      hbuilderx: hbuilderx?.root ?? '',
      template: sdk.templateRoot,
      javaHome,
    },
  })

  logger.success(`APK：${published.target}`)
  logger.info(`最新副本：${published.latest}`)
  return { apk: published.target, latest: published.latest, sha256: published.sha256, resolved, workRoot }
}

/**
 * @param {string} apksigner
 * @param {string} apk
 * @param {import('./logger.js').Logger} logger
 */
async function verifySignature(apksigner, apk, logger) {
  try {
    const { run } = await import('./process.js')
    const { stdout } = await run(apksigner, ['verify', '--print-certs', apk], { allowFailure: false })
    const sha1 = /SHA-1 digest:\s*([0-9a-f:]+)/i.exec(stdout)?.[1] ?? ''
    const sha256 = /SHA-256 digest:\s*([0-9a-f:]+)/i.exec(stdout)?.[1] ?? ''
    logger.info(`签名 SHA1：${sha1}`)
    logger.detail(`签名 SHA256：${sha256}`)
  } catch (error) {
    throw new PackError('APK 签名校验失败', EXIT.SIGN, { cause: error })
  }
}

/**
 * 模板自带的 libs 是该 SDK 版本的基线；BASE_AARS 里新旧版本都有的再补上，
 * 老 SDK 缺少的 AAR 只提示不阻断。
 * @param {Object} options
 * @param {{ templateRoot: string, libsDir: string }} options.sdk
 * @param {string} options.targetDir
 * @param {boolean} options.debug
 * @param {string[]} options.modules
 * @param {boolean} [options.uts]
 * @param {2 | 3} [options.vueVersion]
 * @param {import('./logger.js').Logger} options.logger
 */
async function copyAars(options) {
  const { sdk, targetDir, debug, modules, uts, vueVersion, logger } = options
  await ensureDir(targetDir)

  /** @type {Map<string, string>} */
  const sources = new Map()
  const templateLibs = path.join(sdk.templateRoot, 'simpleDemo/libs')
  for (const name of await listLibs(templateLibs)) {
    if (name === DEBUG_AAR && !debug) {
      continue
    }
    sources.set(name, path.join(templateLibs, name))
  }

  const available = new Set(await listLibs(sdk.libsDir))
  // 模板里的 uniapp-v8-release.aar 可能只带 Vue3 运行时；Vue2 必须用 SDK/libs 的完整版。
  if (vueVersion === 2 && available.has('uniapp-v8-release.aar')) {
    sources.set('uniapp-v8-release.aar', path.join(sdk.libsDir, 'uniapp-v8-release.aar'))
  }
  const missing = []
  for (const name of debug ? [...BASE_AARS, DEBUG_AAR] : BASE_AARS) {
    if (sources.has(name)) {
      continue
    }
    if (available.has(name)) {
      sources.set(name, path.join(sdk.libsDir, name))
    } else if (name !== DEBUG_AAR) {
      missing.push(name)
    }
  }
  if (missing.length > 0) {
    logger.warn(`当前 SDK 没有这些 AAR，已跳过：${missing.join(', ')}`)
  }

  /** @type {string[]} */
  const unresolved = []
  for (const module of modules) {
    const names = MODULE_AARS[module]
    if (!names) {
      unresolved.push(module)
      continue
    }
    for (const name of names) {
      if (!available.has(name)) {
        continue
      }
      sources.set(name, path.join(sdk.libsDir, name))
    }
  }
  if (unresolved.length > 0) {
    logger.warn(`未识别的模块 AAR：${unresolved.join(', ')}（若运行时报模块缺失，请在配置 modules 里补充）`)
  }

  if (uts) {
    if (!available.has(UTS_AAR)) {
      throw new PackError(`离线 SDK 缺少 ${UTS_AAR}，无法编译 UTS 插件`, EXIT.PREFLIGHT, {
        hint: '请换用包含 utsplugin-release.aar 的 Android 离线 SDK',
      })
    }
    sources.set(UTS_AAR, path.join(sdk.libsDir, UTS_AAR))
  }

  for (const [name, source] of sources) {
    await copyFile(source, path.join(targetDir, name))
  }
  return { count: sources.size }
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listLibs(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile() && /\.(aar|jar)$/i.test(entry.name)).map((entry) => entry.name)
}

/**
 * @param {...unknown} values
 * @returns {string}
 */
function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) {
      return text
    }
  }
  return ''
}

/**
 * @param {string} value
 */
function sanitize(value) {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}
