import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  makeFileValidator,
  splitInitConfig,
  toProjectRelative,
  validateAppKey,
  validateConfirm,
  validateCustomType,
  validateExplicitConfirm,
  validatePackageName,
  validatePlayground,
  validateRequired,
} from '../../src/core/initConfig.js'

test('包名与 AppKey 校验', () => {
  assert.equal(validatePackageName('uni.app.UNIF1A8702').ok, true)
  assert.equal(validatePackageName('com.example.app').ok, true)
  assert.equal(validatePackageName('').ok, true)
  assert.equal(validatePackageName('bad').ok, false)
  assert.equal(validatePackageName('1com.example').ok, false)

  const appKey = '9F9F3E5A2AB84CA3106FBBD67FDC0212'
  assert.deepEqual(validateAppKey(appKey), { ok: true, value: appKey.toLowerCase() })
  assert.equal(validateAppKey('').ok, true)
  assert.equal(validateAppKey('123').ok, false)
  assert.equal(validateAppKey('zzzz3e5a2ab84ca3106fbbd67fdc0212').ok, false)

  assert.equal(validateRequired('x').ok, true)
  assert.equal(validateRequired('').ok, false)
})

test('确认项只接受 Y/n/空', () => {
  assert.equal(validateConfirm('').ok, true)
  assert.equal(validateConfirm('y').ok, true)
  assert.equal(validateConfirm('N').ok, true)
  assert.equal(validateConfirm('maybe').ok, false)
})

test('文件校验支持相对项目目录，路径不存在时给提示', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-init-file-'))
  try {
    await mkdir(path.join(dir, 'cert'), { recursive: true })
    await writeFile(path.join(dir, 'cert', 'app.jks'), 'x')
    const validate = makeFileValidator(dir)
    assert.deepEqual(validate(''), { ok: true, value: '' })
    assert.deepEqual(validate('cert/app.jks'), { ok: true, value: path.join(dir, 'cert', 'app.jks') })
    assert.equal(validate('cert/nope.jks').ok, false)
    assert.match(String(validate('cert/nope.jks').message), /找不到文件/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('最终确认必须显式 y/n，回车无效', () => {
  assert.equal(validateExplicitConfirm('y').ok, true)
  assert.equal(validateExplicitConfirm('N').ok, true)
  assert.equal(validateExplicitConfirm('').ok, false)
  assert.match(String(validateExplicitConfirm('').message), /回车不会默认确认/)
  assert.equal(validateExplicitConfirm('yes').value, 'yes')
  assert.equal(validateExplicitConfirm('no').value, 'no')
})

test('项目内路径写相对路径，项目外保留绝对路径', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-init-rel-'))
  try {
    assert.equal(toProjectRelative(dir, path.join(dir, 'apk')), 'apk')
    assert.equal(toProjectRelative(dir, 'cert/app.jks'), 'cert/app.jks')
    assert.equal(toProjectRelative(dir, ''), '')
    const outside = path.join(path.dirname(dir), 'shared', 'app.jks')
    assert.equal(toProjectRelative(dir, outside), outside)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('调试基座选项只接受约定值', () => {
  assert.equal(validatePlayground('standard').ok, true)
  assert.equal(validatePlayground('CUSTOM').value, 'custom')
  assert.equal(validatePlayground('device').ok, false)
  assert.equal(validateCustomType('local').ok, true)
  assert.equal(validateCustomType('DEVICE').value, 'device')
  assert.equal(validateCustomType('standard').ok, false)
})

test('init 结果拆分：共享字段进项目配置，本机路径进用户配置', () => {
  const projectDir = path.resolve('virtual', 'projects', 'demo')
  const { projectConfig, userEntry } = splitInitConfig({
    projectDir,
    type: 'cli',
    packageName: 'uni.app.DEMO',
    appKey: '9f9f3e5a2ab84ca3106fbbd67fdc0212',
    outputDir: path.join(projectDir, 'apk'),
    outputPrefix: 'DEMO',
    webBuild: { command: 'pnpm', args: ['run', 'build:app-android'], outputDir: 'dist/build/app' },
    signing: {
      keystore: path.join(projectDir, 'certificate', 'android', 'app.jks'),
      keyAlias: 'demo',
      keystoreProperties: path.join(projectDir, 'certificate', 'android', 'keystore.properties'),
      storePasswordEnv: 'TEAM_STORE_PASS',
      keyPasswordEnv: 'TEAM_KEY_PASS',
    },
    existingProjectConfig: { debug: { launchActivity: 'io.dcloud.PandoraEntry' } },
    existingUserEntry: {
      name: '旧快照',
      versionName: '1.0.0',
      appKey: 'old',
      signing: { keystore: 'old.jks' },
      sdkRoot: 'C:/sdk',
      hbuilderxRoot: '',
      outputDir: 'C:/projects/demo/apk',
    },
    sdkRoot: 'C:/sdk/hbuilder',
    hbuilderxRoot: '',
  })

  assert.equal(projectConfig.type, 'cli')
  assert.equal(projectConfig.package, 'uni.app.DEMO')
  assert.equal(projectConfig.appKey, '9f9f3e5a2ab84ca3106fbbd67fdc0212')
  assert.equal(projectConfig.outputDir, 'apk')
  assert.equal(projectConfig.outputPrefix, 'DEMO')
  assert.equal(projectConfig.signing.keystore, 'certificate/android/app.jks')
  assert.equal(projectConfig.signing.keystoreProperties, 'certificate/android/keystore.properties')
  assert.equal(projectConfig.signing.keyAlias, 'demo')
  assert.equal(projectConfig.signing.storePasswordEnv, 'TEAM_STORE_PASS')
  assert.equal(projectConfig.signing.keyPasswordEnv, 'TEAM_KEY_PASS')
  assert.deepEqual(projectConfig.debug, { launchActivity: 'io.dcloud.PandoraEntry' })
  assert.deepEqual(projectConfig.webBuild, {
    command: 'pnpm',
    args: ['run', 'build:app-android'],
    outputDir: 'dist/build/app',
  })

  assert.equal(userEntry.projectDir, projectDir)
  assert.equal(userEntry.type, 'cli')
  assert.equal(userEntry.sdkRoot, 'C:/sdk/hbuilder')
  assert.equal(userEntry.appKey, undefined)
  assert.equal(userEntry.signing, undefined)
  assert.equal(userEntry.outputDir, undefined)
  assert.equal(userEntry.name, undefined)
  assert.equal(userEntry.versionName, undefined)
})

test('调试预设写入项目配置，并从用户配置移除', () => {
  const { projectConfig, userEntry } = splitInitConfig({
    projectDir: 'C:/p',
    type: 'hbuilderx',
    packageName: 'uni.app.DEMO',
    appKey: '',
    outputDir: 'apk',
    signing: { keystore: '', keyAlias: '', keystoreProperties: '' },
    debug: { strategy: 'hbuilderx', playground: 'custom', customType: 'local', logs: true },
    existingProjectConfig: {},
    existingUserEntry: { debug: { launchActivity: 'io.dcloud.PandoraEntry' }, sdkRoot: 'C:/sdk' },
    sdkRoot: 'C:/sdk',
  })
  assert.deepEqual(projectConfig.debug, {
    launchActivity: 'io.dcloud.PandoraEntry',
    strategy: 'hbuilderx',
    playground: 'custom',
    customType: 'local',
    logs: true,
  })
  assert.equal(userEntry.debug, undefined)
})

test('清空 AppKey/包名时会从项目配置里删除旧值', () => {
  const { projectConfig } = splitInitConfig({
    projectDir: 'C:/p',
    type: 'cli',
    packageName: '',
    appKey: '',
    outputDir: 'apk',
    signing: { keystore: '', keyAlias: '', keystoreProperties: '' },
    existingProjectConfig: { appKey: 'old', package: 'old.pkg' },
    existingUserEntry: {},
    sdkRoot: 'C:/sdk',
  })
  assert.equal('appKey' in projectConfig, false)
  assert.equal('package' in projectConfig, false)
  assert.equal(projectConfig.signing.storePasswordEnv, 'UNI_PACK_STORE_PASS')
  assert.equal(projectConfig.signing.keyPasswordEnv, 'UNI_PACK_KEY_PASS')
})
