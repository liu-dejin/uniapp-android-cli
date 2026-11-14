import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { exists } from './fsx.js'
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
 * @param {any} config
 */
export async function resolveSdk(config) {
  const root = path.resolve(String(config.sdk?.root ?? ''))
  if (!config.sdk?.root) {
    throw new PackError('未配置离线 SDK 路径（sdk.root）', EXIT.PREFLIGHT, {
      hint: '运行 uni-pack init，或手工填写 ~/.uniapp-android-cli/config.json',
    })
  }

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
 */
export async function resolveAndroidTools(config) {
  const sdkDir = path.resolve(String(config.android?.sdkDir ?? ''))
  if (!config.android?.sdkDir) {
    throw new PackError('未配置 Android SDK 路径（android.sdkDir）', EXIT.PREFLIGHT)
  }

  const buildToolsDir = path.join(sdkDir, 'build-tools', String(config.android?.buildTools ?? '35.0.0'))
  const suffix = process.platform === 'win32' ? '.bat' : ''
  const apksigner = path.join(buildToolsDir, `apksigner${suffix}`)
  const zipalign = path.join(buildToolsDir, `zipalign${process.platform === 'win32' ? '.exe' : ''}`)
  const adb = path.join(sdkDir, 'platform-tools', `adb${process.platform === 'win32' ? '.exe' : ''}`)
  const keytool = await resolveKeytool(config)

  if (!(await exists(apksigner))) {
    throw new PackError(`找不到 apksigner：${apksigner}`, EXIT.PREFLIGHT)
  }

  return { sdkDir, buildToolsDir, apksigner, zipalign, adb, keytool }
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
