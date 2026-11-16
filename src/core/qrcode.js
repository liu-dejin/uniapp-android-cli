import qrcode from 'qrcode-terminal'

/**
 * @param {string} text
 * @returns {string}
 */
export function renderQr(text) {
  let output = ''
  qrcode.generate(text, { small: true }, (code) => {
    output = code
  })
  return output
}
