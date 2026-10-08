# 三栏顶部窗口拖动：独立用例审核

2026-10-09（Asia/Shanghai）。审核 `135-pane-window-drag-test-cases.md`、`tests/unit/pane-window-drag.test.ts`、`tests/browser/pane-window-drag.test.ts`；本次未改实现、未执行全量测试。

结论：**用例设计通过；复查确认夹具构建错误已修复，5/5 修改前测试在实际断言失败。**

- DRAG-01/04 的 AST 测试确实读取当前真实 ChatPanel，要求 h-11 拖动标题为面板第一个有效 JSX 子节点，并处于 StoryWorkflowBar 与恢复提示前；同时只允许一个拖动标题，不允许它包住状态行、composer 或工作台根。聚焦挂载真实标题 JSX 适合本次有限 CSS/结构变更。
- DRAG-01 的实际浏览器计算样式与 geometry 验证了左、AI 和右无 Tab 的顶部与 44px 高度，恢复按钮仍能点击；右内容、正文和编辑字段不扩展为 drag。测试中的正文/编辑字段是有限范围夹具，不能单独声称完整 ChatPanel composer 的业务验收；真实 Electron 完整 ChatPanel 验收另行提供该范围的证据。
- DRAG-02 使用真实 ContentTabs、tabs store 与查询客户端。测试覆盖 Tab 整体 no-drag、标题/图标的排除祖先、关闭按钮、两枚面板按钮以及鼠标/Enter 激活、中键关闭、关闭不切错 activeTab、关闭最后一个 Tab 回到无 Tab 拖动标题。业务 registry/Staged/story 内容 stub 不替代面板业务验收，当前文档已限定范围。
- DRAG-03 验证真实滚动逻辑：产生横向溢出，激活最远 Tab 后等待几何可见；导轨之外仍为非拖动。未修改 Tab 的高度、排序或原事件合同，测试范围合理。
- DRAG-05 明确完整离线 Electron、隔离根、系统鼠标、实际窗口 bounds，并对三处分别拖动和双击两次；必须保留带 StoryWorkflowBar 的完整 ChatPanel 顶部证据。Tab/按钮排除也需真正做鼠标拖动，不能以其 computed style 或直接调用 maximize() 代替。最大化与 panel fullscreen 行为须分开，第二次双击须回到原正常 bounds，窗口不得进入系统 fullscreen。
- DRAG-06 全量回归、typecheck 和两侧构建与 Windows 未执行记录符合实施台账约束；不能凭样式或测试 API 的平台参数声称 Windows 原生通过。

执行前发现并已报告的夹具问题：`/private/tmp/xaanink-drag-red.log` 中 browser bundle 报 `Could not resolve "react/jsx-runtime"`；`panel-fixture` 的 esbuild onLoad 结果缺少 resolveDir。先为该虚拟 TSX 模块设置工作区 resolveDir 并重跑，确保红测来自缺少 drag/no-drag/标题置顶的实际断言。Chromium 版本缺失导致的启动错误也只能记录为环境错误；显式指定已安装 Chromium 后需记录实际版本，不能当作预期功能红测。

代码审核阶段复查：onLoad 已加入 `resolveDir: process.cwd()`，并显式指定已安装 Chromium。更新后的 `/private/tmp/xaanink-drag-red.log` 记录 5 tests / 0 pass / 5 fail / 0 skipped；三个 browser 测试均为 `none !== drag` 的功能断言失败，两项 AST 测试分别因首行仍为工作流以及 drag 数量为 0 失败。该记录满足本次修改前红测要求。

本审核批准先修好测试环境，再完成红→绿实现流程。所有 native 和全量通过状态仍需后续命令及实际界面证据。
