import { createInterface } from 'node:readline/promises'
import process from 'node:process'

/**
 * @typedef {Object} PromptValidationResult
 * @property {boolean} ok
 * @property {string} [value]
 * @property {string} [message]
 * @typedef {(value: string) => PromptValidationResult | Promise<PromptValidationResult>} PromptValidator
 * @typedef {{ question: string, defaultValue?: string, validate?: PromptValidator }} PromptOptions
 */

/**
 * 非交互环境（CI、管道、--json）不能停在问答上。
 * @param {{ yes?: boolean, json?: boolean }} options
 * @param {{ isTTY?: boolean }} [input]
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function canPrompt(options, input = process.stdin, env = process.env) {
  if (options?.yes || options?.json) {
    return false
  }
  if (env.UNI_PACK_NO_INPUT === '1') {
    return false
  }
  return Boolean(/** @type {{ isTTY?: boolean }} */ (input).isTTY)
}

/**
 * 简单的问答封装：回车用默认值，校验失败重新问，EOF/中断按默认值返回。
 */
export class Prompt {
  /**
   * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, isTTY?: boolean }} [options]
   */
  constructor(options = {}) {
    const input = options.input ?? process.stdin
    const output = options.output ?? process.stdout
    this.output = output
    this.rl = createInterface({
      input,
      output,
      terminal: options.isTTY ?? Boolean(/** @type {{ isTTY?: boolean }} */ (input).isTTY),
    })
  }

  /**
   * @param {PromptOptions} options
   * @returns {Promise<string>}
   */
  async ask(options) {
    const defaultValue = options.defaultValue ?? ''
    const suffix = defaultValue ? `（${defaultValue}）` : ''
    for (;;) {
      // 输入流被 Ctrl+D / 关闭时 question 可能永远不 resolve，和 close 事件赛跑
      /** @type {(() => void) | null} */
      let onClose = null
      const closed = new Promise((resolve) => {
        onClose = () => resolve(null)
        this.rl.once('close', onClose)
      })
      let raw
      try {
        raw = await Promise.race([this.rl.question(`${options.question}${suffix}: `), closed])
      } catch {
        return defaultValue
      } finally {
        if (onClose) {
          this.rl.removeListener('close', onClose)
        }
      }
      if (raw === null) {
        return defaultValue
      }
      const value = String(raw).trim() || defaultValue
      if (!options.validate) {
        return value
      }
      const result = await options.validate(value)
      if (result.ok) {
        return result.value ?? value
      }
      if (result.message) {
        this.output.write(`  ${result.message}\n`)
      }
    }
  }

  close() {
    this.rl.close()
  }
}
