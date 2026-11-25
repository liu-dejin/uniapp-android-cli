import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { buildTempEnv, resolveBuildTempDir, resolveWorkRoot, sanitizeWorkName } from '../../src/core/workdir.js'

test('项目名清洗与工作目录解析', () => {
  assert.equal(sanitizeWorkName('PRO DIS V2'), 'PRO-DIS-V2')
  assert.equal(sanitizeWorkName('生产小助手'), 'project')
  assert.equal(sanitizeWorkName(''), 'project')
  assert.equal(resolveWorkRoot({ workDir: 'C:/work' }, { name: 'PRO DIS V2' }), path.join('C:/work', 'PRO-DIS-V2'))
})

test('前端构建临时目录默认在 workRoot/tmp，UNI_PACK_TEMP 显式指定时不覆盖', () => {
  assert.deepEqual(resolveBuildTempDir(path.join('C:', 'work', 'proj'), {}), {
    tempDir: path.join('C:', 'work', 'proj', 'tmp'),
    explicit: false,
  })
  assert.deepEqual(resolveBuildTempDir(path.join('C:', 'work', 'proj'), { UNI_PACK_TEMP: ' D:/build-tmp ' }), {
    tempDir: 'D:/build-tmp',
    explicit: true,
  })
  // 空字符串视为未设置
  assert.equal(resolveBuildTempDir('C:/work/proj', { UNI_PACK_TEMP: '   ' }).explicit, false)
})

test('子进程环境同时设置 TEMP 与 TMP', () => {
  assert.deepEqual(buildTempEnv('C:/work/tmp'), { TEMP: 'C:/work/tmp', TMP: 'C:/work/tmp' })
})
