import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveDefaultWebBuild, resolveProject } from '../../src/core/config.js'

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
