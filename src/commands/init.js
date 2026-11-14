import path from 'node:path'
import { CONFIG_FILE, loadConfig, saveConfig } from '../core/config.js'
import { PackError, EXIT } from '../core/errors.js'
import { exists, readText } from '../core/fsx.js'
import { resolveHbuilderx } from '../core/hbuilderx.js'
import { Logger } from '../core/logger.js'
import { normalizeManifest, readProjectManifest, readProjectPackage } from '../core/project.js'
import { findSdkForVersion, resolveSdkRootInput } from '../core/sdk.js'
import { readCompilerVersion, readSdkVersion } from '../core/version.js'

// 这些字段以 manifest 为准；旧配置里的快照会在重跑 init 时清掉。
const SNAPSHOT_FIELDS = [
  'name',
  'appid',
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

  const { manifest, type } = await readProjectManifest(projectDir)
  const fallbackPackage = String(options.package ?? '') || (await readProjectPackage(projectDir))
  const resolved = normalizeManifest(manifest, { package: fallbackPackage }, { validate: false })
  const key = projectKey(resolved)
  const existing = config.projects?.[key] ?? {}

  const hbuilderx = type === 'hbuilderx' ? await resolveHbuilderx(config, { projectDir, explicit: options.hbuilderx }) : null
  const compiler = await readCompilerVersion({ ...existing, type, projectDir }, { hbuilderxRoot: hbuilderx?.root })

  const sdkRoot = await resolveSdkRoot({
    config,
    explicit: options.sdk,
    existingRoot: existing.sdkRoot,
    version: compiler.version,
  })
  const sdkVersion = await readSdkVersion(sdkRoot)
  const androidSdk = await resolveAndroidSdk(options.androidSdk ?? config.android.sdkDir)
  const javaHome = await resolveJdk(options.jdk ?? config.android.jdk)
  const certificateDir = path.join(projectDir, 'certificate/android')
  const properties = path.join(certificateDir, 'keystore.properties')
  const keystore =
    options.keystore ||
    (await detectKeystore(certificateDir)) ||
    String(existing.signing?.keystore ?? '')
  const alias = (await exists(properties)) ? await readProperty(properties, 'keyAlias') : ''
  config.sdk = { ...config.sdk, root: config.sdk.root || sdkRoot }
  config.hbuilderx = { ...config.hbuilderx, root: config.hbuilderx.root || hbuilderx?.root || '' }
  config.android = {
    ...config.android,
    sdkDir: androidSdk || config.android.sdkDir || '',
    jdk: javaHome || config.android.jdk || '',
  }
  const next = { ...existing }
  for (const field of SNAPSHOT_FIELDS) {
    delete next[field]
  }
  const webBuild =
    type === 'hbuilderx'
      ? existing.webBuild?.mode === 'hbuilderx'
        ? existing.webBuild
        : { mode: 'hbuilderx', outputDir: 'unpackage/dist/build/app-plus' }
      : (existing.webBuild ?? {
          command: 'pnpm',
          args: ['run', 'build:app-android'],
          outputDir: 'dist/build/app',
        })

  config.projects = {
    ...(config.projects ?? {}),
    [key]: {
      ...next,
      projectDir,
      type,
      sdkRoot,
      hbuilderxRoot: hbuilderx?.root ?? existing.hbuilderxRoot ?? '',
      package: fallbackPackage || resolved.packageName || existing.package || '',
      appKey: options.appkey ?? existing.appKey ?? '',
      outputDir: existing.outputDir ?? path.join(projectDir, 'apk'),
      webBuild,
      signing: {
        ...(existing.signing ?? {}),
        keystore,
        keyAlias: options.keyAlias || alias || existing.signing?.keyAlias || 'key0',
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
  logger.info(`项目：${key}（${type === 'hbuilderx' ? 'HBuilderX' : 'CLI'}）  ${resolved.appid}  ${resolved.packageName || '(未配置包名)'}`)
  logger.info(`版本：${resolved.versionName}(${resolved.versionCode})，以 manifest.json 为准`)
  logger.info(`编译器：${compiler.version ?? '未知'}（${compiler.source}）`)
  logger.info(`离线 SDK：${sdkRoot}（${sdkVersion ?? '版本未知'}）`)
  if (type === 'hbuilderx') {
    logger.info(`HBuilderX：${hbuilderx?.root || '(未找到)'}`)
  }
  logger.info(`Android SDK：${androidSdk || '(未找到)'}`)
  logger.info(`JDK：${javaHome || '(未找到，构建时用 JAVA_HOME)'}`)
  logger.info(`输出：${config.projects[key].outputDir}`)
  logger.info(`证书：${keystore || '(未找到，请手工填写 signing.keystore)'}`)
  if (!config.projects[key].package) {
    logger.warn('未配置包名：请在 manifest.json 的 app-plus.distribute.android.packagename 填写，或重跑 init 时加 --package')
  }
  if (!config.projects[key].appKey) {
    logger.warn('未填写 DCloud AppKey，请在配置的 appKey 字段补齐（后台按 appid + 包名 + 证书 SHA1 绑定）')
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
