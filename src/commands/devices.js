import { loadConfig } from '../core/config.js'
import { listDevices } from '../core/adb.js'
import { Logger } from '../core/logger.js'
import { resolveAdbPath } from '../core/sdk.js'

/**
 * @param {Record<string, any>} options
 */
export async function devicesCommand(options) {
  const logger = new Logger(options)
  const config = await loadConfig()
  const adb = await resolveAdbPath(config)
  const devices = await listDevices(adb)

  if (devices.length === 0) {
    logger.warn('没有检测到设备')
  }
  for (const device of devices) {
    logger.info(`${device.serial}\t${device.state}\t${device.model}`)
  }
  logger.output('devices', { devices })
  return devices
}
