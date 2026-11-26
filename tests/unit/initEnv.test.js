import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  askEnvironmentPaths,
  makeAndroidSdkValidator,
  makeHbuilderxValidator,
  makeJdkValidator,
  makeSdkRootValidator,
} from '../../src/core/initEnv.js'

const EXE = process.platform === 'win32' ? '.exe' : ''
const logger = { step() {}, info() {}, warn() {} }

/**
 * @param {string} root
 * @param {string[]} parts
 * @param {string} [content]
 */
async function touch(root, parts, content = 'x') {
  const file = path.join(root, ...parts)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

test('机器级路径校验：SDK / HBuilderX / Android SDK / JDK', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-env-'))
  try {
    const sdk = path.join(dir, 'sdk')
    await mkdir(path.join(sdk, 'HBuilder-Integrate-AS'), { recursive: true })
    const validateSdk = makeSdkRootValidator()
    assert.equal((await validateSdk('')).ok, false)
    assert.equal((await validateSdk(path.join(dir, 'none'))).ok, false)
    assert.deepEqual(await validateSdk(sdk), { ok: true, value: sdk })

    const hbuilderx = path.join(dir, 'HBuilderX')
    await touch(hbuilderx, ['plugins', 'about', 'package.json'], '{"name":"about"}')
    const validateHx = makeHbuilderxValidator()
    assert.equal(validateHx('').ok, true)
    assert.equal(validateHx(hbuilderx).ok, true)
    assert.equal(validateHx(path.join(dir, 'bad')).ok, false)
    assert.match(String(validateHx(path.join(dir, 'bad')).message), /HBuilderX/)

    const android = path.join(dir, 'android')
    await mkdir(path.join(android, 'build-tools'), { recursive: true })
    await touch(android, ['platform-tools', `adb${EXE}`])
    const validateAndroid = makeAndroidSdkValidator()
    assert.equal(validateAndroid('').ok, true)
    assert.equal(validateAndroid(android).ok, true)
    assert.equal(validateAndroid(path.join(dir, 'bad')).ok, false)

    const jdk = path.join(dir, 'jdk')
    await touch(jdk, ['bin', `java${EXE}`])
    const validateJdk = makeJdkValidator()
    assert.equal(validateJdk('').ok, true)
    assert.equal(validateJdk(jdk).ok, true)
    assert.equal(validateJdk(path.join(dir, 'bad')).ok, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('全部探测到时默认不修改本机路径', async () => {
  /** @type {string[]} */
  const asked = []
  const prompt = {
    async ask(options) {
      asked.push(options.question)
      return 'n'
    },
  }
  const defaults = {
    sdkPath: 'C:/sdk',
    hbuilderxPath: 'C:/hx',
    androidSdkPath: 'C:/android',
    jdkPath: 'C:/jdk',
  }
  const answers = await askEnvironmentPaths({ prompt, type: 'cli', logger, defaults })
  assert.deepEqual(answers, defaults)
  assert.deepEqual(asked, ['要修改以上本机路径吗？[y/N]'])
})

test('缺少离线 SDK 时强制补路径，CLI 项目不问 HBuilderX', async () => {
  /** @type {string[]} */
  const asked = []
  const queue = ['C:/sdk-new', 'C:/android-new', 'C:/jdk-new']
  const prompt = {
    async ask(options) {
      asked.push(options.question)
      return queue.shift() ?? ''
    },
  }
  const answers = await askEnvironmentPaths({
    prompt,
    type: 'cli',
    logger,
    defaults: { sdkPath: '', hbuilderxPath: '', androidSdkPath: '', jdkPath: '' },
  })
  assert.deepEqual(answers, {
    sdkPath: 'C:/sdk-new',
    hbuilderxPath: '',
    androidSdkPath: 'C:/android-new',
    jdkPath: 'C:/jdk-new',
  })
  assert.deepEqual(asked, [
    '离线 SDK 根目录（含 HBuilder-Integrate-AS）',
    'Android SDK 根目录（留空自动探测）',
    'JDK 根目录（留空自动探测）',
  ])
})

test('HBuilderX 项目多问一项，选择修改时逐项询问', async () => {
  /** @type {string[]} */
  const asked = []
  const queue = ['y', 'C:/sdk', 'C:/hx', 'C:/android', 'C:/jdk']
  const prompt = {
    async ask(options) {
      asked.push(options.question)
      return queue.shift() ?? ''
    },
  }
  const answers = await askEnvironmentPaths({
    prompt,
    type: 'hbuilderx',
    logger,
    defaults: { sdkPath: 'C:/sdk0', hbuilderxPath: 'C:/hx0', androidSdkPath: '', jdkPath: '' },
  })
  assert.equal(answers.sdkPath, 'C:/sdk')
  assert.equal(answers.hbuilderxPath, 'C:/hx')
  assert.equal(answers.androidSdkPath, 'C:/android')
  assert.equal(answers.jdkPath, 'C:/jdk')
  assert.equal(asked.length, 5)
  assert.match(asked[0], /要修改以上本机路径/)
  assert.match(asked[2], /HBuilderX/)
})
