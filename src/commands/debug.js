import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildProject } from '../core/build.js'
import { installApk, listDevices, pickDevice, startApp } from '../core/adb.js'
import { loadConfig, resolveProject } from '../core/config.js'
import { resolveDebugBase, resolveDebugDevice, resolveDebugLogs, resolveDebugStrategy } from '../core/debugPreset.js'
import { PackError, EXIT } from '../core/errors.js'
import { ensureDir, exists } from '../core/fsx.js'
import { resolveHbuilderx } from '../core/hbuilderx.js'
import { buildLaunchArgs, cliPath, ensureHbuilderxRunning, localCustomBasePath, runLaunch } from '../core/hbuilderxCli.js'
import { Logger } from '../core/logger.js'
import { apkBaseName, resolveApkPrefix } from '../core/output.js'
import { normalizeManifest, readProjectManifest } from '../core/project.js'
import { resolveAndroidTools } from '../core/sdk.js'
import { resolveBuildTempDir, resolveWorkRoot } from '../core/workdir.js'

/**
 * @param {Record<string, any>} options
 */
export async function debugCommand(options) {
  const logger = new Logger(options)
  const config = await loadConfig()
  const { project } = await resolveProject(config, options.project, options.cwd)
  const preset = project.debug ?? {}

  options.device = resolveDebugDevice(options, preset) || undefined
  options.logs = resolveDebugLogs(options, preset)

  if (resolveDebugStrategy(options, preset) === 'hbuilderx') {
    await runHbuilderxDebug({ config, project, options, logger, preset })
    return
  }

  const tools = await resolveAndroidTools(config)

  const devices = await listDevices(tools.adb)
  const device = pickDevice(devices, options.device)
  const activity = String(project.debug?.launchActivity ?? 'io.dcloud.PandoraEntry')

  const { manifest } = await readProjectManifest(project.projectDir)
  const resolved = normalizeManifest(manifest, {
    appid: project.appid,
    name: project.name,
    package: project.package,
    versionName: project.versionName,
    versionCode: project.versionCode,
  })

  let baseApk = options.base ? path.resolve(options.base) : ''
  if (!baseApk) {
    const baseName = apkBaseName(resolveApkPrefix(project, resolved), resolved.versionName, resolved.versionCode)
    const candidate = path.join(path.resolve(project.outputDir), `${baseName}_debug_latest.apk`)
    baseApk = (await exists(candidate)) ? candidate : ''
  }

  // --push 表示「带上最新前端资源重建基座」，等价于 build + install；
  // SDK 的 wgt 安装会让基座崩溃，这里不走 plus.runtime.install。
  const rebuild = Boolean(options.push) || Boolean(options.build) || !baseApk
  if (rebuild) {
    logger.step('构建自定义基座')
    const built = await buildProject({
      config,
      project,
      mode: 'debug',
      options: { ...options, install: false },
      logger,
    })
    baseApk = built.apk
  }

  if (options.install || options.push || rebuild) {
    logger.step(`安装到 ${device.model || device.serial}`)
    await installApk(tools.adb, baseApk, device.serial)
    await startApp(tools.adb, resolved.packageName, activity, device.serial)
    logger.success('基座已安装并启动')
  } else {
    logger.info(`基座：${baseApk}`)
    logger.info('重新构建并安装：uni-pack debug --push；只看日志：--logs')
  }

  if (options.logs) {
    await streamLogs(tools.adb, device.serial)
  }
}

/**
 * 用 HBuilderX CLI 真机运行：HBuilderX 负责编译、安装基座、差量同步与项目日志，
 * uni-pack 只做环境检查和参数转发。
 * @param {{ config: any, project: any, options: Record<string, any>, logger: Logger, preset: any }} input
 */
async function runHbuilderxDebug(input) {
  const { config, project, options, logger, preset } = input
  if (options.playground && !['standard', 'custom'].includes(String(options.playground).toLowerCase())) {
    throw new PackError(`--playground 只支持 standard 或 custom，收到：${options.playground}`, EXIT.CONFIG)
  }
  if (options.customType && !['local', 'device'].includes(String(options.customType).toLowerCase())) {
    throw new PackError(`--custom-type 只支持 local 或 device，收到：${options.customType}`, EXIT.CONFIG)
  }
  const { playground, customType } = resolveDebugBase(options, preset)

  const tools = await resolveAndroidTools(config)
  const devices = await listDevices(tools.adb)
  const device = pickDevice(devices, options.device ?? preset.device)
  options.device = device.serial

  // 本地自定义基座：先自己 adb install -r。
  // HBuilderX 只按包名+版本判断“基座已是最新”，同版本的正式包会让它误判并跳过安装。
  if (playground === 'custom' && customType === 'local') {
    const baseApk = localCustomBasePath(project.projectDir)
    if (!(await exists(baseApk))) {
      throw new PackError(`找不到本地自定义基座：${baseApk}`, EXIT.PREFLIGHT, {
        hint: '先在 HBuilderX 制作自定义基座（生成 unpackage/debug/android_debug.apk），或改用 --custom-type device',
      })
    }
    logger.info(`安装本地自定义基座：${baseApk}`)
    await installApk(tools.adb, baseApk, device.serial)
  }

  const hbuilderx = await resolveHbuilderx(config, { project })
  if (!hbuilderx) {
    throw new PackError('找不到 HBuilderX，无法使用 --hbuilderx 运行', EXIT.PREFLIGHT, {
      hint: '运行 uni-pack init 配置 hbuilderx.root，或设置 HBUILDERX_HOME',
    })
  }
  const cli = cliPath(hbuilderx.root)
  if (!(await exists(cli))) {
    throw new PackError(`找不到 HBuilderX CLI：${cli}`, EXIT.PREFLIGHT, {
      hint: '确认 hbuilderx.root 指向 HBuilderX 安装目录（与 cli.exe 同级）',
    })
  }

  const workRoot = resolveWorkRoot(config, project)
  const temp = resolveBuildTempDir(workRoot)
  await ensureDir(temp.tempDir)
  const env = { TEMP: temp.tempDir, TMP: temp.tempDir }

  logger.step(`HBuilderX 真机运行：${project.projectDir}`)
  const version = await ensureHbuilderxRunning({ cli, logger, env })
  logger.info(`HBuilderX ${version.raw}${options.logs ? '（项目日志会直接输出）' : ''}`)

  let packageName = ''
  if (playground === 'custom' && customType === 'device') {
    const { manifest } = await readProjectManifest(project.projectDir)
    packageName = normalizeManifest(manifest, { package: project.package }, { validate: false }).packageName
    if (!packageName) {
      throw new PackError('--custom-type device 需要知道设备上基座的包名', EXIT.CONFIG, {
        hint: '在 manifest 的 app-plus.distribute.android.packagename 配好包名，或改用 --custom-type local',
      })
    }
  }

  if (options.push || options.base || options.install || options.build) {
    logger.info('--hbuilderx 模式下由 HBuilderX 负责构建/安装/启动，--push/--base/--install 会忽略')
  }

  const args = buildLaunchArgs({
    projectDir: project.projectDir,
    deviceId: options.device,
    playground: /** @type {'standard' | 'custom'} */ (playground),
    customType: /** @type {'local' | 'device'} */ (customType),
    packageName,
    ui: Boolean(options.ui),
  })
  logger.info(`保存代码后自动差量编译并同步；Ctrl+C 结束${options.ui ? '（界面模式）' : ''}`)
  const code = await runLaunch({ cli, args, env })
  if (code !== 0) {
    throw new PackError(`HBuilderX 运行结束（退出码 ${code}）`, EXIT.DEVICE)
  }
}

/**
 * @param {string} adb
 * @param {string} serial
 */
async function streamLogs(adb, serial) {
  const child = spawn(adb, ['-s', serial, 'logcat', '-v', 'time', '-s', 'console:V', 'uni-app:V', 'AndroidRuntime:E'], {
    stdio: 'inherit',
    windowsHide: true,
  })
  const stop = () => child.kill()
  process.once('SIGINT', stop)
  await new Promise((resolve) => child.on('close', resolve))
}
