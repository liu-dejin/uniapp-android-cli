import path from 'node:path'
import { CONFIG_FILE, loadConfig, saveConfig } from '../core/config.js'
import { PackError, EXIT } from '../core/errors.js'
import { exists, readText } from '../core/fsx.js'
import { Logger } from '../core/logger.js'
import { normalizeManifest, readProjectManifest } from '../core/project.js'
import { resolveSdkRootInput } from '../core/sdk.js'

// 这些字段以 manifest 为准；旧配置里的快照会在重跑 init 时清掉。
const SNAPSHOT_FIELDS = [
  'name',
  'appid',
  'package',
  'versionName',
  'versionCode',
  'minSdkVersion',
  'targetSdkVersion',
  'abiFilters',
]

/**
 * @param {Record<string, any>} options
 */
export async function initCommand(options) {
  const logger = new Logger(options)
  const projectDir = path.resolve(options.project ?? options.cwd ?? process.cwd())
  const config = await loadConfig()

  const { manifest } = await readProjectManifest(projectDir)
  const resolved = normalizeManifest(manifest)
  const key = projectKey(resolved)
  const existing = config.projects?.[key] ?? {}

  const sdkRoot = await resolveSdkRoot(options.sdk ?? config.sdk.root)
  const androidSdk = await resolveAndroidSdk(options.androidSdk ?? config.android.sdkDir)
  const javaHome = await resolveJdk(options.jdk ?? config.android.jdk)
  const certificateDir = path.join(projectDir, 'certificate/android')
  const properties = path.join(certificateDir, 'keystore.properties')
  const keystore =
    options.keystore ||
    (await detectKeystore(certificateDir)) ||
    String(existing.signing?.keystore ?? '')
  const alias = (await exists(properties)) ? await readProperty(properties, 'keyAlias') : ''

  config.sdk = { ...config.sdk, root: sdkRoot }
  config.android = {
    ...config.android,
    sdkDir: androidSdk || config.android.sdkDir || '',
    jdk: javaHome || config.android.jdk || '',
  }
  const next = { ...existing }
  for (const field of SNAPSHOT_FIELDS) {
    delete next[field]
  }
  config.projects = {
    ...(config.projects ?? {}),
    [key]: {
      ...next,
      projectDir,
      appKey: options.appkey ?? existing.appKey ?? '',
      outputDir: existing.outputDir ?? path.join(projectDir, 'apk'),
      webBuild: existing.webBuild ?? {
        command: 'pnpm',
        args: ['run', 'build:app-android'],
        outputDir: 'dist/build/app',
      },
      signing: {
        ...(existing.signing ?? {}),
        keystore,
        keyAlias: alias || existing.signing?.keyAlias || 'key0',
        keystoreProperties: (await exists(properties))
          ? properties
          : (existing.signing?.keystoreProperties ?? ''),
        storePasswordEnv: existing.signing?.storePasswordEnv ?? 'UNI_PACK_STORE_PASS',
        keyPasswordEnv: existing.signing?.keyPasswordEnv ?? 'UNI_PACK_KEY_PASS',
      },
      debug: {
        ...(existing.debug ?? {}),
        launchActivity: existing.debug?.launchActivity ?? 'io.dcloud.PandoraEntry',
      },
    },
  }

  await saveConfig(config)

  logger.step('已写入配置')
  logger.info(CONFIG_FILE)
  logger.info(`项目：${key}  ${resolved.appid}  ${resolved.packageName}`)
  logger.info(`版本：${resolved.versionName}(${resolved.versionCode})，以 manifest.json 为准`)
  logger.info(`离线 SDK：${sdkRoot}`)
  logger.info(`Android SDK：${androidSdk || '(未找到)'}`)
  logger.info(`JDK：${javaHome || '(未找到，构建时用 JAVA_HOME)'}`)
  logger.info(`输出：${config.projects[key].outputDir}`)
  logger.info(`证书：${keystore || '(未找到，请手工填写 signing.keystore)'}`)
  if (!config.projects[key].appKey) {
    logger.warn('未填写 DCloud AppKey，请在配置的 appKey 字段补齐（后台按 appid + 包名 + 证书 SHA1 绑定）')
  }
  if (!androidSdk) {
    logger.warn('未找到 Android SDK：设置环境变量 ANDROID_HOME，或执行 uni-pack init --android-sdk <目录>')
  }
  if (!javaHome) {
    logger.warn('未找到 JDK：设置环境变量 JAVA_HOME 指向 JDK 17+')
  }
  logger.info(`下一步：uni-pack doctor -p "${projectDir}"`)

  return { key, config }
}

/**
 * 项目名可能是中文，退化成空串时依次用包名、appid 兜底，避免多个项目共用同一个 key。
 * @param {{ name: string, packageName: string, appid: string }} resolved
 */
function projectKey(resolved) {
  return [resolved.name, resolved.packageName, resolved.appid]
    .map((value) => String(value ?? '').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, ''))
    .find(Boolean) ?? 'app'
}

/**
 * @param {string | undefined} explicit
 */
async function resolveSdkRoot(explicit) {
  const candidates = [explicit, process.env.UNI_SDK_ROOT, 'C:/develop/android-sdk/uniapp-Android']
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (!value) {
      continue
    }
    const root = await resolveSdkRootInput(value)
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
