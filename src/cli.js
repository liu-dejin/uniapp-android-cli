import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { PackError, toFailure } from './core/errors.js'

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const COMMON = {
  project: { type: 'string', short: 'p' },
  verbose: { type: 'boolean' },
  json: { type: 'boolean' },
}

const SPECS = {
  init: {
    ...COMMON,
    appkey: { type: 'string' },
    keystore: { type: 'string' },
    sdk: { type: 'string' },
    'android-sdk': { type: 'string' },
    jdk: { type: 'string' },
  },
  doctor: { ...COMMON },
  devices: { ...COMMON },
  build: {
    ...COMMON,
    mode: { type: 'string' },
    'skip-web': { type: 'boolean' },
    out: { type: 'string' },
    install: { type: 'boolean' },
    device: { type: 'string' },
    offline: { type: 'boolean' },
    'keep-workdir': { type: 'boolean' },
    'skip-version-check': { type: 'boolean' },
    'store-password': { type: 'string' },
    'key-password': { type: 'string' },
  },
  wgt: { ...COMMON, 'skip-web': { type: 'boolean' }, out: { type: 'string' } },
  debug: {
    ...COMMON,
    install: { type: 'boolean' },
    push: { type: 'boolean' },
    logs: { type: 'boolean' },
    device: { type: 'string' },
    base: { type: 'string' },
    build: { type: 'boolean' },
    'skip-web': { type: 'boolean' },
    'store-password': { type: 'string' },
    'key-password': { type: 'string' },
  },
}

/**
 * @param {string[]} argv
 */
export async function main(argv) {
  const [command, ...rest] = argv
  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(VERSION)
    return
  }
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  const spec = SPECS[command]
  if (!spec) {
    console.error(`未知命令：${command}`)
    printHelp()
    process.exitCode = 2
    return
  }

  let options
  try {
    const { values } = parseArgs({ args: rest, options: spec, allowPositionals: true })
    options = normalize(values)
    options.cwd = process.cwd()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  try {
    if (command === 'init') {
      const { initCommand } = await import('./commands/init.js')
      await initCommand(options)
    } else if (command === 'doctor') {
      const { doctorCommand } = await import('./commands/doctor.js')
      await doctorCommand(options)
    } else if (command === 'devices') {
      const { devicesCommand } = await import('./commands/devices.js')
      await devicesCommand(options)
    } else if (command === 'build') {
      const { buildCommand } = await import('./commands/build.js')
      await buildCommand(options)
    } else if (command === 'wgt') {
      const { wgtCommand } = await import('./commands/wgt.js')
      await wgtCommand(options)
    } else if (command === 'debug') {
      const { debugCommand } = await import('./commands/debug.js')
      await debugCommand(options)
    }
  } catch (error) {
    const failure = toFailure(error)
    if (options.json) {
      console.log(JSON.stringify({ ok: false, code: failure.code, message: failure.message, hint: failure.hint }, null, 2))
    } else {
      console.error(`\n✗ ${failure.message}`)
      if (failure.hint) {
        console.error(`  ${failure.hint}`)
      }
      if (error instanceof PackError && error.cause instanceof Error) {
        console.error(`  原因：${error.cause.message}`)
      }
    }
    process.exitCode = failure.code
  }
}

/**
 * @param {Record<string, unknown>} values
 */
function normalize(values) {
  /** @type {Record<string, unknown>} */
  const result = {}
  for (const [key, value] of Object.entries(values)) {
    result[key.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value
  }
  return result
}

function printHelp() {
  console.log(`uni-pack ${VERSION} — uni-app Android 离线打包

用法：
  uni-pack init    [-p <dir>] [--appkey <key>] [--sdk <dir>] [--android-sdk <dir>] [--jdk <dir>]
  uni-pack doctor  [-p <dir>] [--json]                环境自检
  uni-pack devices                                    列出设备
  uni-pack build   [-p <dir>] [--mode release|debug] [--install] [--device <serial>]
                   [--skip-web] [--out <dir>] [--offline]
  uni-pack wgt     [-p <dir>] [--skip-web] [--out <dir>]
  uni-pack debug   [-p <dir>] [--push] [--install] [--build] [--logs] [--device <serial>]
  uni-pack version                                    显示版本

环境变量：
  UNI_SDK_ROOT    含 HBuilder-Integrate-AS 的离线 SDK 目录
  ANDROID_HOME    Android SDK 根目录
  JAVA_HOME       JDK 17+ 根目录

配置：~/.uniapp-android-cli/config.json（项目内 uni-pack.config.json 可覆盖项目级字段）
`)
}
