import {
  connectDevice,
  deviceWifiIp,
  disconnectDevice,
  enableTcpip,
  listDevices,
  listMdnsServices,
  mdnsSupported,
  pairDevice,
  pickDevice,
  waitForDevice,
} from '../core/adb.js'
import { loadConfig } from '../core/config.js'
import {
  hostOf,
  normalizeAddress,
  normalizePairingAddress,
  pairingPayload,
  selectPairingService,
  validatePairingCode,
  validateServiceName,
} from '../core/devicePairing.js'
import { PackError, EXIT } from '../core/errors.js'
import { Logger } from '../core/logger.js'
import { renderQr } from '../core/qrcode.js'
import { resolveAdbPath } from '../core/sdk.js'

/**
 * @param {Record<string, any>} options
 */
export async function deviceCommand(options) {
  const logger = new Logger(options)
  const config = await loadConfig()
  const adb = await resolveAdbPath(config)
  const [action = 'list', ...rest] = options.positionals ?? []

  if (action === 'list') {
    await list(adb, logger)
    return
  }
  if (action === 'pair') {
    if (rest.length >= 2) {
      await pairByCode(adb, rest[0], rest[1], logger)
      return
    }
    await pairByQr(adb, options, logger)
    return
  }
  if (action === 'connect') {
    await connect(adb, rest[0], logger)
    return
  }
  if (action === 'disconnect') {
    await disconnect(adb, rest[0], logger)
    return
  }
  if (action === 'tcpip') {
    await tcpip(adb, options, logger)
    return
  }
  if (action === 'mdns') {
    await mdns(adb, logger)
    return
  }
  throw new PackError(`未知的 device 子命令：${action}`, EXIT.CONFIG, {
    hint: '可用：list / pair / connect / disconnect / tcpip / mdns',
  })
}

/**
 * @param {string} adb
 * @param {Logger} logger
 */
async function list(adb, logger) {
  const devices = await listDevices(adb)
  if (devices.length === 0) {
    logger.warn('没有发现设备。USB 连接请确认已开启 USB 调试；无线连接用 uni-pack device pair')
    return
  }
  for (const device of devices) {
    const kind = device.serial.includes(':') ? '无线' : 'USB'
    logger.info(`${device.serial}  ${device.state}${device.model ? `  ${device.model}` : ''}  [${kind}]`)
  }
}

/**
 * @param {string} adb
 * @param {Record<string, any>} options
 * @param {Logger} logger
 */
async function pairByQr(adb, options, logger) {
  if (!(await mdnsSupported(adb))) {
    throw new PackError('当前 adb 不支持 mDNS 发现，无法使用二维码配对', EXIT.DEVICE, {
      hint: '升级 Android SDK platform-tools（adb mdns check 应返回 mdns daemon 版本）',
    })
  }

  const service = validateServiceName(options.service)
  const code = validatePairingCode(options.code)
  const timeout = clamp(Number(options.timeout) || 120, 15, 600)
  const payload = pairingPayload(service, code)

  logger.step('手机扫码配对')
  process.stdout.write(`${renderQr(payload)}\n`)
  logger.info('手机：设置 → 开发者选项 → 无线调试 → 使用二维码配对设备')
  logger.info(`服务名：${service}    配对码：${code}`)
  logger.info(`等待手机注册配对服务（最多 ${timeout} 秒）…`)

  const before = await listMdnsServices(adb)
  const pairing = await waitForPairingService(adb, service, before, timeout)
  if (!pairing) {
    throw new PackError(`等待超时：没有发现配对服务 ${service}`, EXIT.DEVICE, {
      hint: [
        '确认手机与电脑在同一 Wi-Fi，且已选择“使用二维码配对设备”；关闭 VPN/代理后重试。',
        '仍不行改用配对码方式：手机 无线调试 → “使用配对码配对设备”，然后执行',
        '  uni-pack device pair <手机显示的 IP:端口> <6 位配对码>',
        '配对完成后在无线调试主页查看 IP:端口，执行 uni-pack device connect <IP:端口>',
        '诊断：另开终端执行 uni-pack device mdns，应能看到 _adb-tls-pairing._tcp 服务',
      ].join('\n'),
    })
  }

  logger.step(`发现配对服务：${pairing.address}`)
  await pairDevice(adb, pairing.address, code)
  logger.success('配对成功')

  const connectService = await waitForConnectService(adb, pairing.host, before, 20)
  if (!connectService) {
    logger.info('暂未发现连接服务，可稍后在手机上查看 IP 并执行：uni-pack device connect <ip:port>')
    return
  }
  await connectDevice(adb, connectService.address)
  const device = await waitForDevice(adb, connectService.address, 10000)
  if (device) {
    logger.success(`已连接：${device.serial}${device.model ? `（${device.model}）` : ''}`)
  } else {
    logger.warn(`已发起连接，但设备状态未就绪：${connectService.address}`)
  }
}

/**
 * @param {string} adb
 * @param {string} addressValue
 * @param {string} codeValue
 * @param {Logger} logger
 */
async function pairByCode(adb, addressValue, codeValue, logger) {
  const address = normalizePairingAddress(addressValue)
  const code = validatePairingCode(codeValue)
  const before = await listMdnsServices(adb)
  logger.step(`配对 ${address}`)
  await pairDevice(adb, address, code)
  logger.success('配对成功')

  const host = hostOf(address)
  const connectService = await waitForConnectService(adb, host, before, 10)
  if (!connectService) {
    logger.info('已配对。请在手机“无线调试”主页查看 IP:端口，执行：uni-pack device connect <IP:端口>')
    return
  }
  await connect(adb, connectService.address, logger)
}

/**
 * @param {string} adb
 * @param {string} service
 * @param {Array<{ address: string }>} before
 * @param {number} timeoutSeconds
 */
async function waitForPairingService(adb, service, before, timeoutSeconds) {
  const previous = new Set(before.map((item) => item.address))
  const deadline = Date.now() + timeoutSeconds * 1000
  while (Date.now() < deadline) {
    const services = await listMdnsServices(adb)
    const match = selectPairingService(services, previous, service)
    if (match) {
      return match
    }
    await sleep(1000)
  }
  return null
}

/**
 * @param {string} adb
 * @param {string} host
 * @param {Array<{ address: string }>} before
 * @param {number} timeoutSeconds
 */
async function waitForConnectService(adb, host, before, timeoutSeconds) {
  const previous = new Set(before.map((item) => item.address))
  const deadline = Date.now() + timeoutSeconds * 1000
  while (Date.now() < deadline) {
    const services = await listMdnsServices(adb)
    const candidates = services.filter((item) => item.type === 'connect' && item.host === host)
    const fresh = candidates.find((item) => !previous.has(item.address))
    if (fresh) {
      return fresh
    }
    if (candidates.length === 1) {
      return candidates[0]
    }
    await sleep(1000)
  }
  return null
}

/**
 * @param {string} adb
 * @param {string | undefined} value
 * @param {Logger} logger
 */
async function connect(adb, value, logger) {
  if (!value) {
    throw new PackError('缺少设备地址', EXIT.DEVICE, { hint: 'uni-pack device connect <ip[:port]>，默认端口 5555' })
  }
  const address = normalizeAddress(value)
  logger.step(`连接 ${address}`)
  await connectDevice(adb, address)
  const device = await waitForDevice(adb, address, 10000)
  if (device) {
    logger.success(`已连接：${device.serial}${device.model ? `（${device.model}）` : ''}`)
  } else {
    logger.warn(`已发起连接，但设备状态未就绪：${address}`)
  }
}

/**
 * @param {string} adb
 * @param {string | undefined} value
 * @param {Logger} logger
 */
async function disconnect(adb, value, logger) {
  const address = value ? normalizeAddress(value) : ''
  const output = await disconnectDevice(adb, address || undefined)
  logger.success(output || (address ? `已断开 ${address}` : '已断开所有无线设备'))
}

/**
 * @param {string} adb
 * @param {Record<string, any>} options
 * @param {Logger} logger
 */
async function tcpip(adb, options, logger) {
  const devices = await listDevices(adb)
  const device = pickDevice(devices, options.device)
  if (device.serial.includes(':')) {
    throw new PackError(`设备已经是无线连接：${device.serial}`, EXIT.DEVICE, {
      hint: 'USB 转无线请先用数据线连接设备',
    })
  }
  const port = Number(options.port ?? 5555)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PackError(`端口不合法：${options.port}`, EXIT.CONFIG, { hint: '端口范围 1–65535，无线调试常用 5555' })
  }
  const ip = await deviceWifiIp(adb, device.serial)
  if (!ip) {
    throw new PackError('无法读取设备的 Wi-Fi IP', EXIT.DEVICE, {
      hint: '确认手机已连接 Wi-Fi；也可以手动执行 uni-pack device connect <手机IP>:5555',
    })
  }

  logger.step(`开启无线调试：${device.serial}`)
  await enableTcpip(adb, device.serial, port)
  const address = `${ip}:${port}`
  logger.success(`设备已监听 ${address}`)

  if (options.connect) {
    await connect(adb, address, logger)
    return
  }
  logger.info(`连接：uni-pack device connect ${address}`)
}

/**
 * @param {string} adb
 * @param {Logger} logger
 */
async function mdns(adb, logger) {
  if (!(await mdnsSupported(adb))) {
    throw new PackError('当前 adb 不支持 mDNS 发现', EXIT.DEVICE, {
      hint: '升级 Android SDK platform-tools 后重试',
    })
  }
  const services = await listMdnsServices(adb)
  if (services.length === 0) {
    logger.warn('没有发现 mDNS 服务（无线调试是否已开启？手机与电脑是否在同一 Wi-Fi？）')
    return
  }
  for (const service of services) {
    logger.info(`${service.name}  ${service.address}  [${service.type}]`)
  }
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * @param {number} milliseconds
 */
function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
