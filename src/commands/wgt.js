import path from 'node:path'
import { loadConfig, resolveProject } from '../core/config.js'
import { exists } from '../core/fsx.js'
import { resolveHbuilderx } from '../core/hbuilderx.js'
import { Logger } from '../core/logger.js'
import { detectVueVersion, normalizeManifest, readProjectManifest } from '../core/project.js'
import { assertResourceVersion } from '../core/resourceVersion.js'
import { runWebBuild } from '../core/webBuild.js'
import { writeWgt } from '../core/wgt.js'

/**
 * @param {Record<string, any>} options
 */
export async function wgtCommand(options) {
  const logger = new Logger(options)
  const config = await loadConfig()
  const { project } = await resolveProject(config, options.project, options.cwd)
  const { manifest, type } = await readProjectManifest(project.projectDir)
  project.type = type
  const vueVersion = await detectVueVersion(project.projectDir, manifest, type)
  const resolved = normalizeManifest(
    manifest,
    {
      appid: project.appid,
      name: project.name,
      versionName: project.versionName,
      versionCode: project.versionCode,
    },
    { validate: false },
  )

  const hbuilderx = type === 'hbuilderx' ? await resolveHbuilderx(config, { project }) : null
  let resourcesDir = path.resolve(
    project.projectDir,
    String(project.webBuild?.outputDir ?? (type === 'hbuilderx' ? 'unpackage/dist/build/app-plus' : 'dist/build/app')),
  )
  if (options.skipWeb) {
    if (!(await exists(path.join(resourcesDir, 'app-service.js')))) {
      throw new Error('--skip-web 但前端产物不存在，请先构建')
    }
    logger.info(`跳过前端构建，使用 ${resourcesDir}`)
  } else {
    resourcesDir = (await runWebBuild(project, logger, { hbuilderx: hbuilderx ?? undefined, vueVersion })).dir
  }

  const resourceVersion = await assertResourceVersion({
    resourcesDir,
    expected: resolved,
    skip: Boolean(options.skipResourceCheck),
    logger,
  })

  const appid = String(project.appid ?? manifest.appid)
  const outputDir = path.resolve(options.out ?? path.join(project.projectDir, 'unpackage/release/wgt'))
  const versionName = resourceVersion.versionName || resolved.versionName
  const versionCode = resourceVersion.versionCode || resolved.versionCode

  logger.step('生成 wgt')
  const result = await writeWgt({ resourcesDir, outputDir, appid, versionName, versionCode })
  logger.success(`wgt：${result.file}（${(result.size / 1024 / 1024).toFixed(1)} MB）`)
  logger.info(`版本清单：${result.meta}`)
  logger.info(`固定入口：${result.latest}（硬链到最新版本）`)
  logger.info(`sha256：${result.sha256}`)

  logger.output('wgt', {
    ok: true,
    file: result.file,
    latest: result.latest,
    meta: result.meta,
    sha256: result.sha256,
    size: result.size,
    versionName,
    versionCode,
    resourceVersion: resourceVersion.versionName,
    resourceVersionCode: resourceVersion.versionCode,
  })
  return result
}
