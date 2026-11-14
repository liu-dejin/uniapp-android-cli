import { copyFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { emptyDir, ensureDir, exists } from './fsx.js'
import { runGradle } from './gradle.js'
import { patchAndroidManifest } from './patch/manifest.js'
import { patchAppGradle, patchRootGradle } from './patch/gradle.js'
import { applyAssets } from './patch/assets.js'
import { prepareTemplate } from './patch/template.js'
import { normalizeManifest, readProjectManifest } from './project.js'
import { BASE_AARS, DEBUG_AAR, resolveAndroidTools, resolveJavaHome, resolveSdk } from './sdk.js'
import { resolveSigning } from './signing.js'
import { assertVersionMatch, readProjectCompilerVersion, readSdkVersion, versionMismatchError } from './version.js'
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

  const { manifest, file } = await readProjectManifest(project.projectDir)
  const resolved = normalizeManifest(manifest, {
    appid: project.appid,
    name: project.name,
    package: project.package,
    versionName: project.versionName,
    versionCode: project.versionCode,
    minSdkVersion: project.minSdkVersion,
    targetSdkVersion: project.targetSdkVersion,
    abiFilters: project.abiFilters,
  })
  logger.info(`项目 ${resolved.name}（${resolved.appid}）v${resolved.versionName}(${resolved.versionCode})`)
  logger.detail(`manifest: ${file}`)

  if (resolved.modules.length > 0) {
    throw new PackError(`manifest 声明了模块：${resolved.modules.join(', ')}`, EXIT.CONFIG, {
      hint: '第一版只支持基础 AAR；请在配置 modules.extraAars 里补充对应 AAR 后再打包',
    })
  }

  let resourcesDir = path.resolve(project.projectDir, String(project.webBuild?.outputDir ?? 'dist/build/app'))
  if (options.skipWeb) {
    if (!(await exists(path.join(resourcesDir, 'app-service.js')))) {
      throw new PackError('--skip-web 但前端产物不存在，请先构建', EXIT.WEB_BUILD)
    }
    logger.info(`跳过前端构建，使用 ${resourcesDir}`)
  } else {
    resourcesDir = (await runWebBuild(project, logger)).dir
  }

  const signing = await resolveSigning(project, options)
  const sdk = await resolveSdk(config)

  const versions = {
    compiler: await readProjectCompilerVersion(project.projectDir),
    sdk: await readSdkVersion(sdk.root),
  }
  const versionCheck = assertVersionMatch(versions)
  if (!versionCheck.ok && !options.skipVersionCheck) {
    throw versionMismatchError(versions)
  }
  if (versionCheck.ok) {
    logger.info(`版本一致：uni-app ${versions.compiler} / SDK ${versions.sdk}`)
  } else {
    logger.warn(`版本不一致：uni-app ${versions.compiler ?? '未知'} / SDK ${versions.sdk ?? '未知'}（已跳过检查）`)
  }

  const tools = await resolveAndroidTools(config)
  const javaHome = await resolveJavaHome(config)
  const workRoot = path.join(config.workDir, sanitize(project.name ?? 'project'))
  const gradleRoot = path.join(workRoot, 'gradle')

  logger.step('准备构建工程')
  await emptyDir(gradleRoot)
  await prepareTemplate(sdk.templateRoot, gradleRoot)
  await copyAars(sdk.libsDir, path.join(gradleRoot, 'simpleDemo/libs'), debug)
  logger.success('模板与 AAR 就绪')

  logger.step('写入项目配置')
  await patchRootGradle(path.join(gradleRoot, 'build.gradle'), config.android.sdkDir)
  await patchAppGradle(path.join(gradleRoot, 'simpleDemo/build.gradle'), {
    packageName: resolved.packageName,
    versionName: resolved.versionName,
    versionCode: resolved.versionCode,
    minSdkVersion: resolved.minSdkVersion,
    targetSdkVersion: resolved.targetSdkVersion,
    compileSdkVersion: Number(project.compileSdkVersion ?? 35),
    buildToolsVersion: String(config.android?.buildTools ?? '35.0.0'),
    abiFilters: resolved.abiFilters,
    signing,
  })
  await patchAndroidManifest(path.join(gradleRoot, 'simpleDemo/src/main/AndroidManifest.xml'), {
    packageName: resolved.packageName,
    appKey: String(project.appKey ?? ''),
    permissions: resolved.permissions,
    features: resolved.features.map((entry) => {
      const [name, required] = entry.split('|')
      return { name, required }
    }),
    debug,
  })
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
    outputDir: path.resolve(options.out ?? config.outputDir),
    baseName,
    mode,
    workDir: workRoot,
    record: {
      appid: resolved.appid,
      packageName: resolved.packageName,
      versionName: resolved.versionName,
      versionCode: resolved.versionCode,
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
 * @param {string} libsDir
 * @param {string} targetDir
 * @param {boolean} debug
 */
async function copyAars(libsDir, targetDir, debug) {
  await ensureDir(targetDir)
  const available = new Set(await readdir(libsDir))
  const wanted = debug ? [...BASE_AARS, DEBUG_AAR] : BASE_AARS
  const missing = wanted.filter((name) => !available.has(name))
  if (missing.length > 0) {
    throw new PackError(`离线 SDK 缺少 AAR：${missing.join(', ')}`, EXIT.PREFLIGHT)
  }
  for (const name of wanted) {
    await copyFile(path.join(libsDir, name), path.join(targetDir, name))
  }
}

/**
 * @param {string} value
 */
function sanitize(value) {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}
