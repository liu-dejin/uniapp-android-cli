import path from 'node:path'
import { CONFIG_FILE, defaultConfig, loadConfig, saveConfig } from '../core/config.js'
import { exists, readJson, readText } from '../core/fsx.js'
import { Logger } from '../core/logger.js'
import { normalizeManifest, readProjectManifest } from '../core/project.js'

/**
 * @param {Record<string, any>} options
 */
export async function initCommand(options) {
  const logger = new Logger(options)
  const projectDir = path.resolve(options.project ?? options.cwd ?? process.cwd())
  const config = { ...defaultConfig(), ...(await loadConfig()) }

  const { manifest } = await readProjectManifest(projectDir)
  const resolved = normalizeManifest(manifest)

  const sdkRoot = options.sdk || config.sdk.root || (await detectSdkRoot())
  const androidSdk = config.android.sdkDir || (await detectAndroidSdk())
  const certificateDir = path.join(projectDir, 'certificate/android')
  const keystore = options.keystore || (await detectKeystore(certificateDir))
  const properties = path.join(certificateDir, 'keystore.properties')
  const alias = (await exists(properties)) ? await readProperty(properties, 'keyAlias') : ''

  const key = resolved.name.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'app'
  config.sdk.root = sdkRoot
  config.android.sdkDir = androidSdk
  config.outputDir = path.join(projectDir, 'apk')
  config.projects = {
    ...(config.projects ?? {}),
    [key]: {
      projectDir,
      name: resolved.name,
      appid: resolved.appid,
      package: resolved.packageName,
      appKey: options.appkey ?? config.projects?.[key]?.appKey ?? '',
      versionName: resolved.versionName,
      versionCode: resolved.versionCode,
      minSdkVersion: resolved.minSdkVersion,
      targetSdkVersion: resolved.targetSdkVersion,
      abiFilters: resolved.abiFilters,
      webBuild: { command: 'pnpm', args: ['run', 'build:app-android'], outputDir: 'dist/build/app' },
      signing: {
        keystore,
        keyAlias: alias || 'key0',
        keystoreProperties: (await exists(properties)) ? properties : '',
        storePasswordEnv: 'UNI_PACK_STORE_PASS',
        keyPasswordEnv: 'UNI_PACK_KEY_PASS',
      },
      debug: { port: 8787, launchActivity: 'io.dcloud.PandoraEntry' },
    },
  }

  await saveConfig(config)

  logger.step('已写入配置')
  logger.info(CONFIG_FILE)
  logger.info(`项目：${key}  ${resolved.appid}  ${resolved.packageName}`)
  logger.info(`离线 SDK：${sdkRoot}`)
  logger.info(`Android SDK：${androidSdk}`)
  logger.info(`证书：${keystore || '(未找到，请手工填写 signing.keystore)'}`)
  if (!config.projects[key].appKey) {
    logger.warn('未填写 DCloud AppKey，请在配置的 appKey 字段补齐（后台按 appid + 包名 + 证书 SHA1 绑定）')
  }
  logger.info('下一步：uni-pack doctor --project .')

  return { key, config }
}

async function detectSdkRoot() {
  if (process.env.UNI_SDK_ROOT) {
    return process.env.UNI_SDK_ROOT
  }
  const base = 'C:/develop/android-sdk/uniapp-Android'
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('Android-SDK@'))
    .map((entry) => path.join(base, entry.name))
    .sort()
  const latest = candidates.at(-1)
  if (!latest) {
    throw new Error('未找到离线 SDK，请设置 UNI_SDK_ROOT 或在配置里填写 sdk.root')
  }
  const nested = path.join(latest, path.basename(latest))
  return (await exists(path.join(nested, 'HBuilder-Integrate-AS'))) ? nested : latest
}

async function detectAndroidSdk() {
  if (process.env.ANDROID_HOME) {
    return process.env.ANDROID_HOME
  }
  const candidate = 'C:/develop/android-sdk'
  return (await exists(candidate)) ? candidate : ''
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

/**
 * @param {string} file
 */
export async function readJsonFile(file) {
  return readJson(file)
}
