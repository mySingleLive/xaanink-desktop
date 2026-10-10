# 新手引导设计独立审核

日期：2026-10-11（Asia/Shanghai）。审核范围限定于本次新手引导；此记录由独立子代理维护。

当前状态：调研、产品设计、HTML 源码与预览证据独立复审完成，无剩余设计阻断项，可以交给用户审核。本轮不实现产品，不运行产品自动测试或全量回归，不能以设计查看器结果认定安装版验收通过。

## 已核对的依据与契约

| 审核项 | 设计依据 | 现有源码证据 | 结论 |
| --- | --- | --- | --- |
| 首次触发时机、流程顺序与完整/短流程 | product-design.md「进入规则」「完整流程」 | DesktopApp.tsx:93 等待草稿会话初始化后发布 bootstrap；:160–162 现有设置、模型问题、恢复和关闭对话框 | 设计明确初始化/维护/恢复优先、完整顺序与短流程，不用默认笔名推测首次；实现仍待 UI 审核 |
| 三主题与即时持久化 | product-design.md 步骤 1 | desktop/core/settings.ts:4；DesktopApp.tsx:144；SettingsDialog.tsx 外观首行 | 复用 paper/ink/system 语义，系统主题保存语义值；选中状态与保存失败后不能前进已明确 |
| 用户资料“确定”与原有手动保存 | product-design.md 步骤 2 | ProfileSettings.tsx:42–48 校验/提交；:23 清理头像草稿；:52 普通编辑的保存按钮 | 引导允许扩展按钮为“确定”，原设置保留“保存”；笔名必填、头像/邮件可选，草稿生命周期保留 |
| 文本单选与两用途一致提交 | product-design.md 步骤 3 及既有模型入口 | ModelConfigurationDialog.tsx:48–55 单模型校验；:77–78 普通模型保存；ModelRepository.ts:81、:106 分别提交模型与设置 | 设计没有把现有两次提交当原子成功，明确新增提交契约；需要技术方案扩展 |
| 文生图询问、表单两处跳过及默认绑定 | product-design.md 步骤 4a/4b | ModelConfigurationDialog.tsx:19/103–108 为 TEXT/IMAGE 单模型配置；settings.ts:37 现有 imageModelId | 询问接受/跳过、表单跳过/确认均明确；跳过保留已有图片配置，确认设默认图片用途 |
| 无模型与修复条件区分 | product-design.md「进入规则」 | ModelRequiredDialog.tsx 对 MODEL_NOT_CONFIGURED/NOT_SELECTED/DISABLED/KEY_MISSING 等分别提示；ipc.ts:37 类型 | 无 TEXT 的短流程不掩盖已有但不可用模型的准确修复入口；不自动重发任务 |
| Key 与演示边界 | research.md 与 product-design.md「设计审核稿」 | settings.ts:43–44 公开状态不含 encryptedKey；ModelRepository.ts:17–24/57–58 主进程密钥保护；ModelConfigurationDialog.tsx:33–37 取消请求 | 进度/摘要/截图不能含真实 Key；HTML 仅设计占位与内存交互，无产品写入或供应商调用；后续需核对 HTML |
| 已批准组件边界与本次验证范围 | implementation-boundaries.md:15–21/25–29；product-design.md「设计审核稿与后续实施」 | DesktopApp.tsx:159 真实 DashboardShell；ProfileSettings、ModelConfigurationDialog 等现有组件 | 不以原型替换真实工作台；用户本次明确要求新 UI 审核、只做专项测试，优先于旧 UI 自动推进/全量回归约定 |

表中的 product-design.md 与 research.md 指本目录的 2026-10-11-onboarding-product-design.md、2026-10-11-onboarding-research.md。源码路径分别为 src/components/desktop/、desktop/core/、desktop/main/、desktop/shared/ 中已列文件。

## 提醒与待复核

1. 持久化失败需要幂等重试。ModelRepository.ts:41–50 明确目录 fsync 失败时 rename 可能已提交，随后协调授权并抛 CommitDurabilityError。实现应先核对权威状态，复用提交身份/模型 ID，避免首次添加的确认重试生成重复记录；这属于技术阶段必须细化的契约，不是 HTML 连通或落盘证据。
2. “已配置”不能变成“已验证连接”。公开模型仅提供密钥掩码；使用既有模型可提交默认用途与进度，但目录列出和模型保存不证明该 Key 的供应商权限。现有 ModelConfigurationDialog.tsx:104/107/109 已区分目录、收费测试、测试未保存；引导应保留这些区分。
3. HTML 复审待核对：顺序、独立主题对话框、两个“确定”、两个图片跳过、完整/短流程、退出/恢复、失败及键盘、窄屏/短窗布局、源代码的网络/持久化与占位边界。预览截图仅为设计证据。

## HTML 首轮源码检查

已读取 design/onboarding/index.html、flow.html、flow.js、preview.css、viewer.js、capture-preview.mjs。审核查看器与产品弹窗分离，背景为无文字布局占位，主题缩略图为抽象布局；资料/模型确认、两个图片跳过、完成摘要以及短流程入口具备可审核页面。原生 dialog 和 CSS 固定头尾/中间滚动仅为设计预览行为，尚不能证明正式 React/Windows 行为。

已向主代理提出以下预览修订项，源码复查已关闭：

- viewer.js:36 已隐藏短流程不适用的主题/资料选项，保留正确编号。
- flow.js:128 在退出时 replaceChildren 并清理头像草稿，未提交 Key 表单不残留于关闭的 dialog。
- flow.js:155–159 以当前供应商、协议/端点范围匹配已保存记录才允许空 Key，记录保存非 Key 自定义字段；:184 返回自定义配置完整回填。
- flow.js:242 失败/正常场景仅改状态，保留当前表单；已有模型场景才重新绘制，修正了保存失败演示丢草稿的问题。

补充源码边界已闭合：flow.js 的无文本模型入口清空设计内存 TEXT 与完成标记，符合空模型前提；产品设计新增权威重读/提交身份幂等要求。

主题即时提交与审核工具跳步并发时的迟到响应问题也已修正：flow.js:165–168 在 await 后核对 epoch 与当前步骤，再访问旧主题 radio。

## 预览证据复核

已读取 capture-preview.mjs 与最终 preview-checks.json，后者明确 scope 为 HTML design viewer only, not product tests，记录 15 项查看器检查、10 个整页截图场景（另含 2 张主题弹窗裁剪图）、0 脚本错误、0 失败资源、0 HTTP 请求。审核者未把报告视为产品测试结果，也未重运行会改写其他文件的截屏脚本；只读 PowerShell 报告计数命令确认上述数量。

已逐张视觉检查 preview-theme-paper.png、preview-theme-ink.png、preview-profile.png、preview-text-save-failure.png、preview-image-choice.png、preview-image.png、preview-done-skip.png、preview-model-entry.png、preview-short-custom.png、preview-mobile-theme.png。主题独立对话框、资料“确定”、两个模型默认效果说明、图片询问与表单跳过、完成页用途摘要、短窗固定标题/按钮与中间滚动均清楚可读；360px 为审核阅读证据，不是目标桌面系统验收。

视觉复核发现的短流程隐藏问题已关闭：index.html:9 增加全局 [hidden]{display:none!important}；capture-preview.mjs 断言右侧仅有 3 个可见步骤且首项编号为 1；已重新查看 preview-model-entry.png，右侧仅有文本、文生图、完成三项。另逐张查看新增两张主题弹窗裁剪图，主题选择内容完整。

本次独立复审结论：调研、产品设计与 HTML 设计稿满足本次目标及约束，可以进入用户 UI 审核。修订项均已关闭；产品事务、恢复持久化、原组件复用与真实 Windows Electron 相关专项验收等待用户 UI 批准后按既定顺序进行，尚未执行。

最终补充核对：已读取 2026-10-11-onboarding-ui-design.md 与 requirements-traceability.json 的 onboarding 新增条目。UI 文档将原型检查、前次失败/修正和后续产品验证分开说明；台账状态为 awaiting-user-ui-review，15 项数字仅归入 previewOnly，未将产品标为通过。只读命令 `git status --short -- desktop src` 输出为空，当前产品源码没有待提交修改。主代理提供最终截屏命令退出 0 的结果，与查看器报告一致。
