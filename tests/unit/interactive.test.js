import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { Prompt, canPrompt } from '../../src/core/interactive.js'
import { validateAppKey } from '../../src/core/initConfig.js'

test('canPrompt：CI/--json/非 TTY 都不问答', () => {
  assert.equal(canPrompt({}, { isTTY: true }, {}), true)
  assert.equal(canPrompt({}, { isTTY: false }, {}), false)
  assert.equal(canPrompt({ yes: true }, { isTTY: true }, {}), false)
  assert.equal(canPrompt({ json: true }, { isTTY: true }, {}), false)
  assert.equal(canPrompt({}, { isTTY: true }, { UNI_PACK_NO_INPUT: '1' }), false)
})

function makePrompt() {
  const input = new PassThrough()
  const output = new PassThrough()
  /** @type {string} */
  let written = ''
  output.on('data', (chunk) => {
    written += String(chunk)
  })
  const prompt = new Prompt({ input, output, isTTY: false })
  return { input, output, prompt, read: () => written }
}

test('回车使用默认值', async () => {
  const { input, prompt } = makePrompt()
  try {
    const pending = prompt.ask({ question: 'Android 包名', defaultValue: 'uni.app.DEMO' })
    input.write('\n')
    assert.equal(await pending, 'uni.app.DEMO')
  } finally {
    prompt.close()
  }
})

test('校验失败时提示并重新询问', async () => {
  const { input, prompt, read } = makePrompt()
  try {
    const pending = prompt.ask({ question: 'AppKey', validate: validateAppKey })
    input.write('bad\n')
    // 等第一轮校验提示写出后再输入合法值
    await new Promise((resolve) => setTimeout(resolve, 20))
    input.write(`${'a'.repeat(32)}\n`)
    assert.equal(await pending, 'a'.repeat(32))
    assert.match(read(), /AppKey 应为 32 位十六进制/)
  } finally {
    prompt.close()
  }
})

test('输入流提前关闭时回退默认值', async () => {
  const { input, prompt } = makePrompt()
  try {
    const pending = prompt.ask({ question: '包名', defaultValue: 'fallback' })
    input.end()
    assert.equal(await pending, 'fallback')
  } finally {
    prompt.close()
  }
})
