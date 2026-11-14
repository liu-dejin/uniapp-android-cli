import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { findSdkForVersion, listInstalledSdks, readTemplateDefaults, resolveSdk } from '../../src/core/sdk.js'

/**
 * @param {string} root
 * @param {string[]} parts
 * @param {string} [content]
 */
async function touch(root, parts, content = '') {
  const file = path.join(root, ...parts)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

/**
 * @param {string} dir
 * @param {string} version
 */
async function makeSdk(dir, version) {
  const root = path.join(dir, `Android-SDK@${version}.82692_20261030`)
  await touch(root, ['HBuilder-Integrate-AS', 'simpleDemo', 'build.gradle'], `
android {
    compileSdkVersion 35
    buildToolsVersion '35.0.0'
}
dependencies {
}
`)
  await touch(root, ['HBuilder-Integrate-AS', 'simpleDemo', 'src', 'main', 'AndroidManifest.xml'], '<manifest/>')
  await touch(root, ['HBuilder-Integrate-AS', 'gradlew.bat'], '')
  await touch(root, ['SDK', 'libs', 'lib.5plus.base-release.aar'], '')
  await touch(root, ['SDK', 'assets', 'data', 'dcloud_control.xml'], '<hbuilder/>')
  return root
}

test('按编译器版本匹配已安装的离线 SDK', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-sdk-'))
  try {
    const oldRoot = await makeSdk(dir, '4.45')
    const newRoot = await makeSdk(dir, '5.34')
    const config = { sdk: { searchDirs: [dir] } }

    assert.equal(await findSdkForVersion(config, '5.34'), newRoot)
    assert.equal(await findSdkForVersion(config, '4.45'), oldRoot)
    assert.equal(await findSdkForVersion(config, '9.99'), '')

    const versions = (await listInstalledSdks(config))
      .filter((item) => item.root.startsWith(dir))
      .map((item) => item.version)
    assert.deepEqual(versions.sort(), ['4.45', '5.34'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('显式 sdk.root 优先，没有匹配版本时给出可选版本', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-sdk2-'))
  try {
    const root = await makeSdk(dir, '4.45')
    const config = { sdk: { root, searchDirs: [dir] } }
    const sdk = await resolveSdk(config, { version: '4.45' })
    assert.equal(sdk.root, root)

    await assert.rejects(() => resolveSdk({ sdk: { searchDirs: [dir] } }, { version: '9.99' }), /9\.99/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('模板里的 compileSdk / buildTools 作为老 SDK 的默认值', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-template-'))
  try {
    await touch(dir, ['simpleDemo', 'build.gradle'], `
android {
    compileSdkVersion 31
    buildToolsVersion '31.0.0'
}`)
    const defaults = await readTemplateDefaults(dir)
    assert.equal(defaults.compileSdkVersion, 31)
    assert.equal(defaults.buildToolsVersion, '31.0.0')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
