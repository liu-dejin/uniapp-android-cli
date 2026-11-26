import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveDebugBase,
  resolveDebugDevice,
  resolveDebugLogs,
  resolveDebugStrategy,
} from '../../src/core/debugPreset.js'

test('调试策略：预设可走 HBuilderX，基座相关参数强制回退 uni-pack 流程', () => {
  assert.equal(resolveDebugStrategy({}, { strategy: 'hbuilderx' }), 'hbuilderx')
  assert.equal(resolveDebugStrategy({}, {}), 'legacy')
  assert.equal(resolveDebugStrategy({ hbuilderx: true }, {}), 'hbuilderx')
  assert.equal(resolveDebugStrategy({ playground: 'custom' }, {}), 'hbuilderx')
  assert.equal(resolveDebugStrategy({ device: 'x' }, { strategy: 'hbuilderx' }), 'hbuilderx')
  // --push/--install 等是 uni-pack 自己的基座流程
  assert.equal(resolveDebugStrategy({ push: true }, { strategy: 'hbuilderx' }), 'legacy')
  assert.equal(resolveDebugStrategy({ install: true }, { strategy: 'hbuilderx' }), 'legacy')
  assert.equal(resolveDebugStrategy({ base: 'app.apk' }, { strategy: 'hbuilderx' }), 'legacy')
})

test('基座类型：命令行 > 项目预设 > 默认 standard/local', () => {
  assert.deepEqual(resolveDebugBase({}, {}), { playground: 'standard', customType: 'local' })
  assert.deepEqual(resolveDebugBase({}, { playground: 'custom', customType: 'device' }), {
    playground: 'custom',
    customType: 'device',
  })
  assert.deepEqual(resolveDebugBase({ playground: 'STANDARD' }, { playground: 'custom' }), {
    playground: 'standard',
    customType: 'local',
  })
  assert.deepEqual(resolveDebugBase({ customType: 'DEVICE' }, {}), {
    playground: 'standard',
    customType: 'device',
  })
})

test('设备与日志：命令行 > 项目预设', () => {
  assert.equal(resolveDebugDevice({}, { device: '33538ccc' }), '33538ccc')
  assert.equal(resolveDebugDevice({ device: 'V1963A' }, { device: '33538ccc' }), 'V1963A')
  assert.equal(resolveDebugDevice({}, {}), '')
  assert.equal(resolveDebugLogs({}, { logs: true }), true)
  assert.equal(resolveDebugLogs({}, {}), false)
})
