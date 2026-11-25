import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildGradleEnv } from '../../src/core/gradle.js'
import { patchAppGradle } from '../../src/core/patch/gradle.js'

const TEMPLATE = `apply plugin: 'com.android.application'

android {
    compileSdkVersion 35
    buildToolsVersion '35.0.0'
    namespace 'com.android.simple'
    defaultConfig {
        applicationId "uni.app.UNIF1A8702"
        minSdkVersion 23
        targetSdkVersion 30
        versionCode 200
        versionName "2.0.0"
        multiDexEnabled true
    }
    signingConfigs {
        config {
            keyAlias 'old'
            keyPassword 'old'
            storeFile file('aw-pack.jks')
            storePassword 'old'
        }
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}

dependencies {
    implementation fileTree(dir: 'libs', include: ['*.aar', '*.jar'])
}
`

test('签名密码只写成环境变量引用，工作目录不出现明文', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-signing-'))
  try {
    const file = path.join(dir, 'simpleDemo', 'build.gradle')
    await (await import('node:fs/promises')).mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, TEMPLATE, 'utf8')

    await patchAppGradle(file, {
      packageName: 'com.example.app',
      versionName: '1.2.3',
      versionCode: 123,
      minSdkVersion: 21,
      targetSdkVersion: 30,
      compileSdkVersion: 35,
      buildToolsVersion: '35.0.0',
      abiFilters: ['arm64-v8a'],
      signing: {
        keyAlias: 'myalias',
        keyPassword: 'super-secret-key',
        storePassword: 'super-secret-store',
      },
    })

    const text = await readFile(file, 'utf8')
    assert.match(text, /keyPassword System\.getenv\('UNI_PACK_KEY_PASS'\)/)
    assert.match(text, /storePassword System\.getenv\('UNI_PACK_STORE_PASS'\)/)
    assert.match(text, /keyAlias 'myalias'/)
    assert.doesNotMatch(text, /super-secret/)
    assert.match(text, /applicationId "com\.example\.app"/)
    assert.match(text, /versionName "1\.2\.3"/)
    assert.match(text, /versionCode 123/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Gradle 子进程环境注入签名密码，未配置签名时不注入', () => {
  const withSigning = buildGradleEnv({
    javaHome: 'C:/jdk',
    androidSdkDir: 'C:/sdk',
    signing: { storePassword: 's3cret', keyPassword: 'k3cret' },
  })
  assert.equal(withSigning.UNI_PACK_STORE_PASS, 's3cret')
  assert.equal(withSigning.UNI_PACK_KEY_PASS, 'k3cret')
  assert.equal(withSigning.JAVA_HOME, 'C:/jdk')

  const withoutSigning = buildGradleEnv({ javaHome: 'C:/jdk', androidSdkDir: 'C:/sdk' })
  assert.equal(withoutSigning.UNI_PACK_STORE_PASS, undefined)
  assert.equal(withoutSigning.UNI_PACK_KEY_PASS, undefined)
})
