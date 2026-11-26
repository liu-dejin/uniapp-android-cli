import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyAssets } from '../../src/core/patch/assets.js'

const DENSITIES = ['hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']

/**
 * @param {string} file
 * @param {string} content
 */
async function write(file, content) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

/**
 * 构造一个最小构建工程：模板自带默认图标/启动图，模拟 SDK 模板。
 * @param {string} dir
 * @param {any} manifest
 * @param {string[]} warnings
 */
async function makeContext(dir, manifest, warnings) {
  const moduleDir = path.join(dir, 'simpleDemo')
  const dataDir = path.join(dir, 'data')
  const resourcesDir = path.join(dir, 'dist')
  await write(
    path.join(moduleDir, 'src/main/res/values/strings.xml'),
    '<resources><string name="app_name">Demo</string></resources>',
  )
  await write(path.join(moduleDir, 'src/main/res/drawable/icon.png'), 'default-icon')
  for (const density of DENSITIES) {
    await write(path.join(moduleDir, `src/main/res/drawable-${density}/splash.png`), `default-splash-${density}`)
  }
  await write(path.join(dataDir, 'dcloud_control.xml'), '<hbuilder/>')
  await write(path.join(resourcesDir, 'app-service.js'), '')
  return {
    moduleDir,
    dataDir,
    resourcesDir,
    appid: '__UNI__ABCDEF',
    appName: 'Demo',
    versionName: '1.0.0',
    debug: false,
    projectDir: dir,
    manifest,
    logger: { warn: (message) => warnings.push(message) },
  }
}

test('未配置图标与启动图时保留 SDK 默认资源并告警', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-assets-default-'))
  /** @type {string[]} */
  const warnings = []
  try {
    const context = await makeContext(dir, {}, warnings)
    await applyAssets(context)

    const mainDir = path.join(context.moduleDir, 'src/main')
    assert.equal(await readFile(path.join(mainDir, 'res/drawable/icon.png'), 'utf8'), 'default-icon')
    for (const density of DENSITIES) {
      assert.equal(
        await readFile(path.join(mainDir, `res/drawable-${density}/splash.png`), 'utf8'),
        `default-splash-${density}`,
      )
    }
    assert.equal(warnings.length, 2)
    assert.match(warnings[0], /图标/)
    assert.match(warnings[1], /启动图/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('只配置部分密度时，用最高密度补齐其余密度', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-assets-fill-'))
  /** @type {string[]} */
  const warnings = []
  try {
    await write(path.join(dir, 'icons/192x192.png'), 'custom-icon')
    await write(path.join(dir, 'splash/splash-hdpi.png'), 'custom-splash')
    const manifest = {
      'app-plus': {
        distribute: {
          icons: { android: { xxxhdpi: 'icons/192x192.png' } },
          splashscreen: { android: { hdpi: 'splash/splash-hdpi.png' } },
        },
      },
    }
    const context = await makeContext(dir, manifest, warnings)
    await applyAssets(context)

    const mainDir = path.join(context.moduleDir, 'src/main')
    assert.equal(await readFile(path.join(mainDir, 'res/drawable/icon.png'), 'utf8'), 'custom-icon')
    for (const density of DENSITIES) {
      assert.equal(await readFile(path.join(mainDir, `res/drawable-${density}/icon.png`), 'utf8'), 'custom-icon')
      assert.equal(await readFile(path.join(mainDir, `res/drawable-${density}/splash.png`), 'utf8'), 'custom-splash')
    }
    assert.equal(warnings.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('没有 manifest 时也能从默认目录读取图标与启动图', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-assets-fallback-'))
  /** @type {string[]} */
  const warnings = []
  try {
    await write(path.join(dir, 'src/static/app/icons/72x72.png'), 'dir-icon')
    await write(path.join(dir, 'src/static/app/splash/splash-hdpi.png'), 'dir-splash')
    const context = await makeContext(dir, {}, warnings)
    await applyAssets(context)

    const mainDir = path.join(context.moduleDir, 'src/main')
    assert.equal(await readFile(path.join(mainDir, 'res/drawable-hdpi/icon.png'), 'utf8'), 'dir-icon')
    assert.equal(await readFile(path.join(mainDir, 'res/drawable-xxxhdpi/icon.png'), 'utf8'), 'dir-icon')
    assert.equal(await readFile(path.join(mainDir, 'res/drawable-xxxhdpi/splash.png'), 'utf8'), 'dir-splash')
    assert.equal(warnings.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
