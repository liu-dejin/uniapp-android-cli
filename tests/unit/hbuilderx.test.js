import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { selectHbuilderxCompiler } from '../../src/core/hbuilderx.js'

test('HBuilderX 按 Vue 版本选择编译器', () => {
  const vue3 = selectHbuilderxCompiler(3)
  assert.equal(vue3.platform, 'app')
  assert.match(vue3.dir, /uniapp-cli-vite/)
  assert.match(vue3.entry, /vite-plugin-uni/)

  const vue2 = selectHbuilderxCompiler(2)
  assert.equal(vue2.platform, 'app-plus')
  assert.match(vue2.dir, /uniapp-cli$/)
  assert.equal(vue2.entry, path.join('bin', 'uniapp-cli.js'))

  // 没写 vueVersion 的老项目按 Vue 2 处理
  assert.equal(selectHbuilderxCompiler(undefined).vueVersion, 3)
  assert.equal(selectHbuilderxCompiler('2').vueVersion, 2)
})
