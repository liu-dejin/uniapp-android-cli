import path from 'node:path'
import { loadConfig, resolveProject } from '../core/config.js'
import { exists, readJson } from '../core/fsx.js'
import { Logger } from '../core/logger.js'
import { normalizeManifest, readProjectManifest } from '../core/project.js'
import { listDevices } from '../core/adb.js'
import { resolveAndroidTools, resolveJavaHome, resolveSdk } from '../core/sdk.js'
import { resolveSigning } from '../core/signing.js'
import { assertVersionMatch, readProjectCompilerVersion, readSdkVersion } from '../core/version.js'

/**
 * @param {Record<string, any>} options
 */
export async function doctorCommand(options) {
  const logger = new Logger(options)
  /** @type {{ name: string, ok: boolean, detail: string }[]} */
  const checks = []

  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail })
    if (ok) {
      logger.success(`${name}：${detail}`)
    } else {
      logger.warn(`${name}：${detail}`)
    }
  }

  const [major] = process.versions.node.split('.').map(Number)
  add('Node', major >= 20, process.versions.node)

  const config = await loadConfig()

  let sdkRoot = ''
  try {
    const sdk = await resolveSdk(config)
    sdkRoot = sdk.root
    add('离线 SDK', true, sdk.root)
  } catch (error) {
    add('离线 SDK', false, error instanceof Error ? error.message : String(error))
  }

  try {
    const tools = await resolveAndroidTools(config)
    add('Android SDK', true, tools.sdkDir)
    const devices = await listDevices(tools.adb)
    const online = devices.filter((device) => device.state === 'device')
    add('ADB 设备', online.length > 0, online.map((device) => `${device.model || 'device'}(${device.serial})`).join(', ') || '未连接')
  } catch (error) {
    add('Android SDK', false, error instanceof Error ? error.message : String(error))
  }

  try {
    const javaHome = await resolveJavaHome(config)
    add('JDK', true, javaHome)
  } catch (error) {
    add('JDK', false, error instanceof Error ? error.message : String(error))
  }

  try {
    const { project } = await resolveProject(config, options.project, options.cwd)
    const { manifest } = await readProjectManifest(project.projectDir)
    const resolved = normalizeManifest(manifest, {
      appid: project.appid,
      package: project.package,
      versionName: project.versionName,
      versionCode: project.versionCode,
    })
    add('项目', true, `${resolved.name} ${resolved.appid} v${resolved.versionName}(${resolved.versionCode})`)

    const compiler = await readProjectCompilerVersion(project.projectDir)
    const sdkVersion = sdkRoot ? await readSdkVersion(sdkRoot) : null
    const versionCheck = assertVersionMatch({ compiler, sdk: sdkVersion })
    add(
      '版本一致性',
      versionCheck.ok,
      `uni-app ${compiler ?? '未知'} / 离线 SDK ${sdkVersion ?? '未知'}${
        versionCheck.ok ? '' : '（必须一致，见 uni-pack build 的提示）'
      }`,
    )

    try {
      const signing = await resolveSigning(project, options)
      add('签名证书', true, `${signing.keyAlias} @ ${path.basename(signing.keystore)}`)

      const tools = await resolveAndroidTools(config)
      const { readKeystoreFingerprint } = await import('../core/sdk.js')
      const fingerprint = await readKeystoreFingerprint(
        tools.keytool,
        signing.keystore,
        signing.storePassword,
        signing.keyAlias,
      )
      logger.info(`证书 SHA1：${fingerprint.sha1}`)
      logger.info(`证书 SHA256：${fingerprint.sha256}`)
      logger.info(`AppKey：${project.appKey ?? '(未配置)'}`)
      logger.info('请核对 DCloud 后台的 AppKey 绑定：appid + 包名 + SHA1 三者必须一致')
    } catch (error) {
      add('签名证书', false, error instanceof Error ? error.message : String(error))
    }
  } catch (error) {
    add('项目', false, error instanceof Error ? error.message : String(error))
  }

  const failed = checks.filter((check) => !check.ok)
  logger.output('doctor', { ok: failed.length === 0, checks })
  if (failed.length > 0) {
    process.exitCode = 3
  }
  return checks
}

/**
 * @param {string} file
 */
export async function readJsonSafe(file) {
  if (!(await exists(file))) {
    return undefined
  }
  return readJson(file)
}
