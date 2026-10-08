# 玄印写作 · 桌面版

独立开源项目 **XaanInk**，中文全称「玄印写作」，简称「玄印」。代码仓库为 [mySingleLive/xaanink-desktop](https://github.com/mySingleLive/xaanink-desktop)，主分支为 `master`。

基于原 Web 版，使用 Electron、Next.js、React、TypeScript 与原有 UI 技术栈构建纯本地桌面创作应用。作品保存在作者选定的本地目录；AI 只使用作者配置的模型接口与密钥。

## 当前进度

技术方案及测试清单已通过独立审核，进入TDD实现与验收阶段。按作者最新要求，自动/手动备份及备份恢复已移除；正常保存、草稿保留和目录迁移继续保留。原531条清单中1条纯备份用例退役，当前有效530条（106桌面+424业务），均未完成正式验收。此前已生成macOS arm64未签名开发版.app、DMG和ZIP，并完成有限静态及原生检查：系统六组菜单、关于窗口、真实目录/头像选择取消、用户资料和多快捷键跨进程保持、正常退出及异常锁修复。Dock控制工具超时的失败保留，窗口完整操作、输入法、完整业务及真实供应商仍待验收。Windows无现成测试环境，按作者要求保留待验收。见[本次验证记录](docs/verification-2026-10-08.md)。

本源码提交不包含安装产物、用户数据、真实密钥或本机原始验收日志；公开的审核文档已隐藏本机路径，原始记录保留在开发环境。

交付严格按以下顺序进行：

1. [调研文档](docs/01-research.md)及[供应商目录补充](docs/provider-catalog-research.md)
2. [产品设计](docs/02-product-design.md) → [子代理审核通过](docs/reviews/21-product-settings-shell-review.md)
3. [UI 设计](docs/03-ui-design.md) → [子代理复审通过](docs/reviews/22-ui-settings-shell-review.md) → 用户已批准（2026-10-07），[实施边界](docs/implementation-boundaries.md)
4. [技术方案](docs/04-technical-design.md) → [独立审核通过](docs/reviews/23-technical-design-review.md)
5. [测试用例](docs/05-test-cases.md) → [独立审核通过](docs/reviews/25-test-cases-review.md)；[当前范围](docs/acceptance-active-scope.json)为106桌面 + 424业务
6. TDD 实现 → 子代理 code review
7. 执行全部测试用例与真实桌面验收
8. 测试通过后总结

阶段状态、审核记录与继续工作的条件见 [交付进度](docs/00-delivery-status.md)。

## 查看 UI 设计稿

[交互稿源码](design/desktop-preview.html)包含两平台、两套色板与三种主题模式、十三个页面及异常状态；[截图与检查记录](design/preview-verification.md)用于复核。所有数据均为内存演示，请勿输入真实 Key。UI v0.13 设置为纯左右结构：标题放在左导航顶部，关闭按钮在右内容右上；去掉重复分类大标题及跟随系统示意图的棕色圆形装饰。内容滚动区域避开固定关闭/状态区域；保留即时反馈、失败重试和原有子编辑行为。本版23项定向界面检查通过，6张截图。其他原生窗口、系统目录选择和真实模型等状态见交付进度。

在仓库根目录启动仅用于设计审核的静态预览：

```sh
python3 -m http.server 4187 --bind 127.0.0.1
```

然后打开 <http://127.0.0.1:4187/design/desktop-preview.html>；默认在顶部显示调试工具栏（平台、色板、页面、异常状态、AI门控示例），按 Alt+Shift+P 切换显隐；`?review=0` 隐藏工具栏。此临时预览服务不是最终 App 的运行方案，最终桌面版无需部署服务端。

原型按键规则检查：`node --test design/check-shortcut-keys.cjs`。

## 运行当前开发版本

需要 Node.js 24。执行 `npm ci`、`npm run generate`、`npm run build:ui`、`npm run build:desktop` 后运行 `npm start`。工作台由 Electron 的本地协议加载，不启动 HTTP 服务或外部数据库。当前开发版本尚不适合承载真实创作数据。

旧版作品、设置、加密模型配置和目录迁移记录继续兼容；已有数据保持原目录及控制文件，新安装默认使用 `~/.xaanink`，新建作品及导出文件使用 XaanInk 标识。原有目录损坏或控制记录冲突时会停止普通启动并保留原文件，不自动创建空库替代。改名方案见 [品牌改名方案](docs/reviews/121-brand-rename-plan.md)，本次完整核心、打包及 macOS 升级结果见 [改名验证记录](docs/reviews/130-brand-rename-verification.md)。

核心验证：`npm run test:core:evidence`；隔离的 macOS Electron 定向检查：`node scripts/smoke-electron.mjs`。这些检查不替代正式验收清单。

## 本机构建安装包

安装开发依赖并完成生成与构建后，`npm run package:dir` 生成应用目录，`npm run package` 生成macOS DMG/ZIP或Windows NSIS。产物位于 `release/`。封包前核本机Electron版本、OS/CPU和Sharp动态库；所有归档前检查实际资源，并用包内依赖在独立工具进程中完成内存数据库与图片资源检查，不启动Electron或访问作者数据。`npm run package:check` 可重复检查已生成的macOS arm64应用目录。

只在匹配目标OS/CPU的机器安装依赖并构建。macOS x64和Windows安装/运行未验收；当前macOS产物未签名、未公证，不自动上传、发布或更新。配置及资源检查不替代实际安装、原生UI与持久化验收，当前开发版本仍不用于真实创作数据。

## 来源

Web 基线：`mySingleLive/xuanxiang.ink`，提交 `55a62560dc4818143469abb12717a23c752ade8c`。桌面版保持独立 Git 历史、构建和发布，不依赖原仓库所在目录。

Copyright (c) 2026 mySingleLive。开源许可证为 [GNU GPL-3.0](LICENSE)（`GPL-3.0-only`），第三方资源见 [来源与许可声明](THIRD_PARTY_NOTICES.md)。此阶段未替原 Web 仓库添加许可证。
