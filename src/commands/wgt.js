import path from 'node:path'
import { loadConfig, resolveProject } from '../core/config.js'
import { ensureDir, exists } from '../core/fsx.js'
import { Logger } from '../core/logger.js'
import { readProjectManifest } from '../core/project.js'
import { runWebBuild } from '../core/webBuild.js'
import { writeWgt } from '../core/wgt.js'

/**
 * @param {Record<string, any>} options
 */
export async function wgtCommand(options) {
  const logger = new Logger(options)
  const config = await loadConfig()
  const { project } = await resolveProject(config, options.project, options.cwd)

  let resourcesDir = path.resolve(project.projectDir, String(project.webBuild?.outputDir ?? 'dist/build/app'))
  if (options.skipWeb) {
    if (!(await exists(path.join(resourcesDir, 'app-service.js')))) {
      throw new Error('--skip-web 但前端产物不存在，请先构建')
    }
    logger.info(`跳过前端构建，使用 ${resourcesDir}`)
  } else {
    resourcesDir = (await runWebBuild(project, logger)).dir
  }

  const { manifest } = await readProjectManifest(project.projectDir)
  const appid = String(project.appid ?? manifest.appid)
  const outputDir = path.resolve(
    options.out ?? path.join(project.projectDir, 'unpackage/release/wgt'),
  )
  await ensureDir(outputDir)

  logger.step('生成 wgt')
  const result = await writeWgt({ resourcesDir, outputFile: path.join(outputDir, `${appid}.wgt`) })
  logger.success(`wgt：${result.file}（${(result.size / 1024 / 1024).toFixed(1)} MB）`)
  logger.info(`sha256：${result.sha256}`)

  logger.output('wgt', { ok: true, file: result.file, sha256: result.sha256, size: result.size })
  return result
}
