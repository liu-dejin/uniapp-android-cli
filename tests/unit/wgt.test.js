import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PackError } from '../../src/core/errors.js'
import { fileHash } from '../../src/core/hash.js'
import { wgtBaseName, writeWgt } from '../../src/core/wgt.js'

/**
 * @param {string} dir
 * @param {Record<string, Buffer | string>} files
 */
async function writeFiles(dir, files) {
  const { mkdir } = await import('node:fs/promises')
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
}

/**
 * @param {string} dir
 * @param {{ appid?: string, versionName?: string, versionCode?: number, size?: number }} [options]
 */
async function makeResources(dir, options = {}) {
  await writeFiles(dir, {
    'manifest.json': JSON.stringify({
      id: options.appid ?? '__UNI__ABCDEF',
      version: { name: options.versionName ?? '2.1.24', code: options.versionCode ?? 234 },
    }),
    '__uniappview.html': '<html></html>',
    // 随机内容避免被 zip 压到 1 MB 以下
    'app-service.js': randomBytes(options.size ?? 1500000),
  })
}

test('wgt 文件名带版本号，非法字符替换为下划线', () => {
  assert.equal(wgtBaseName({ appid: '__UNI__ABCDEF', versionName: '2.1.24' }), '__UNI__ABCDEF-2.1.24')
  assert.equal(wgtBaseName({ appid: '__UNI__ABCDEF', versionName: '2.1.24 beta/1' }), '__UNI__ABCDEF-2.1.24_beta_1')
  assert.equal(wgtBaseName({ appid: '__UNI__ABCDEF', versionName: '' }), '__UNI__ABCDEF')
})

test('写出的 wgt 带同名版本清单，固定名硬链到最新版本', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-wgt-'))
  try {
    const resourcesDir = path.join(dir, 'dist')
    const outputDir = path.join(dir, 'out')
    await makeResources(resourcesDir)

    const result = await writeWgt({
      resourcesDir,
      outputDir,
      appid: '__UNI__ABCDEF',
      versionName: '2.1.24',
      versionCode: 234,
    })

    assert.equal(path.basename(result.file), '__UNI__ABCDEF-2.1.24.wgt')
    assert.equal(path.basename(result.meta), '__UNI__ABCDEF-2.1.24.json')
    assert.equal(path.basename(result.latest), '__UNI__ABCDEF.wgt')
    assert.ok(result.size > 1024 * 1024)
    assert.equal(result.sha256, await fileHash(result.file))

    const meta = JSON.parse(await readFile(result.meta, 'utf8'))
    assert.equal(meta.appid, '__UNI__ABCDEF')
    assert.equal(meta.versionName, '2.1.24')
    assert.equal(meta.versionCode, 234)
    assert.equal(meta.size, result.size)
    assert.equal(meta.sha256, result.sha256)
    assert.match(meta.builtAt, /^\d{4}-\d{2}-\d{2}T/)

    const [fileStat, latestStat] = await Promise.all([stat(result.file), stat(result.latest)])
    assert.equal(fileStat.ino, latestStat.ino)
    assert.ok(fileStat.nlink >= 2)

    // 重复打包同一版本：latest 硬链可被替换而不是报 EEXIST
    const again = await writeWgt({
      resourcesDir,
      outputDir,
      appid: '__UNI__ABCDEF',
      versionName: '2.1.24',
      versionCode: 234,
    })
    assert.equal(again.latest, result.latest)
    assert.equal((await stat(again.latest)).ino, (await stat(again.file)).ino)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('资源不完整或体积异常时按 wgt 失败处理', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-wgt-bad-'))
  try {
    const resourcesDir = path.join(dir, 'dist')
    await writeFiles(resourcesDir, {
      'manifest.json': JSON.stringify({ id: '__UNI__ABCDEF', version: { name: '1.0.0', code: 1 } }),
      'app-service.js': 'console.log(1)',
    })

    await assert.rejects(
      writeWgt({
        resourcesDir,
        outputDir: path.join(dir, 'out'),
        appid: '__UNI__ABCDEF',
        versionName: '1.0.0',
        versionCode: 1,
      }),
      (error) => error instanceof PackError && error.code === 8,
    )

    await writeFiles(resourcesDir, { '__uniappview.html': '<html></html>' })
    await assert.rejects(
      writeWgt({
        resourcesDir,
        outputDir: path.join(dir, 'out'),
        appid: '__UNI__ABCDEF',
        versionName: '1.0.0',
        versionCode: 1,
      }),
      (error) => error instanceof PackError && error.code === 8 && /体积异常/.test(error.message),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
