import crypto from 'node:crypto'
import { PackError, EXIT } from './errors.js'

/**
 * 手机端把二维码里的 S 当作 mDNS 实例名、P 当作配对码：
 * 设置 → 开发者选项 → 无线调试 → 使用二维码配对设备。
 * 实例名需满足 RFC6763：≤15 字符，字母数字与连字符。
 * @returns {string}
 */
export function createServiceName() {
  return `unipack-${crypto.randomBytes(3).toString('hex')}`
}

/**
 * @param {string} value
 * @returns {string}
 */
export function validateServiceName(value) {
  const text = String(value ?? '').trim()
  if (!text) {
    return createServiceName()
  }
  const valid =
    text.length <= 15 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(text) &&
    !text.includes('--') &&
    /[A-Za-z]/.test(text)
  if (!valid) {
    throw new PackError(`服务名不合法：${text}`, EXIT.DEVICE, {
      hint: '长度不超过 15，仅字母数字和连字符，首尾为字母或数字，不能有连续连字符，且至少含一个字母',
    })
  }
  return text
}

/**
 * @returns {string}
 */
export function createPairingCode() {
  return String(crypto.randomInt(100000, 1000000))
}

/**
 * @param {string} code
 * @returns {string}
 */
export function validatePairingCode(code) {
  const text = String(code ?? '').trim()
  if (!text) {
    return createPairingCode()
  }
  if (!/^\d{6}$/.test(text)) {
    throw new PackError(`配对码不合法：${text}`, EXIT.DEVICE, { hint: '配对码为 6 位数字' })
  }
  return text
}

/**
 * @param {string} service
 * @param {string} code
 * @returns {string}
 */
export function pairingPayload(service, code) {
  return `WIFI:T:ADB;S:${service};P:${code};;`
}

/**
 * @typedef {{ name: string, type: string, host: string, port: number, address: string }} MdnsLike
 */

/**
 * 手机扫码后广播的实例名不一定等于二维码里的 S：优先取新出现的配对服务，
 * 名字匹配其次，最后才接受当前唯一的配对服务。
 * @param {MdnsLike[]} services
 * @param {Set<string>} seen 扫码前已存在的地址
 * @param {string} service 二维码里的服务名
 * @returns {MdnsLike | null}
 */
export function selectPairingService(services, seen, service) {
  const pairing = services.filter((item) => item.type === 'pairing')
  const fresh = pairing.filter((item) => !seen.has(item.address))
  const named = fresh.find((item) => item.name.startsWith(`${service}.`))
  if (named) {
    return named
  }
  if (fresh.length === 1) {
    return fresh[0]
  }
  if (pairing.length === 1) {
    return pairing[0]
  }
  return null
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizePairingAddress(value) {
  const text = String(value ?? '').trim()
  if (!text) {
    throw new PackError('请输入配对地址', EXIT.DEVICE, { hint: '手机无线调试页显示的 IP:端口，例如 192.168.1.20:37123' })
  }
  if (/^\[[^\]]+\]:\d+$/.test(text) || /^[^:]+:\d+$/.test(text)) {
    return text
  }
  throw new PackError(`配对地址需要带端口：${text}`, EXIT.DEVICE, {
    hint: '使用手机“使用配对码配对设备”弹窗里显示的 IP:端口，不是连接端口 5555',
  })
}

/**
 * @param {string} address
 * @returns {string}
 */
export function hostOf(address) {
  const text = String(address ?? '')
  const bracketed = /^\[([^\]]+)\]:\d+$/.exec(text)
  if (bracketed) {
    return bracketed[1]
  }
  return text.replace(/:\d+$/, '')
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeAddress(value) {
  const text = String(value ?? '').trim()
  if (!text) {
    throw new PackError('请输入设备地址，例如 192.168.1.20:5555', EXIT.DEVICE)
  }
  if (/^\[[^\]]+\]:\d+$/.test(text)) {
    return text
  }
  if (/^\[[^\]]+\]$/.test(text)) {
    return `${text}:5555`
  }
  const colons = (text.match(/:/g) ?? []).length
  if (colons === 0) {
    return `${text}:5555`
  }
  if (colons === 1) {
    const [, port] = text.split(':')
    if (!/^\d+$/.test(port)) {
      throw new PackError(`端口不合法：${text}`, EXIT.DEVICE, { hint: '格式为 <ip>:<端口>，例如 192.168.1.20:5555' })
    }
    return text
  }
  return `[${text}]:5555`
}
