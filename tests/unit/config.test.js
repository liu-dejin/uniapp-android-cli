import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { resolveProject } from '../../src/core/config.js'

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
