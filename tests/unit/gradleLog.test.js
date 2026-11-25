import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GradleLogAggregator,
  extractFailureContext,
  formatFailureHint,
  knownFailureCause,
} from '../../src/core/gradleLog.js'

/**
 * @param {string[]} lines
 * @param {number} [maxSampleLines]
 */
function aggregate(lines, maxSampleLines) {
  /** @type {string[]} */
  const written = []
  const aggregator = new GradleLogAggregator({ onLine: (line) => written.push(line), maxSampleLines })
  for (const line of lines) {
    aggregator.push(line)
  }
  const groups = aggregator.finish()
  return { written, groups }
}

const STACK = [
  '\tat com.android.tools.r8.kotlin.a0.a(R8_8.7.18:2)',
  '\tat com.android.tools.r8.kotlin.Z.a(R8_8.7.18:185)',
  '\tat com.android.tools.r8.D8.b(R8_8.7.18:17)',
]

const PARSE_WARNING =
  'WARNING: D8: An error occurred when parsing kotlin metadata. This normally happens when using a newer version of kotlin than the kotlin version released when this version of R8 was created.'

test('重复的 D8/Kotlin 告警折叠成 N 条 + 首个样例，普通行原样保留', () => {
  const lines = [
    '> Task :simpleDemo:mergeExtDexRelease',
    PARSE_WARNING,
    PARSE_WARNING,
    PARSE_WARNING,
    "WARNING: D8: Unexpected error during rewriting of Kotlin metadata for class 'io.dcloud.Foo':",
    'com.android.tools.r8.internal.Os0: Should never be called',
    ...STACK,
    "e: file:///C:/cache/uni-chooseMedia/jars/classes.jar!/META-INF/uni.kotlin_module Module was compiled with an incompatible version of Kotlin. The binary version of its metadata is 2.2.0, expected version is 2.0.0.",
    '> Task :simpleDemo:packageRelease',
    "WARNING: D8: Unexpected error during rewriting of Kotlin metadata for class 'io.dcloud.Bar':",
    'com.android.tools.r8.internal.Os0: Should never be called',
    ...STACK,
  ]

  const { written, groups } = aggregate(lines)
  assert.equal(groups.length, 3)
  assert.deepEqual(
    groups.map((group) => group.count),
    [3, 2, 1],
  )
  assert.match(groups[0].label, /D8 解析 Kotlin metadata 失败/)
  assert.match(groups[1].label, /Should never be called/)
  assert.match(groups[2].label, /Kotlin 元数据版本不兼容/)

  const text = written.join('\n')
  // 普通构建行保留，栈帧与重复告警不逐条出现
  assert.match(text, /> Task :simpleDemo:mergeExtDexRelease/)
  assert.match(text, /> Task :simpleDemo:packageRelease/)
  assert.doesNotMatch(text, /\tat com\.android\.tools\.r8/)
  assert.equal(text.split(PARSE_WARNING).length - 1, 1)
  // 摘要带计数和首个样例
  assert.match(text, /D8 解析 Kotlin metadata 失败（R8 版本低于 AAR 的 Kotlin 元数据版本） ×3/)
  assert.match(text, /Should never be called） ×2/)
  assert.match(text, /样例：WARNING: D8: An error occurred when parsing kotlin metadata/)
  assert.match(text, /样例：com\.android\.tools\.r8\.internal\.Os0: Should never be called/)
})

test('异常头不同时按不同类告警分别计数', () => {
  const lines = [
    "WARNING: D8: Unexpected error during rewriting of Kotlin metadata for class 'A':",
    'com.android.tools.r8.internal.Os0: Should never be called',
    ...STACK,
    "WARNING: D8: Unexpected error during rewriting of Kotlin metadata for class 'B':",
    'com.android.tools.r8.internal.Os1: Another failure',
    ...STACK,
  ]
  const { groups, written } = aggregate(lines)
  assert.equal(groups.length, 2)
  assert.deepEqual(
    groups.map((group) => group.count),
    [1, 1],
  )
  assert.doesNotMatch(written.join('\n'), /\tat com\.android\.tools\.r8/)
})

test('没有重复告警时不写摘要', () => {
  const { written, groups } = aggregate(['> Task :a', '> Task :b'])
  assert.deepEqual(groups, [])
  assert.deepEqual(written, ['> Task :a', '> Task :b'])
})

test('失败上下文只截取 FAILURE / What went wrong 前后各 15 行', () => {
  const lines = []
  for (let index = 0; index < 100; index += 1) {
    lines.push(`line-${index}`)
  }
  lines[60] = 'FAILURE: Build failed with an exception.'
  lines[62] = '* What went wrong:'
  lines[63] = 'Execution failed for task :simpleDemo:mergeReleaseResources.'

  const context = extractFailureContext(lines)
  const contextLines = context.split('\n')
  assert.equal(contextLines.length, 31)
  assert.equal(contextLines[15], 'FAILURE: Build failed with an exception.')
  assert.match(context, /What went wrong/)
  assert.doesNotMatch(context, /line-0$/)
})

test('失败 hint = 已知原因 + 上下文 + 完整日志路径', () => {
  const lines = ['> Task :x', 'Could not resolve com.example:lib:1.0', '* What went wrong:', 'FAILURE: Build failed.']
  const hint = formatFailureHint({ lines, logFile: 'C:/logs/gradle-1.log' })
  assert.match(hint, /依赖下载失败/)
  assert.match(hint, /What went wrong/)
  assert.match(hint, /完整日志：C:\/logs\/gradle-1\.log/)
  assert.equal(knownFailureCause('nothing here'), '')
})

test('已知问题识别：Manifest 合并失败与 JDK 不匹配', () => {
  assert.match(knownFailureCause('Manifest merger failed with multiple errors'), /AndroidManifest 合并失败/)
  assert.match(knownFailureCause('Unsupported class file major version 68'), /JDK 版本不匹配/)
})
