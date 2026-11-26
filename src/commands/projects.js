import path from 'node:path'
import { loadConfig } from '../core/config.js'
import { Logger } from '../core/logger.js'

/**
 * @param {Record<string, any>} options
 */
export async function projectsCommand(options) {
  const logger = new Logger(options)
  const config = await loadConfig()
  const entries = Object.entries(config.projects ?? {})
  const projects = entries.map(([name, entry]) => ({
    name,
    projectDir: String(entry.projectDir ?? ''),
    type: String(entry.type ?? ''),
    outputDir: String(entry.outputDir ?? ''),
  }))

  if (projects.length === 0) {
    logger.warn('还没有登记项目：在项目目录执行 uni-pack init -p .')
  } else {
    logger.step(`已登记项目（${projects.length}）`)
    for (const project of projects) {
      const basename = path.basename(project.projectDir)
      logger.info(`${project.name}${basename && basename !== project.name ? `（${basename}）` : ''}  ${project.projectDir}  ${project.type || '(未知类型)'}`)
    }
    logger.info('可以这样用：uni-pack build -p <项目名或目录名>')
  }
  logger.output('projects', { ok: true, projects })
  return projects
}
