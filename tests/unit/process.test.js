import assert from 'node:assert/strict'
import test from 'node:test'
import { createLineSplitter } from '../../src/core/process.js'

test('按 \\n 缓冲残行：chunk 边界落在一行中间也不会拆开', () => {
  /** @type {string[]} */
  const lines = []
  const splitter = createLineSplitter((line) => lines.push(line))
  splitter.push('> Task :simpleDe')
  splitter.push('mo:packageRelease\nnext')
  splitter.push('-line\r\n')
  splitter.push('partial')
  splitter.flush()
  assert.deepEqual(lines, ['> Task :simpleDemo:packageRelease', 'next-line', 'partial'])
})

test('空行与只有空白的行不回调', () => {
  /** @type {string[]} */
  const lines = []
  const splitter = createLineSplitter((line) => lines.push(line))
  splitter.push('\n   \n\r\nreal\n')
  splitter.flush()
  assert.deepEqual(lines, ['real'])
})
