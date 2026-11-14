import { createReadStream } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildProject } from '../core/build.js'
import { installApk, listDevices, pickDevice, reversePort, startApp } from '../core/adb.js'
import { loadConfig, resolveProject } from '../core/config.js'
import { exists } from '../core/fsx.js'
import { Logger } from '../core/logger.js'
import { apkBaseName } from '../core/output.js'
import { normalizeManifest, readProjectManifest } from '../core/project.js'
import { resolveAndroidTools } from '../core/sdk.js'
import { runWebBuild } from '../core/webBuild.js'
import { fileHash, writeWgt } from '../core/wgt.js'

/**
 * @param {Record<string, any>} options
 */
export async function debugCommand(options) {
  const logger = new Logger(options)
  const config = await loadConfig()
  const { project } = await resolveProject(config, options.project, options.cwd)
  const tools = await resolveAndroidTools(config)

  const devices = await listDevices(tools.adb)
  const device = pickDevice(devices, options.device)
  const port = Number(options.port ?? project.debug?.port ?? 8787)
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
    const baseName = apkBaseName(project.name ?? resolved.name, resolved.versionName, resolved.versionCode)
    const candidate = path.join(path.resolve(config.outputDir), `${baseName}_debug_latest.apk`)
    baseApk = (await exists(candidate)) ? candidate : ''
  }

  if (!baseApk || options.build) {
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

  if (options.install || options.build) {
    logger.step(`安装基座到 ${device.model || device.serial}`)
    await installApk(tools.adb, baseApk, device.serial)
    logger.success('基座安装完成')
  }

  if (options.push) {
    await pushResources({ config, project, resolved, logger, options, adb: tools.adb, serial: device.serial, port, activity })
  } else if (options.logs) {
    await streamLogs(tools.adb, device.serial, resolved.packageName)
  } else {
    logger.info(`基座：${baseApk}`)
    logger.info('如需推送资源：uni-pack debug --push；如需日志：--logs')
  }
}

/**
 * @param {any} input
 */
async function pushResources(input) {
  const { project, resolved, logger, options, adb, serial, port, activity } = input

  let resourcesDir = path.resolve(project.projectDir, String(project.webBuild?.outputDir ?? 'dist/build/app'))
  if (options.skipWeb) {
    logger.info('跳过前端构建')
  } else {
    resourcesDir = (await runWebBuild(project, logger)).dir
  }

  const workDir = path.join(input.config.workDir, 'debug')
  const wgtFile = path.join(workDir, 'app.wgt')
  const wgt = await writeWgt({ resourcesDir, outputFile: wgtFile })
  logger.success(`wgt 就绪：${(wgt.size / 1024 / 1024).toFixed(1)} MB`)

  const server = http.createServer((request, response) => {
    const url = request.url?.split('?')[0] ?? '/'
    if (url === '/version.json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          sha256: wgt.sha256,
          version: wgt.manifest?.version?.name ?? resolved.versionName,
        }),
      )
      return
    }
    if (url === '/app.wgt') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': wgt.size,
      })
      createReadStream(wgtFile).pipe(response)
      return
    }
    response.writeHead(404)
    response.end('not found')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(undefined))
  })
  logger.success(`资源服务：http://127.0.0.1:${port}（sha256 ${wgt.sha256.slice(0, 12)}）`)

  await reversePort(adb, serial, port)
  logger.info(`adb reverse tcp:${port} 已建立`)
  await startApp(adb, resolved.packageName, activity, serial)
  logger.success('应用已重启，等待基座拉取新资源')

  if (options.logs) {
    await streamLogs(adb, serial, resolved.packageName)
  }

  logger.info('按 Ctrl+C 结束')
  await untilInterrupted()
  server.close()
}

/**
 * @param {string} adb
 * @param {string} serial
 * @param {string} packageName
 */
async function streamLogs(adb, serial, packageName) {
  const child = spawn(
    adb,
    ['-s', serial, 'logcat', '-v', 'time', '-s', 'console:V', 'uni-app:V', 'AndroidRuntime:E', 'System.err:W'],
    { stdio: 'inherit', windowsHide: true },
  )
  const stop = () => child.kill()
  process.once('SIGINT', stop)
  await new Promise((resolve) => child.on('close', resolve))
}

async function untilInterrupted() {
  await new Promise((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
}

/** @param {string} file */
export async function hashOf(file) {
  return fileHash(file)
}
