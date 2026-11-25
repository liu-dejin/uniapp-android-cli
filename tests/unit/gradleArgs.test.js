import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGradleArgs, isConfigurationCacheFailure } from '../../src/core/gradle.js'

test('Gradle 默认参数：守护进程 + 构建缓存 + 并行', () => {
  const args = buildGradleArgs({ task: 'assembleRelease' })
  assert.deepEqual(args, [':simpleDemo:assembleRelease', '--console=plain', '--build-cache', '--parallel'])
  assert.equal(args.includes('--no-daemon'), false)
})

test('CI 与离线场景参数', () => {
  const args = buildGradleArgs({ task: 'assembleDebug', daemon: false, offline: true, configurationCache: true })
  assert.deepEqual(args, [
    ':simpleDemo:assembleDebug',
    '--console=plain',
    '--no-daemon',
    '--build-cache',
    '--parallel',
    '--offline',
    '--configuration-cache',
  ])
  assert.equal(buildGradleArgs({ task: 'assembleRelease', buildCache: false }).includes('--build-cache'), false)
})

test('配置缓存不兼容文案识别：命中失败、忽略成功与普通错误', () => {
  assert.equal(isConfigurationCacheFailure('FAILURE: Configuration cache problems found in this build.'), true)
  assert.equal(isConfigurationCacheFailure('Configuration cache entry discarded with 2 problems.'), true)
  assert.equal(isConfigurationCacheFailure('The build is not compatible with the configuration cache.'), true)
  assert.equal(isConfigurationCacheFailure('Invocation of Task.project at execution time is unsupported.'), true)
  assert.equal(isConfigurationCacheFailure('Configuration cache entry reused successfully.'), false)
  assert.equal(isConfigurationCacheFailure('35 actionable tasks: 35 executed'), false)
  assert.equal(isConfigurationCacheFailure(''), false)
})
