import assert from 'node:assert/strict'
import test from 'node:test'
import { assertVersionMatch, decodeCompilerVersion } from '../../src/core/version.js'

test('解码 uni-app 版本号', () => {
  assert.equal(decodeCompilerVersion('3.0.0-5030420261029002'), '5.34')
  assert.equal(decodeCompilerVersion('3.0.0-4080520251106001'), '4.85')
  assert.equal(decodeCompilerVersion('2.0.2-5030320261023001'), '5.33')
  assert.equal(decodeCompilerVersion('not-a-version'), null)
})

test('版本一致性判断', () => {
  assert.equal(assertVersionMatch({ compiler: '5.34', sdk: '5.34' }).ok, true)
  assert.equal(assertVersionMatch({ compiler: '4.85', sdk: '5.34' }).ok, false)
  assert.equal(assertVersionMatch({ compiler: null, sdk: '5.34' }).unknown, true)
})
