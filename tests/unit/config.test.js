import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveDefaultWebBuild, resolveProject } from '../../src/core/config.js'
import { PackError } from '../../src/core/errors.js'

test('输出目录默认落在项目内，忽略全局旧配置', async () => {
  const projectDir = path.resolve('virtual/demo')
  const { project } = await resolveProject(
    {
      outputDir: path.resolve('virtual/elsewhere'),
      projects: { demo: { projectDir } },
    },
    'demo',
  )

  assert.equal(project.outputDir, path.join(projectDir, 'apk'))
})

test('项目可以单独指定输出目录', async () => {
  const projectDir = path.resolve('virtual/demo')
  const outputDir = path.resolve('virtual/out')
  const { project } = await resolveProject(
    {
      projects: { demo: { projectDir, outputDir } },
    },
    'demo',
  )

  assert.equal(project.outputDir, outputDir)
})

test('CLI 默认构建命令按项目脚本选择 Vue 2 / Vue 3', async () => {
  const vue3Dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-vue3-'))
  const vue2Dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-vue2-'))
  try {
    await writeFile(
      path.join(vue3Dir, 'package.json'),
      JSON.stringify({ scripts: { 'build:app-android': 'uni build -p app-android' } }),
    )
    const vue3 = await resolveDefaultWebBuild('cli', vue3Dir)
    assert.deepEqual(vue3.args, ['run', 'build:app-android'])
    assert.equal(vue3.outputDir, 'dist/build/app')

    await writeFile(
      path.join(vue2Dir, 'package.json'),
      JSON.stringify({ scripts: { 'build:app-plus': 'uni build -p app-plus' } }),
    )
    const vue2 = await resolveDefaultWebBuild('cli', vue2Dir)
    assert.deepEqual(vue2.args, ['run', 'build:app-plus'])
    assert.equal(vue2.outputDir, 'dist/build/app-plus')
  } finally {
    await rm(vue3Dir, { recursive: true, force: true })
    await rm(vue2Dir, { recursive: true, force: true })
  }
})

test('HBuilderX 项目默认使用 app-plus 产物目录', async () => {
  const result = await resolveDefaultWebBuild('hbuilderx', path.resolve('virtual/demo'))
  assert.equal(result.mode, 'hbuilderx')
  assert.equal(result.outputDir, 'unpackage/dist/build/app-plus')
})

test('-p 支持项目目录名与唯一子串，歧义时报错', async () => {
  const config = {
    projects: {
      'pro-phone': { projectDir: path.resolve('virtual/PRO_PHONE'), type: 'hbuilderx' },
      'pro-pad': { projectDir: path.resolve('virtual/PRO_PAD'), type: 'hbuilderx' },
      'uni-demo': { projectDir: path.resolve('virtual/DEMO'), type: 'cli' },
    },
  }

  assert.equal((await resolveProject(config, 'PRO_PHONE')).project.name, 'pro-phone')
  assert.equal((await resolveProject(config, 'phone')).project.name, 'pro-phone')
  assert.equal((await resolveProject(config, 'pro_phone')).project.name, 'pro-phone')
  assert.equal((await resolveProject(config, 'uni-demo')).project.name, 'uni-demo')

  await assert.rejects(
    resolveProject(config, 'pro'),
    (error) => error instanceof PackError && error.code === 2 && /不唯一/.test(error.message),
  )
})

test('项目级 uni-pack.config.json 覆盖用户配置，相对输出目录按项目解析', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-local-'))
  try {
    await writeFile(
      path.join(dir, 'uni-pack.config.json'),
      JSON.stringify({
        type: 'cli',
        package: 'uni.app.LOCAL',
        appKey: 'local-key',
        outputDir: 'build/apk',
        webBuild: { command: 'pnpm', args: ['run', 'build:app-android'], outputDir: 'dist/build/app' },
        signing: {
          keystore: 'cert/app.jks',
          keyAlias: 'local',
          keystoreProperties: 'cert/creds.properties',
        },
      }),
    )
    const { project } = await resolveProject(
      {
        projects: {
          demo: {
            projectDir: dir,
            type: 'cli',
            package: 'old.pkg',
            appKey: 'old-key',
            outputDir: path.join(dir, 'apk'),
          },
        },
      },
      'demo',
    )

    assert.equal(project.package, 'uni.app.LOCAL')
    assert.equal(project.appKey, 'local-key')
    assert.equal(project.outputDir, path.join(dir, 'build', 'apk'))
    assert.equal(project.signing.keystore, 'cert/app.jks')
    assert.equal(project.signing.keyAlias, 'local')
    assert.equal(project.webBuild.command, 'pnpm')
    assert.equal(project.type, 'cli')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
