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
 * 解析 `adb mdns services` 输出，兼容两种格式：
 * - 新版 3 列：<实例名> <服务类型> <host>:<port>
 * - 老版 2 列：<实例名含服务类型> <host>:<port>
 * 同时兼容 IPv4 与 [IPv6]:port。
 * @param {string} stdout
 * @returns {MdnsService[]}
 */
export function parseMdnsServices(stdout) {
  /** @type {MdnsService[]} */
  const services = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || /^List of discovered/i.test(line)) {
      continue
    }
    const fields = line.split(/\s+/)
    if (fields.length < 2) {
      continue
    }
    const addressToken = fields[fields.length - 1]
    const match = /^(\[[^\]]+\]|[^\s:]+):(\d+)$/.exec(addressToken)
    if (!match) {
      continue
    }
    const name = fields[0]
    const typeText = fields.length > 2 ? fields.slice(1, -1).join(' ') : name
    const host = match[1].replace(/^\[|\]$/g, '')
    const type = typeText.includes('_adb-tls-pairing._tcp')
      ? 'pairing'
      : typeText.includes('_adb-tls-connect._tcp')
        ? 'connect'
        : 'other'
    services.push({ name, type, host, port: Number(match[2]), address: `${host}:${match[2]}` })
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
 * 按完整序列号、型号或唯一子串找设备。多设备时避免手抄长序列号。
 * @param {Device[]} devices
 * @param {string | undefined} input
 * @returns {Device | null}
 */
export function matchDevice(devices, input) {
  const query = String(input ?? '').trim()
  if (!query) {
    return null
  }
  const exact = devices.find((device) => device.serial === query)
  if (exact) {
    return exact
  }
  const lower = query.toLowerCase()
  const byModel = devices.filter((device) => device.model && device.model.toLowerCase() === lower)
  if (byModel.length === 1) {
    return byModel[0]
  }
  const matches = devices.filter(
    (device) =>
      device.serial.toLowerCase().includes(lower) || (device.model && device.model.toLowerCase().includes(lower)),
  )
  if (matches.length === 1) {
    return matches[0]
  }
  if (matches.length > 1) {
    throw new PackError(`设备不唯一：${query}`, EXIT.DEVICE, {
      hint: `候选：${matches.map(formatDevice).join('；')}`,
    })
  }
  return null
}

/**
 * @param {Device} device
 * @returns {string}
 */
function formatDevice(device) {
  return `${device.serial}${device.model ? `（${device.model}）` : ''}`
}

/**
 * @param {Device[]} devices
 * @param {string} [input] 完整序列号、型号或唯一子串
 */
export function pickDevice(devices, input) {
  if (input) {
    const match = matchDevice(devices, input)
    if (!match) {
      throw new PackError(`找不到设备：${input}`, EXIT.DEVICE, {
        hint: `可用设备：${devices.map(formatDevice).join('；') || '(无)'}；支持序列号后缀或型号`,
      })
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
