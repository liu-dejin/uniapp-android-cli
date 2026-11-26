/**
 * @typedef {Object} DebugPreset
 * @property {'hbuilderx' | 'legacy'} [strategy]
 * @property {'standard' | 'custom'} [playground]
 * @property {'local' | 'device'} [customType]
 * @property {string} [device]
 * @property {boolean} [logs]
 */

/**
 * 项目预设只作为默认值；显式调用 HBuilderX 参数优先，基座相关参数强制走 uni-pack 自己的流程。
 * @param {{ hbuilderx?: boolean, playground?: string, customType?: string, push?: boolean, build?: boolean,
 *   base?: string, install?: boolean }} options
 * @param {DebugPreset} [preset]
 * @returns {'hbuilderx' | 'legacy'}
 */
export function resolveDebugStrategy(options, preset = {}) {
  const forceLegacy = Boolean(options.push || options.build || options.base || options.install)
  const wantsHbuilderx = Boolean(options.hbuilderx || options.playground || options.customType)
  if (wantsHbuilderx) {
    return 'hbuilderx'
  }
  return !forceLegacy && preset.strategy === 'hbuilderx' ? 'hbuilderx' : 'legacy'
}

/**
 * @param {{ playground?: string, customType?: string }} options
 * @param {DebugPreset} [preset]
 * @returns {{ playground: 'standard' | 'custom', customType: 'local' | 'device' }}
 */
export function resolveDebugBase(options, preset = {}) {
  const playground = String(options.playground ?? preset.playground ?? 'standard').toLowerCase()
  const customType = String(options.customType ?? preset.customType ?? 'local').toLowerCase()
  return {
    playground: /** @type {'standard' | 'custom'} */ (playground === 'custom' ? 'custom' : 'standard'),
    customType: /** @type {'local' | 'device'} */ (customType === 'device' ? 'device' : 'local'),
  }
}

/**
 * @param {{ device?: string }} options
 * @param {DebugPreset} [preset]
 * @returns {string}
 */
export function resolveDebugDevice(options, preset = {}) {
  return String(options.device ?? preset.device ?? '').trim()
}

/**
 * @param {{ logs?: boolean }} options
 * @param {DebugPreset} [preset]
 * @returns {boolean}
 */
export function resolveDebugLogs(options, preset = {}) {
  return Boolean(options.logs ?? preset.logs)
}
