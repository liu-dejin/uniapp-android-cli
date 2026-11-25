import os from 'node:os'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { PackError, EXIT } from './errors.js'
import { exists, readText } from './fsx.js'
import { run } from './process.js'

/** 基础 AAR：与当前线上可运行的自定义基座保持一致 */
export const BASE_AARS = [
  'android-gif-drawable-1.2.29.aar',
  'audio-mp3aac-release.aar',
  'breakpad-build-release.aar',
  'lib.5plus.base-release.aar',
  'msa_mdid_1.0.13.aar',
  'uni-chooseMedia-release.aar',
  'uni-createRequestPermissionListener-release.aar',
  'uni-exit-release.aar',
  'uni-getAccessibilityInfo-release.aar',
  'uni-getAppAuthorizeSetting-release.aar',
  'uni-getAppBaseInfo-release.aar',
  'uni-getDeviceInfo-release.aar',
  'uni-getNetworkType-release.aar',
  'uni-getSystemInfo-release.aar',
  'uni-getSystemSetting-release.aar',
  'uni-installApk-release.aar',
  'uni-network-release.aar',
  'uni-openAppAuthorizeSetting-release.aar',
  'uni-prompt-release.aar',
  'uni-storage-release.aar',
  'uniapp-v8-release.aar',
]

export const DEBUG_AAR = 'debug-server-release.aar'

/**
 * manifest.json 的 app-plus.modules 与 SDK/libs 里的 AAR 不是一一对应，常见的做映射，
 * 认不出的模块给出提示而不是直接失败（很多模块已经并进核心 AAR）。
 */
export const MODULE_AARS = {
  Barcode: ['barcode-release.aar'],
  Bluetooth: ['Bluetooth-release.aar'],
  Camera: ['media-release.aar'],
  VideoPlayer: ['media-release.aar', 'weex_videoplayer-release.aar'],
  Audio: ['audio-mp3aac-release.aar'],
  Speech: ['speech-release.aar'],
  Fingerprint: ['fingerprint-release.aar'],
  Contacts: ['contacts-release.aar'],
  Messaging: ['messaging-release.aar'],
  iBeacon: ['iBeacon-release.aar'],
  Share: ['share-weixin-release.aar', 'share-qq-release.aar', 'share-sina-release.aar'],
  Payment: ['payment-weixin-release.aar', 'payment-alipay-release.aar'],
  OAuth: ['oauth-weixin-release.aar', 'oauth-qq-release.aar', 'oauth-sina-release.aar'],
  Statistic: ['statistic-release.aar'],
}

/**
 * 接受用户可能给的各种层级：SDK 根、解压出来的归档根，甚至 HBuilder-Integrate-AS 本身。
 * @param {string} input
 * @returns {Promise<string>} 含 HBuilder-Integrate-AS 的目录；找不到返回空串
 */
export async function resolveSdkRootInput(input) {
  const value = String(input ?? '').trim()
  if (!value) {
    return ''
  }
  const root = path.resolve(value)
  if (path.basename(root) === 'HBuilder-Integrate-AS') {
    return path.dirname(root)
  }
  if (await exists(path.join(root, 'HBuilder-Integrate-AS'))) {
    return root
  }
  const nested = path.join(root, path.basename(root))
  if (await exists(path.join(nested, 'HBuilder-Integrate-AS'))) {
    return nested
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('Android-SDK@'))
    .map((entry) => path.join(root, entry.name))
    .sort()
    .reverse()
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, 'HBuilder-Integrate-AS'))) {
      return candidate
    }
    const deep = path.join(candidate, path.basename(candidate))
    if (await exists(path.join(deep, 'HBuilder-Integrate-AS'))) {
      return deep
    }
  }
  return ''
}

/**
 * 解析离线 SDK。显式配置优先；没有显式配置时按项目的编译器版本在已安装的 Android-SDK@x.yy 里找。
 * @param {any} config
 * @param {{ project?: any, version?: string, searchDirs?: string[] }} [options]
 */
export async function resolveSdk(config, options = {}) {
  const explicit = [options.project?.sdkRoot, config.sdk?.root, process.env.UNI_SDK_ROOT]
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)

  let invalid = ''
  for (const candidate of explicit) {
    const root = await resolveSdkRootInput(candidate)
    if (root) {
      return validateSdkRoot(root, config)
    }
    invalid = candidate
  }

  const version = String(options.version ?? '').trim()
  if (version) {
    const matched = await findSdkForVersion(config, version, options.searchDirs)
    if (matched) {
      return validateSdkRoot(matched, config)
    }
    if (invalid) {
      throw new PackError(`离线 SDK 路径无效：${invalid}`, EXIT.PREFLIGHT, {
        hint: `未找到与 uni-app ${version} 匹配的其他 SDK；--sdk / sdk.root 应指向包含 HBuilder-Integrate-AS 的 Android-SDK@x.yy 目录`,
      })
    }
    const installed = await listInstalledSdks(config, options.searchDirs)
    throw new PackError(`未找到与 uni-app ${version} 匹配的离线 SDK`, EXIT.PREFLIGHT, {
      hint: [
        `已安装的 SDK：${installed.map((item) => item.version).join(', ') || '(未扫描到)'}`,
        `请下载 Android-SDK@${version} 放到 ${defaultSdkDirs(config).join(' 或 ')}，`,
        '或在配置里指定该项目的 sdkRoot / sdk.root',
      ].join('\n'),
    })
  }

  if (invalid) {
    throw new PackError(`离线 SDK 路径无效：${invalid}`, EXIT.PREFLIGHT, {
      hint: 'UNI_SDK_ROOT / --sdk 应指向包含 HBuilder-Integrate-AS 的 Android-SDK@x.yy 目录',
    })
  }

  throw new PackError('未配置离线 SDK 路径（sdk.root）', EXIT.PREFLIGHT, {
    hint: '运行 uni-pack init --sdk <目录>，或设置环境变量 UNI_SDK_ROOT，或手工填写 ~/.uniapp-android-cli/config.json',
  })
}

/**
 * @param {string} root
 * @param {any} config
 */
async function validateSdkRoot(root, config) {
  const templateRoot = path.join(root, String(config.sdk?.template ?? 'HBuilder-Integrate-AS'))
  const moduleDir = path.join(templateRoot, 'simpleDemo')
  const libsDir = path.join(root, String(config.sdk?.libsDir ?? 'SDK/libs'))
  const dataDir = path.join(root, String(config.sdk?.dataDir ?? 'SDK/assets/data'))

  const required = [
    path.join(libsDir, 'lib.5plus.base-release.aar'),
    path.join(moduleDir, 'build.gradle'),
    path.join(moduleDir, 'src/main/AndroidManifest.xml'),
    path.join(dataDir, 'dcloud_control.xml'),
  ]
  const missing = []
  for (const item of required) {
    if (!(await exists(item))) {
      missing.push(item)
    }
  }
  if (missing.length > 0) {
    throw new PackError(`离线 SDK 不完整，缺少：\n${missing.join('\n')}`, EXIT.PREFLIGHT)
  }

  const gradlew = path.join(templateRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  if (!(await exists(gradlew))) {
    throw new PackError(`找不到 ${gradlew}`, EXIT.PREFLIGHT)
  }

  return { root, templateRoot, moduleDir, libsDir, dataDir, gradlew }
}

/**
 * @param {any} config
 * @param {string[]} [extraDirs]
 * @returns {string[]}
 */
function defaultSdkDirs(config, extraDirs = []) {
  return [
    ...extraDirs,
    ...(config?.sdk?.searchDirs ?? []),
    config?.sdk?.root ? path.dirname(path.resolve(String(config.sdk.root))) : '',
    ...String(process.env.UNI_SDK_DIRS ?? '').split(path.delimiter),
    'C:/develop/android-sdk/uniapp-Android',
    path.join(os.homedir(), 'android-sdk', 'uniapp-Android'),
  ].filter((item) => typeof item === 'string' && item.trim())
}

/**
 * 扫描 Android-SDK@x.yy 目录。解压后常见一层同名嵌套，交给 resolveSdkRootInput 处理。
 * @param {any} config
 * @param {string[]} [extraDirs]
 * @returns {Promise<Array<{ version: string, root: string, name: string }>>}
 */
export async function listInstalledSdks(config, extraDirs = []) {
  /** @type {Array<{ version: string, root: string, name: string }>} */
  const found = []
  const seen = new Set()
  for (const dir of defaultSdkDirs(config, extraDirs)) {
    const entries = await readdir(path.resolve(dir), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      const match = /^Android-SDK@(\d+\.\d+)\./i.exec(entry.name)
      if (!match) {
        continue
      }
      const root = await resolveSdkRootInput(path.join(dir, entry.name))
      if (!root) {
        continue
      }
      const key = root.toLowerCase()
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      found.push({ version: match[1], root, name: entry.name })
    }
  }
  return found.sort((a, b) => b.name.localeCompare(a.name))
}

/**
 * @param {any} config
 * @param {string} version
 * @param {string[]} [extraDirs]
 * @returns {Promise<string>}
 */
export async function findSdkForVersion(config, version, extraDirs = []) {
  const installed = await listInstalledSdks(config, extraDirs)
  return installed.find((item) => item.version === version)?.root ?? ''
}

/**
 * 老版本 SDK 的 compileSdk/buildTools 与新版不同，优先沿用 SDK 自带的模板值。
 * Kotlin 版本同样以模板声明为准；模板没写 kotlin-gradle-plugin 时返回空，由调用方兜底。
 * @param {string} templateRoot
 * @returns {Promise<{ compileSdkVersion?: number, buildToolsVersion?: string, kotlinVersion?: string }>}
 */
export async function readTemplateDefaults(templateRoot) {
  const file = path.join(templateRoot, 'simpleDemo', 'build.gradle')
  if (!(await exists(file))) {
    return {}
  }
  const text = await readText(file)
  const compileSdk = Number(/compileSdkVersion\s+(\d+)/.exec(text)?.[1])
  const buildTools = /buildToolsVersion\s+'([^']+)'/.exec(text)?.[1]
  const rootFile = path.join(templateRoot, 'build.gradle')
  const rootText = (await exists(rootFile)) ? await readText(rootFile) : ''
  const kotlinVersion = /kotlin-gradle-plugin:([0-9][\w.-]*)/.exec(rootText)?.[1]
  return {
    compileSdkVersion: Number.isFinite(compileSdk) ? compileSdk : undefined,
    buildToolsVersion: buildTools || undefined,
    kotlinVersion: kotlinVersion || undefined,
  }
}

/**
 * @param {string} sdkDir
 * @returns {Promise<string[]>}
 */
async function listBuildTools(sdkDir) {
  const dir = path.join(sdkDir, 'build-tools')
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => compareDotted(b, a))
}

/**
 * @param {string} a
 * @param {string} b
 */
function compareDotted(a, b) {
  const left = a.split(/[.-]/).map(Number)
  const right = b.split(/[.-]/).map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0)
    if (diff !== 0) {
      return diff
    }
  }
  return a.localeCompare(b)
}

/**
 * @param {any} config
 * @returns {string}
 */
function resolveAndroidSdkDir(config) {
  const configured = String(config.android?.sdkDir ?? '').trim()
  const candidate = configured || String(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '').trim()
  if (!candidate) {
    throw new PackError('未配置 Android SDK 路径（android.sdkDir）', EXIT.PREFLIGHT, {
      hint: '运行 uni-pack init --android-sdk <目录>，或设置环境变量 ANDROID_HOME',
    })
  }
  return path.resolve(candidate)
}

/**
 * 只依赖 adb 的命令（设备列表/配对）不需要 JDK 与 build-tools。
 * @param {any} config
 * @returns {Promise<string>}
 */
export async function resolveAdbPath(config) {
  const adb = path.join(
    resolveAndroidSdkDir(config),
    'platform-tools',
    `adb${process.platform === 'win32' ? '.exe' : ''}`,
  )
  if (!(await exists(adb))) {
    throw new PackError(`找不到 adb：${adb}`, EXIT.PREFLIGHT, {
      hint: '在 Android SDK Manager 里安装 Platform-Tools',
    })
  }
  return adb
}

/**
 * @param {any} config
 * @param {{ preferredBuildTools?: string }} [options]
 */
export async function resolveAndroidTools(config, options = {}) {
  const sdkDir = resolveAndroidSdkDir(config)

  const installed = await listBuildTools(sdkDir)
  const wanted = [
    String(config.android?.buildTools ?? '').trim(),
    String(options.preferredBuildTools ?? '').trim(),
  ].filter(Boolean)
  const buildTools = wanted.find((item) => installed.includes(item)) ?? installed[0]
  if (!buildTools) {
    throw new PackError(`Android SDK 下没有 build-tools：${path.join(sdkDir, 'build-tools')}`, EXIT.PREFLIGHT)
  }

  const buildToolsDir = path.join(sdkDir, 'build-tools', buildTools)
  const suffix = process.platform === 'win32' ? '.bat' : ''
  const apksigner = path.join(buildToolsDir, `apksigner${suffix}`)
  const zipalign = path.join(buildToolsDir, `zipalign${process.platform === 'win32' ? '.exe' : ''}`)
  const adb = path.join(sdkDir, 'platform-tools', `adb${process.platform === 'win32' ? '.exe' : ''}`)
  const keytool = await resolveKeytool(config)

  if (!(await exists(apksigner))) {
    throw new PackError(`找不到 apksigner：${apksigner}`, EXIT.PREFLIGHT)
  }

  return { sdkDir, buildTools, buildToolsDir, apksigner, zipalign, adb, keytool }
}

/**
 * @param {any} config
 * @returns {Promise<string>}
 */
export async function resolveJavaHome(config) {
  const candidates = [
    config.android?.jdk,
    process.env.JAVA_HOME,
    'C:/Program Files/Java/jdk-21',
    'C:/Program Files/Java/jdk-17',
  ].filter((item) => typeof item === 'string' && item.length > 0)

  for (const candidate of candidates) {
    const java = path.join(String(candidate), 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    if (await exists(java)) {
      return String(candidate)
    }
  }
  throw new PackError('找不到 JDK，请在配置里填写 android.jdk 或设置 JAVA_HOME', EXIT.PREFLIGHT)
}

/**
 * @param {any} config
 * @returns {Promise<string>}
 */
async function resolveKeytool(config) {
  const javaHome = await resolveJavaHome(config)
  return path.join(javaHome, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool')
}

/**
 * @param {string} keytool
 * @param {string} keystore
 * @param {string} storePassword
 * @param {string} alias
 */
export async function readKeystoreFingerprint(keytool, keystore, storePassword, alias) {
  const { stdout } = await run(keytool, ['-list', '-v', '-keystore', keystore, '-storepass', storePassword, '-alias', alias], {
    allowFailure: false,
  })
  const sha1 = /SHA1:\s*([0-9A-F:]+)/i.exec(stdout)?.[1] ?? ''
  const sha256 = /SHA256:\s*([0-9A-F:]+)/i.exec(stdout)?.[1] ?? ''
  return { sha1, sha256, raw: stdout }
}
