import assert from 'node:assert/strict'
import test from 'node:test'
import { matchDevice, pickDevice } from '../../src/core/adb.js'
import { PackError } from '../../src/core/errors.js'

const devices = [
  { serial: '33538ccc', state: 'device', model: 'V1963A' },
  { serial: '192.168.1.35:41239', state: 'device', model: 'PLK110' },
  { serial: 'emulator-5554', state: 'offline', model: 'sdk_gphone64_x86_64' },
]

test('设备匹配：完整序列号 / 型号 / 唯一子串', () => {
  assert.equal(matchDevice(devices, '33538ccc')?.serial, '33538ccc')
  assert.equal(matchDevice(devices, 'V1963A')?.serial, '33538ccc')
  assert.equal(matchDevice(devices, '33538')?.serial, '33538ccc')
  assert.equal(matchDevice(devices, 'plk110')?.serial, '192.168.1.35:41239')
  assert.equal(matchDevice(devices, '192.168.1.35')?.serial, '192.168.1.35:41239')
  assert.equal(matchDevice(devices, 'not-exist'), null)
})

test('设备匹配：多候选时报歧义', () => {
  assert.throws(
    () => matchDevice(devices, '3'),
    (error) => error instanceof PackError && error.code === 7 && /不唯一/.test(error.message),
  )
})

test('pickDevice：不传参数时取第一台在线设备，传参数支持模糊匹配', () => {
  assert.equal(pickDevice(devices)?.serial, '33538ccc')
  assert.equal(pickDevice(devices, 'V1963A')?.serial, '33538ccc')
  assert.throws(
    () => pickDevice(devices, 'nope'),
    (error) => error instanceof PackError && error.code === 7 && /找不到设备/.test(error.message),
  )
  assert.throws(
    () => pickDevice([], ''),
    (error) => error instanceof PackError && error.code === 7,
  )
})
