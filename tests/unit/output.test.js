import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PackError } from '../../src/core/errors.js'
import { fileHash } from '../../src/core/hash.js'
import { apkBaseName, pruneApks, publishApk, resolveApkPrefix } from '../../src/core/output.js'

const logger = { detail() {}, info() {}, warn() {}, success() {}, step() {} }

/**
 * @param {string} dir
 * @param {string[]} names
 */
async function touchAll(dir, names) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  for (const name of names) {
    await writeFile(path.join(dir, name), `content:${name}`, 'utf8')
  }
}

test('APK 基名沿用展示名清洗规则', () => {
  assert.equal(apkBaseName('PRO DIS V2', '2.1.24', 234), 'PRO-DIS-V2_2.1.24_234')
  assert.equal(apkBaseName('!!!', '1.0.0', 1), 'app_1.0.0_1')
})

test('APK 前缀：显式 outputPrefix > 展示名 > 项目标识/appid', () => {
  assert.equal(resolveApkPrefix({ outputPrefix: 'PRO-PHONE' }, { name: '生产小助手', appid: '__UNI__A' }), 'PRO-PHONE')
  assert.equal(resolveApkPrefix({ name: 'uni-uni5658b71' }, { name: 'PRO DIS V2', appid: '__UNI__A' }), 'PRO DIS V2')
  // 中文展示名清洗后为空，回退项目标识，避免所有中文项目都变成 app_
  assert.equal(resolveApkPrefix({ name: 'uni-uni5658b71' }, { name: '生产小助手', appid: '__UNI__5658B71' }), 'uni-uni5658b71')
  assert.equal(resolveApkPrefix({}, { name: '生产小助手', appid: '__UNI__5658B71' }), '__UNI__5658B71')
  assert.equal(resolveApkPrefix({}, {}), 'app')
})

test('发布 APK：时间戳副本 + latest 硬链 + 清单 + builds.jsonl', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-apk-'))
  try {
    const source = path.join(dir, 'gradle-output.apk')
    const outputDir = path.join(dir, 'apk')
    const workDir = path.join(dir, 'work')
    await writeFile(source, 'fake-apk-content', 'utf8')

    const result = await publishApk({
      apk: source,
      outputDir,
      baseName: 'PRO-DIS-V2_2.1.24_234',
      mode: 'release',
      workDir,
      record: { appid: '__UNI__2E0DF29', packageName: 'uni.app.UNIF1A8702' },
      logger,
    })

    assert.match(path.basename(result.target), /^PRO-DIS-V2_2\.1\.24_234_release_\d{8}_\d{4}\.apk$/)
    assert.equal(path.basename(result.latest), 'PRO-DIS-V2_2.1.24_234_release_latest.apk')
    assert.equal(result.latestLinked, true)
    assert.equal(result.sha256, await fileHash(result.target))
    assert.equal(result.recordFile, `${result.target}.json`)

    const [targetStat, latestStat] = await Promise.all([stat(result.target), stat(result.latest)])
    assert.equal(targetStat.ino, latestStat.ino)
    assert.ok(targetStat.nlink >= 2)

    const record = JSON.parse(await readFile(result.recordFile, 'utf8'))
    assert.equal(record.appid, '__UNI__2E0DF29')
    assert.equal(record.packageName, 'uni.app.UNIF1A8702')
    assert.equal(record.mode, 'release')
    assert.equal(record.apk, result.target)
    assert.equal(record.latest, result.latest)
    assert.equal(record.sha256, result.sha256)
    assert.equal(record.size, 16)
    assert.match(record.builtAt, /^\d{4}-\d{2}-\d{2}T/)

    const lines = (await readFile(path.join(outputDir, 'builds.jsonl'), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 1)
    assert.deepEqual(JSON.parse(lines[0]), record)

    const state = JSON.parse(await readFile(path.join(workDir, '.uni-pack-build.json'), 'utf8'))
    assert.equal(state.sha256, result.sha256)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('--prune 按 mode 保留最近 n 个时间戳包，latest 与记录不动', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-prune-'))
  try {
    const outputDir = path.join(dir, 'apk')
    await touchAll(outputDir, [
      'P_1.0.0_1_release_20261120_1000.apk',
      'P_1.0.0_1_release_20261120_1000.apk.json',
      'P_1.0.0_1_release_20261121_1000.apk',
      'P_1.0.0_1_release_20261121_1000.apk.json',
      'P_1.0.0_1_release_20261122_1000.apk',
      'P_1.0.0_1_release_20261122_1000.apk.json',
      'P_1.0.0_1_debug_20261120_1000.apk',
      'P_1.0.0_1_release_latest.apk',
      'builds.jsonl',
    ])

    const deleted = await pruneApks({ outputDir, mode: 'release', keep: 1, logger })
    assert.deepEqual(deleted.sort(), [
      'P_1.0.0_1_release_20261120_1000.apk',
      'P_1.0.0_1_release_20261121_1000.apk',
    ])
    assert.equal(await existsPath(path.join(outputDir, 'P_1.0.0_1_release_20261122_1000.apk')), true)
    assert.equal(await existsPath(path.join(outputDir, 'P_1.0.0_1_release_20261121_1000.apk.json')), false)
    assert.equal(await existsPath(path.join(outputDir, 'P_1.0.0_1_debug_20261120_1000.apk')), true)
    assert.equal(await existsPath(path.join(outputDir, 'P_1.0.0_1_release_latest.apk')), true)
    assert.equal(await existsPath(path.join(outputDir, 'builds.jsonl')), true)

    const rest = await pruneApks({ outputDir, mode: 'release', keep: 0, logger })
    assert.deepEqual(rest, ['P_1.0.0_1_release_20261122_1000.apk'])
    assert.equal(await existsPath(path.join(outputDir, 'P_1.0.0_1_release_latest.apk')), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('--prune 非法值按配置错误处理', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-prune-bad-'))
  try {
    await assert.rejects(
      pruneApks({ outputDir: dir, keep: -1, logger }),
      (error) => error instanceof PackError && error.code === 2 && /非负整数/.test(error.message),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/**
 * @param {string} file
 */
async function existsPath(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}
