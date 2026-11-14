# uniapp-android-cli

离线打包 uni-app（Vue 3 / Vite）Android 应用，不依赖 HBuilderX。

- `build`：正式包、自定义基座
- `wgt`：生成可热更新的 wgt 包
- `debug`：安装基座、启动应用、推送最新资源、抓日志
- `doctor`：环境与证书自检

## 依赖

- Node ≥ 20（Windows 为主）
- DCloud Android 离线 SDK（版本需与项目的 `@dcloudio/*` 一致）
- Android SDK（build-tools 含 apksigner / zipalign，platform-tools 含 adb）
- JDK 17+

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
uni-pack init    [-p <dir>] [--appkey <key>] [--sdk <dir>] [--keystore <file>]
uni-pack doctor  [-p <dir>] [--json]
uni-pack devices
uni-pack build   [-p <dir>] [--mode release|debug] [--skip-web] [--out <dir>] [--install] [--device <serial>] [--offline]
uni-pack wgt     [-p <dir>] [--skip-web] [--out <dir>]
uni-pack debug   [-p <dir>] [--install] [--build] [--push] [--logs] [--port 8787] [--device <serial>]
```

## 配置

用户级 `~/.uniapp-android-cli/config.json`，项目内可放 `uni-pack.config.json` 覆盖。

```jsonc
{
  "sdk": { "root": "<离线 SDK 根目录>" },
  "android": { "sdkDir": "<Android SDK>", "buildTools": "35.0.0", "jdk": "" },
  "outputDir": "<APK 输出目录>",
  "projects": {
    "pro-dis-v2": {
      "projectDir": "<uni-app 项目>",
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
