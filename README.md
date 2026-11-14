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

## 调试（基座 + 推资源）

```bash
uni-pack debug -p <dir> --build --install   # 首次：构建并安装基座
uni-pack debug -p <dir> --push --logs       # 之后：构建资源并推送到设备
```

原理：基座启动后请求本机 `http://127.0.0.1:<port>`（通过 `adb reverse` 打通），
发现 wgt 的 sha256 变化就下载并通过 `plus.runtime.install` 安装后自动重启。
引导脚本只注入 debug 基座的 `app-service.js`，正式包不受影响。

> 基座与正式包同包名同签名，安装基座会覆盖设备上的正式包。

## 限制

- 仅支持普通 uni-app（Vue 3），不含 uni-app x / vapor / iOS。
- AAR 为基线集合；`manifest.json` 声明了 `app-plus.modules` 时会直接报错，需自行补充。
- 不实现 HBuilderX 的私有同步协议。
