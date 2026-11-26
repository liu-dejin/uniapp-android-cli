import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {
  buildLaunchArgs,
  cliPath,
  parseHbuilderxCliVersion,
  supportsLaunch,
} from '../../src/core/hbuilderxCli.js'

test('解析 HBuilderX CLI 版本（带 ANSI 颜色 / 旧版本）', () => {
  assert.deepEqual(parseHbuilderxCliVersion('\u001b[1;32m5.34.2026102909\u001b[0m'), {
    major: 5,
    minor: 34,
    patch: 2026102909,
    raw: '5.34.2026102909',
  })
  assert.equal(parseHbuilderxCliVersion('4.87.2025010502')?.major, 4)
  assert.equal(parseHbuilderxCliVersion('与主程序的连接已中断'), null)
})

test('launch 需要 HBuilderX 5.0+', () => {
  assert.equal(supportsLaunch({ major: 5, minor: 0, patch: 0, raw: '5.0.0' }), true)
  assert.equal(supportsLaunch({ major: 4, minor: 99, patch: 0, raw: '4.99.0' }), false)
  assert.equal(supportsLaunch(null), false)
})

test('cli 路径与 platform 对应', () => {
  const cli = cliPath('C:/Soft/HBuilderX')
  assert.equal(path.basename(cli), process.platform === 'win32' ? 'cli.exe' : 'cli')
})

test('launch 参数：项目/设备/自定义基座/界面模式', () => {
  assert.deepEqual(
    buildLaunchArgs({ projectDir: 'C:/project', deviceId: '192.168.1.35:41239' }),
    ['launch', 'app-android', '--project', 'C:/project', '--deviceId', '192.168.1.35:41239'],
  )
  assert.deepEqual(
    buildLaunchArgs({
      projectDir: 'C:/project',
      playground: 'custom',
      customType: 'local',
    }),
    ['launch', 'app-android', '--project', 'C:/project', '--playground', 'custom', '--customType', 'local'],
  )
  assert.deepEqual(
    buildLaunchArgs({
      projectDir: 'C:/project',
      playground: 'custom',
      customType: 'device',
      packageName: 'uni.app.DEMO',
      ui: true,
    }),
    [
      'launch',
      'app-android',
      '--project',
      'C:/project',
      '--playground',
      'custom',
      '--customType',
      'device',
      '--packageName',
      'uni.app.DEMO',
      '--ui',
      'true',
    ],
  )
})
