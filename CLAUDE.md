# CLAUDE.md

本文件为 Claude Code 在本仓库工作时的指引。

## 项目简介

`uniapp-android-cli` 是一个 Node CLI（命令名 `uni-pack`），用于离线打包 uni-app（Vue 3）Android 应用，不依赖 HBuilderX 的图形界面。提供 `init` / `doctor` / `build` / `wgt` / `debug` / `device` 等命令。

## 常用命令

```bash
npm ci                  # 安装依赖（首次或锁文件变更后）
npm run typecheck       # tsc --noEmit，checkJs 模式下对 src/ 与 bin/ 做类型检查
npm test                # node --test，跑 tests/unit
npm link                # 本地把 uni-pack 链到全局，便于手动验证
npm run pack:cli        # 打 tarball 供分发
```

提交前至少跑 `npm run typecheck && npm test`。

## 目录结构

- `bin/uni-pack.js`：可执行入口，只负责调用 `src/cli.js`
- `src/cli.js`：参数解析（`node:util parseArgs`）、命令分发、统一错误输出
- `src/commands/`：各子命令（init、doctor、build、wgt、debug、device、devices）
- `src/core/`：可复用逻辑，按职责拆分
  - `config.js` 配置合并，`project.js` 项目识别，`sdk.js` / `hbuilderx.js` 环境探测
  - `version.js` 编译器与离线 SDK 版本对齐
  - `build.js` / `gradle.js` / `signing.js` / `wgt.js` 构建链路
  - `patch/` 对 SDK 模板的改写（manifest、gradle、assets、nativePlugins、utsPlugins、template）
  - `adb.js` / `devicePairing.js` / `qrcode.js` 设备与无线配对
- `tests/unit/`：`node:test` 单测，纯函数优先

## 代码约定

- ES Module（`"type": "module"`），NodeNext 解析，import 必须带 `.js` 后缀
- 纯 JavaScript + JSDoc 类型注释；`tsconfig.json` 开启 `checkJs` 与 `strict`，新增函数请补 JSDoc
- 面向用户的提示、错误、帮助文案使用中文；代码标识符用英文
- 失败一律抛 `PackError`（来自 `src/core/errors.js`），并带上合适的 `EXIT` 退出码；只有系统边界（CLI 参数、外部工具输出）才做防御性校验
- 日志统一走 `src/core/logger.js` 的 `Logger`（step/info/detail/warn/success），不要直接 `console.log` 拼流程输出；`--json` 模式下保持纯净
- 密码类信息不落盘：优先命令行参数 → 环境变量 → `keystore.properties`；日志输出前用 `Logger.redact`

## 关键约束

- **不改动共享离线 SDK**：构建时把 `HBuilder-Integrate-AS` 复制到工作目录后再改写
- **版本必须对齐**：uni-app 编译器版本与 `Android-SDK@x.yy` 必须同号，否则真机白屏或弹版本不匹配；改动 `version.js` / `sdk.js` 时不要绕过该校验
- 支持 CLI 项目（`src/manifest.json`）与 HBuilderX 项目（根目录 `manifest.json`）两种类型，后续走同一套离线打包流程
- 仅支持 Vue 3 普通 uni-app，不做 uni-app x / iOS / wgt 热更新（原因见 README「调试」）
- 兼容 Node `^20.19.0 || >=22.12.0`、npm ≥ 11，避免使用更新的语法或 API

## 测试

- 使用 `node:test` + `node:assert/strict`，测试文件放在 `tests/unit/*.test.js`
- 优先测可导出的纯函数（版本解析、配置合并、manifest 改写、配对地址解析等），避免依赖真实 SDK / 设备
- 新增能力时同步补对应单测

## 提交与推送

- **重要改动完成后，提交并推送代码**，不要留到最后一起堆积
- 提交信息保持简洁规范，沿用 Conventional Commits 风格并用中文描述，例如：
  - `feat: 支持设备二维码配对`
  - `fix: 修复无线连接超时未提示`
  - `docs: 补充版本对齐说明`
  - `refactor: 拆分构建流程`
- 一个提交只做一件事；提交前确认 `git status`，不要误带无关文件或密钥
- 发布走 tag：改 `package.json` 的 `version` 后 `npm version patch`（或 minor/major），再 `git push --follow-tags`，由 CI 完成 `npm publish`
