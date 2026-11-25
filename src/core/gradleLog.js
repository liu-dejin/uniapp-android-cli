/**
 * Gradle 日志里有两类「同类重复告警」会把真正的错误埋掉：
 * - D8/R8 解析 DCloud AAR 的 Kotlin 2.2 元数据失败（每个 AAR/类一份几十行栈）
 * - lint 报 Kotlin metadata 版本不兼容（每个 AAR 一行）
 * 这里把它们折叠成「N 条同类告警 + 首个样例」，其余行原样保留。
 */

const D8_PARSE = /^WARNING: D8: An error occurred when parsing kotlin metadata/i
const D8_REWRITE = /^WARNING: D8: Unexpected error during rewriting of Kotlin metadata/i
const KOTLIN_METADATA = /^e: file:.*Module was compiled with an incompatible version of Kotlin/i

const LABELS = {
  'd8-parse': 'D8 解析 Kotlin metadata 失败（R8 版本低于 AAR 的 Kotlin 元数据版本）',
  'kotlin-metadata': 'Kotlin 元数据版本不兼容（lint 无法分析高版本 Kotlin 编译的 AAR）',
}

const MAX_SAMPLE_CHARS = 240

/**
 * @param {string} value
 * @param {number} [max]
 */
function truncate(value, max = MAX_SAMPLE_CHARS) {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * 流式折叠器：非重复行立即写出；重复块按 key 计数，结束写摘要。
 */
export class GradleLogAggregator {
  /**
   * @param {{ onLine: (line: string) => void, maxSampleLines?: number }} options
   */
  constructor(options) {
    this.write = options.onLine
    this.maxSampleLines = options.maxSampleLines ?? 2
    /** @type {Map<string, { label: string, count: number, sample: string[] }>} */
    this.groups = new Map()
    /** @type {{ kind: 'd8-rewrite', lines: string[] } | null} */
    this.pending = null
  }

  /** @param {string} line */
  push(line) {
    if (this.pending) {
      if (this.isContinuation(line)) {
        this.pending.lines.push(line)
        return
      }
      this.flushPending()
    }

    if (D8_PARSE.test(line)) {
      this.record('d8-parse', LABELS['d8-parse'], [line])
      return
    }
    if (KOTLIN_METADATA.test(line)) {
      this.record('kotlin-metadata', LABELS['kotlin-metadata'], [line])
      return
    }
    if (D8_REWRITE.test(line)) {
      this.pending = { kind: 'd8-rewrite', lines: [line] }
      return
    }
    this.write(line)
  }

  /**
   * @param {string} line
   */
  isContinuation(line) {
    if (!this.pending) {
      return false
    }
    if (this.pending.lines.length === 1) {
      // 紧跟在 WARNING 后的异常头：com.android.tools.r8.internal.Os0: Should never be called
      return /^[\w.$]+:\s+\S/.test(line) && !/^(WARNING|FAILURE|BUILD|e:|>)/.test(line)
    }
    // 栈帧缩进（制表符或空格）
    return /^\s+\S/.test(line) && !/^\s+(WARNING|FAILURE|BUILD)/.test(line)
  }

  flushPending() {
    const pending = this.pending
    if (!pending) {
      return
    }
    this.pending = null
    const header = pending.lines[1]
    const message = header ? /^[\w.$]+:\s+(.+)$/.exec(header)?.[1] : undefined
    const label = message ? `D8 重写 Kotlin metadata 失败（${message}）` : 'D8 重写 Kotlin metadata 失败'
    this.record(`d8-rewrite:${message ?? ''}`, label, pending.lines)
  }

  /**
   * @param {string} key
   * @param {string} label
   * @param {string[]} lines
   */
  record(key, label, lines) {
    const group = this.groups.get(key) ?? { label, count: 0, sample: [] }
    group.count += 1
    if (group.sample.length === 0) {
      group.sample = lines.slice(0, this.maxSampleLines).map((line) => truncate(line))
    }
    this.groups.set(key, group)
  }

  /**
   * 结束并写出聚合摘要，返回分组（供控制台输出）。
   * @returns {Array<{ label: string, count: number, sample: string[] }>}
   */
  finish() {
    this.flushPending()
    if (this.groups.size === 0) {
      return []
    }
    this.write('')
    this.write('===== 以下重复告警已聚合（原始栈用 --verbose 重跑获取）=====')
    for (const group of this.groups.values()) {
      this.write(`${group.label} ×${group.count}`)
      for (const sample of group.sample) {
        this.write(`  样例：${sample}`)
      }
    }
    return [...this.groups.values()]
  }
}

/**
 * 失败时只保留 FAILURE / What went wrong 前后各若干行，避免把 1 万多行日志塞进终端。
 * @param {string[]} lines
 * @param {{ before?: number, after?: number }} [options]
 * @returns {string}
 */
export function extractFailureContext(lines, options = {}) {
  const before = options.before ?? 15
  const after = options.after ?? 15
  const patterns = [/^FAILURE:/, /What went wrong/i]
  for (const pattern of patterns) {
    const index = lines.findIndex((line) => pattern.test(line))
    if (index >= 0) {
      return lines.slice(Math.max(0, index - before), Math.min(lines.length, index + after + 1)).join('\n')
    }
  }
  const fallback = lines.findIndex((line) => /error:|Caused by:/i.test(line))
  if (fallback >= 0) {
    return lines.slice(Math.max(0, fallback - 5), Math.min(lines.length, fallback + after + 1)).join('\n')
  }
  return ''
}

/**
 * 已知问题直接给修复方向（与上下文一起展示）。
 * @param {string} output
 * @returns {string}
 */
export function knownFailureCause(output) {
  if (/Could not resolve|Could not download|Could not GET/i.test(output)) {
    return '依赖下载失败：检查网络，或先联网成功构建一次再使用 --offline'
  }
  if (/Manifest merger failed/i.test(output)) {
    return 'AndroidManifest 合并失败：检查包名、权限与模板内容是否冲突'
  }
  if (/Duplicate class/i.test(output)) {
    return 'AAR 重复：检查 libs 目录是否有多余的重复依赖'
  }
  if (/SDK location not found|sdk\.dir/i.test(output)) {
    return 'Android SDK 路径不正确：检查配置里的 android.sdkDir 与 local.properties'
  }
  if (/Unsupported class file major version|Unsupported Java/i.test(output)) {
    return 'JDK 版本不匹配：确认 JAVA_HOME 指向 JDK 17+'
  }
  return ''
}

/**
 * @param {{ lines: string[], logFile: string }} options
 * @returns {string}
 */
export function formatFailureHint(options) {
  const cause = knownFailureCause(options.lines.join('\n'))
  let context = extractFailureContext(options.lines)
  if (context.length > 5000) {
    context = `${context.slice(0, 5000)}\n…（已截断）`
  }
  return [cause, context, `完整日志：${options.logFile}`].filter(Boolean).join('\n')
}
