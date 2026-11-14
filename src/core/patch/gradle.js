import path from 'node:path'
import { PackError, EXIT } from '../errors.js'
import { readText, writeText } from '../fsx.js'

/**
 * 精确替换：匹配 0 次或多次都视为错误，避免模板变化后静默失效。
 * @param {string} text
 * @param {RegExp} pattern
 * @param {string | ((...args: string[]) => string)} replacement
 * @param {string} label
 */
export function replaceExactlyOnce(text, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const global = new RegExp(pattern.source, flags)
  const matches = [...text.matchAll(global)]
  if (matches.length !== 1) {
    throw new PackError(`模板替换失败（${label}）：期望命中 1 次，实际 ${matches.length} 次`, EXIT.GRADLE)
  }
  return text.replace(global, /** @type {any} */ (typeof replacement === 'string' ? replacement : replacement))
}

/**
 * @typedef {Object} GradlePatchContext
 * @property {string} packageName
 * @property {string} versionName
 * @property {number} versionCode
 * @property {number} minSdkVersion
 * @property {number} targetSdkVersion
 * @property {number} compileSdkVersion
 * @property {string} buildToolsVersion
 * @property {string[]} abiFilters
 * @property {{ keyAlias: string, keyPassword: string, storePassword: string }} signing
 */

/**
 * @param {string} file
 * @param {GradlePatchContext} context
 */
export async function patchAppGradle(file, context) {
  let text = await readText(file)

  text = replaceExactlyOnce(text, /compileSdkVersion\s+\d+/, `compileSdkVersion ${context.compileSdkVersion}`, 'compileSdkVersion')
  text = replaceExactlyOnce(
    text,
    /buildToolsVersion\s+'[^']*'/,
    `buildToolsVersion '${context.buildToolsVersion}'`,
    'buildToolsVersion',
  )
  text = replaceExactlyOnce(text, /namespace\s+'[^']*'/, `namespace '${context.packageName}'`, 'namespace')
  text = replaceExactlyOnce(
    text,
    /applicationId\s+"[^"]*"/,
    `applicationId "${context.packageName}"`,
    'applicationId',
  )
  text = replaceExactlyOnce(text, /minSdkVersion\s+\d+/, `minSdkVersion ${context.minSdkVersion}`, 'minSdkVersion')
  text = replaceExactlyOnce(
    text,
    /targetSdkVersion\s+\d+/,
    `targetSdkVersion ${context.targetSdkVersion}`,
    'targetSdkVersion',
  )
  text = replaceExactlyOnce(text, /versionCode\s+\d+/, `versionCode ${context.versionCode}`, 'versionCode')
  text = replaceExactlyOnce(text, /versionName\s+"[^"]*"/, `versionName "${context.versionName}"`, 'versionName')

  const abi = context.abiFilters.map((item) => `'${item}'`).join(', ')
  const ndkPattern = /ndk\s*\{\s*abiFilters[^}]*\}/
  if (ndkPattern.test(text)) {
    text = replaceExactlyOnce(text, ndkPattern, `ndk {\n            abiFilters ${abi}\n        }`, 'abiFilters')
  } else {
    text = replaceExactlyOnce(
      text,
      /multiDexEnabled\s+true/,
      `multiDexEnabled true\n        ndk {\n            abiFilters ${abi}\n        }`,
      'abiFilters(insert)',
    )
  }

  const signingBlock = [
    'signingConfigs {',
    '        config {',
    `            keyAlias '${context.signing.keyAlias}'`,
    `            keyPassword '${context.signing.keyPassword}'`,
    "            storeFile file('aw-pack.jks')",
    `            storePassword '${context.signing.storePassword}'`,
    '            v1SigningEnabled true',
    '            v2SigningEnabled true',
    '        }',
    '    }',
  ].join('\n')
  text = replaceExactlyOnce(text, /signingConfigs\s*\{[\s\S]*?\n {4}\}/, signingBlock, 'signingConfigs')

  // targetSdk 30 是电视端的既定配置，关掉对应的 lint 阻断
  if (!text.includes('ExpiredTargetSdkVersion')) {
    text = replaceExactlyOnce(
      text,
      /buildTypes\s*\{/,
      "lint {\n        disable 'ExpiredTargetSdkVersion'\n    }\n    buildTypes {",
      'lint',
    )
  }

  await writeText(file, text)
}

/**
 * @param {string} file
 * @param {string} androidSdkDir
 */
export async function patchRootGradle(file, androidSdkDir) {
  let text = await readText(file)
  if (!text.includes('maven { url \'https://jitpack.io\' }')) {
    text = text.replace(
      /allprojects\s*\{[\s\S]*?repositories\s*\{/,
      (match) => `${match}\n        maven { url 'https://jitpack.io' }`,
    )
    if (!text.includes('jitpack.io')) {
      throw new PackError('模板根 build.gradle 结构异常，无法注入 jitpack 仓库', EXIT.GRADLE, {
        hint: '换一份干净的离线 SDK 再试',
      })
    }
    await writeText(file, text)
  }
  await writeText(
    path.join(path.dirname(file), 'local.properties'),
    `sdk.dir=${androidSdkDir.replace(/\\/g, '/')}\n`,
  )
}
