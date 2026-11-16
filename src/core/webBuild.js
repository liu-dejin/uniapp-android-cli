import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { exists, readJson } from './fsx.js'
import { runHbuilderxBuild } from './hbuilderx.js'
import { run } from './process.js'

const REQUIRED = ['manifest.json', 'app-service.js', 'app-config.js', '__uniappview.html']

/**
 * @param {any} project
 * @param {import('./logger.js').Logger} logger
 * @param {{ hbuilderx?: { root: string, version: string }, vueVersion?: 2 | 3 }} [context]
 * @returns {Promise<{ dir: string, manifest: any }>}
 */
export async function runWebBuild(project, logger, context = {}) {
  const config = project.webBuild ?? {}
  const dir = path.resolve(
    project.projectDir,
    String(config.outputDir ?? (project.type === 'hbuilderx' ? 'unpackage/dist/build/app-plus' : 'dist/build/app')),
  )

  if (project.type === 'hbuilderx') {
    const hbuilderx = context.hbuilderx
    if (!hbuilderx) {
      throw new PackError('找不到 HBuilderX，无法编译 HBuilderX 项目', EXIT.WEB_BUILD, {
        hint: '运行 uni-pack init --hbuilderx <HBuilderX 目录>，或在配置 hbuilderx.root 里填写安装路径',
      })
    }
    await runHbuilderxBuild({
      root: hbuilderx.root,
      version: hbuilderx.version,
      inputDir: String(project.inputDir ?? project.projectDir),
      outputDir: dir,
      vueVersion: context.vueVersion ?? 3,
      logger,
    })
  } else {
    const command = String(config.command ?? 'pnpm')
    const args = Array.isArray(config.args) ? config.args : ['run', 'build:app-android']

    logger.step(`构建前端资源：${command} ${args.join(' ')}`)
    try {
      await run(command, args, {
        cwd: project.projectDir,
        onLine: (line) => logger.detail(line),
      })
    } catch (error) {
      throw new PackError('前端构建失败', EXIT.WEB_BUILD, { cause: error })
    }
  }

  if (!(await exists(dir))) {
    throw new PackError(`前端产物目录不存在：${dir}`, EXIT.WEB_BUILD)
  }

  const missing = []
  for (const file of REQUIRED) {
    if (!(await exists(path.join(dir, file)))) {
      missing.push(file)
    }
  }
  if (missing.length > 0) {
    throw new PackError(`前端产物不完整，缺少：${missing.join(', ')}`, EXIT.WEB_BUILD)
  }

  const manifest = await readJson(path.join(dir, 'manifest.json'))
  logger.success(`前端资源就绪：${manifest.id} ${manifest.version?.name ?? ''}`)
  return { dir, manifest }
}
