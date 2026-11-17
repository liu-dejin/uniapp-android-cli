import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  detectProject,
  detectVueVersion,
  missingAppKeyHint,
  normalizeManifest,
  readProjectManifest,
  readProjectPackage,
  readVueVersion,
} from '../../src/core/project.js'
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

test('HBuilderX 版本取 about/package.json 前两段，编译器版本回退到上次产物', async () => {  assert.equal(normalizeHbuilderxVersion('5.34.2026102909'), '5.34')
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

test('项目根 AndroidManifest 的包名兜底转小写，与 HBuilderX 打包一致', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-pkg-'))
  try {
    await writeFileAt(
      dir,
      ['AndroidManifest.xml'],
      '<?xml version="1.0" encoding="utf-8"?>\n<manifest package="uni.uni5658B71" />',
    )
    assert.equal(await readProjectPackage(dir), 'uni.uni5658b71')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Vue 版本：显式 3 为 Vue 3，缺省按 Vue 2', () => {
  assert.equal(readVueVersion({ vueVersion: '3' }), 3)
  assert.equal(readVueVersion({ vueVersion: '2' }), 2)
  assert.equal(readVueVersion({}), 2)
})

test('CLI 项目从 package.json 推断 Vue 版本', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-vue-'))
  try {
    await writeFileAt(
      dir,
      ['package.json'],
      JSON.stringify({ dependencies: { vue: '^2.7.16', '@dcloudio/uni-app': '2.0.2-5030320261023001' } }),
    )
    assert.equal(await detectVueVersion(dir, {}, 'cli'), 2)

    await writeFileAt(
      dir,
      ['package.json'],
      JSON.stringify({ dependencies: { vue: '^3.4.21', '@dcloudio/uni-app': '3.0.0-50304' } }),
    )
    assert.equal(await detectVueVersion(dir, {}, 'cli'), 3)

    // HBuilderX 项目没写 vueVersion 时按 Vue 2，不看 package.json
    assert.equal(await detectVueVersion(dir, {}, 'hbuilderx'), 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('缺少 AppKey 时提示运行时症状与修复方式', () => {
  assert.match(missingAppKeyHint(''), /未配置appkey或配置错误/)
  assert.match(missingAppKeyHint(undefined), /--appkey/)
  assert.equal(missingAppKeyHint('644d2d1528c5ee62ec27d990c6308db4'), '')
})
