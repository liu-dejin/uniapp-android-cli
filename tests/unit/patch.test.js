import assert from 'node:assert/strict'
import test from 'node:test'
import { replaceExactlyOnce } from '../../src/core/patch/gradle.js'
import { extractFeatureNames, extractPermissionNames } from '../../src/core/project.js'

test('replaceExactlyOnce 命中一次时替换成功', () => {
  const result = replaceExactlyOnce('versionCode 1', /versionCode\s+\d+/, 'versionCode 2', 'versionCode')
  assert.equal(result, 'versionCode 2')
})

test('replaceExactlyOnce 未命中时报错', () => {
  assert.throws(() => replaceExactlyOnce('nothing', /versionCode\s+\d+/, 'x', 'versionCode'), /期望命中 1 次/)
})

test('replaceExactlyOnce 多次命中时报错', () => {
  assert.throws(() => replaceExactlyOnce('a 1 a 2', /a\s+\d+/, 'x', 'a'), /实际 2 次/)
})

test('提取权限与特性', () => {
  const entries = [
    '<uses-permission android:name="android.permission.INTERNET"/>',
    '<uses-permission android:name="android.permission.WAKE_LOCK"/>',
    '<uses-feature android:name="android.hardware.touchscreen" android:required="false"/>',
  ]
  assert.deepEqual(extractPermissionNames(entries), [
    'android.permission.INTERNET',
    'android.permission.WAKE_LOCK',
  ])
  assert.deepEqual(extractFeatureNames(entries), ['android.hardware.touchscreen|false'])
})
