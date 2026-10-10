# 新手引导调研

日期：2026-10-11（Asia/Shanghai）。阶段：调研完成，产品与 UI 待审核。本轮按用户要求先交付调研 → 产品设计 → HTML 设计稿，用户审核后才进入实现与专项测试；不运行全量回归。这一要求覆盖 AGENTS.md 中本轮原有的自动推进 UI 和全量测试约定。

## 目标与现状

首次打开应用后依次选择界面主题、填写本地用户信息、配置文本模型、决定是否配置文生图模型，最后完成引导。文本模型确认后同时成为默认文本与审核模型；文生图确认后成为默认文生图模型。没有配置任何文本模型时，应能单独启动模型部分。

本次只读取独立桌面仓库源码，不读取用户 state.json、真实作品或凭据。工作树开始时只有未跟踪的 startup-backup/，本轮不修改该目录。

| 现有能力 | 源文件证据 | 对设计的影响 |
| --- | --- | --- |
| 启动先加载本地状态与草稿会话，再显示真实工作台 | src/components/desktop/DesktopApp.tsx：bootstrap、session.initialize、DashboardShell | 引导放在本地初始化成功之后；不占用启动加载、目录迁移、草稿恢复或 writer lease 的处理 |
| 宣纸、玄墨、跟随系统，主题变更走设置持久化 | desktop/core/settings.ts：appearanceSchema、defaultState；SettingsDialog.tsx：主题首行；DesktopApp.tsx：setTheme | 独立主题选择对话框复用这三项语义，点击后即时落盘与预览；不新增主题体系 |
| 本地头像、笔名、邮件及手动保存，头像有独立草稿生命周期 | src/components/desktop/ProfileSettings.tsx：edit、choose、save、release；desktop/core/settings.ts：user schema | 复用真实资料编辑逻辑，只给引导增加标题、步骤提示、返回与“确定”；头像和邮件可选，笔名必填 |
| 一个对话框只配置一个 TEXT 或 IMAGE 模型；有内置供应商与自定义供应商 | src/components/desktop/ModelConfigurationDialog.tsx；desktop/shared/model-catalog.ts | 继续单选，不批量添加；内置供应商沿用现有目录、Logo、权限提示，自定义沿用协议、地址、型号与高级配置 |
| 空 Key 可见内置官网目录，测试连接是明确操作 | ModelConfigurationDialog.tsx：choices、discover、test；desktop/shared/builtin-model-catalog.ts | 未持有 Key 时仍可了解候选；“确定”只保存配置，不偷偷测试、发起生成或要求购买 |
| 模型保存与默认用途是分开的写入 | src/stores/desktop.ts：saveDesktopModel、updateDesktopSettings；desktop/main/model-repository.ts：saveModel、updateSettings | 新增引导专用提交语义：模型、默认角色及进度需一致提交；不得把两次普通写入误称为原子成功 |
| 默认无模型、三个默认模型 ID 均为空 | desktop/core/settings.ts：defaultState | 保留离线启动能力；用户主动确认前不得添加演示模型或平台后备 |
| 现有模型问题提示由真实调用失败触发 | desktop/main/model-guidance.ts；ModelRequiredDialog.tsx；DesktopApp.tsx：model-required | “没有 TEXT 记录”可进入短引导；已有但停用、缺 Key、未选默认等错误沿用修复入口，不混成“未配置” |
| 没有首次引导标记 | desktop/core/settings.ts、desktop/shared/ipc.ts、DesktopApp.tsx、model-repository.ts | 需要持久化、可恢复的引导进度，不能用渲染器 localStorage 或笔名是否为“作者”猜测是否首次 |
| 主进程拥有加密凭据，公开状态只含掩码 | desktop/main/model-repository.ts：encrypt、publicState；desktop/core/settings.ts：publicModel | 不把 Key 放进进度、摘要、URL、截图或日志；退出清理未提交 Key 和目录/测试请求 |

源文件列出的函数/字段可由 `rg -n` 定位。本调研只证明已有能力与缺口，不代表新增引导已实现或已通过产品测试。

## 交互资料与采用判断

[Apple 的 Onboarding 指南](https://developer.apple.com/design/human-interface-guidelines/onboarding)强调尽快进入应用，通过操作学习，并在启动完成后提供引导。根据本项目需要配置自己的模型这一事实，本设计采用短步骤对话框；配置暂时无法完成时允许退出，已经确认的内容保留，下次继续。这是项目产品判断，指南没有规定本项目必须填写哪些字段。

[W3C 模态对话框模式](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)要求对话框打开后焦点进入其中、Tab 循环、背景不可交互、有可见关闭途径，Escape 可关闭。本设计使用真实 Dialog 构件：每次只有一个引导主对话框，按步骤交接焦点；保存过程中短暂锁定关闭以防重复提交，其他时候 Escape 等价于暂时退出。

## 决策与边界

1. 新设计只包括独立主题对话框、步骤提示、文生图询问及完成摘要。资料和模型表单以现有真实组件为实施来源，HTML 仅为审核媒介。
2. 完整流程以本地应用数据目录中的引导记录为依据。记录缺失时从主题开始；已有用户、主题、模型保留并回填，不把“缺记录”称为能证明用户从未使用过应用。增加本功能后的已有安装也会获得一次引导。
3. 完整流程中的文本步骤没有“跳过并完成”；可暂时退出，继续本地写作，并从当前未完成步骤恢复。文生图询问和配置都有明确跳过途径。
4. 完整引导结束后不再重放主题和资料。若之后 TEXT 记录为零，启动时每个会话至多提示一次短模型入口，也可从模型设置空态或 AI 的真实缺模型提示进入；拒绝当次提示不算完成，不反复弹出。
5. 文本确认的效果须清晰写在按钮附近：同时设为默认文本模型和默认审核模型。图片确认同理。只影响新任务默认值，不能替换现有任务冻结的模型或自动重发失败请求。
6. 只验证本次功能及直接受影响的主题、资料、模型保存、默认用途与 IPC；不为此重做 29 类业务面板验收、供应商目录全量调研或旧失败处置。

## 下一产物

产品设计：[2026-10-11-onboarding-product-design.md](2026-10-11-onboarding-product-design.md)。HTML 设计稿将在产品设计之后生成，供用户审核；技术方案、独立审核、专项用例、TDD、code review 和真实目标系统相关验证留到 UI 通过后。
