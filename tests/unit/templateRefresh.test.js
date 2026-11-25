import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { refreshTemplateFiles } from '../../src/core/patch/template.js'

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

test('增量刷新只覆盖被 patch 的文件，并清掉 SMARTPACK 注入块', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uni-pack-refresh-'))
  try {
    const templateRoot = path.join(dir, 'template')
    const targetDir = path.join(dir, 'work')
    await touch(
      templateRoot,
      ['build.gradle'],
      [
        'buildscript {',
        '    // ===== SMARTPACK ROOT DEPS START =====',
        "    classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.0'",
        '    // ===== SMARTPACK ROOT DEPS END =====',
        '}',
        'allprojects {',
        '    // ===== SMARTPACK ROOT REPOS START =====',
        '}',
        '    // ===== SMARTPACK ROOT REPOS END =====',
        '',
      ].join('\n'),
    )
    await touch(templateRoot, ['settings.gradle'], "include ':simpleDemo'\n")
    await touch(templateRoot, ['simpleDemo', 'build.gradle'], '// 模板 app gradle\n')
    await touch(templateRoot, ['simpleDemo', 'src', 'main', 'AndroidManifest.xml'], '<manifest/>\n')
    await touch(templateRoot, ['simpleDemo', 'libs', 'base.aar'], 'aar')
    await touch(templateRoot, ['simpleDemo', 'build', 'stale.bin'], 'stale')

    // 工作目录里的旧版本（上一轮 patch 后）
    await touch(targetDir, ['build.gradle'], "classpath 'patched'\n")
    await touch(targetDir, ['settings.gradle'], "include ':uts-old'\n")
    await touch(targetDir, ['simpleDemo', 'build.gradle'], '// patched app gradle\n')
    await touch(targetDir, ['simpleDemo', 'src', 'main', 'AndroidManifest.xml'], '<manifest patched="true"/>\n')
    await touch(targetDir, ['simpleDemo', 'libs', 'keep.aar'], 'keep')
    await touch(targetDir, ['simpleDemo', 'build', 'keep.bin'], 'keep')
    await touch(targetDir, ['gradle', 'wrapper', 'gradle-wrapper.properties'], 'keep')

    await refreshTemplateFiles(templateRoot, targetDir)

    const rootGradle = await readFile(path.join(targetDir, 'build.gradle'), 'utf8')
    assert.match(rootGradle, /buildscript/)
    assert.doesNotMatch(rootGradle, /SMARTPACK/)
    assert.match(await readFile(path.join(targetDir, 'settings.gradle'), 'utf8'), /include ':simpleDemo'/)
    assert.equal(await readFile(path.join(targetDir, 'simpleDemo', 'src', 'main', 'AndroidManifest.xml'), 'utf8'), '<manifest/>\n')
    // 不在刷新列表里的构建产物保持不变
    assert.equal(await readFile(path.join(targetDir, 'simpleDemo', 'libs', 'keep.aar'), 'utf8'), 'keep')
    assert.equal(await readFile(path.join(targetDir, 'simpleDemo', 'build', 'keep.bin'), 'utf8'), 'keep')
    assert.equal(await readFile(path.join(targetDir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'utf8'), 'keep')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
