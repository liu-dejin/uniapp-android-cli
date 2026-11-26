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
| `UNI_PACK_TEMP` | 前端构建子进程的临时目录；默认 `<workDir>/<项目>/tmp`，系统 TEMP 有 ACL 问题时可用它显式指定 |

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

首次 `init` 会像 `create-vue` 一样逐项询问包名、AppKey、签名证书、别名、`keystore.properties`、输出目录，直接回车保留括号里的默认值；缺少离线 SDK / HBuilderX / Android SDK / JDK 时会继续引导填写本机路径并写入全局配置。CI 或非交互环境加 `--yes` 跳过问答。可共享的配置会写到 `<项目>/uni-pack.config.json`。

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

HBuilderX 项目如果没有 `certificate/android/keystore.properties`，`init` 会询问证书路径与别名；密码仍然只在构建时提供：

```bash
uni-pack init  -p <项目> --appkey <key>
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

`<名称>` 默认取 manifest 的 `name`；如果 `name` 是中文（清洗后为空），会回退到项目标识或 appid。希望改名不影响产物前缀时，在项目级配置里写 `outputPrefix` 固定它。

`--prune <n>` 会在构建完成后按时间只保留最近 n 个时间戳 APK（按 mode 分别计算，`latest` 与 `builds.jsonl` 永远保留）。

## 命令参考

通用参数：

- `-p, --project <dir>`：项目目录；不传时使用当前目录
- `--verbose`：输出全量 Gradle 原始日志（默认把重复的 D8 / Kotlin metadata 告警折叠成摘要）
- `--json`：`doctor` / `build` / `wgt` 输出机器可读结果

### init

```bash
uni-pack init [-p <dir>] [--appkey <key>] [--package <包名>] [--key-alias <别名>]
              [--keystore <文件>] [--keystore-properties <文件>]
              [--sdk <dir>] [--hbuilderx <dir>]
              [--android-sdk <dir>] [--jdk <dir>] [--yes]
```

- 自动识别 CLI / HBuilderX 项目
- 自动探测 HBuilderX 与离线 SDK，并按项目版本匹配 SDK
- 交互式补全项目级配置（包名、AppKey、证书、别名、`keystore.properties`、输出目录）；回车保留默认值
- 机器级路径（离线 SDK / HBuilderX / Android SDK / JDK）：已探测到时询问是否修改，缺失时强制引导填写，结果写入 `~/.uniapp-android-cli/config.json`，后续项目复用
- 非 TTY / CI 环境自动跳过问答，`--yes` 可显式跳过
- 可共享字段写入 `<项目>/uni-pack.config.json`：包名、AppKey、签名路径、`webBuild`、输出目录，可提交到仓库
- 本机路径写入 `~/.uniapp-android-cli/config.json`：`projectDir`、`sdkRoot`、`hbuilderxRoot`
- 密码不写入任何配置；证书默认在 `<项目>/certificate/android/` 下自动探测，团队自定义布局用 `--keystore` / `--keystore-properties` 指定（相对路径按项目目录解析）
- `--key-alias` 可省略：会从 `keystore.properties` 的 `keyAlias` 读取
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
| `--no-daemon` | 关闭 Gradle 守护进程（CI 等一次性环境用）；默认开启以便复用增量结果 |
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

如果项目里还保留 7-Zip 版 `scripts/build-wgt.mjs`，可以迁到 `uni-pack wgt`：

- 文件名由 `PRO-DIS-V2-<ver>.wgt` 变为 `<appid>-<ver>.wgt`，并附带同名 `.json`（sha256 / 版本 / 大小）与固定入口 `<appid>.wgt`；
- 默认输出目录为 `unpackage/release/wgt`，需要旧目录时用 `--out` 指回；
- 打包前已有资源版本闸门，不再需要脚本自己核对版本；
- 下游若依赖 md5 或固定前缀，先按清单字段/文件名适配；确认没有 CI 或脚本引用后，再删除 `scripts/build-wgt.mjs` 与 `package.json` 的 `build:wgt`。

### debug

```bash
uni-pack debug [-p <dir>] [--base <apk>] [--build] [--push]
               [--install] [--logs] [--device <serial>] [--skip-web]
               [--hbuilderx [--playground standard|custom] [--custom-type local|device] [--ui]]
               [--store-password <密码>] [--key-password <密码>]
```

行为：

- 没有基座、或传了 `--build` / `--push`：重新构建 debug 基座
- `--push`：重新编译前端资源并整体重建基座，然后覆盖安装、启动应用
- `--install`：安装基座并拉起应用
- `--logs`：实时输出 `console`、`uni-app`、`AndroidRuntime` 日志，`Ctrl+C` 结束
- 都不传且已有基座：只打印基座路径
- `--hbuilderx`：改用 HBuilderX CLI 真机运行（差量热重载 + 项目 `console` 日志），见下方「HBuilderX 真机运行」

### HBuilderX 真机运行（热重载 + 项目日志）

前提：

- HBuilderX **5.0+**，项目已经在 HBuilderX 中导入；
- HBuilderX 主程序保持运行；未运行时 `uni-pack` 会执行 `cli open`（Windows 5.34 没有无头模式，会打开窗口，5.36+ 可用 `startup.ini` 开无头）；
- **不要以管理员身份运行 HBuilderX**，否则普通权限的 `cli.exe` 连不上主程序（命名管道 `EPERM`）；
- 系统 TEMP 不可写时，先用可写 TEMP 启动 HBuilderX（`uni-pack` 会把 `TEMP/TMP` 传给 cli 子进程）。

```bash
uni-pack debug -p <项目> --hbuilderx --device <serial> --logs
```

- 保存代码后 HBuilderX 自动差量编译并同步到已安装基座，终端**直接输出项目 `console` 日志**（不是原生日志），`Ctrl+C` 结束；
- `--playground standard`（默认）使用 HBuilderX 标准基座；
- `--playground custom --custom-type local`：使用 `<项目>/unpackage/debug/android_debug.apk`，uni-pack 会先 `adb install -r` 强制安装，避免 HBuilderX 把同包名同版本的正式包误判成「基座已是最新」而跳过；
- `--playground custom --custom-type device`：直接使用设备上已安装的自定义基座（适合已经手动装好基座/多设备场景）；
- 自定义基座里没有新加的 UTS/原生插件时，运行会提示「当前运行的基座不包含原生插件 XXX」，需要在 HBuilderX 重新制作包含该插件的基座；
- `--ui`：交给 HBuilderX 界面运行（需 5.11+）；
- `--push` / `--base` / `--install` 在 `--hbuilderx` 模式下会被忽略（由 HBuilderX 负责安装与启动）。

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
| `~/.uniapp-android-cli/config.json` | 本机配置：SDK / Android SDK / JDK / HBuilderX 路径，以及项目注册（`projectDir`、`sdkRoot`） |
| `<项目>/uni-pack.config.json` | 项目配置（`init` 生成，可提交）：包名、AppKey、签名路径、`webBuild`、输出目录；不含密码 |

同名配置以**项目级优先**；密码只来自命令行、环境变量或 `keystore.properties`。

`init` 的问答会把机器级路径写进用户配置（全局复用），把团队共享字段写进项目配置。

配置文件是**标准 JSON**，不支持注释。

### 项目级配置示例

`init` 生成的 `<项目>/uni-pack.config.json`：

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
    "keystore": "certificate/android/PRO_DIS_V2.keystore",
    "keyAlias": "prodis",
    "keystoreProperties": "certificate/android/keystore.properties",
    "storePasswordEnv": "UNI_PACK_STORE_PASS",
    "keyPasswordEnv": "UNI_PACK_KEY_PASS"
  }
}
```

`keystore` / `keystoreProperties` 的相对路径按项目目录解析；团队自定义布局可直接改成 `build/signing/...` 或绝对路径。

AppKey 会被打进 APK，不属于密码；如果公司规范不允许入库，可以只放在用户级配置（两处都写时项目级优先）。

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
      "hbuilderxRoot": ""
    }
  }
}
```

> 旧版本 `init` 写在用户配置里的 `appKey` / `package` / `signing` 仍然兼容；重跑一次 `init` 会自动迁移到项目级 `uni-pack.config.json`。

### 字段说明

用户配置里的 `projects.<key>.*` 与项目级 `uni-pack.config.json` 使用同一套字段名（项目级去掉 `projects.<key>` 前缀，直接写 `package` / `signing` 等）。

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
| `workDir` | 构建工作目录；首次构建复制 SDK 模板，之后复用（保留 `build/`、`.gradle/`），换 SDK 或模板改动时重新复制 |
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

- 路径规则：`keystore` / `keystoreProperties` 的相对路径都按**项目目录**解析，可以放在项目任意位置；也可以写绝对路径（团队共享证书目录）
- 别名：`keyAlias` 优先取配置；不填时自动读 `keystoreProperties` 里的 `keyAlias`
- 环境变量名：`storePasswordEnv` / `keyPasswordEnv` 可以改成团队已有的变量名（不局限于 `UNI_PACK_*`）
- 默认布局只探测 `<项目>/certificate/android/`；自定义布局用 `init --keystore ... --keystore-properties ...`，或直接写项目级 `uni-pack.config.json`

团队自定义布局示例：

```text
<项目>/
├─ build/signing/release.jks
└─ build/signing/release.properties
```

```bash
uni-pack init -p <项目> --keystore build/signing/release.jks \
  --keystore-properties build/signing/release.properties
```

密码优先级：命令行 → 环境变量 → `keystore.properties` → `keyPassword` 缺省时复用 `storePassword`。

密码不会落盘：工作目录的 `build.gradle` 只写 `System.getenv('UNI_PACK_STORE_PASS')` / `System.getenv('UNI_PACK_KEY_PASS')`，解析出的密码由构建子进程环境变量注入；复制到工作目录的 `aw-pack.jks` 在 Gradle 结束（成功或失败）后立即删除。

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
   - 首次构建或 SDK/模板变化时整棵复制；之后按模板指纹复用，只刷新会被 patch 的 `build.gradle` / `settings.gradle` / `simpleDemo/build.gradle` / `AndroidManifest.xml`，并清掉当前 appid 的 `www` 等增量输入
   - `build/`、`.gradle/` 保留，Gradle 可以命中 UP-TO-DATE / FROM-CACHE
3. 复制 AAR
   - 模板 `simpleDemo/libs` 是该 SDK 版本的基线
   - Vue 2 项目会改用 `SDK/libs` 里包含 Vue 2 运行时的完整 `uniapp-v8-release.aar`（模板里的可能是只含 Vue 3 的裁剪版）
   - `BASE_AARS` 与 `app-plus.modules` 常见模块按需补充
   - 老 SDK 缺少的 AAR 只提示不阻断
4. 写入项目配置
   - `build.gradle`：包名、版本、ABI、`compileSdk`、`buildTools`、签名（密码只写环境变量名，由子进程注入）
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
   - 默认开启 Gradle 守护进程、构建缓存与并行；首次构建会尝试配置缓存（`--configuration-cache`）
   - 配置缓存与工程不兼容时自动回退为普通构建，并在工作目录写 `gradle-flags.json` 记录，后续不再尝试（删掉该文件可重新尝试）
8. `apksigner verify` 校验，输出时间戳 APK、`latest` 硬链与构建清单；`--prune` 按需清理旧包

工作目录：`<workDir>/<项目名>/gradle`，首次构建复制模板，之后复用；Gradle 日志在 `<workDir>/<项目名>/logs/`。默认会把重复的 D8 / Kotlin metadata 告警折叠成「N 条 + 首个样例」，失败时只打印 `FAILURE` / `What went wrong` 前后各 15 行；需要完整原始日志时加 `--verbose`。

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

- **不会丢数据**：同包名同签名覆盖安装会保留 `/data/data/<包名>` 与 `/sdcard/Android/data/<包名>` 下的数据；
- **真实风险是现场设备上的正式包被调试基座替换**，所以调试机与现场机应分开；
- 不要给 debug 加 `applicationIdSuffix`：包名一变，DCloud AppKey 校验必然失败（见「签名与 AppKey」），而且两个包名会变成两个独立应用、数据目录互不相通。

> 没有采用「wgt + 热更新」：实测 SDK 5.34 上 `plus.runtime.install` 安装 wgt 后基座会在
> `io.dcloud.feature.pdr.RuntimeFeatureImpl` 抛空指针崩溃。`wgt` 命令仍可用于业务侧自建更新。

### 资源热更（wgt 与 debug 基座）

DCloud 5+ 运行时对每个 appid 有两套资源来源：优先读文件系统副本 `.../apps/<appid>/www`，没有才回退 APK 内 `assets/apps/<appid>/www`。

- **正式包**的文件系统副本在应用私有目录（`/data/data/<包名>/files/...`），普通 adb 写不进去，所以热更只能走 wgt 安装（`plus.runtime.install` / 在线更新）；
- **debug 基座**（`dcloud_control.xml` 根节点带 `debug="true"`）的文件系统根目录是 `/sdcard/Android/data/<包名>/`，理论上可以 `adb push` 做手工热更：
  - 至少推 `manifest.json`、`app-service.js`、`__uniappview.html`；
  - `appid` 必须与 `dcloud_control.xml`、推送的 `manifest.json` 的 `id` 一致；
  - 推完必须 `adb shell am force-stop <包名>` 冷启动，热启动不会重新扫描；
  - 这是未文档化用法，不建议作为发布机制；
- **HBuilderX 官方自定义基座热更**需要 `debug="true" + syncDebug="true"` 并打入 `debug-server-release.aar`；CLI 当前只写 `debug="true"`、模板也不带该 AAR，所以 CLI 基座不具备官方热更能力，仍采用「重建基座 + 覆盖安装」。

## 签名与 AppKey

### 签名

- 证书路径：`signing.keystore`
- 别名：`--key-alias` 或 `keystore.properties` 的 `keyAlias`
- 密码：命令行 → 环境变量 → `keystore.properties`
- `doctor` 会打印证书 SHA1/SHA256，便于核对 DCloud 后台绑定

### AppKey

AppKey 写入 `AndroidManifest.xml` 的 `dcloud_appkey` meta-data，必须与 DCloud 后台的 **appid + 包名（运行时转小写） + 证书 SHA1** 三者一致；AppKey 不区分 debug/release，但签名证书必须与申请时相同。

因此给 debug 加 `applicationIdSuffix` 会改变包名，AppKey 校验必然失败，应用会提示「未配置appkey或配置错误」并退出。需要并存时不要改包名，而是单独申请 AppKey（后台是否支持同一 appid 多包名需自行确认）。

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
| 加 `applicationIdSuffix` 后 AppKey 报错 | AppKey 绑定 appid + 包名 + 证书 SHA1，改了包名必然失败 | 不要加 suffix；debug 与正式包同包名同签名，或单独申请 AppKey |
| debug 基座覆盖正式包会不会丢数据 | 同包名同签名覆盖安装保留 `/data/data`，不会丢 | 真实风险是现场正式包被替换；调试机与现场机分开 |
| 能不能 adb push 热更 | 正式包资源在 APK assets 与私有目录，push 无效；只有 `debug="true"` 基座会读外部目录 | 正式热更走 wgt 安装；debug push 需 appid 一致并 force-stop 冷启动，属未文档化用法 |
| 项目的 `build-wgt` 脚本还要吗 | `uni-pack wgt` 已覆盖版本化命名、清单与版本闸门 | 按「从项目自带 wgt 脚本迁移」适配下游后删除脚本 |
| 提示“当前环境无法运行 VUE2 版本的 uni-app 应用” | 模板里的 `uniapp-v8-release.aar` 只带 Vue 3 运行时 | 本工具会为 Vue 2 自动改用 `SDK/libs` 完整版；确认 SDK 里有完整 AAR |
| UTS 插件被跳过 | 产物里没有编译后的 Kotlin | 先用 HBuilderX 完整编译一次 |
| UTS 日志提示 BuildConfig / dcloud_uts.dat | 运行时探测可选钩子 | 插件没有 `hooksClass/components` 时属正常提示 |
| Mpaas-Scan 未集成 | 只有 `meta.config`，无 `package.json` | 按云端插件文档手工集成 |
| 没有发现设备 | USB 调试未开 / 未授权 / 多设备 | 检查 `adb devices`；多设备用 `--device` |
| 无线配对超时 | 不同 Wi-Fi、VPN、防火墙、mDNS 不支持 | 同网段、关代理、放行防火墙、升级 platform-tools |
| Gradle 依赖下载失败 | 网络问题 | 联网成功构建一次后再用 `--offline` |
| 日志里大量 `D8 ... Kotlin metadata` / `Should never be called` | DCloud AAR 由 Kotlin 2.2 编译，模板 AGP 8.7 自带的 R8/lint 只认 Kotlin 2.0；不影响产物 | 默认已折叠为摘要；需要原始栈加 `--verbose`。不要为此降级 Gradle/AGP 或替换 AAR |
| 前端构建报 `C:\Windows\temp\esbuild-*: Access is denied` | 系统 TEMP 的 ACL 不可写，esbuild 无法清理临时文件 | 已自动把前端构建的 `TEMP`/`TMP` 指到 `<workDir>/<项目>/tmp`；仍失败时用 `UNI_PACK_TEMP` 指定可写目录 |
| Gradle 失败只看到一段上下文 | 默认只打印 `FAILURE` / `What went wrong` 前后各 15 行 | hint 末尾有完整日志路径；需要更多上下文加 `--verbose` 重跑 |
| 构建结束 Gradle 守护进程仍占内存 | 默认复用守护进程以加速下一次构建 | 一次性环境加 `--no-daemon`；需要立即释放时在工作目录执行 `gradlew --stop` |
| JDK 不匹配 | 版本过低 | 设置 `JAVA_HOME` 指向 JDK 17+ |
| 找不到 apksigner | build-tools 缺失 | 安装 build-tools，或配置 `android.buildTools` |
| 证书/密码文件不在 `certificate/android` | 默认只在该目录自动探测 | `init` 加 `--keystore` / `--keystore-properties`，或在项目级配置 `signing` 里指定；相对路径按项目目录解析 |

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
- UTS 模块优先使用 SDK 模板根 `build.gradle` 声明的 Kotlin 版本，模板没写时回退 Kotlin 2.2.0；coroutines 固定 1.8.1，首次构建需要联网
- 调试采用「重建基座 + 覆盖安装」；`wgt` 只负责产出资源包，不在设备上安装/热更
- 正式包热更需业务侧自行实现 wgt 下载与 `plus.runtime.install`；debug 基座的 adb push 热更属未文档化用法，不作为产品机制

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
