import path from 'node:path'
import { buildProject } from '../core/build.js'
import { installApk } from '../core/adb.js'
import { loadConfig, resolveProject } from '../core/config.js'
import { Logger } from '../core/logger.js'
import { resolveAndroidTools } from '../core/sdk.js'

/**
 * @param {Record<string, any>} options
 */
export async function buildCommand(options) {
  const logger = new Logger(options)
  const config = await loadConfig()
  const { project } = await resolveProject(config, options.project, options.cwd)

  const result = await buildProject({
    config,
    project,
    mode: options.mode === 'debug' ? 'debug' : 'release',
    options,
    logger,
  })

  if (options.install) {
    const tools = await resolveAndroidTools(config)
    const { listDevices, pickDevice } = await import('../core/adb.js')
    const devices = await listDevices(tools.adb)
    const device = pickDevice(devices, options.device)
    logger.step(`安装到 ${device.model || device.serial}`)
    await installApk(tools.adb, result.apk, device.serial)
    logger.success('安装完成')
  }

  logger.output('build', {
    ok: true,
    apk: result.apk,
    latest: result.latest,
    sha256: result.sha256,
    resourceVersion: result.resourceVersion,
    resourceVersionCode: result.resourceVersionCode,
    workDir: path.join(result.workRoot, 'gradle'),
  })
  return result
}
