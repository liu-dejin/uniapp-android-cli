import assert from 'node:assert/strict'
import test from 'node:test'
import { translateArgsError } from '../../src/cli.js'

const initSpec = {
  project: { type: 'string', short: 'p' },
  appkey: { type: 'string' },
  sdk: { type: 'string' },
}

test('单横线写长参数时提示改成双横线', () => {
  const message = translateArgsError(new Error("Unknown option '-a'"), ['-p', 'C:/proj', '-appkey', 'abc'], initSpec)
  assert.match(message, /未知参数：-appkey/)
  assert.match(message, /改为：--appkey/)
})

test('未知短参数时列出可用参数', () => {
  const message = translateArgsError(new Error("Unknown option '-x'"), ['-x'], initSpec)
  assert.match(message, /未知参数：-x/)
  assert.match(message, /可用参数：/)
  for (const flag of ['-p', '--appkey', '--project', '--sdk']) {
    assert.match(message, new RegExp(flag))
  }
})

test('其它参数错误原样返回', () => {
  assert.equal(translateArgsError(new Error('Option requires argument'), [], initSpec), 'Option requires argument')
})
