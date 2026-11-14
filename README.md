# uniapp-android-cli

离线打包 uni-app（Vue 3 / Vite）Android 应用，不依赖 HBuilderX。

- `build`：正式包、自定义基座
- `wgt`：生成可热更新的 wgt 包
- `debug`：安装基座、启动应用、推送最新资源、抓日志
- `doctor`：环境与证书自检

## 依赖

- Node ≥ 20（Windows 为主）
- DCloud Android 离线 SDK（版本需与项目的 `@dcloudio/*` 一致）
- Android SDK（build-tools 含 apksigner，platform-tools 含 adb）
- JDK 17+

首次使用建议先设好环境变量，`init` 探测不到时会按提示使用：

| 变量 | 指向 |
| --- | --- |
| `UNI_SDK_ROOT` | 解压后包含 `HBuilder-Integrate-AS` 的目录 |
| `ANDROID_HOME` | Android SDK 根目录（也认 `ANDROID_SDK_ROOT`） |
| `JAVA_HOME` | JDK 17+ 根目录 |

## 安装

```bash
# 方式一：源码开发
npm install
npm link

# 方式二：打成 tarball 分发给同事
npm run pack:cli
npm install -g ./uniapp-android-cli-0.1.0.tgz

# 方式三：不安装，直接跑
node bin/uni-pack.js doctor -p <项目>
```

## 快速开始

```bash
npm install
npm link                # 之后可直接用 uni-pack
uni-pack init -p ../YFB_PROJECT/PRO_DIS_V2 --appkey <DCloud AppKey>
uni-pack doctor -p ../YFB_PROJECT/PRO_DIS_V2
uni-pack build  -p ../YFB_PROJECT/PRO_DIS_V2 --mode release
```

产物默认输出到项目的 `apk/`：`<名称>_<版本>_<版本号>_<release|debug>_<时间>.apk` 与 `_latest.apk`。

## 命令

```bash
uni-pack init    [-p <dir>] [--appkey <key>] [--sdk <dir>] [--android-sdk <dir>] [--jdk <dir>] [--keystore <file>]
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
  "sdk": { "root": "<离线 SDK 根目录>" },
  "android": { "sdkDir": "<Android SDK>", "buildTools": "35.0.0", "jdk": "" },
  "projects": {
    "pro-dis-v2": {
      "projectDir": "<uni-app 项目>",
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
`uni-pack.config.json` 只覆盖项目级字段（appKey、signing、webBuild、outputDir 等），SDK 与 Android SDK 路径请写在用户级配置或环境变量里。

**密码不落盘**：优先命令行 `--store-password/--key-password`，其次环境变量，其次 `keystore.properties`。

## 构建流程

1. 在项目内执行 `webBuild`，得到 `dist/build/app`（即 `www`）。
2. 把 SDK 的 `HBuilder-Integrate-AS` 复制到工作目录，**不改动共享 SDK**。
3. 重写 `build.gradle`（包名、版本、ABI、签名）、`AndroidManifest.xml`（AppKey、权限、TV 入口）、
   `dcloud_control.xml`、`strings.xml`、图标与启动图。
4. 执行 `gradlew :simpleDemo:assembleRelease|assembleDebug`。
5. `apksigner verify` 校验并输出 APK。

## 调试（基座 + 覆盖安装）

```bash
uni-pack debug -p <dir> --push --logs   # 重建基座、安装、启动并输出日志
```

`--push` 会重新编译前端资源并整体重建自定义基座，然后 `adb install -r` 覆盖安装并拉起应用。

> 没有采用「wgt + 热更新」方案：实测 SDK 5.34 上 `plus.runtime.install` 安装 wgt 后基座会在
> `io.dcloud.feature.pdr.RuntimeFeatureImpl` 抛空指针直接崩溃。`wgt` 命令仍可用于业务侧自建更新。

> 基座与正式包同包名同签名，安装基座会覆盖设备上的正式包。

## 版本必须对齐

真正必须一致的是「uni-app 编译器」和「离线 SDK」；HBuilderX 只在用它的编译器或云打包时才相关。

| 角色 | 版本来源 | 示例 |
| --- | --- | --- |
| uni-app 编译器 | 项目 `node_modules/@dcloudio/uni-app/package.json` | `3.0.0-5030420261029002` → **5.34** |
| Android 离线 SDK | SDK 目录名 | `Android-SDK@5.34.82692` → **5.34** |
| HBuilderX | 仅用 HBuilderX 编译/云打包时 | 5.34 |

包名、版本号、名称与 min/target SDK 一律以 `src/manifest.json` 为准；配置里的同名字段只在该字段缺失时兜底，项目升版后不需要重跑 `init`。

编码规则：取版本号横线后的前 5 位 `50304`，依次是主、次、补丁 → 5.3.4 → 显示为 `5.34`；`40805` → 4.8.5 → `4.85`。

不一致时 App 启动会弹「编译版本与手机端 SDK 版本不匹配」，严重时白屏。两种解决办法：

```bash
# 方案一：升级项目依赖到 SDK 对应版本，然后重新安装、重建基座与正式包
npx @dcloudio/uvm@latest
pnpm install

# 方案二：下载与当前编译器同版本的 Android-SDK@x.yy，改配置 sdk.root 指向它
```

`uni-pack doctor` 会显示两边的版本并标红，`uni-pack build` 会直接拦下（可用 `--skip-version-check` 临时跳过）。

## 限制

- 仅支持普通 uni-app（Vue 3），不含 uni-app x / vapor / iOS。
- AAR 为基线集合；`manifest.json` 声明了 `app-plus.modules` 时会直接报错，需自行补充。
- 调试采用「重建基座 + 覆盖安装」，不做 wgt 热更新。
