import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ensureCoreDependencies, replaceExactlyOnce } from '../../src/core/patch/gradle.js'
import { stripMarkerBlocks } from '../../src/core/patch/template.js'
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

test('补全模板缺失的核心依赖且不重复', () => {
  const source = [
    'dependencies {',
    '    implementation "net.lingala.zip4j:zip4j:2.11.5"',
    '}',
    '',
  ].join('\n')
  const result = ensureCoreDependencies(source)
  assert.match(result, /com\.squareup\.okhttp3:okhttp/)
  assert.match(result, /androidx\.legacy:legacy-support-v4/)
  assert.equal((result.match(/net\.lingala\.zip4j/g) ?? []).length, 1)
  assert.equal(ensureCoreDependencies(result), result)
  assert.throws(() => ensureCoreDependencies('android {}'), /dependencies/)
})

test('清理模板时保留 SMARTPACK CORE DEPS', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-template-'))
  const file = path.join(dir, 'build.gradle')
  try {
    await writeFile(
      file,
      [
        'dependencies {',
        '    // ===== SMARTPACK CORE DEPS START =====',
        '    implementation "net.lingala.zip4j:zip4j:2.11.5"',
        '    // ===== SMARTPACK CORE DEPS END =====',
        '    // ===== SMARTPACK UTS DEPS START =====',
        '    implementation "org.jetbrains.kotlin:kotlin-stdlib:2.2.0"',
        '    // ===== SMARTPACK UTS DEPS END =====',
        '}',
        '',
      ].join('\n'),
    )
    await stripMarkerBlocks(file)
    const text = await readFile(file, 'utf8')
    assert.match(text, /net\.lingala\.zip4j/)
    assert.doesNotMatch(text, /kotlin-stdlib/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
