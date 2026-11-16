import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { integrateUtsPlugins, scanUtsPlugins } from '../../src/core/patch/utsPlugins.js'
import { applyAssets } from '../../src/core/patch/assets.js'

const logger = { detail() {}, info() {}, warn() {}, success() {}, step() {} }

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
 * @param {string} root
 */
async function makeGradleProject(root) {
  await touch(root, ['build.gradle'], `
buildscript {
    repositories {
        google()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.7.3'
    }
}
allprojects {
    repositories {
        google()
    }
}
`)
  await touch(root, ['settings.gradle'], "include ':simpleDemo'\n")
  await touch(root, ['simpleDemo', 'build.gradle'], `
apply plugin: 'com.android.application'
android {
    compileSdkVersion 35
    defaultConfig {
        minSdkVersion 21
    }
}
dependencies {
    implementation fileTree(dir: 'libs', include: ['*.aar'])
}
`)
  await touch(root, ['simpleDemo', 'libs', 'lib.5plus.base-release.aar'], '')
  await touch(root, ['simpleDemo', 'src', 'main', 'assets', 'data', 'dcloud_control.xml'], '')
}

test('扫描构建产物里的 UTS 插件并生成 Android Library 模块', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-uts-'))
  try {
    const resourcesDir = path.join(dir, 'dist')
    const pluginDir = path.join(resourcesDir, 'uni_modules', 'demo-sse', 'utssdk', 'app-android')
    await touch(pluginDir, ['src', 'index.kt'], 'package uts.sdk.modules.demoSse\nclass Demo\n')
    await touch(pluginDir, ['AndroidManifest.xml'], '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="uts.sdk.modules.demoSse"><uses-permission android:name="android.permission.INTERNET"/></manifest>')
    await touch(pluginDir, ['config.json'], '{"minSdkVersion":21,"hooksClass":"uts.sdk.modules.demoSse.DemoHook","components":[{"name":"demo-view","class":"uts.sdk.modules.demoSse.DemoView"}]}')
    await touch(resourcesDir, ['uni_modules', 'broken', 'utssdk', 'app-android', 'config.json'], '{}')

    const plugins = await scanUtsPlugins({ projectDir: dir, resourcesDir })
    const demo = plugins.find((plugin) => plugin.name === 'demo-sse')
    assert.equal(demo.usable, true)
    assert.equal(plugins.find((plugin) => plugin.name === 'broken').usable, false)

    const gradleRoot = path.join(dir, 'gradle')
    await makeGradleProject(gradleRoot)
    const result = await integrateUtsPlugins({
      plugins,
      gradleRoot,
      mainModule: 'simpleDemo',
      compileSdkVersion: 35,
      logger,
    })
    assert.deepEqual(result.modules.map((module) => module.moduleName), ['uts-demo-sse'])
    assert.equal(result.modules[0].namespace, 'uts.sdk.modules.demoSse')

    const moduleGradle = await readFile(path.join(gradleRoot, 'uts-demo-sse', 'build.gradle'), 'utf8')
    assert.match(moduleGradle, /namespace 'uts\.sdk\.modules\.demoSse'/)
    assert.match(moduleGradle, /kotlin-android/)
    assert.match(moduleGradle, /compileOnly fileTree\(include: \['\*\.aar'\], dir: '\.\.\/simpleDemo\/libs'\)/)

    const settings = await readFile(path.join(gradleRoot, 'settings.gradle'), 'utf8')
    assert.match(settings, /include ':uts-demo-sse'/)

    const appGradle = await readFile(path.join(gradleRoot, 'simpleDemo', 'build.gradle'), 'utf8')
    assert.match(appGradle, /implementation project\(':uts-demo-sse'\)/)
    assert.match(appGradle, /UTSHooksClassArray/)
    assert.match(appGradle, /kotlin-stdlib/)

    const rootGradle = await readFile(path.join(gradleRoot, 'build.gradle'), 'utf8')
    assert.match(rootGradle, /kotlin-gradle-plugin:2\.2\.0/)

    const uniplugins = JSON.parse(
      await readFile(path.join(gradleRoot, 'simpleDemo', 'src', 'main', 'assets', 'dcloud_uniplugins.json'), 'utf8'),
    )
    assert.deepEqual(uniplugins.nativePlugins[0].plugins, [
      { type: 'component', name: 'demo-view', class: 'uts.sdk.modules.demoSse.DemoView' },
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('只有 .uts 源码（未编译）时不生成模块', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-uts-raw-'))
  try {
    const resourcesDir = path.join(dir, 'dist')
    await touch(resourcesDir, ['uni_modules', 'raw', 'utssdk', 'app-android', 'src', 'index.uts'], 'export {}')
    const plugins = await scanUtsPlugins({ projectDir: dir, resourcesDir })
    assert.equal(plugins.length, 1)
    assert.equal(plugins[0].usable, false)

    const gradleRoot = path.join(dir, 'gradle')
    await makeGradleProject(gradleRoot)
    const result = await integrateUtsPlugins({ plugins, gradleRoot, mainModule: 'simpleDemo', compileSdkVersion: 35, logger })
    assert.deepEqual(result.modules, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('www 不包含 UTS 的 utssdk 编译期资源', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-uts-www-'))
  try {
    const moduleDir = path.join(dir, 'simpleDemo')
    const dataDir = path.join(dir, 'data')
    const resourcesDir = path.join(dir, 'dist')
    await touch(moduleDir, ['src', 'main', 'res', 'values', 'strings.xml'], '<resources><string name="app_name">Demo</string></resources>')
    await touch(dataDir, ['dcloud_control.xml'], '<hbuilder/>')
    await touch(resourcesDir, ['app-service.js'], '')
    await touch(resourcesDir, ['uni_modules', 'demo', 'utssdk', 'app-android', 'src', 'index.kt'], 'package demo')
    await touch(resourcesDir, ['uni_modules', 'demo', 'static', 'logo.png'], 'x')

    await applyAssets({
      moduleDir,
      dataDir,
      resourcesDir,
      appid: '__UNI__ABCDEF',
      appName: 'Demo',
      versionName: '1.0.0',
      debug: false,
      projectDir: dir,
    })

    const www = path.join(moduleDir, 'src', 'main', 'assets', 'apps', '__UNI__ABCDEF', 'www')
    assert.equal(await existsPath(path.join(www, 'app-service.js')), true)
    assert.equal(await existsPath(path.join(www, 'uni_modules', 'demo', 'utssdk')), false)
    assert.equal(await existsPath(path.join(www, 'uni_modules', 'demo', 'static', 'logo.png')), true)
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
