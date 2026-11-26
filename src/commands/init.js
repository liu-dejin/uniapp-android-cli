import path from 'node:path'
import { CONFIG_FILE, PROJECT_CONFIG_FILE, loadConfig, resolveDefaultWebBuild, saveConfig } from '../core/config.js'
import { PackError, EXIT } from '../core/errors.js'
import { exists, readJson, readText, writeJson } from '../core/fsx.js'
import { resolveHbuilderx } from '../core/hbuilderx.js'
import { Prompt, canPrompt } from '../core/interactive.js'
import {
  makeFileValidator,
  splitInitConfig,
  toProjectRelative,
  validateAppKey,
  validateConfirm,
  validatePackageName,
  validateRequired,
} from '../core/initConfig.js'
import { Logger } from '../core/logger.js'
import { detectVueVersion, normalizeManifest, readProjectManifest, readProjectPackage } from '../core/project.js'
import { findSdkForVersion, resolveSdkRootInput } from '../core/sdk.js'
import { readCompilerVersion, readSdkVersion, versionMismatchHint } from '../core/version.js'

/**
 * 初始化：探测环境与项目信息，交互式补全项目级配置，
 * 把可共享字段写入 <项目>/uni-pack.config.json，把本机路径写入用户配置。
 * @param {Record<string, any>} options
 */
export async function initCommand(options) {
  const logger = new Logger(options)
  const projectDir = path.resolve(options.project ?? options.cwd ?? process.cwd())
  const config = await loadConfig()
  const projectConfigFile = path.join(projectDir, PROJECT_CONFIG_FILE)
  const existingProject = (await exists(projectConfigFile)) ? await readJson(projectConfigFile).catch(() => ({})) : {}

  const { manifest, type } = await readProjectManifest(projectDir)
  const vueVersion = await detectVueVersion(projectDir, manifest, type)
  const fallbackPackage = String(options.package ?? '') || (await readProjectPackage(projectDir))
  const resolved = normalizeManifest(manifest, { package: fallbackPackage }, { validate: false })
  const key = projectKey(resolved)
  const existing = config.projects?.[key] ?? {}
  const existingSigning = { ...(existing.signing ?? {}), ...(existingProject.signing ?? {}) }

  const hbuilderx =
    type === 'hbuilderx'
      ? await resolveHbuilderx(config, { projectDir, explicit: options.hbuilderx ?? existingProject.hbuilderxRoot })
      : null
  const compiler = await readCompilerVersion(
    { ...existing, ...existingProject, type, projectDir },
    { hbuilderxRoot: hbuilderx?.root },
  )

  const sdkRoot = await resolveSdkRoot({
    config,
    explicit: options.sdk,
    existingRoot: existingProject.sdkRoot ?? existing.sdkRoot,
    version: compiler.version,
  })
  const sdkVersion = await readSdkVersion(sdkRoot)
  const androidSdk = await resolveAndroidSdk(options.androidSdk ?? config.android.sdkDir)
  const javaHome = await resolveJdk(options.jdk ?? config.android.jdk)

  const certificateDir = path.join(projectDir, 'certificate/android')
  const conventionalProperties = path.join(certificateDir, 'keystore.properties')
  const detectedKeystore = (await detectKeystore(certificateDir)) || ''
  const explicitProperties = String(options.keystoreProperties ?? '').trim()
  const explicitKeystore = String(options.keystore ?? '').trim()

  let packageName = String(resolved.packageName || existingProject.package || existing.package || '')
  let appKey = String(options.appkey ?? existingProject.appKey ?? existing.appKey ?? '')
  let keystorePath = explicitKeystore
    ? absoluteFrom(projectDir, explicitKeystore)
    : absoluteFrom(projectDir, existingSigning.keystore) || detectedKeystore
  let propertiesPath = explicitProperties
    ? path.resolve(projectDir, explicitProperties)
    : absoluteFrom(projectDir, existingSigning.keystoreProperties) ||
      ((await exists(conventionalProperties)) ? conventionalProperties : '')
  let keyAlias =
    String(options.keyAlias ?? '') ||
    String(existingSigning.keyAlias ?? '') ||
    ((await exists(propertiesPath)) ? await readProperty(propertiesPath, 'keyAlias') : '')
  let outputDir =
    toProjectRelative(projectDir, String(existingProject.outputDir ?? existing.outputDir ?? 'apk')) || 'apk'

  if (explicitKeystore && !(await exists(keystorePath))) {
    throw new PackError(`找不到 --keystore 指定的证书：${keystorePath}`, EXIT.CONFIG)
  }
  if (explicitProperties && !(await exists(propertiesPath))) {
    throw new PackError(`找不到 --keystore-properties 指定的文件：${propertiesPath}`, EXIT.CONFIG)
  }

  if (canPrompt(options)) {
    logger.step('初始化配置')
    logger.info('直接回车保留括号内的默认值；密码不会在这里收集，构建时再提供')
    const prompt = new Prompt()
    const fileValidator = makeFileValidator(projectDir)
    try {
      packageName = await prompt.ask({
        question: 'Android 包名',
        defaultValue: packageName,
        validate: validatePackageName,
      })
      appKey = await prompt.ask({
        question: 'DCloud AppKey（32 位十六进制，留空跳过）',
        defaultValue: appKey,
        validate: validateAppKey,
      })
      keystorePath = await prompt.ask({
        question: '签名证书路径（留空跳过）',
        defaultValue: keystorePath,
        validate: fileValidator,
      })
      keyAlias = await prompt.ask({ question: '签名别名 keyAlias', defaultValue: keyAlias })
      propertiesPath = await prompt.ask({
        question: 'keystore.properties 路径（留空则用环境变量提供密码）',
        defaultValue: propertiesPath,
        validate: fileValidator,
      })
      outputDir = await prompt.ask({
        question: 'APK 输出目录',
        defaultValue: outputDir,
        validate: validateRequired,
      })
      const confirmed = await prompt.ask({ question: '确认写入以上配置？[Y/n]', validate: validateConfirm })
      if (/^n/.test(confirmed)) {
        logger.info('已取消，未写入任何配置')
        return { key, config, cancelled: true }
      }
    } finally {
      prompt.close()
    }
  }

  if (!keyAlias && propertiesPath && (await exists(propertiesPath))) {
    keyAlias = await readProperty(propertiesPath, 'keyAlias')
  }

  const defaultWebBuild = await resolveDefaultWebBuild(type, projectDir)
  const baseWebBuild = existingProject.webBuild ?? existing.webBuild
  const webBuild =
    type === 'hbuilderx'
      ? baseWebBuild?.mode === 'hbuilderx'
        ? baseWebBuild
        : defaultWebBuild
      : (baseWebBuild ?? defaultWebBuild)

  const { projectConfig, userEntry } = splitInitConfig({
    projectDir,
    type: /** @type {'cli' | 'hbuilderx'} */ (type),
    packageName,
    appKey,
    outputDir,
    outputPrefix: String(existingProject.outputPrefix ?? existing.outputPrefix ?? ''),
    webBuild,
    signing: {
      keystore: keystorePath,
      keyAlias,
      keystoreProperties: propertiesPath,
      storePasswordEnv: existingSigning.storePasswordEnv,
      keyPasswordEnv: existingSigning.keyPasswordEnv,
    },
    existingProjectConfig: existingProject,
    existingUserEntry: existing,
    sdkRoot,
    hbuilderxRoot: hbuilderx?.root ?? existing.hbuilderxRoot ?? '',
  })
  userEntry.debug = {
    ...(existing.debug ?? {}),
    launchActivity: existing.debug?.launchActivity ?? 'io.dcloud.PandoraEntry',
  }

  await writeJson(projectConfigFile, projectConfig)
  config.sdk = { ...config.sdk, root: config.sdk.root || sdkRoot }
  config.hbuilderx = { ...config.hbuilderx, root: config.hbuilderx.root || hbuilderx?.root || '' }
  config.android = {
    ...config.android,
    sdkDir: androidSdk || config.android.sdkDir || '',
    jdk: javaHome || config.android.jdk || '',
  }
  config.projects = {
    ...(config.projects ?? {}),
    [key]: userEntry,
  }
  await saveConfig(config)

  logger.step('已写入配置')
  logger.info(`项目配置：${projectConfigFile}`)
  logger.info(`用户配置：${CONFIG_FILE}`)
  logger.info(
    `项目：${key}（${type === 'hbuilderx' ? 'HBuilderX' : 'CLI'}，Vue ${vueVersion}）  ${resolved.appid}`,
  )
  logger.info(`版本：${resolved.versionName}(${resolved.versionCode})，以 manifest.json 为准`)
  logger.info(`包名：${projectConfig.package || '(未配置)'}`)
  logger.info(`AppKey：${projectConfig.appKey ? '已配置' : '(未配置)'}`)
  logger.info(`编译器：${compiler.version ?? '未知'}（${compiler.source}）`)
  logger.info(`离线 SDK：${sdkRoot}（${sdkVersion ?? '版本未知'}）`)
  if (compiler.version && sdkVersion && compiler.version !== sdkVersion) {
    logger.warn(`版本不一致：编译器 ${compiler.version} / 离线 SDK ${sdkVersion}`)
    for (const line of versionMismatchHint({ compiler: compiler.version, sdk: sdkVersion }, { type }).split('\n')) {
      logger.warn(line.trim())
    }
  }
  if (type === 'hbuilderx') {
    logger.info(`HBuilderX：${hbuilderx?.root || '(未找到)'}`)
  }
  logger.info(`Android SDK：${androidSdk || '(未找到)'}`)
  logger.info(`JDK：${javaHome || '(未找到，构建时用 JAVA_HOME)'}`)
  logger.info(`输出：${path.resolve(projectDir, String(projectConfig.outputDir))}`)
  logger.info(`证书：${projectConfig.signing.keystore || '(未配置，构建会失败)'}`)
  if (projectConfig.signing.keystoreProperties) {
    logger.info(`密码文件：${projectConfig.signing.keystoreProperties}`)
  }
  if (!projectConfig.package) {
    logger.warn('未配置包名：请在 manifest.json 的 app-plus.distribute.android.packagename 填写，或重跑 init 时加 --package')
  }
  if (!projectConfig.appKey) {
    logger.warn('未填写 DCloud AppKey，请在项目配置 appKey 字段补齐（后台按 appid + 包名 + 证书 SHA1 绑定）')
  }
  if (projectConfig.signing.keystore && !projectConfig.signing.keyAlias) {
    logger.warn('未配置签名别名 keyAlias：构建会失败，可在 keystore.properties 里补 keyAlias')
  }
  if (
    projectConfig.signing.keystore &&
    !projectConfig.signing.keystoreProperties &&
    !hasSigningEnv(projectConfig.signing)
  ) {
    logger.warn(
      `未配置密码来源：提供 keystore.properties，或设置环境变量 ${projectConfig.signing.storePasswordEnv} / ${projectConfig.signing.keyPasswordEnv}，或构建时传 --store-password/--key-password`,
    )
  }
  if (type === 'hbuilderx' && !hbuilderx) {
    logger.warn('未找到 HBuilderX：构建时无法编译源码，请用 --hbuilderx <目录> 指定或设置 HBUILDERX_HOME')
  }
  if (!androidSdk) {
    logger.warn('未找到 Android SDK：设置环境变量 ANDROID_HOME，或执行 uni-pack init --android-sdk <目录>')
  }
  if (!javaHome) {
    logger.warn('未找到 JDK：设置环境变量 JAVA_HOME 指向 JDK 17+')
  }
  logger.info(`下一步：uni-pack doctor -p "${projectDir}"`)

  return { key, config, projectConfig }
}

/**
 * 项目名可能是中文，退化成空串时依次用包名、appid 兜底，避免多个项目共用同一个 key。
 * @param {{ name: string, packageName: string, appid: string }} resolved
 */
function projectKey(resolved) {
  return (
    [resolved.name, resolved.packageName, resolved.appid]
      .map((value) => String(value ?? '').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, ''))
      .find(Boolean) ?? 'app'
  )
}

/**
 * @param {string} projectDir
 * @param {string} value
 * @returns {string}
 */
function absoluteFrom(projectDir, value) {
  const text = String(value ?? '').trim()
  if (!text) {
    return ''
  }
  return path.isAbsolute(text) ? text : path.resolve(projectDir, text)
}

/**
 * @param {{ storePasswordEnv?: string, keyPasswordEnv?: string }} signing
 * @returns {boolean}
 */
function hasSigningEnv(signing) {
  const names = [signing.storePasswordEnv, signing.keyPasswordEnv].filter(Boolean)
  return names.some((name) => Boolean(process.env[String(name)]))
}

/**
 * @param {Object} options
 * @param {any} options.config
 * @param {string} [options.explicit]
 * @param {string} [options.existingRoot]
 * @param {string | null} [options.version]
 * @returns {Promise<string>}
 */
async function resolveSdkRoot(options) {
  const explicit = String(options.explicit ?? '').trim()
  if (explicit) {
    const root = await resolveSdkRootInput(explicit)
    if (!root) {
      throw new PackError(`离线 SDK 路径无效：${explicit}`, EXIT.PREFLIGHT, {
        hint: '--sdk 应指向包含 HBuilder-Integrate-AS 的 Android-SDK@x.yy 目录',
      })
    }
    return root
  }

  const configured = [options.existingRoot, options.config.sdk?.root, process.env.UNI_SDK_ROOT]
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
  for (const candidate of configured) {
    const root = await resolveSdkRootInput(candidate)
    if (root) {
      const version = await readSdkVersion(root)
      if (!options.version || !version || version === options.version) {
        return root
      }
    }
  }

  if (options.version) {
    const matched = await findSdkForVersion(options.config, options.version)
    if (matched) {
      return matched
    }
  }

  for (const candidate of [options.config.sdk?.root, process.env.UNI_SDK_ROOT]) {
    const root = await resolveSdkRootInput(String(candidate ?? ''))
    if (root) {
      return root
    }
  }

  throw new PackError('未找到 DCloud Android 离线 SDK', EXIT.PREFLIGHT, {
    hint: [
      '任选一种方式指定：',
      '  1) uni-pack init -p <项目> --sdk <含 HBuilder-Integrate-AS 的目录>',
      '  2) 设置环境变量 UNI_SDK_ROOT=<目录>',
      `  3) 在 ${CONFIG_FILE} 里填写 sdk.root`,
    ].join('\n'),
  })
}

/**
 * @param {string | undefined} explicit
 */
async function resolveAndroidSdk(explicit) {
  const candidates = [
    explicit,
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    'C:/develop/android-sdk',
  ]
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (value && (await exists(value))) {
      return path.resolve(value)
    }
  }
  return ''
}

/**
 * @param {string | undefined} explicit
 */
async function resolveJdk(explicit) {
  const candidates = [
    explicit,
    process.env.JAVA_HOME,
    'C:/Program Files/Java/jdk-21',
    'C:/Program Files/Java/jdk-17',
  ]
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (!value) {
      continue
    }
    const java = path.join(value, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    if (await exists(java)) {
      return path.resolve(value)
    }
  }
  return ''
}

/**
 * @param {string} dir
 */
async function detectKeystore(dir) {
  const { readdir } = await import('node:fs/promises')
  if (!(await exists(dir))) {
    return ''
  }
  const entries = await readdir(dir)
  const keystore = entries.find((entry) => entry.endsWith('.keystore') || entry.endsWith('.jks'))
  return keystore ? path.join(dir, keystore) : ''
}

/**
 * @param {string} file
 * @param {string} key
 */
async function readProperty(file, key) {
  const text = await readText(file)
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm').exec(text)
  return match?.[1]?.trim() ?? ''
}
