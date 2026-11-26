import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PackError } from '../../src/core/errors.js'
import { resolveSigning } from '../../src/core/signing.js'

/**
 * @param {string} dir
 * @param {Record<string, string>} files
 */
async function writeFiles(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, 'utf8')
  }
}

/**
 * 模拟团队自定义布局：证书与密码文件都不在 certificate/android 下。
 * @param {string} dir
 */
async function makeCustomProject(dir) {
  await writeFiles(dir, {
    'certs/release.jks': 'fake-keystore',
    'signing/release.properties': [
      'storePassword=team-store',
      'keyPassword=team-key',
      'keyAlias=team-alias',
      '',
    ].join('\n'),
  })
}

test('相对 keystore/keystoreProperties 按项目目录解析，别名可只从 properties 读', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-signing-rel-'))
  try {
    await makeCustomProject(dir)
    const signing = await resolveSigning({
      projectDir: dir,
      signing: {
        keystore: 'certs/release.jks',
        keystoreProperties: 'signing/release.properties',
      },
    })
    assert.equal(signing.keystore, path.join(dir, 'certs', 'release.jks'))
    assert.equal(signing.keyAlias, 'team-alias')
    assert.equal(signing.storePassword, 'team-store')
    assert.equal(signing.keyPassword, 'team-key')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('密码优先级：命令行 → 环境变量 → properties；keyPassword 缺省复用 storePassword', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-signing-prio-'))
  try {
    await writeFiles(dir, {
      'app.jks': 'fake',
      'keystore.properties': 'storePassword=file-store\nkeyAlias=alias-from-file\n',
      'env.properties': 'storePassword=env-store\nkeyPassword=env-key\n',
    })
    process.env.UNI_PACK_STORE_PASS = 'from-env'
    try {
      const fromEnv = await resolveSigning({
        projectDir: dir,
        signing: {
          keystore: 'app.jks',
          keystoreProperties: 'keystore.properties',
          storePasswordEnv: 'UNI_PACK_STORE_PASS',
        },
      })
      assert.equal(fromEnv.storePassword, 'from-env')
      // properties 没有 keyPassword 时复用 storePassword
      assert.equal(fromEnv.keyPassword, 'from-env')

      const fromCli = await resolveSigning(
        {
          projectDir: dir,
          signing: { keystore: 'app.jks', keystoreProperties: 'env.properties', keyAlias: 'cli-alias' },
        },
        { storePassword: 'cli-store', keyPassword: 'cli-key' },
      )
      assert.equal(fromCli.storePassword, 'cli-store')
      assert.equal(fromCli.keyPassword, 'cli-key')
      assert.equal(fromCli.keyAlias, 'cli-alias')
    } finally {
      delete process.env.UNI_PACK_STORE_PASS
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('证书/别名/密码缺失时按签名失败处理并给出 hint', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-signing-bad-'))
  try {
    await writeFiles(dir, { 'app.jks': 'fake' })

    await assert.rejects(
      resolveSigning({ projectDir: dir, signing: { keystore: 'nope.jks', keyAlias: 'a' } }),
      (error) => error instanceof PackError && error.code === 6 && /找不到签名证书/.test(error.message),
    )
    await assert.rejects(
      resolveSigning({ projectDir: dir, signing: { keystore: 'app.jks' } }),
      (error) => error instanceof PackError && error.code === 6 && /签名别名/.test(error.message),
    )
    await assert.rejects(
      resolveSigning({ projectDir: dir, signing: { keystore: 'app.jks', keyAlias: 'a' } }),
      (error) => error instanceof PackError && error.code === 6 && /缺少签名密码/.test(error.message),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('绝对路径原样使用', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-signing-abs-'))
  try {
    await writeFiles(dir, { 'abs.jks': 'fake' })
    const signing = await resolveSigning(
      {
        projectDir: path.join(dir, 'project'),
        signing: { keystore: path.join(dir, 'abs.jks'), keyAlias: 'a' },
      },
      { storePassword: 's', keyPassword: 'k' },
    )
    assert.equal(signing.keystore, path.join(dir, 'abs.jks'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
