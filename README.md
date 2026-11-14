# uniapp-android-cli

离线打包 uni-app（Vue 3 / Vite）Android 应用，不依赖 HBuilderX。

- `build`：正式包、自定义基座
- `wgt`：生成可热更新的 wgt 包
- `debug`：安装基座、启动应用、推送最新资源、抓日志
- `doctor`：环境与证书自检

## 依赖

- Node `^20.19.0 || >=22.12.0`（推荐 22，见 `.nvmrc`；Windows 为主）
- DCloud Android 离线 SDK（版本需与项目的 uni-app 编译版本一致）
- Android SDK（build-tools 含 apksigner，platform-tools 含 adb）
- JDK 17+
- HBuilderX 项目还需要安装 HBuilderX（用它的编译器构建源码）

首次使用建议先设好环境变量，`init` 探测不到时会按提示使用：

| 变量 | 指向 |
| --- | --- |
| `UNI_SDK_ROOT` | 解压后包含 `HBuilder-Integrate-AS` 的目录 |
| `UNI_SDK_DIRS` | 额外扫描 `Android-SDK@x.yy` 的目录，多个用 `;` 分隔 |
| `HBUILDERX_HOME` | HBuilderX 安装目录 |
| `ANDROID_HOME` | Android SDK 根目录（也认 `ANDROID_SDK_ROOT`） |
| `JAVA_HOME` | JDK 17+ 根目录 |

## 支持的项目类型

| 类型 | 识别方式 | 源码构建 | 版本来源 | 产物 |
| --- | --- | --- | --- | --- |
| CLI | 有 `src/manifest.json` | 项目的 `pnpm run build:app-android` | `node_modules/@dcloudio/uni-app` | `dist/build/app` |
| HBuilderX | 根目录有 `manifest.json`（JSONC） | HBuilderX 自带 node + uni-app 编译器 | HBuilderX 版本 | `unpackage/dist/build/app-plus` |

两种项目后续都走同一套离线打包流程（模板、AAR、Gradle、签名）。

## 安装

```bash
# 方式一：从 npm 全局安装
npm install -g uniapp-android-cli

# 方式二：源码开发
npm install
npm link

# 方式三：打成 tarball 分发给同事
npm run pack:cli
npm install -g ./uniapp-android-cli-0.1.0.tgz

# 方式四：不安装，直接跑
node bin/uni-pack.js doctor -p <项目>
```

## 快速开始

```bash
npm install
npm link                # 之后可直接用 uni-pack

# CLI 项目
uni-pack init -p ../YFB_PROJECT/PRO_DIS_V2 --appkey <DCloud AppKey>
uni-pack doctor -p ../YFB_PROJECT/PRO_DIS_V2
uni-pack build  -p ../YFB_PROJECT/PRO_DIS_V2 --mode release

# HBuilderX 项目（自动探测 HBuilderX；也可用 --hbuilderx 指定）
uni-pack init -p ../YFB_PROJECT/PRO_PHONE --appkey <DCloud AppKey>
uni-pack doctor -p ../YFB_PROJECT/PRO_PHONE
uni-pack build  -p ../YFB_PROJECT/PRO_PHONE --mode release
```

产物默认输出到项目的 `apk/`：`<名称>_<版本>_<版本号>_<release|debug>_<时间>.apk` 与 `_latest.apk`。

## 命令

```bash
uni-pack init    [-p <dir>] [--appkey <key>] [--package <包名>] [--key-alias <别名>]
                 [--sdk <dir>] [--hbuilderx <dir>] [--android-sdk <dir>] [--jdk <dir>] [--keystore <file>]
uni-pack doctor  [-p <dir>] [--json]
uni-pack devices
uni-pack build   [-p <dir>] [--mode release|debug] [--skip-web] [--out <dir>] [--install] [--device <serial>] [--offline]
uni-pack wgt     [-p <dir>] [--skip-web] [--out <dir>]
uni-pack debug   [-p <dir>] [--install] [--build] [--push] [--logs] [--device <serial>]
uni-pack version
```

## 配置

用户级 `~/.uniapp-android-cli/config.json`，项目内可放 `uni-pack.config.json` 覆盖。

```jsonc
{
  "sdk": {
    "root": "<离线 SDK 根目录>",
    "searchDirs": ["<扫描 Android-SDK@x.yy 的目录>"]
  },
  "hbuilderx": { "root": "<HBuilderX 安装目录>", "searchDirs": [] },
  "android": { "sdkDir": "<Android SDK>", "buildTools": "", "jdk": "" },
  "projects": {
    "pro-dis-v2": {
      "projectDir": "<uni-app 项目>",
      "type": "cli",
      "sdkRoot": "<该项目专用的离线 SDK>",
      "hbuilderxRoot": "",
      "outputDir": "<APK 输出目录，默认 <projectDir>/apk>",
      "appid": "__UNI__XXXXXX",
      "package": "com.example.app",
      "appKey": "<DCloud AppKey>",
      "webBuild": { "command": "pnpm", "args": ["run", "build:app-android"], "outputDir": "dist/build/app" },
      "signing": {
        "keystore": "certificate/android/app.keystore",
        "keyAlias": "key0",
        "keystoreProperties": "certificate/android/keystore.properties",
        "storePasswordEnv": "UNI_PACK_STORE_PASS",
        "keyPasswordEnv": "UNI_PACK_KEY_PASS"
      }
    }
  }
}
```

`outputDir` 跟着项目走，多项目不会互相覆盖；不填时默认 `<projectDir>/apk`。
`sdkRoot` / `hbuilderxRoot` 是项目级覆盖，适合多个项目使用不同版本 SDK / HBuilderX；不填时按项目版本自动匹配已安装的 `Android-SDK@x.yy`。
`buildTools` 留空时使用 SDK 模板里的版本，模板版本缺失再退到本机已安装的最高版本。
`uni-pack.config.json` 只覆盖项目级字段（appKey、signing、webBuild、outputDir 等），SDK 与 Android SDK 路径请写在用户级配置或环境变量里。

**密码不落盘**：优先命令行 `--store-password/--key-password`，其次环境变量，其次 `keystore.properties`。

## 构建流程

1. 编译源码：
   - CLI 项目：执行 `webBuild`，得到 `dist/build/app`。
   - HBuilderX 项目：用 HBuilderX 自带 node + `uniapp-cli-vite` 编译，得到 `unpackage/dist/build/app-plus`
     （与 HBuilderX 发行时的产物一致，`--skip-web` 可直接复用已有产物）。
2. 按项目版本匹配离线 SDK（`Android-SDK@x.yy`），把 SDK 的 `HBuilder-Integrate-AS` 复制到工作目录，**不改动共享 SDK**。
3. 复制 AAR：模板自带的 `simpleDemo/libs` 为该 SDK 版本的基线，`BASE_AARS` 与 `app-plus.modules`
   对应的 AAR 按需补充；老 SDK 缺少的 AAR 只提示不阻断。
4. 重写 `build.gradle`（包名、版本、ABI、签名）、`AndroidManifest.xml`（AppKey、权限、TV 入口，并合并项目根的
   `AndroidManifest.xml` 中的权限与 meta-data）、`dcloud_control.xml`、`strings.xml`、图标与启动图。
5. 集成 `nativeplugins/`：AAR 放进 libs，`_dp_nativeplugin.android.plugins` 注册到 `dcloud_properties.xml`。
6. 执行 `gradlew :simpleDemo:assembleRelease|assembleDebug`。
7. `apksigner verify` 校验并输出 APK。

## 调试（基座 + 覆盖安装）

```bash
uni-pack debug -p <dir> --push --logs   # 重建基座、安装、启动并输出日志
```

`--push` 会重新编译前端资源并整体重建自定义基座，然后 `adb install -r` 覆盖安装并拉起应用。

> 没有采用「wgt + 热更新」方案：实测 SDK 5.34 上 `plus.runtime.install` 安装 wgt 后基座会在
> `io.dcloud.feature.pdr.RuntimeFeatureImpl` 抛空指针直接崩溃。`wgt` 命令仍可用于业务侧自建更新。

> 基座与正式包同包名同签名，安装基座会覆盖设备上的正式包。

## 版本必须对齐

真正必须一致的是「uni-app 编译器」和「离线 SDK」。两种项目的编译器版本来源不同：

| 项目类型 | 编译器版本来源 | 示例 |
| --- | --- | --- |
| CLI | 项目 `node_modules/@dcloudio/uni-app/package.json` | `3.0.0-5030420261029002` → **5.34** |
| HBuilderX | HBuilderX 安装目录 `plugins/about/package.json`（找不到时读上次产物 manifest） | `5.34.2026102909` → **5.34** |
| Android 离线 SDK | SDK 目录名 | `Android-SDK@5.34.82692` → **5.34** |

包名、版本号、名称与 min/target SDK 一律以项目 `manifest.json` 为准；配置里的同名字段只在该字段缺失时兜底，项目升版后不需要重跑 `init`。HBuilderX 项目不在 manifest 里写包名时，回退到项目根 `AndroidManifest.xml` 的 `package`，也可以在 `init` 时用 `--package` 指定。

CLI 项目的编码规则：取版本号横线后的前 5 位 `50304`，依次是主、次、补丁 → 5.3.4 → 显示为 `5.34`；`40805` → 4.8.5 → `4.85`。

不一致时 App 启动会弹「编译版本与手机端 SDK 版本不匹配」，严重时白屏。`init`/`build` 会在 `sdk.searchDirs` 里自动找与编译版本同号的 `Android-SDK@x.yy`，找不到时：

```bash
# CLI 项目：升级项目依赖到 SDK 对应版本，然后重新安装、重建基座与正式包
npx @dcloudio/uvm@latest
pnpm install

# 或者：下载与当前编译版本同号的 Android-SDK@x.yy，放到 sdk.searchDirs 或改 sdk.root
```

HBuilderX 项目则反过来：安装与离线 SDK 同号的 HBuilderX，或把 `sdk.root` / 项目 `sdkRoot` 指向与 HBuilderX 同号的 SDK。

`uni-pack doctor` 会显示项目类型、两边版本与匹配到的 SDK，`uni-pack build` 会直接拦下（可用 `--skip-version-check` 临时跳过）。

## 限制

- 仅支持普通 uni-app（Vue 3），不含 uni-app x / vapor / iOS。
- `app-plus.modules` 只自动映射常见模块的 AAR；未识别的模块会提示，运行时若报模块缺失需自行补充。
- `nativeplugins` 支持 `aar` 集成与 `plugins` 注册；依赖云端 SDK 的插件（只有 `meta.config`、没有 `package.json`）仍需手工集成。
- UTS 插件（`uni_modules/*/utssdk/app-android`）的离线集成尚未自动化，升级到包含 UTS 插件的项目前请先确认。
- 调试采用「重建基座 + 覆盖安装」，不做 wgt 热更新。

## 开发与发布

仓库锁定了开发环境：`.nvmrc` 为 Node 22，`engines` / `devEngines` 要求 Node `^20.19.0 || >=22.12.0`，npm 建议 ≥ 11。

```bash
nvm use            # 没有 nvm 就手动切到 Node 22
npm i -g npm@11    # 仅当本机 npm 低于 11
npm ci
npm test
```

发布只改 `package.json` 的 `version` 然后打标签，其余交给 CI，本机不需要 npm token：

```bash
npm version patch        # 或 minor / major
git push --follow-tags
```

`.github/workflows/release.yml` 在推送 `v*` 标签时运行：校验标签与 `package.json` 版本一致 → `npm ci` → `npm publish --provenance`（`prepublishOnly` 会再跑类型检查与单测）。凭据由 GitHub Actions 的 OIDC 临时换取，并自动附带 provenance 来源证明。

首次发布前需在 npmjs.com 的包设置里配置 trusted publisher：

- 仓库：`liu-dejin/uniapp-android-cli`
- 工作流文件：`.github/workflows/release.yml`

未配置时手动 `npm publish` 仍可发布，但不会生成来源证明。
