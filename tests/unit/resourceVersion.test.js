import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertResourceVersion, compareResourceVersion, readResourceVersion } from '../../src/core/resourceVersion.js'
import { PackError } from '../../src/core/errors.js'

const logger = { detail() {}, info() {}, warn() {}, success() {}, step() {} }

test('读取前端产物版本：name/code 缺省时归一化', () => {
  assert.deepEqual(readResourceVersion({ version: { name: '2.1.24', code: '234' } }), {
    versionName: '2.1.24',
    versionCode: 234,
  })
  assert.deepEqual(readResourceVersion({}), { versionName: '', versionCode: 0 })
})

test('版本一致返回 ok，不一致时消息包含两边版本', () => {
  const expected = { versionName: '2.1.24', versionCode: 234 }
  assert.equal(compareResourceVersion({ versionName: '2.1.24', versionCode: 234 }, expected).ok, true)

  const older = compareResourceVersion({ versionName: '2.1.18', versionCode: 228 }, expected)
  assert.equal(older.ok, false)
  assert.match(older.message, /2\.1\.18\(228\)/)
  assert.match(older.message, /2\.1\.24\(234\)/)

  // version.code 在产物里是字符串，按数字比较
  assert.equal(compareResourceVersion({ versionName: '1.0.0', versionCode: 1 }, { versionName: '1.0.0', versionCode: 1 }).ok, true)
})

/**
 * @param {string} dir
 * @param {any} manifest
 */
async function writeResourceManifest(dir, manifest) {
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
}

test('资源版本不一致抛 WEB_BUILD 并给出修复 hint，--skip-resource-check 可跳过', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-resver-'))
  try {
    await writeResourceManifest(dir, { id: '__UNI__AAAAAA', version: { name: '2.1.18', code: '228' } })
    const expected = { versionName: '2.1.24', versionCode: 234 }

    await assert.rejects(
      assertResourceVersion({ resourcesDir: dir, expected, logger }),
      (error) => {
        assert.ok(error instanceof PackError)
        assert.equal(error.code, 4)
        assert.match(error.message, /不一致/)
        assert.match(String(error.hint), /--skip-web/)
        assert.match(String(error.hint), /--skip-resource-check/)
        return true
      },
    )

    const skipped = await assertResourceVersion({ resourcesDir: dir, expected, skip: true, logger })
    assert.deepEqual(skipped, { versionName: '2.1.18', versionCode: 228, skipped: true })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('资源版本一致时返回产物版本且不跳过', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-resver-ok-'))
  try {
    await writeResourceManifest(dir, { id: '__UNI__AAAAAA', version: { name: '2.1.24', code: '234' } })
    const result = await assertResourceVersion({
      resourcesDir: dir,
      expected: { versionName: '2.1.24', versionCode: 234 },
      logger,
    })
    assert.deepEqual(result, { versionName: '2.1.24', versionCode: 234, skipped: false })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('产物目录缺少 manifest.json 时按前端构建失败处理', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-resver-missing-'))
  try {
    await assert.rejects(
      assertResourceVersion({ resourcesDir: dir, expected: { versionName: '1.0.0', versionCode: 1 }, logger }),
      (error) => {
        assert.ok(error instanceof PackError)
        assert.equal(error.code, 4)
        assert.match(error.message, /无法读取前端产物 manifest/)
        return true
      },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
