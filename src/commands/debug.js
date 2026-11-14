import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildProject } from '../core/build.js'
import { installApk, listDevices, pickDevice, startApp } from '../core/adb.js'
import { loadConfig, resolveProject } from '../core/config.js'
import { exists } from '../core/fsx.js'
import { Logger } from '../core/logger.js'
import { apkBaseName } from '../core/output.js'
import { normalizeManifest, readProjectManifest } from '../core/project.js'
import { resolveAndroidTools } from '../core/sdk.js'

/**
 * @param {Record<string, any>} options
 */
export async function debugCommand(options) {
  const logger = new Logger(options)
  const config = await loadConfig()
  const { project } = await resolveProject(config, options.project, options.cwd)
  const tools = await resolveAndroidTools(config)

  const devices = await listDevices(tools.adb)
  const device = pickDevice(devices, options.device)
  const activity = String(project.debug?.launchActivity ?? 'io.dcloud.PandoraEntry')

  const { manifest } = await readProjectManifest(project.projectDir)
  const resolved = normalizeManifest(manifest, {
    appid: project.appid,
    name: project.name,
    package: project.package,
    versionName: project.versionName,
    versionCode: project.versionCode,
  })

  let baseApk = options.base ? path.resolve(options.base) : ''
  if (!baseApk) {
    const baseName = apkBaseName(project.name ?? resolved.name, resolved.versionName, resolved.versionCode)
    const candidate = path.join(path.resolve(config.outputDir), `${baseName}_debug_latest.apk`)
    baseApk = (await exists(candidate)) ? candidate : ''
  }

  // --push 表示「带上最新前端资源重建基座」，等价于 build + install；
  // SDK 的 wgt 安装会让基座崩溃，这里不走 plus.runtime.install。
  const rebuild = Boolean(options.push) || Boolean(options.build) || !baseApk
  if (rebuild) {
    logger.step('构建自定义基座')
    const built = await buildProject({
      config,
      project,
      mode: 'debug',
      options: { ...options, install: false },
      logger,
    })
    baseApk = built.apk
  }

  if (options.install || options.push || rebuild) {
    logger.step(`安装到 ${device.model || device.serial}`)
    await installApk(tools.adb, baseApk, device.serial)
    await startApp(tools.adb, resolved.packageName, activity, device.serial)
    logger.success('基座已安装并启动')
  } else {
    logger.info(`基座：${baseApk}`)
    logger.info('重新构建并安装：uni-pack debug --push；只看日志：--logs')
  }

  if (options.logs) {
    await streamLogs(tools.adb, device.serial)
  }
}

/**
 * @param {string} adb
 * @param {string} serial
 */
async function streamLogs(adb, serial) {
  const child = spawn(adb, ['-s', serial, 'logcat', '-v', 'time', '-s', 'console:V', 'uni-app:V', 'AndroidRuntime:E'], {
    stdio: 'inherit',
    windowsHide: true,
  })
  const stop = () => child.kill()
  process.once('SIGINT', stop)
  await new Promise((resolve) => child.on('close', resolve))
}
