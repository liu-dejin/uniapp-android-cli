# uniapp-android-cli

[![npm](https://img.shields.io/npm/v/uniapp-android-cli)](https://www.npmjs.com/package/uniapp-android-cli)
[![CI](https://github.com/liu-dejin/uniapp-android-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/liu-dejin/uniapp-android-cli/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/uniapp-android-cli)](https://www.npmjs.com/package/uniapp-android-cli)
[![license](https://img.shields.io/npm/l/uniapp-android-cli)](https://github.com/liu-dejin/uniapp-android-cli/blob/main/LICENSE)

`uni-pack` 是 uni-app（Vue 2 / Vue 3）Android 应用的离线打包命令行工具。
不依赖 HBuilderX 图形界面，一条命令完成：源码编译 → 版本对齐 → SDK 模板与 AAR → UTS/原生插件 → Gradle → 签名 → 安装。

支持两类项目，后续流程一致：

| 类型 | 识别方式 | 源码编译 |
| --- | --- | --- |
| CLI 项目 | `src/manifest.json` | 项目自己的 `build:app-android` / `build:app-plus` |
| HBuilderX 项目 | 根目录 `manifest.json` | HBuilderX 自带编译器（Vue 2 / Vue 3） |

## 特性

- **一条命令出包**：`uni-pack build -p <项目>`，自动匹配离线 SDK、复制模板、集成 AAR/UTS/原生插件、签名并校验。
- **版本强制对齐**：编译器版本必须与 `Android-SDK@x.yy` 同号，不一致在编译前拦下，避免真机白屏。
- **版本化产物**：时间戳 APK + `latest` 硬链 + `.json` 清单 + `builds.jsonl`，多版本互不覆盖。
- **两种调试模式**：HBuilderX 热重载（保存即编译同步），或 uni-pack 自建基座（覆盖安装 + logcat）。
- **设备与产物管理**：USB / 无线 / Android 11+ 二维码配对；wgt 资源包；多项目、多 SDK 共存。

## 工作流程

```text
┌──────────────────────────────┐
│ 项目                          │
│  CLI        src/manifest.json │
│  HBuilderX  manifest.json     │
└──────────────┬───────────────┘
               │  uni-pack build
               ▼
┌──────────────────────────────┐
│ 1. 前端编译                   │
│    pnpm / HBuilderX 编译器     │
│ 2. 编译器与离线 SDK 版本对齐    │
│ 3. 前端产物版本闸门            │
│ 4. 复制 SDK 模板 + AAR         │
│ 5. UTS / nativeplugins 集成    │
│ 6. manifest / gradle / assets │
│ 7. Gradle assemble + 签名校验  │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ apk/  时间戳 APK + latest      │
│       *.json + builds.jsonl   │
│ unpackage/release/wgt/        │
│       <appid>-<ver>.wgt       │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ adb 安装 → 启动 → 日志         │
│ debug: HBuilderX 热重载        │
│        /  uni-pack 自建基座    │
└──────────────────────────────┘
```

日常命令流：

```bash
uni-pack init -p <项目>      # 初始化配置（交互式）
uni-pack doctor -p <项目>    # 环境自检
uni-pack build -p <项目>     # 正式包
uni-pack wgt -p <项目>       # 资源包
uni-pack debug -p <项目>     # 真机调试
```

## 环境要求

| 依赖 | 要求 |
| --- | --- |
| Node.js | `^20.19.0 \|\| >=22.12.0` |
| DCloud Android 离线 SDK | 版本与项目编译器一致 |
| Android SDK | 含 build-tools（apksigner）与 platform-tools（adb） |
| JDK | 17+ |
| HBuilderX | 仅 HBuilderX 项目需要，版本与离线 SDK 对齐 |

以下环境变量可在 `init` 前设置，也可在交互问答中填写：

| 变量 | 指向 |
| --- | --- |
| `UNI_SDK_ROOT` | 含 `HBuilder-Integrate-AS` 的离线 SDK 目录 |
| `UNI_SDK_DIRS` | 额外扫描 `Android-SDK@x.yy` 的目录（`;` 分隔） |
| `HBUILDERX_HOME` | HBuilderX 安装目录 |
| `ANDROID_HOME` | Android SDK 根目录（兼容 `ANDROID_SDK_ROOT`） |
| `JAVA_HOME` | JDK 17+ 根目录 |
| `UNI_PACK_TEMP` | 前端构建临时目录，默认 `<workDir>/<项目>/tmp` |

### 应用图标与启动图

正式包需要准备 Android 图标和启动图。不配置也能构建，但会回退到离线 SDK 的默认资源（DCloud 图标和启动图）并给出告警，发布前请务必替换：

- 在 manifest 的 `app-plus.distribute.icons.android` / `app-plus.distribute.splashscreen.android` 中填写 hdpi / xhdpi / xxhdpi / xxxhdpi 路径；
- 或放到默认目录：`src/static/app/icons/`（`72x72.png`、`96x96.png`、`144x144.png`、`192x192.png`）与 `src/static/app/splash/`（`splash-hdpi.png` 等）；
- 只配置部分密度时，会使用已有最高密度自动补齐其它密度和 `res/drawable/` 兜底图。

## 安装

```bash
npm install -g uniapp-android-cli
uni-pack version
```

源码开发：`npm ci && npm link`；分发 tarball：`npm run pack:cli`。

## 快速开始

```bash
# 1. 初始化：自动识别项目类型，补全包名/AppKey/证书/输出目录
uni-pack init -p ../PRO_DIS_V2

# 2. 自检：Node、编译器、SDK、JDK、证书、设备
uni-pack doctor -p ../PRO_DIS_V2

# 3. 正式包（默认 release）
uni-pack build -p ../PRO_DIS_V2

# 4. 资源包
uni-pack wgt -p ../PRO_DIS_V2

# 5. 真机调试（HBuilderX 项目可直接走热重载）
uni-pack debug -p ../PRO_DIS_V2
```

`init` 会把可共享配置写入 `<项目>/uni-pack.config.json`（可提交），把本机路径写入 `~/.uniapp-android-cli/config.json`。CI 环境加 `--yes` 跳过问答。

## 命令

通用参数：`-p, --project <目录或项目名>`（支持目录名/唯一子串，如 `-p PRO_PHONE`）、`--verbose`（完整 Gradle 日志）、`--json`（机器可读输出）。

| 命令 | 说明 |
| --- | --- |
| `init` | 交互式初始化，识别项目类型，写项目级/用户级配置 |
| `doctor` | 环境自检；有告警时退出码 `3` |
| `projects` | 列出已登记项目，配合 `-p <项目名>` 使用 |
| `build` | 正式包或调试基座，可安装到设备 |
| `wgt` | 生成 wgt 资源包与版本清单 |
| `debug` | 真机调试：HBuilderX 热重载或自建基座 |
| `devices` / `device` | 设备列表、无线配对、连接/断开、mDNS |
| `version` | 显示版本 |

### build

```bash
uni-pack build [-p <项目>] [--mode release|debug] [--skip-web] [--skip-resource-check]
               [--install] [--device <serial>] [--out <dir>] [--offline] [--no-daemon]
               [--prune <n>] [--skip-version-check]
               [--store-password <密码>] [--key-password <密码>]
```

| 参数 | 说明 |
| --- | --- |
| `--mode` | 默认 `release`；`debug` 生成可调试基座 |
| `--skip-web` | 复用已有前端产物 |
| `--skip-resource-check` | 跳过「前端产物版本 = 项目 manifest 版本」校验 |
| `--install` / `--device` | 构建后安装；`--device` 支持序列号、型号或唯一子串 |
| `--out` / `--prune` | 覆盖输出目录 / 只保留最近 n 个时间戳 APK |
| `--offline` / `--no-daemon` | Gradle 离线模式 / 关闭守护进程 |
| `--skip-version-check` | 临时跳过编译器与 SDK 版本一致性检查 |
| `--store-password` / `--key-password` | 签名密码，优先于环境变量与 `keystore.properties` |

### wgt

```bash
uni-pack wgt [-p <项目>] [--skip-web] [--skip-resource-check] [--out <dir>]
```

输出到 `<项目>/unpackage/release/wgt`：`<appid>-<version>.wgt`、同名 `.json` 清单（版本、大小、sha256、构建时间），以及硬链 `<appid>.wgt`。打包前校验前端产物版本，不一致直接失败。

### debug

```bash
uni-pack debug [-p <项目>] [--push] [--build] [--base <apk>] [--install] [--logs]
               [--device <serial>] [--skip-web]
               [--hbuilderx [--playground standard|custom] [--custom-type local|device] [--ui]]
```

| 模式 | 行为 |
| --- | --- |
| 默认（自建基座） | 无基座时自动构建 → 安装 → 启动；`--push` 重新编译前端并重建基座；`--logs` 输出 `console`/`uni-app`/`AndroidRuntime` 日志 |
| `--hbuilderx` | 交给 HBuilderX CLI 真机运行：编译 → 差量同步 → 启动 → 项目 `console` 日志 |

### device

```bash
uni-pack device                                  # USB / 无线设备
uni-pack device pair [--timeout 120]             # Android 11+ 二维码配对
uni-pack device pair <ip:port> <配对码>          # 手动配对
uni-pack device connect <ip[:port]>              # 连接无线设备
uni-pack device disconnect [ip[:port]]
uni-pack device tcpip [--port 5555] [--connect]
uni-pack device mdns
```

## 配置

| 文件 | 内容 |
| --- | --- |
| `~/.uniapp-android-cli/config.json` | 本机路径（SDK、HBuilderX、Android SDK、JDK）、`workDir`、项目注册 |
| `<项目>/uni-pack.config.json` | 包名、AppKey、签名路径、`webBuild`、输出目录，可提交仓库；不含密码 |

项目级优先于用户级。密码只来自命令行、环境变量或 `keystore.properties`，不写入任何配置。

### 项目配置示例

```json
{
  "type": "cli",
  "package": "uni.app.UNIF1A8702",
  "appKey": "<DCloud AppKey>",
  "outputDir": "apk",
  "outputPrefix": "PRO-DIS-V2",
  "webBuild": {
    "command": "pnpm",
    "args": ["run", "build:app-android"],
    "outputDir": "dist/build/app"
  },
  "signing": {
    "keystore": "certificate/android/app.keystore",
    "keyAlias": "key0",
    "keystoreProperties": "certificate/android/keystore.properties",
    "storePasswordEnv": "UNI_PACK_STORE_PASS",
    "keyPasswordEnv": "UNI_PACK_KEY_PASS"
  },
  "debug": {
    "strategy": "hbuilderx",
    "playground": "custom",
    "customType": "local",
    "device": "V1963A",
    "logs": true
  }
}
```

### 主要字段

| 字段 | 说明 |
| --- | --- |
| `package` / `appKey` | 包名与 DCloud AppKey；manifest 有 `packagename` 时以 manifest 为准 |
| `outputDir` / `outputPrefix` | APK 输出目录（默认 `apk`）/ 文件前缀（默认 manifest `name`） |
| `webBuild` | CLI 项目的前端构建命令与产物目录 |
| `signing` | 证书、别名、`keystore.properties`、密码环境变量名 |
| `debug.strategy` | `hbuilderx`（热重载）或 `legacy`（自建基座） |
| `debug.playground` / `customType` | HBuilderX 基座预设：`standard`/`custom`、`local`/`device` |
| `debug.device` / `debug.logs` | 默认设备（序列号/型号/唯一子串）、是否默认输出日志 |
| `sdk.root` / `sdk.searchDirs` | 默认离线 SDK / 扫描目录（用户配置） |
| `hbuilderx.root` | 默认 HBuilderX 目录（用户配置） |
| `android.sdkDir` / `android.jdk` / `android.buildTools` | Android SDK / JDK / build-tools（用户配置） |
| `workDir` | 构建工作目录，保留模板与 Gradle 增量缓存 |

### 签名

```properties
# keystore.properties
storePassword=******
keyPassword=******
keyAlias=key0
```

- `keystore`、`keystoreProperties` 的相对路径按项目目录解析，支持任意团队布局与绝对路径；
- `keyAlias` 缺省时自动读取 `keystore.properties`；
- 密码优先级：命令行 → 环境变量 → `keystore.properties` → `keyPassword` 复用 `storePassword`；
- 构建时只向 gradle 写环境变量名，复制到工作目录的证书在构建结束后立即删除。

### 版本对齐

| 角色 | 版本来源 |
| --- | --- |
| CLI 编译器 | `node_modules/@dcloudio/uni-app/package.json`（`3.0.0-50304…` → `5.34`） |
| HBuilderX 编译器 | HBuilderX `plugins/about/package.json` |
| 离线 SDK | 目录名 `Android-SDK@5.34.…` → `5.34` |

不一致时：CLI 项目升级依赖（`npx @dcloudio/uvm@latest`）或补同号 SDK；HBuilderX 项目安装同号 HBuilderX 或指定同号 SDK。`--skip-version-check` 仅用于临时排查，正式包不建议。

## 产物

### APK

| 文件 | 说明 |
| --- | --- |
| `<前缀>_<版本>_<版本号>_<release\|debug>_<时间戳>.apk` | 每次构建独立副本 |
| `..._latest.apk` | 最近一次构建的硬链接 |
| `<...>.apk.json` | 构建记录 + sha256 |
| `builds.jsonl` | 全部构建记录，一行一条 |

`apksigner verify` 通过后才会发布产物。

### wgt

`<appid>-<version>.wgt` + `.json` 清单 + `<appid>.wgt` 硬链。

> wgt 只负责产出资源包，不在设备上安装/热更。SDK 5.34 实测 `plus.runtime.install` 安装 wgt 会让基座崩溃，正式热更需业务侧自行实现并充分验证。

## 调试

### 自建基座（默认）

```bash
uni-pack debug -p <项目> --logs          # 构建/安装/启动 + 日志
uni-pack debug -p <项目> --push          # 重新编译前端并整体重建基座
```

基座与正式包同包名、同签名，覆盖安装会保留应用数据；风险是现场设备上的正式包被替换，调试机与现场机应分开。不要给 debug 加 `applicationIdSuffix`：包名改变会导致 AppKey 校验失败。

### HBuilderX 热重载

前提：HBuilderX 5.0+、项目已导入、主程序保持运行、**不要以管理员身份运行**（否则 `cli.exe` 无法通过命名管道连接）。

```bash
uni-pack debug -p <项目> --hbuilderx --playground custom --custom-type local --device <serial> --logs
```

- `playground=custom` + `customType=local`：使用 `<项目>/unpackage/debug/android_debug.apk`，uni-pack 先 `adb install -r` 强制安装，避免 HBuilderX 因同包名同版本误判「基座已是最新」；
- `customType=device`：直接使用设备上已安装的自定义基座；
- 保存代码后 HBuilderX 自动差量编译并同步，终端输出项目 `console` 日志；
- 自定义基座缺少新增原生/UTS 插件时，需要在 HBuilderX 重新制作基座。

### 调试预设

写入项目配置后，日常命令可省略全部调试参数：

```bash
uni-pack debug -p PRO_PHONE
```

命令行参数优先（`--playground standard`、`--device PLK110` 可临时覆盖）；`--push`/`--build`/`--base`/`--install` 会强制回到自建基座流程。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 未找到离线 SDK | 设置 `UNI_SDK_ROOT` / `sdk.searchDirs`，或 `init --sdk <目录>` |
| 版本不一致 | 按提示升级项目依赖/HBuilderX，或补同号离线 SDK |
| 找不到 HBuilderX | `init --hbuilderx <目录>` 或设置 `HBUILDERX_HOME` |
| App 停在启动页 / AppKey 错误 | 核对 DCloud 后台 appid + 小写包名 + 证书 SHA1；重跑 `init` 统一包名 |
| 多设备安装到了错误的设备 | 传 `--device <序列号/型号/唯一子串>` |
| 无线配对超时 | 同网段、关闭 VPN/代理、放行防火墙、升级 platform-tools |
| 前端构建 `esbuild-*: Access is denied` | 系统/用户 TEMP 被杀毒或索引服务占用，设置 `UNI_PACK_TEMP` 指向非用户目录 |
| 应用图标/启动图没配 | 使用 SDK 默认 DCloud 资源并告警，发布前在 manifest 或默认目录补齐 |
| Gradle 大量 `D8 ... Kotlin metadata` | DCloud AAR 由更高版本 Kotlin 编译，模板 R8 提示；不影响产物，默认已折叠 |
| 当前基座不包含原生插件 | 自定义基座较旧，在 HBuilderX 重新制作包含该插件的基座 |
| 日志看不到 JS 输出 | HBuilderX 模式看项目 `console` 日志；自建基座加 `--logs` |

## 退出码

| 码 | 含义 | 码 | 含义 |
| --- | --- | --- | --- |
| `0` | 成功 | `5` | Gradle 失败 |
| `2` | 配置错误 | `6` | 签名失败 |
| `3` | 预检失败 / doctor 有告警 | `7` | 设备操作失败 |
| `4` | 前端编译失败 / 资源版本不一致 | `8` | wgt 失败 |

## 限制

- 仅支持普通 uni-app 的 Vue 2 / Vue 3 Android 项目，不含 uni-app x / vapor / iOS。
- `app-plus.modules` 只自动映射常见模块；`nativeplugins` 仅支持带 `package.json` 的本地插件，云端插件需手工集成。
- UTS 插件依赖构建产物中的 Kotlin 源码，首次构建需要联网下载 Kotlin 依赖。
- HBuilderX 项目依赖本机 HBuilderX 编译，版本必须与离线 SDK 对齐。
- wgt 仅产出资源包；调试采用「重建基座 + 覆盖安装」。

## 已验证

Windows 11 + Node 22 + DCloud 离线 SDK 5.34 + HBuilderX 5.34，Android 14 平板（USB）与 Android 17 手机（无线/有线）：

- HBuilderX + Vue 3（正式包 / wgt / 调试）
- HBuilderX + Vue 2（正式包 / wgt / 调试）
- CLI + Vue 3（正式包 / wgt / 调试）
- debug 包已完成真机安装与启动验证

## 开发与发布

```bash
npm ci
npm run typecheck
npm test
```

发布由 CI 完成：修改 `package.json` 版本并推送 `v*` 标签，`.github/workflows/release.yml` 校验标签与版本一致后执行 `npm publish --provenance`（OIDC 换取临时凭据，无需本机 token）。

```bash
npm version patch        # 或 minor / major
git push --follow-tags
```

首次发布需在本机完成 `npm login && npm publish --access public`，然后在 npmjs.com 配置 trusted publisher（仓库 `liu-dejin/uniapp-android-cli`，工作流 `release.yml`）。

## License

MIT
