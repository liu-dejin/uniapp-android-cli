# uniapp-android-cli

离线打包 uni-app（Vue 2 / Vue 3）Android 应用。支持两种项目来源：

- **CLI 项目**：`src/manifest.json`，用项目自己的 `pnpm run build:app-android` 编译
- **HBuilderX 项目**：根目录 `manifest.json`，用 HBuilderX 自带编译器编译

两种项目后面都走同一套离线打包流程：模板、AAR、UTS 插件、原生插件、Gradle、签名、安装与调试。

## 目录

- [能做什么](#能做什么)
- [环境要求](#环境要求)
- [安装](#安装)
- [快速开始](#快速开始)
- [命令参考](#命令参考)
- [配置](#配置)
- [版本对齐](#版本对齐)
- [构建流程](#构建流程)
- [真机安装与调试](#真机安装与调试)
- [签名与 AppKey](#签名与-appkey)
- [常见问题](#常见问题)
- [退出码](#退出码)
- [限制](#限制)
- [已验证环境](#已验证环境)
- [开发与发布](#开发与发布)

## 能做什么

- `init`：识别项目类型，自动匹配离线 SDK 与 HBuilderX，写入项目配置
- `doctor`：检查 Node、项目、编译器版本、离线 SDK、Android SDK、JDK、签名证书、设备
- `build`：生成正式包或自定义基座，支持安装到设备
- `wgt`：生成可热更新的 wgt 包
- `debug`：重建基座、安装、启动、抓日志
- `device`：USB / 无线设备管理，支持 Android 11+ 二维码配对
- 版本对齐：CLI 项目跟随 `@dcloudio`，HBuilderX 项目跟随 HBuilderX，按版本自动匹配 `Android-SDK@x.yy`
- 多项目、多 SDK 版本共存：每个项目可以单独指定 `sdkRoot` / `hbuilderxRoot`

## 环境要求

| 依赖 | 要求 |
| --- | --- |
| Node.js | `^20.19.0 \|\| >=22.12.0`（推荐 Node 22） |
| DCloud Android 离线 SDK | 版本必须与项目编译版本一致 |
| Android SDK | 含 build-tools（apksigner）与 platform-tools（adb） |
| JDK | 17+ |
| HBuilderX | 仅 HBuilderX 项目需要，版本需与离线 SDK 对齐 |

建议先设置环境变量，`init` 探测不到时会按提示使用：

| 变量 | 指向 |
| --- | --- |
| `UNI_SDK_ROOT` | 解压后包含 `HBuilder-Integrate-AS` 的目录 |
| `UNI_SDK_DIRS` | 额外扫描 `Android-SDK@x.yy` 的目录，多个用 `;` 分隔 |
| `HBUILDERX_HOME` | HBuilderX 安装目录 |
| `ANDROID_HOME` | Android SDK 根目录（也认 `ANDROID_SDK_ROOT`） |
| `JAVA_HOME` | JDK 17+ 根目录 |

## 支持的项目类型

| 类型 | 识别方式 | 源码编译 | 版本来源 | 编译产物 |
| --- | --- | --- | --- | --- |
| CLI | 有 `src/manifest.json` | 项目 `webBuild`（默认按脚本选 `build:app-android` 或 `build:app-plus`） | `node_modules/@dcloudio/uni-app` | `dist/build/app` 或 `dist/build/app-plus` |
| HBuilderX | 根目录有 `manifest.json`（JSONC） | HBuilderX 自带编译器（Vue 3 用 `uniapp-cli-vite`，Vue 2 用 `uniapp-cli`） | HBuilderX `plugins/about/package.json` | `unpackage/dist/build/app-plus` |

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

安装后验证：

```bash
uni-pack version
```

## 快速开始

### CLI 项目

```bash
uni-pack init  -p ../YFB_PROJECT/PRO_DIS_V2 --appkey <DCloud AppKey>
uni-pack doctor -p ../YFB_PROJECT/PRO_DIS_V2
uni-pack build  -p ../YFB_PROJECT/PRO_DIS_V2 --mode release
```

### HBuilderX 项目

```bash
# 自动探测 HBuilderX；没有探测到就用 --hbuilderx 指定
uni-pack init  -p ../YFB_PROJECT/PRO_PHONE --appkey <DCloud AppKey>
uni-pack doctor -p ../YFB_PROJECT/PRO_PHONE
uni-pack build  -p ../YFB_PROJECT/PRO_PHONE --mode release
```

HBuilderX 项目如果没有 `certificate/android/keystore.properties`，`init` 不知道签名别名和密码，需要显式传：

```bash
uni-pack init  -p <项目> --appkey <key> --key-alias <别名>
uni-pack build -p <项目> --mode release --store-password <密码> --key-password <密码>
```

### 安装到设备并启动

```bash
uni-pack build -p <项目> --mode debug --install --device <序列号>
uni-pack device
```

### 产物位置

默认输出到项目 `apk/`：

| 文件 | 说明 |
| --- | --- |
| `<名称>_<版本>_<版本号>_<release\|debug>_<YYYYMMDD_HHMM>.apk` | 每次构建的时间戳副本 |
| `<名称>_<版本>_<版本号>_<release\|debug>_latest.apk` | 指向最近一次构建的硬链接，零复制 |
| `<...>.apk.json` | 该 APK 的构建记录 + sha256 + builtAt |
| `builds.jsonl` | 全部构建记录，一行一条，便于脚本或看板消费 |

`<名称>` 默认取 manifest 的 `name`。如果希望改名不影响产物前缀，在项目级配置里写 `outputPrefix` 固定它。

`--prune <n>` 会在构建完成后按时间只保留最近 n 个时间戳 APK（按 mode 分别计算，`latest` 与 `builds.jsonl` 永远保留）。

## 命令参考

通用参数：

- `-p, --project <dir>`：项目目录；不传时使用当前目录
- `--verbose`：输出详细构建日志
- `--json`：`doctor` / `build` / `wgt` 输出机器可读结果

### init

```bash
uni-pack init [-p <dir>] [--appkey <key>] [--package <包名>] [--key-alias <别名>]
              [--keystore <文件>] [--sdk <dir>] [--hbuilderx <dir>]
              [--android-sdk <dir>] [--jdk <dir>]
```

- 自动识别 CLI / HBuilderX 项目
- 自动探测 HBuilderX 与离线 SDK，并按项目版本匹配 SDK
- 写入 `~/.uniapp-android-cli/config.json`
- 不覆盖已有连接配置；`--package` 用于 HBuilderX 项目 manifest 里没有包名的情况
- 版本不一致时会直接打印两边版本和修复方向

### doctor

```bash
uni-pack doctor [-p <dir>] [--json]
```

检查项：Node、项目、项目类型、编译器版本、HBuilderX、离线 SDK、Android SDK、JDK、版本一致性、签名证书、ADB 设备。

有告警时退出码为 `3`。

### build

```bash
uni-pack build [-p <dir>] [--mode release|debug] [--skip-web] [--out <dir>]
               [--install] [--device <serial>] [--offline]
               [--skip-version-check]
               [--store-password <密码>] [--key-password <密码>]
```

| 参数 | 说明 |
| --- | --- |
| `--mode` | 默认 `release`；`debug` 生成可调试基座 |
| `--skip-web` | 跳过源码编译，复用已有产物 |
| `--skip-resource-check` | 跳过「前端产物版本 = 项目 manifest 版本」校验；默认会拦下陈旧 dist |
| `--out` | 覆盖 APK 输出目录 |
| `--install` | 构建完成后安装到设备 |
| `--device` | 指定设备序列号；不传时自动选择唯一在线设备 |
| `--offline` | Gradle 使用 `--offline` |
| `--prune <n>` | 构建后按时间只保留最近 n 个时间戳 APK（`latest` 保留） |
| `--skip-version-check` | 临时跳过编译器与 SDK 版本一致性检查 |
| `--store-password` / `--key-password` | 签名密码，优先于环境变量与 `keystore.properties` |

### wgt

```bash
uni-pack wgt [-p <dir>] [--skip-web] [--skip-resource-check] [--out <dir>]
```

默认输出到 `<项目>/unpackage/release/wgt`：

| 文件 | 说明 |
| --- | --- |
| `<appid>-<versionName>.wgt` | 带版本号，重复打包不会互相覆盖 |
| `<appid>-<versionName>.json` | 同名版本清单：`appid` / `versionName` / `versionCode` / `size` / `sha256` / `builtAt` |
| `<appid>.wgt` | 硬链接到最新版本，旧的固定路径继续可用 |

打包前会校验前端产物 `manifest.json` 的版本与项目 manifest 是否一致：不一致直接以退出码 `4` 失败，避免「新版本号 + 旧资源」。确认 `dist` 已是最新时可加 `--skip-resource-check` 跳过。

### debug

```bash
uni-pack debug [-p <dir>] [--base <apk>] [--build] [--push]
               [--install] [--logs] [--device <serial>] [--skip-web]
               [--store-password <密码>] [--key-password <密码>]
```

行为：

- 没有基座、或传了 `--build` / `--push`：重新构建 debug 基座
- `--push`：重新编译前端资源并整体重建基座，然后覆盖安装、启动应用
- `--install`：安装基座并拉起应用
- `--logs`：实时输出 `console`、`uni-app`、`AndroidRuntime` 日志，`Ctrl+C` 结束
- 都不传且已有基座：只打印基座路径

### devices / device

```bash
uni-pack devices                          # 同 device list
uni-pack device [list]                    # USB / 无线设备
uni-pack device pair [--timeout <秒>] [--service <名>] [--code <6位>]
uni-pack device pair <ip:port> <配对码>   # 手动配对
uni-pack device connect <ip[:port]>       # 连接无线设备，默认端口 5555
uni-pack device disconnect [ip[:port]]    # 断开无线设备
uni-pack device tcpip [--port 5555] [--connect]
uni-pack device mdns                      # 查看 mDNS 服务
```

二维码配对（Android 11+）：

1. 执行 `uni-pack device pair`
2. 终端显示二维码
3. 手机：设置 → 开发者选项 → 无线调试 → 使用二维码配对设备
4. 工具发现手机广播的 mDNS 配对服务，自动执行 `adb pair` 并连接

注意事项：

- 手机广播的实例名不一定等于二维码里的服务名，工具会优先选择扫码后新出现的配对服务
- 手机与电脑需在同一 Wi-Fi，建议关闭 VPN/代理
- `adb mdns check` 需要有 `mdns daemon version` 输出
- Windows 防火墙需允许 node/adb 访问专用网络
- 默认等待 120 秒，范围 15–600 秒
- 配对服务名 ≤15 字符、仅字母数字和连字符且至少含一个字母；配对码为 6 位数字

### version

```bash
uni-pack version
```

## 配置

### 文件位置

| 文件 | 说明 |
| --- | --- |
| `~/.uniapp-android-cli/config.json` | 用户级配置，保存 SDK、Android SDK、JDK、项目列表 |
| `<项目>/uni-pack.config.json` | 项目级覆盖，可写 appKey、package、signing、webBuild、outputDir、sdkRoot 等 |

配置文件是**标准 JSON**，不支持注释。

### 用户级配置示例

```json
{
  "version": 1,
  "sdk": {
    "root": "C:/develop/android-sdk/uniapp-Android/Android-SDK@5.34.82692_20261030",
    "searchDirs": ["C:/develop/android-sdk/uniapp-Android"],
    "template": "HBuilder-Integrate-AS",
    "libsDir": "SDK/libs",
    "dataDir": "SDK/assets/data"
  },
  "hbuilderx": {
    "root": "C:/Soft/HBuilderX",
    "searchDirs": []
  },
  "android": {
    "sdkDir": "C:/develop/android-sdk",
    "buildTools": "",
    "jdk": "C:/develop/Java/jdk-17"
  },
  "workDir": "C:/Users/<用户>/.uniapp-android-cli/work",
  "projects": {
    "pro-dis-v2": {
      "projectDir": "C:/develop/Project/YFB_PROJECT/PRO_DIS_V2",
      "type": "cli",
      "sdkRoot": "C:/develop/android-sdk/uniapp-Android/Android-SDK@5.34.82692_20261030",
      "hbuilderxRoot": "",
      "package": "com.yfb.prodis",
      "appKey": "<DCloud AppKey>",
      "outputDir": "C:/develop/Project/YFB_PROJECT/PRO_DIS_V2/apk",
      "webBuild": {
        "command": "pnpm",
        "args": ["run", "build:app-android"],
        "outputDir": "dist/build/app"
      },
      "signing": {
        "keystore": "certificate/android/PRO_DIS_V2.keystore",
        "keyAlias": "prodis",
        "keystoreProperties": "certificate/android/keystore.properties",
        "storePasswordEnv": "UNI_PACK_STORE_PASS",
        "keyPasswordEnv": "UNI_PACK_KEY_PASS"
      },
      "debug": {
        "launchActivity": "io.dcloud.PandoraEntry"
      }
    }
  }
}
```

### 字段说明

| 字段 | 说明 |
| --- | --- |
| `sdk.root` | 默认离线 SDK；不填时按项目版本自动扫描 |
| `sdk.searchDirs` | 扫描 `Android-SDK@x.yy` 的目录 |
| `sdk.template` | 模板目录名，默认 `HBuilder-Integrate-AS` |
| `sdk.libsDir` / `sdk.dataDir` | SDK 内 AAR 与 assets 目录 |
| `hbuilderx.root` | 默认 HBuilderX 安装目录 |
| `hbuilderx.searchDirs` | 额外扫描 HBuilderX 的目录 |
| `android.sdkDir` | Android SDK 根目录 |
| `android.buildTools` | 指定 build-tools 版本；留空时用 SDK 模板值，再退到本机最高版本 |
| `android.jdk` | JDK 目录 |
| `workDir` | 构建工作目录，每次构建会清空对应的 `gradle/` |
| `projects.<key>.projectDir` | 项目目录 |
| `projects.<key>.type` | `cli` 或 `hbuilderx`，一般由 `init` 自动识别 |
| `projects.<key>.sdkRoot` | 项目专用离线 SDK，覆盖全局 `sdk.root` |
| `projects.<key>.hbuilderxRoot` | 项目专用 HBuilderX |
| `projects.<key>.package` | 包名；manifest 里有 `packagename` 时以 manifest 为准 |
| `projects.<key>.appKey` | DCloud AppKey |
| `projects.<key>.outputDir` | APK 输出目录，默认 `<项目>/apk` |
| `projects.<key>.outputPrefix` | APK 文件名前缀，默认取 manifest 的 `name`；固定它可让展示名改动不影响产物前缀 |
| `projects.<key>.webBuild` | CLI 项目的前端构建命令与产物目录 |
| `projects.<key>.signing` | 签名配置 |
| `projects.<key>.debug.launchActivity` | 启动 Activity，默认 `io.dcloud.PandoraEntry` |

### 签名配置

```json
{
  "signing": {
    "keystore": "certificate/android/app.keystore",
    "keyAlias": "key0",
    "keystoreProperties": "certificate/android/keystore.properties",
    "storePasswordEnv": "UNI_PACK_STORE_PASS",
    "keyPasswordEnv": "UNI_PACK_KEY_PASS"
  }
}
```

`keystore.properties` 格式：

```properties
storePassword=123456
keyPassword=123456
keyAlias=key0
```

密码优先级：命令行 → 环境变量 → `keystore.properties` → `keyPassword` 缺省时复用 `storePassword`。

### 多项目与多 SDK

同一台机器可以同时存在多个版本：

```text
C:/develop/android-sdk/uniapp-Android/
├─ Android-SDK@4.45.xxxxx/
└─ Android-SDK@5.34.82692_20261030/
```

```json
{
  "sdk": { "searchDirs": ["C:/develop/android-sdk/uniapp-Android"] },
  "projects": {
    "pro-dis-v2": { "sdkRoot": ".../Android-SDK@5.34.82692_20261030" },
    "pro-phone":  { "sdkRoot": ".../Android-SDK@4.45.xxxxx" }
  }
}
```

- 项目写了 `sdkRoot`：始终使用它，版本不符会报错
- 项目没写 `sdkRoot`：先按版本在扫描目录里找；全局 `sdk.root` 版本不符时 `build` 会自动切到匹配版本

## 版本对齐

真正必须一致的是「uni-app 编译器」和「离线 SDK」。

| 角色 | 版本来源 | 示例 |
| --- | --- | --- |
| CLI 编译器 | 项目 `node_modules/@dcloudio/uni-app/package.json` | `3.0.0-5030420261029002` → **5.34** |
| HBuilderX 编译器 | HBuilderX `plugins/about/package.json`；找不到时读上次产物 manifest | `5.34.2026102909` → **5.34** |
| 离线 SDK | SDK 目录名 | `Android-SDK@5.34.82692_20261030` → **5.34** |

CLI 版本解码规则：取横线后前 5 位 `50304`，依次为主、次、补丁 → 5.3.4 → 显示为 `5.34`；`40805` → 4.8.5 → `4.85`。

自动匹配顺序：

1. 项目 `sdkRoot`
2. 全局 `sdk.root` / `UNI_SDK_ROOT`
3. 按版本扫描 `sdk.searchDirs`、`UNI_SDK_DIRS`、`sdk.root` 上级目录、默认目录
4. 找不到：`doctor` 标红，`build` 在编译前拦下

两种项目的修复方向不同：

| 项目类型 | 版本不符时 |
| --- | --- |
| CLI | 升级项目依赖到 SDK 版本（`npx @dcloudio/uvm@latest` + `pnpm install`），或补一份与项目同号的 SDK |
| HBuilderX | 安装与 SDK 同号的 HBuilderX，或把 `sdkRoot` / `sdk.root` 指向与 HBuilderX 同号的 SDK |

`--skip-version-check` 可临时跳过，但运行时可能弹版本不匹配甚至白屏，不建议用于正式包。

## 构建流程

1. 编译源码
   - CLI：执行 `webBuild`。Vue 3 项目默认用 `build:app-android`（产物 `dist/build/app`），Vue 2 项目默认用 `build:app-plus`（产物 `dist/build/app-plus`），`init` 会根据 `package.json` 脚本自动选择
   - HBuilderX：按 `manifest.json` 的 `vueVersion` 选择编译器。Vue 3 用 `uniapp-cli-vite`，Vue 2 用 `uniapp-cli`，产物均为 `unpackage/dist/build/app-plus`
   - 编译后校验产物 `manifest.json` 的 `version.name` / `version.code` 与项目 manifest 一致；bump 版本后忘记重新编译、或 `--skip-web` 用了旧 dist 都会在这里失败（退出码 `4`）
2. 按项目版本匹配离线 SDK，把 `HBuilder-Integrate-AS` 复制到工作目录，**不改动共享 SDK**
3. 复制 AAR
   - 模板 `simpleDemo/libs` 是该 SDK 版本的基线
   - Vue 2 项目会改用 `SDK/libs` 里包含 Vue 2 运行时的完整 `uniapp-v8-release.aar`（模板里的可能是只含 Vue 3 的裁剪版）
   - `BASE_AARS` 与 `app-plus.modules` 常见模块按需补充
   - 老 SDK 缺少的 AAR 只提示不阻断
4. 写入项目配置
   - `build.gradle`：包名、版本、ABI、`compileSdk`、`buildTools`、签名
   - `AndroidManifest.xml`：AppKey、权限、TV 入口，并合并项目根 `AndroidManifest.xml` 的权限与 meta-data
   - `dcloud_control.xml`、`strings.xml`、图标与启动图
5. 集成 `nativeplugins/`
   - `android/` 下的 AAR/JAR 放进 libs
   - `_dp_nativeplugin.android.plugins` 注册到 `dcloud_properties.xml`
   - `_dp_nativeplugin.android.dependencies` 注入 Gradle
6. 集成 UTS 插件
   - 读取 `uni_modules/<插件>/utssdk/app-android` 下编译后的 Kotlin 源码
   - 生成 `uts-<插件>` Android Library 模块
   - 接入 `settings.gradle`、根工程 Kotlin 插件、主模块依赖、`UTSHooksClassArray`、`dcloud_uniplugins.json`
   - 补充该 SDK 的 `utsplugin-release.aar`
   - 首次构建需要联网下载 Kotlin Gradle 插件与运行时依赖
7. 执行 `gradlew :simpleDemo:assembleRelease|assembleDebug`
8. `apksigner verify` 校验，输出时间戳 APK、`latest` 硬链与构建清单；`--prune` 按需清理旧包

工作目录：`<workDir>/<项目名>/gradle`，每次构建前清空；Gradle 日志在 `<workDir>/<项目名>/logs/`。

## 真机安装与调试

### USB

1. 手机/平板开启开发者选项与 USB 调试
2. 连接后确认：

```bash
uni-pack device
```

3. 构建并安装：

```bash
uni-pack build -p <项目> --mode debug --install --device <序列号>
```

多台设备时务必传 `--device`。

### 无线

```bash
uni-pack device pair          # Android 11+，扫码
uni-pack device pair <ip:port> <配对码>
uni-pack device connect <ip>
```

### 抓日志

```bash
uni-pack debug -p <项目> --logs
```

会输出 `console`、`uni-app`、`AndroidRuntime` 日志；`Ctrl+C` 结束。

### 基座与正式包

`debug` 构建的基座与正式包同包名、同签名，安装基座会覆盖设备上的正式包。

> 没有采用「wgt + 热更新」：实测 SDK 5.34 上 `plus.runtime.install` 安装 wgt 后基座会在
> `io.dcloud.feature.pdr.RuntimeFeatureImpl` 抛空指针崩溃。`wgt` 命令仍可用于业务侧自建更新。

## 签名与 AppKey

### 签名

- 证书路径：`signing.keystore`
- 别名：`--key-alias` 或 `keystore.properties` 的 `keyAlias`
- 密码：命令行 → 环境变量 → `keystore.properties`
- `doctor` 会打印证书 SHA1/SHA256，便于核对 DCloud 后台绑定

### AppKey

AppKey 写入 `AndroidManifest.xml` 的 `dcloud_appkey` meta-data，必须与 DCloud 后台的 **appid + 包名 + 证书 SHA1** 绑定一致。

常见现象：AppKey 无效时应用可能停在启动页，日志里几乎没有 JS 运行记录。排查：

```bash
# 查看包内 AppKey
aapt2 dump xmltree --file AndroidManifest.xml app.apk | grep -A2 dcloud_appkey

# 查看包名与版本
aapt2 dump badging app.apk | grep "^package:"
```

也可以从设备上已安装的正常包提取真实 AppKey，核对后再写入项目配置。

### 包名

解析顺序：

1. `manifest.json` 的 `app-plus.distribute.android.packagename`
2. 配置里的 `package`
3. 项目根 `AndroidManifest.xml` 的 `package`（HBuilderX 兜底时统一转小写）

HBuilderX 实际打包使用小写包名，大小写不一致会导致 AppKey 绑定失败。旧配置里如果保存了大写包名，重跑一次 `init` 即可。

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 未找到离线 SDK | 未配置或目录无效 | 设置 `UNI_SDK_ROOT` / `sdk.searchDirs`，或 `init --sdk` |
| 版本不一致 | 项目编译器与 SDK 不同号 | 按提示升级项目依赖 / HBuilderX，或补同号 SDK |
| 找不到 HBuilderX | HBuilderX 项目需要它编译源码 | `init --hbuilderx <目录>` 或设置 `HBUILDERX_HOME` |
| 包名不合法 | manifest 没写 packagename | `init --package <包名>` 或补 manifest |
| App 停在启动页 | AppKey 无效或包名大小写不匹配 | 换真实 AppKey；重跑 `init` 统一小写包名 |
| 提示“当前环境无法运行 VUE2 版本的 uni-app 应用” | 模板里的 `uniapp-v8-release.aar` 只带 Vue 3 运行时 | 本工具会为 Vue 2 自动改用 `SDK/libs` 完整版；确认 SDK 里有完整 AAR |
| UTS 插件被跳过 | 产物里没有编译后的 Kotlin | 先用 HBuilderX 完整编译一次 |
| UTS 日志提示 BuildConfig / dcloud_uts.dat | 运行时探测可选钩子 | 插件没有 `hooksClass/components` 时属正常提示 |
| Mpaas-Scan 未集成 | 只有 `meta.config`，无 `package.json` | 按云端插件文档手工集成 |
| 没有发现设备 | USB 调试未开 / 未授权 / 多设备 | 检查 `adb devices`；多设备用 `--device` |
| 无线配对超时 | 不同 Wi-Fi、VPN、防火墙、mDNS 不支持 | 同网段、关代理、放行防火墙、升级 platform-tools |
| Gradle 依赖下载失败 | 网络问题 | 联网成功构建一次后再用 `--offline` |
| JDK 不匹配 | 版本过低 | 设置 `JAVA_HOME` 指向 JDK 17+ |
| 找不到 apksigner | build-tools 缺失 | 安装 build-tools，或配置 `android.buildTools` |

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 配置错误 |
| `3` | 预检失败 / doctor 有告警 |
| `4` | 前端编译失败 / 前端产物版本与项目 manifest 不一致 |
| `5` | Gradle 失败 |
| `6` | 签名失败 |
| `7` | 设备操作失败 |
| `8` | wgt 失败 |

## 限制

- 支持普通 uni-app 的 Vue 2 / Vue 3 项目，不含 uni-app x / vapor / iOS
- `app-plus.modules` 只自动映射常见模块的 AAR；未识别模块会提示，运行时缺模块需自行补充
- `nativeplugins` 支持 `aar` 集成与 `plugins` 注册；只有 `meta.config` 的云端插件需手工集成
- UTS 插件依赖构建产物里的 Kotlin 源码；只有 `.uts` 源码时会跳过
- UTS 模块固定使用 Kotlin 2.2.0 / coroutines 1.8.1，首次构建需要联网
- 调试采用「重建基座 + 覆盖安装」，不做 wgt 热更新

## 已验证环境

- Windows 11
- Node 22
- DCloud Android 离线 SDK 5.34
- HBuilderX 5.34
- Android 14 平板（USB）与 Android 17 手机（无线）
- CLI 项目与 HBuilderX 项目的 debug / release / wgt 构建均已跑通
- 已覆盖 Vue 3 项目（PRO_DIS_V2、PRO_PHONE）与 Vue 2 项目（PRO_PAD）
- debug 包已完成真机安装与启动验证（Android 14 平板 USB、Android 17 手机无线）

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

首次发布需要在本机手动完成（trusted publisher 只能配置到已存在的包上）：

```bash
npm login
npm publish --access public
```

发布成功后，在 npmjs.com 的包设置里配置 trusted publisher：

- 仓库：`liu-dejin/uniapp-android-cli`
- 工作流文件：`.github/workflows/release.yml`

之后的版本只改 `package.json` 的 `version` 然后打标签，由 CI 换取 OIDC 凭据发布并附带 provenance，本机不再需要 token。
