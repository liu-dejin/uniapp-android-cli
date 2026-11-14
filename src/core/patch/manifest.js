import { PackError, EXIT } from '../errors.js'
import { readText, writeText } from '../fsx.js'

/**
 * @typedef {Object} ManifestPatchContext
 * @property {string} packageName
 * @property {string} appKey
 * @property {string[]} permissions
 * @property {{ name: string, required: string }[]} features
 * @property {boolean} debug
 */

/**
 * @param {string} file
 * @param {ManifestPatchContext} context
 */
export async function patchAndroidManifest(file, context) {
  let text = await readText(file)

  if (!text.includes('package="')) {
    throw new PackError('AndroidManifest.xml 缺少 package 属性', EXIT.PREFLIGHT)
  }
  text = text.replace(/package="[^"]*"/, `package="${context.packageName}"`)

  text = removeBlocks(text, 'uses-permission')
  text = removeBlocks(text, 'uses-feature')

  const permissionLines = context.permissions
    .filter((name, index, list) => list.indexOf(name) === index)
    .map((name) => `    <uses-permission android:name="${name}"/>`)
    .join('\n')
  const featureLines = context.features
    .map((feature) => `    <uses-feature android:name="${feature.name}" android:required="${feature.required}"/>`)
    .join('\n')

  const injected = [permissionLines, featureLines].filter(Boolean).join('\n')
  text = text.replace(/<manifest([^>]*)>/, (match) => `${match}\n\n    <!-- uni-pack 注入 -->\n${injected}\n`)

  // 不硬编码 debuggable，交给 buildType 自动决定（否则 lint 的 HardcodedDebugMode 会直接失败）
  text = text.replace(/\s*android:debuggable="[^"]*"/, '')
  text = setApplicationAttr(text, 'android:usesCleartextTraffic', 'true')

  if (text.includes('name="dcloud_appkey"')) {
    text = text.replace(/(name="dcloud_appkey"\s*\n?\s*android:value=")[^"]*(")/, `$1${context.appKey}$2`)
  } else {
    text = text.replace(
      /<\/application>/,
      `        <meta-data\n            android:name="dcloud_appkey"\n            android:value="${context.appKey}" />\n    </application>`,
    )
  }

  if (!text.includes('LEANBACK_LAUNCHER')) {
    text = text.replace(
      /(<category android:name="android\.intent\.category\.LAUNCHER"\s*\/>)/,
      '$1\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />',
    )
  }

  await writeText(file, text)
}

/**
 * @param {string} text
 * @param {string} tagName
 */
function removeBlocks(text, tagName) {
  return text.replace(new RegExp(`\\s*<${tagName}[^>]*/>`, 'g'), '')
}

/**
 * @param {string} text
 * @param {string} attr
 * @param {string} value
 */
function setApplicationAttr(text, attr, value) {
  const pattern = new RegExp(`${attr}="[^"]*"`)
  if (pattern.test(text)) {
    return text.replace(pattern, `${attr}="${value}"`)
  }
  return text.replace(/<application\b/, `<application\n        ${attr}="${value}"`)
}
