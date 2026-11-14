import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeManifest } from '../../src/core/project.js'

const manifest = {
  appid: '__UNI__ABCDEF',
  name: 'Demo',
  versionName: '2.1.0',
  versionCode: 210,
  'app-plus': {
    distribute: {
      android: {
        packagename: 'com.demo.app',
        minSdkVersion: 26,
        targetSdkVersion: 33,
        abiFilters: ['arm64-v8a'],
      },
    },
  },
}

test('manifest 优先于配置里的旧快照', () => {
  const result = normalizeManifest(manifest, {
    appid: '__UNI__000000',
    name: 'Old',
    versionName: '2.0.0',
    versionCode: 200,
    package: 'com.old.app',
    minSdkVersion: 21,
    targetSdkVersion: 30,
    abiFilters: ['armeabi-v7a'],
  })

  assert.equal(result.appid, '__UNI__ABCDEF')
  assert.equal(result.name, 'Demo')
  assert.equal(result.versionName, '2.1.0')
  assert.equal(result.versionCode, 210)
  assert.equal(result.packageName, 'com.demo.app')
  assert.equal(result.minSdkVersion, 26)
  assert.equal(result.targetSdkVersion, 33)
  assert.deepEqual(result.abiFilters, ['arm64-v8a'])
})

test('manifest 缺字段时才用配置兜底', () => {
  const result = normalizeManifest(
    { appid: '__UNI__ABCDEF', 'app-plus': { distribute: { android: {} } } },
    {
      name: 'Fallback',
      versionName: '3.0.0',
      versionCode: 300,
      package: 'com.fallback.app',
    },
  )

  assert.equal(result.name, 'Fallback')
  assert.equal(result.versionName, '3.0.0')
  assert.equal(result.versionCode, 300)
  assert.equal(result.packageName, 'com.fallback.app')
})
