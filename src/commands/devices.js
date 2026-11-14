import { loadConfig } from '../core/config.js'
import { listDevices } from '../core/adb.js'
import { Logger } from '../core/logger.js'
import { resolveAndroidTools } from '../core/sdk.js'

/**
 * @param {Record<string, any>} options
 */
export async function devicesCommand(options) {
  const logger = new Logger(options)
  const config = await loadConfig()
  const tools = await resolveAndroidTools(config)
  const devices = await listDevices(tools.adb)

  if (devices.length === 0) {
    logger.warn('没有检测到设备')
  }
  for (const device of devices) {
    logger.info(`${device.serial}\t${device.state}\t${device.model}`)
  }
  logger.output('devices', { devices })
  return devices
}
