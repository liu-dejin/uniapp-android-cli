import { PackError, EXIT } from './errors.js'
import { run } from './process.js'

/**
 * @typedef {{ serial: string, state: string, model: string }} Device
 * @typedef {{ name: string, type: 'pairing' | 'connect' | 'other', host: string, port: number, address: string }} MdnsService
 */

/**
 * @param {string} adb
 * @returns {Promise<boolean>}
 */
export async function mdnsSupported(adb) {
  const { code, stdout, stderr } = await run(adb, ['mdns', 'check'], { allowFailure: true })
  // 失败时也常带 "mdns"（如 ERROR: mdns daemon unavailable），只认版本行
  return code === 0 && /mdns daemon version/i.test(`${stdout}${stderr}`)
}

/**
 * 解析 `adb mdns services` 输出，兼容 IPv4 与 [IPv6]:port。
 * @param {string} stdout
 * @returns {MdnsService[]}
 */
export function parseMdnsServices(stdout) {
  /** @type {MdnsService[]} */
  const services = []
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\[[^\]]+\]|[^\s:]+):(\d+)\s*$/.exec(line.trim())
    if (!match) {
      continue
    }
    const name = match[1]
    const host = match[2].replace(/^\[|\]$/g, '')
    const type = name.includes('_adb-tls-pairing._tcp')
      ? 'pairing'
      : name.includes('_adb-tls-connect._tcp')
        ? 'connect'
        : 'other'
    services.push({ name, type, host, port: Number(match[3]), address: `${host}:${match[3]}` })
  }
  return services
}

/**
 * @param {string} adb
 * @returns {Promise<MdnsService[]>}
 */
export async function listMdnsServices(adb) {
  const { stdout } = await run(adb, ['mdns', 'services'], { allowFailure: true })
  return parseMdnsServices(stdout)
}

/**
 * @param {string} adb
 * @param {string} address
 * @param {string} code
 */
export async function pairDevice(adb, address, code) {
  const { code: exitCode, stdout, stderr } = await run(adb, ['pair', address, code], { allowFailure: true })
  const output = `${stdout}\n${stderr}`.trim()
  if (exitCode !== 0 || /failed|error|cannot/i.test(output)) {
    throw new PackError(`配对失败：${output.split(/\r?\n/).slice(-3).join('\n') || 'adb pair 无输出'}`, EXIT.DEVICE, {
      hint: '确认手机与电脑在同一 Wi-Fi、二维码未过期；如有 VPN 先关闭再重试',
    })
  }
  return output
}

/**
 * @param {string} adb
 * @param {string} address
 */
export async function connectDevice(adb, address) {
  const { code, stdout, stderr } = await run(adb, ['connect', address], { allowFailure: true })
  const output = `${stdout}\n${stderr}`.trim()
  if (code !== 0 || /failed|cannot/i.test(output)) {
    throw new PackError(`连接失败：${output.split(/\r?\n/).slice(-3).join('\n') || address}`, EXIT.DEVICE, {
      hint: '确认手机无线调试已开启、与电脑同网段，并已配对',
    })
  }
  return output
}

/**
 * @param {string} adb
 * @param {string} [address]
 */
export async function disconnectDevice(adb, address) {
  const args = address ? ['disconnect', address] : ['disconnect']
  const { stdout, stderr } = await run(adb, args, { allowFailure: true })
  return `${stdout}\n${stderr}`.trim()
}

/**
 * @param {string} adb
 * @param {string} serial
 * @param {number} port
 */
export async function enableTcpip(adb, serial, port) {
  const { code, stdout, stderr } = await run(adb, ['-s', serial, 'tcpip', String(port)], { allowFailure: true })
  if (code !== 0) {
    throw new PackError(`开启无线调试失败：${(stderr || stdout).trim()}`, EXIT.DEVICE)
  }
}

/**
 * @param {string} adb
 * @param {string} serial
 * @returns {Promise<string>}
 */
export async function deviceWifiIp(adb, serial) {
  const { stdout } = await run(adb, ['-s', serial, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'], {
    allowFailure: true,
  })
  const match = /inet\s+(\d+\.\d+\.\d+\.\d+)/.exec(stdout)
  return match?.[1] ?? ''
}

/**
 * @param {string} adb
 * @param {string} address
 * @param {number} timeoutMs
 */
export async function waitForDevice(adb, address, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const devices = await listDevices(adb).catch(() => [])
    const match = devices.find((device) => device.serial === address && device.state === 'device')
    if (match) {
      return match
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return null
}

/**
 * @param {string} adb
 * @returns {Promise<Device[]>}
 */
export async function listDevices(adb) {
  const { stdout } = await run(adb, ['devices', '-l'], { allowFailure: false })
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0 && !line.startsWith('*'))
    .map((line) => {
      const [serial, state, ...rest] = line.trim().split(/\s+/)
      const model = rest.find((item) => item.startsWith('model:'))?.slice('model:'.length) ?? ''
      return { serial, state, model }
    })
}

/**
 * @param {Device[]} devices
 * @param {string} [serial]
 */
export function pickDevice(devices, serial) {
  if (serial) {
    const match = devices.find((device) => device.serial === serial)
    if (!match) {
      throw new PackError(`找不到设备：${serial}`, EXIT.DEVICE)
    }
    return match
  }
  const online = devices.filter((device) => device.state === 'device')
  if (online.length === 0) {
    throw new PackError('没有可用设备，请连接设备或启动模拟器后重试', EXIT.DEVICE)
  }
  return online[0]
}

/**
 * @param {string} adb
 * @param {string} apk
 * @param {string} serial
 */
export async function installApk(adb, apk, serial) {
  const { code, stdout, stderr } = await run(adb, ['-s', serial, 'install', '-r', apk], { allowFailure: true })
  if (code !== 0 || /Failure/i.test(stdout + stderr)) {
    throw new PackError(`安装失败：${(stdout + stderr).trim().split('\n').slice(-3).join('\n')}`, EXIT.DEVICE)
  }
}

/**
 * @param {string} adb
 * @param {string} serial
 * @param {string} packageName
 */
export async function isInstalled(adb, serial, packageName) {
  const { stdout } = await run(adb, ['-s', serial, 'shell', 'pm', 'list', 'packages', packageName], {
    allowFailure: true,
  })
  return stdout.split(/\r?\n/).some((line) => line.trim() === `package:${packageName}`)
}

/**
 * @param {string} adb
 * @param {string} packageName
 * @param {string} activity
 * @param {string} serial
 */
export async function startApp(adb, packageName, activity, serial) {
  await run(adb, ['-s', serial, 'shell', 'am', 'force-stop', packageName], { allowFailure: true })
  const { code, stdout, stderr } = await run(
    adb,
    ['-s', serial, 'shell', 'am', 'start', '-n', `${packageName}/${activity}`],
    { allowFailure: true },
  )
  if (code !== 0) {
    throw new PackError(`启动应用失败：${(stderr || stdout).trim()}`, EXIT.DEVICE, {
      hint: '基座未安装？先执行 uni-pack debug --install',
    })
  }
}

/**
 * @param {string} adb
 * @param {string} serial
 * @param {number} port
 */
export async function reversePort(adb, serial, port) {
  await run(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], { allowFailure: false })
}

/**
 * @param {string} adb
 * @param {string} serial
 * @returns {Promise<string>}
 */
export async function packagePid(adb, serial, packageName) {
  const { stdout } = await run(adb, ['-s', serial, 'shell', 'pidof', packageName], { allowFailure: true })
  return stdout.trim()
}
