import path from 'node:path'

/**
 * 项目名可能是中文或带空格，工作目录用清洗后的名字，和旧版本保持一致。
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeWorkName(value) {
  return String(value ?? '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

/**
 * 每个项目一个稳定的构建工作目录：<workDir>/<项目名>。
 * @param {any} config
 * @param {any} project
 * @returns {string}
 */
export function resolveWorkRoot(config, project) {
  return path.join(String(config?.workDir ?? ''), sanitizeWorkName(project?.name ?? 'project'))
}

/**
 * 前端构建（pnpm / HBuilderX 编译器）的临时目录。
 * 默认 <workRoot>/tmp：某些机器的系统 TEMP 有 ACL 问题，esbuild 删除临时文件会被拒绝。
 * 用户显式设置 UNI_PACK_TEMP 时不覆盖。
 * @param {string} workRoot
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ tempDir: string, explicit: boolean }}
 */
export function resolveBuildTempDir(workRoot, env = process.env) {
  const explicit = String(env.UNI_PACK_TEMP ?? '').trim()
  if (explicit) {
    return { tempDir: explicit, explicit: true }
  }
  return { tempDir: path.join(workRoot, 'tmp'), explicit: false }
}

/**
 * @param {string} tempDir
 * @returns {{ TEMP: string, TMP: string }}
 */
export function buildTempEnv(tempDir) {
  return { TEMP: tempDir, TMP: tempDir }
}
