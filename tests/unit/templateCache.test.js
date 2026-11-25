import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  TEMPLATE_STATE_FILE,
  cleanIncrementalInputs,
  readTemplateState,
  templateFingerprint,
  writeTemplateState,
} from '../../src/core/templateCache.js'

/**
 * @param {string} root
 * @param {string} relative
 * @param {string} [content]
 */
async function touch(root, relative, content = 'x') {
  const file = path.join(root, relative)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

/**
 * @param {string} dir
 */
async function makeTemplate(dir) {
  for (const relative of [
    'build.gradle',
    'settings.gradle',
    'gradle/wrapper/gradle-wrapper.properties',
    'simpleDemo/build.gradle',
    'simpleDemo/src/main/AndroidManifest.xml',
  ]) {
    await touch(dir, relative)
  }
  return dir
}

test('模板指纹包含 SDK 路径/版本与关键文件大小，改动后可区分', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-template-fp-'))
  try {
    const templateRoot = await makeTemplate(path.join(dir, 'HBuilder-Integrate-AS'))
    const sdk = { root: path.join(dir, 'sdk-a'), templateRoot, version: '5.34' }
    const first = await templateFingerprint(sdk)
    assert.match(first.fingerprint, /^[0-9a-f]{64}$/)
    assert.equal(first.files.length, 5)
    assert.equal((await templateFingerprint({ ...sdk })).fingerprint, first.fingerprint)

    // 版本变化
    assert.notEqual((await templateFingerprint({ ...sdk, version: '4.45' })).fingerprint, first.fingerprint)
    // 模板文件内容/大小变化（mtime 可能相同，指纹带 size）
    await touch(templateRoot, 'simpleDemo/build.gradle', 'changed-content-longer-than-before')
    assert.notEqual((await templateFingerprint({ ...sdk })).fingerprint, first.fingerprint)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('模板状态读写与缺失时返回 null', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-template-state-'))
  try {
    assert.equal(await readTemplateState(dir), null)
    await writeTemplateState(dir, { fingerprint: 'abc', version: '5.34' })
    assert.deepEqual(await readTemplateState(dir), { fingerprint: 'abc', version: '5.34' })
    assert.equal((await stat(path.join(dir, TEMPLATE_STATE_FILE))).isFile(), true)
    assert.match(await readFile(path.join(dir, TEMPLATE_STATE_FILE), 'utf8'), /fingerprint/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('增量构建只清理会残留的输入，保留 build 与 .gradle', async () => {
  const gradleRoot = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-clean-'))
  try {
    await touch(gradleRoot, 'simpleDemo/src/main/assets/apps/__UNI__AAAA/www/app-service.js')
    await touch(gradleRoot, 'simpleDemo/src/main/assets/apps/__UNI__BBBB/www/app-service.js')
    await touch(gradleRoot, 'simpleDemo/src/main/assets/data/dcloud_control.xml')
    await touch(gradleRoot, 'simpleDemo/src/main/assets/dcloud_uniplugins.json')
    await touch(gradleRoot, 'simpleDemo/libs/uni-app.aar')
    await touch(gradleRoot, 'simpleDemo/src/main/jniLibs/arm64-v8a/libx.so')
    await touch(gradleRoot, 'simpleDemo/build/outputs/apk/release/x.apk')
    await touch(gradleRoot, '.gradle/cache.bin')

    const removed = await cleanIncrementalInputs({ gradleRoot, appid: '__UNI__AAAA' })
    assert.deepEqual(removed.sort(), [
      path.join('simpleDemo', 'libs'),
      path.join('simpleDemo', 'src', 'main', 'assets', 'apps', '__UNI__AAAA'),
      path.join('simpleDemo', 'src', 'main', 'assets', 'data'),
      path.join('simpleDemo', 'src', 'main', 'assets', 'dcloud_uniplugins.json'),
      path.join('simpleDemo', 'src', 'main', 'jniLibs'),
    ])

    // 其他 appid、build 产物、.gradle 保留
    assert.equal(await exists(path.join(gradleRoot, 'simpleDemo/src/main/assets/apps/__UNI__BBBB/www/app-service.js')), true)
    assert.equal(await exists(path.join(gradleRoot, 'simpleDemo/build/outputs/apk/release/x.apk')), true)
    assert.equal(await exists(path.join(gradleRoot, '.gradle/cache.bin')), true)
  } finally {
    await rm(gradleRoot, { recursive: true, force: true })
  }
})

/**
 * @param {string} file
 */
async function exists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}
