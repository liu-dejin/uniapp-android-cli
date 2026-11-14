import path from 'node:path'
import { PackError, EXIT } from './errors.js'
import { exists, readJson, readText } from './fsx.js'

/**
 * 把 uni-app npm 版本换算成 HBuilderX 版本号。
 * 3.0.0-5030420261029002 -> 5.34（50304 -> 5.3.4）
 * 3.0.0-4080520251106001 -> 4.85（40805 -> 4.8.5）
 * @param {string} version
 * @returns {string | null}
 */
export function decodeCompilerVersion(version) {
  const match = /^\d+\.\d+\.\d+-(\d{5})\d+$/.exec(version)
  if (!match) {
    return null
  }
  const code = match[1]
  const major = code[0]
  const minor = Number(code.slice(1, 3))
  const patch = Number(code.slice(3, 5))
  return `${major}.${minor}${patch}`
}

/**
 * @param {string} projectDir
 * @returns {Promise<string | null>}
 */
export async function readProjectCompilerVersion(projectDir) {
  const file = path.join(projectDir, 'node_modules/@dcloudio/uni-app/package.json')
  if (!(await exists(file))) {
    return null
  }
  const pkg = await readJson(file)
  return decodeCompilerVersion(String(pkg.version ?? ''))
}

/**
 * SDK 目录名形如 Android-SDK@5.34.82692_20261030。
 * @param {string} sdkRoot
 * @returns {Promise<string | null>}
 */
export async function readSdkVersion(sdkRoot) {
  const match = /Android-SDK@(\d+\.\d+)/i.exec(path.basename(sdkRoot))
  if (match) {
    return match[1]
  }
  const readme = path.join(sdkRoot, 'readme/readme.md')
  if (await exists(readme)) {
    const text = await readText(readme)
    const inline = /(\d+\.\d+)\.\d+/.exec(text)
    if (inline) {
      return inline[1]
    }
  }
  return null
}

/**
 * 编译版本与离线 SDK 版本必须一致，否则运行时会提示版本不匹配甚至异常。
 * @param {{ compiler: string | null, sdk: string | null }} versions
 */
export function assertVersionMatch(versions) {
  if (!versions.compiler || !versions.sdk) {
    return { ok: false, unknown: true }
  }
  return { ok: versions.compiler === versions.sdk, unknown: false }
}

/**
 * @param {{ compiler: string | null, sdk: string | null }} versions
 */
export function versionMismatchError(versions) {
  return new PackError(
    `uni-app 编译版本 ${versions.compiler ?? '未知'} 与离线 SDK ${versions.sdk ?? '未知'} 不一致`,
    EXIT.PREFLIGHT,
    {
      hint: [
        '两边必须一致，二选一：',
        `  1) 升级项目依赖到 SDK 对应版本：npx @dcloudio/uvm@latest`,
        `  2) 下载与当前编译版本 ${versions.compiler ?? '?'} 匹配的 Android 离线 SDK，并在配置 sdk.root 指向它`,
        '确认后重新执行 uni-pack doctor',
      ].join('\n'),
    },
  )
}
