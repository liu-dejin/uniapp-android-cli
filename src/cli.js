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
    yes: { type: 'boolean', short: 'y' },
    keystore: { type: 'string' },
    'keystore-properties': { type: 'string' },
    'key-alias': { type: 'string' },
    package: { type: 'string' },
    sdk: { type: 'string' },
    hbuilderx: { type: 'string' },
    'android-sdk': { type: 'string' },
    jdk: { type: 'string' },
  },
  doctor: { ...COMMON },
  projects: { ...COMMON },
  devices: { ...COMMON },
  device: {
    ...COMMON,
    timeout: { type: 'string' },
    service: { type: 'string' },
    code: { type: 'string' },
    port: { type: 'string' },
    device: { type: 'string' },
    connect: { type: 'boolean' },
  },
  build: {
    ...COMMON,
    mode: { type: 'string' },
    'skip-web': { type: 'boolean' },
    'skip-resource-check': { type: 'boolean' },
    out: { type: 'string' },
    install: { type: 'boolean' },
    device: { type: 'string' },
    offline: { type: 'boolean' },
    'no-daemon': { type: 'boolean' },
    prune: { type: 'string' },
    'keep-workdir': { type: 'boolean' },
    'skip-version-check': { type: 'boolean' },
    'store-password': { type: 'string' },
    'key-password': { type: 'string' },
  },
  wgt: {
    ...COMMON,
    'skip-web': { type: 'boolean' },
    'skip-resource-check': { type: 'boolean' },
    out: { type: 'string' },
  },
  debug: {
    ...COMMON,
    install: { type: 'boolean' },
    push: { type: 'boolean' },
    logs: { type: 'boolean' },
    device: { type: 'string' },
    base: { type: 'string' },
    build: { type: 'boolean' },
    hbuilderx: { type: 'boolean' },
    playground: { type: 'string' },
    'custom-type': { type: 'string' },
    ui: { type: 'boolean' },
    'skip-web': { type: 'boolean' },
    'skip-resource-check': { type: 'boolean' },
    'no-daemon': { type: 'boolean' },
    prune: { type: 'string' },
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
    const { values, positionals } = parseArgs({ args: rest, options: spec, allowPositionals: true })
    options = normalize(values)
    options.positionals = positionals
    options.cwd = process.cwd()
  } catch (error) {
    console.error(translateArgsError(error, rest, spec))
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
    } else if (command === 'projects') {
      const { projectsCommand } = await import('./commands/projects.js')
      await projectsCommand(options)
    } else if (command === 'devices') {
      const { devicesCommand } = await import('./commands/devices.js')
      await devicesCommand(options)
    } else if (command === 'device') {
      const { deviceCommand } = await import('./commands/device.js')
      await deviceCommand(options)
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
 * node:util parseArgs 的报错是英文，且单横线长参数会被拆成短选项（-appkey → -a），
 * 这里翻译成中文并提示正确写法，避免用户对着 "Unknown option '-a'" 猜。
 * @param {unknown} error
 * @param {string[]} args
 * @param {Record<string, unknown>} spec
 * @returns {string}
 */
export function translateArgsError(error, args, spec) {
  const message = error instanceof Error ? error.message : String(error)
  const known = new Set(Object.keys(spec))
  const mistaken = args.find((arg) => /^-[^-][\w-]+$/.test(arg) && known.has(arg.slice(1)))
  if (mistaken) {
    return `未知参数：${mistaken}\n长参数需要两个横线，改为：--${mistaken.slice(1)}`
  }
  const unknown = /Unknown option '(-[^']+)'/.exec(message)?.[1]
  if (unknown) {
    const flags = new Set()
    for (const [key, value] of Object.entries(spec)) {
      const short =
        value && typeof value === 'object' && 'short' in value ? String(/** @type {any} */ (value).short ?? '') : ''
      if (short) {
        flags.add(`-${short}`)
      }
      flags.add(key.length === 1 ? `-${key}` : `--${key}`)
    }
    return `未知参数：${unknown}\n可用参数：${[...flags].sort().join(' ')}`
  }
  return message
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
  uni-pack init    [-p <dir>] [--appkey <key>] [--package <包名>] [--sdk <dir>] [--hbuilderx <dir>]
                   [--keystore <文件>] [--key-alias <别名>] [--keystore-properties <文件>]
                   [--android-sdk <dir>] [--jdk <dir>] [--yes]
                   （问答式写入 <项目>/uni-pack.config.json；缺环境会引导填写；CI 用 --yes 跳过）
  uni-pack doctor  [-p <dir>] [--json]                环境自检
  uni-pack projects                                   列出已登记项目（-p 可用项目名/目录名）
  uni-pack build   [-p <dir>] [--mode release|debug] [--install] [--device <serial>]
                   [--skip-web] [--skip-resource-check] [--out <dir>] [--offline]
                   [--prune <n>] [--no-daemon]
  uni-pack wgt     [-p <dir>] [--skip-web] [--skip-resource-check] [--out <dir>]
  uni-pack debug   [-p <dir>] [--push] [--install] [--build] [--logs] [--device <serial>]
                   [--hbuilderx [--playground standard|custom] [--custom-type local|device] [--ui]]
  uni-pack devices                                    列出设备（同 device list）
  uni-pack device [list]                              列出 USB / 无线设备
  uni-pack device pair [--timeout 120] [--service <名>] [--code <6位>]
                                                      终端显示二维码，手机扫码配对（Android 11+）
  uni-pack device pair <ip:port> <配对码>             手动配对（手机显示配对码时用）
  uni-pack device connect <ip[:port]>                 连接无线设备（默认端口 5555）
  uni-pack device disconnect [ip[:port]]              断开无线设备
  uni-pack device tcpip [--port 5555] [--connect]     USB 设备开启无线调试
  uni-pack device mdns                                列出 mDNS 发现的无线调试服务
  uni-pack version                                    显示版本

支持两种项目：
  CLI 项目       src/manifest.json，按项目脚本选 build:app-android / build:app-plus
  HBuilderX 项目 根目录 manifest.json，用 HBuilderX 自带编译器（Vue 2 / Vue 3）

环境变量：
  UNI_SDK_ROOT    含 HBuilder-Integrate-AS 的离线 SDK 目录
  UNI_SDK_DIRS    额外扫描 Android-SDK@x.yy 的目录（多个用 ; 分隔）
  HBUILDERX_HOME  HBuilderX 安装目录
  ANDROID_HOME    Android SDK 根目录
  JAVA_HOME       JDK 17+ 根目录
  UNI_PACK_TEMP   前端构建临时目录（默认 <workDir>/<项目>/tmp）

配置：~/.uniapp-android-cli/config.json（项目内 uni-pack.config.json 可覆盖项目级字段）
`)
}
