# 工作区外观实现独立代码审核

2026-10-10。独立子代理核对已批准 UI v3、技术方案、实施边界，以及本次四个产品文件的实际 diff。最终代码审核结论：**通过，当前无未关闭的必修产品项。** 本结论不代表专项、全量或真实 Windows 验收通过；执行证据另行审核。本代理未修改产品，只新增本审核文档。

## 产品范围与实现

- `src/app/desktop.css:29–34` 将导航、AI、右内容底色及 AI 表面令牌限定在宣纸工作区内。右侧规划、ScenarioLab、SceneWorkspace、标签条及 Monaco 正文/gutter 接入右侧内容令牌；全局背景、边框和 Monaco 主题注册值保持原样，AI 内嵌编辑器不继承右侧变量。
- `src/app/desktop.css:37–43` 用零内容尺寸、content-box 和标准 1px border 绘制分栏、水平/竖直 Separator、菜单/select、Markdown hr 与 edit/preview 中线。竖直组件同时兼容 `data-vertical` 和当前 BaseUI 实际的 `data-orientation="vertical"`；hover/active 只改线色。Markdown hr 补齐 min-height:0 与 content-box，避免边框计入内容尺寸。split 中列为 auto，左右继续使用 minmax(0,1fr)。
- `DashboardShell.tsx:47–49,504` 仅替换原 ResizeHandle 外观；原 Group/Panel、显隐、布局持久化和动画未重写。安装的 `react-resizable-panels` 源码约第3590、3627行仍为 Separator 提供 flexGrow:0/flexShrink:0；默认10/20px不可见命中扩展和键盘处理未改动。实际交互仍由后续执行证明。
- `MarkdownEditor.tsx:348,380` 仅新增 split 语义 class，未改变组件 key、状态、实例回调或生命周期。`planning.module.css:4` 采用专用内容 token 并保留全局背景 fallback；卡片与表单层次未被统一覆盖。
- `desktop.css:14,19` 的 Windows 结构底边和上 padding 同为1px。44 DIP 行高、28/24 DIP控制尺寸、图标、安全间距以及选中 Tab 顶部标记的原 zoom 补偿继续保留。

## 初审必修项关闭

真实 ScenePanel 的 `scene/scene.css:1` 原本以全局 `--background` 覆盖右侧底色；其 `.scene-content` 使用未定义的 `--editor`，实际透明。只测 `.content-tabs` 不能证明可见场景背景。

已新增独立 SURF-05，读取真实场景 CSS，固定期望右侧颜色。`docs/evidence/workspace-surfaces/scene-before-fix.json` 与对应日志记录修复前1项失败：实际 rgb(244,237,218)，期望 rgb(248,243,228)。随后 `desktop.css:33` 为宣纸右侧 `.scene-workspace` 局部接入内容 token；真实 Windows 脚本约第90–93行也改为直接断言该根容器，不再只断言父层。代码范围与预期修复路径核对通过；修复后执行结果留待证据审核。

## 测试与证据边界

浏览器窄布局修订忠于原899/679px断点，分别覆盖760px两栏与640px单栏，仍检查固定底色、等细、面板邻接和无亮沟槽。15组 DPR×CSS zoom、轮换字号明确为代表组合；Monaco/规划/场景探针仍为 CSS 夹具，不冒充业务组件验收。

`verify-workspace-surfaces.mjs` 使用新隔离目录、真实服务/草稿前置、当前构建的真实 Electron、真实 settings IPC；不注入拟议 CSS 或替换产品 DOM。先前要求已补入脚本：原生 zoom 下的按钮/图标尺寸、中心和安全区；主题往返后消息与 AI 表面固定色值；通过替换选中末行及两次 undo 证明正文模型选区、稿件与撤销保持；CDP composition 链明确标为合成 Chromium 输入，不宣称物理 Windows 输入法或 macOS 通过。脚本内容审核可推进，最终必须核对实际执行记录。

本轮只读执行 `git diff --check` 返回0（既有生成文件换行提示不构成 diff 错误）。尚未据此声明 GREEN、全量测试、构建或原生验收通过。

## 审核源码指纹

基线 HEAD：`b1af4fb9e2d75104974514ec674df33d723ebe4e`。本次审核产品文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| src/app/desktop.css | e4480ab1495b1a0119e983a5e404e0abd83ee6deec7929e831df83c78f568024 |
| src/components/layout/DashboardShell.tsx | 096856e0820166db756ab20f7b925a73de917fddfb28d77c0deddb721ee44b72 |
| src/components/content/planning/planning.module.css | 8b1ed8c7ef036ab45dd42ace35a1b199af73594a54d2b69a6c917a68cb440953 |
| src/components/editor/MarkdownEditor.tsx | f9c2a67b4d3af194e8c369fccb9e279270f9172957d6122bdb9e578373465e48 |

来源：四个产品 diff、真实原组件/CSS、安装包库源码、专项用例、check/seed/verify 脚本及 Scene 修复前 RED 原始记录。后续代码变化需要按变化范围复核，本结论不能替代最终测试证据。
