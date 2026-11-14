import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { detectProject, normalizeManifest, readProjectManifest } from '../../src/core/project.js'
import { parseJsonc } from '../../src/core/fsx.js'
import { normalizeHbuilderxVersion, readLastBuiltVersion } from '../../src/core/hbuilderx.js'
import { readCompilerVersion } from '../../src/core/version.js'

/**
 * @param {string} root
 * @param {string[]} parts
 * @param {string} content
 */
async function writeFileAt(root, parts, content) {
  const file = path.join(root, ...parts)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

test('JSONC 解析：注释、末尾逗号、字符串里的斜杠', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-jsonc-'))
  try {
    const file = path.join(dir, 'manifest.json')
    await writeFile(
      file,
      `{
        // 行注释
        "name": "https://example.com/app",
        /* 块注释 */
        "appid": "__UNI__ABCDEF",
        "text": "逗号在字符串里,}",
        "list": [1, 2,],
      }`,
      'utf8',
    )
    const parsed = parseJsonc(await (await import('node:fs/promises')).readFile(file, 'utf8'))
    assert.equal(parsed.name, 'https://example.com/app')
    assert.equal(parsed.text, '逗号在字符串里,}')
    assert.deepEqual(parsed.list, [1, 2])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('识别 CLI 项目与 HBuilderX 项目', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-project-'))
  try {
    const cliDir = path.join(dir, 'cli')
    await writeFileAt(cliDir, ['src', 'manifest.json'], '{"appid":"__UNI__AAAAAA"}')
    const cli = await detectProject(cliDir)
    assert.equal(cli.type, 'cli')
    assert.equal(cli.manifestFile, path.join(cliDir, 'src', 'manifest.json'))

    const hxDir = path.join(dir, 'hx')
    await writeFileAt(hxDir, ['manifest.json'], '{"appid":"__UNI__BBBBBB", /* c */}')
    const hx = await detectProject(hxDir)
    assert.equal(hx.type, 'hbuilderx')
    assert.equal(hx.inputDir, hxDir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('HBuilderX manifest 带注释也能读取，且缺包名时不阻断 init', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-hx-'))
  try {
    await writeFileAt(
      dir,
      ['manifest.json'],
      `{
        "name": "生产小助手",
        "appid": "__UNI__5658B71",
        "versionName": "1.0.0",
        "versionCode": 1,
        /* 没写 packagename */
      }`,
    )
    const { manifest, type } = await readProjectManifest(dir)
    assert.equal(type, 'hbuilderx')
    const resolved = normalizeManifest(manifest, {}, { validate: false })
    assert.equal(resolved.name, '生产小助手')
    assert.equal(resolved.packageName, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('HBuilderX 版本取 about/package.json 前两段，编译器版本回退到上次产物', async () => {
  assert.equal(normalizeHbuilderxVersion('5.34.2026102909'), '5.34')
  assert.equal(normalizeHbuilderxVersion('4.45.2025010502'), '4.45')

  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-hxver-'))
  try {
    await writeFileAt(
      dir,
      ['unpackage', 'dist', 'build', 'app-plus', 'manifest.json'],
      JSON.stringify({ 'app-plus': { 'uni-app': { compilerVersion: '5.34' } } }),
    )
    assert.equal(await readLastBuiltVersion(dir), '5.34')
    const version = await readCompilerVersion({ type: 'hbuilderx', projectDir: dir })
    assert.equal(version.version, '5.34')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
