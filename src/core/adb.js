import { PackError, EXIT } from './errors.js'
import { run } from './process.js'

/**
 * @typedef {{ serial: string, state: string, model: string }} Device
 */

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
