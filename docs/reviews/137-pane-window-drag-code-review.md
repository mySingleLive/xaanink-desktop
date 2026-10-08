# 三栏顶部窗口拖动：独立代码审核

2026-10-09（Asia/Shanghai）。审核本轮 `desktop.css`、`ChatPanel.tsx`、`ContentTabs.tsx` 的 git diff 与新增 unit/browser 测试。仅写审核记录；未运行 native UI 或全量回归。

结论：**实现代码审核通过；真实原生与全部测试验收仍为后续通过门。** 未发现需更改产品实现的问题。

- `ChatPanel.tsx` 只对现有 h-11 标题增加 desktop-drag。StoryWorkflowBar 的 novelId/running 参数，三组状态行的条件、内容、role 和原 CSS 均完整保留，仅移到标题后方；标题现为 pane 第一个有效 JSX 子节点。标题内恢复按钮仍受既有 button no-drag 规则保护，未加 drag 给 pane 根、消息或 composer。
- `ContentTabs.tsx` 无 Tab 时只添加 h-11 shrink-0、aria-hidden 的空白顶部；有 Tab 时只给现有 tablist 增加 desktop-drag。Tab JSX、关闭/键盘/中键事件、按钮、滚动器与 activeTab reveal effect 全部未变，内容及工作流业务组件仍原样保留。
- `desktop.css` 增加 user-select: none 与 `[role="tab"]` no-drag。后者使 Tab 整个 hit rectangle 排除，标题/图标/封面/徽标均位于该矩形内，按钮也保留原排除规则。新增区域限于用户请求的顶部；没有 DOM 双击 handler 或 IPC 与原生事件竞争。
- 双击依旧是运行时验收条件。CSS 和本轮聚焦 browser 测试只证明 DOM/样式/现有 Tab 交互，不能证明实际窗口移动或最大化。必须在实际 Electron 对三处分别执行拖动、双击最大化、再次双击复原，并保留 workflow 可见的顶部 evidence；Windows 未运行不能报通过。

验证：独立执行 `node --import tsx --test tests/unit/pane-window-drag.test.ts`，2/2 通过、0 skipped。复查 `/private/tmp/xaanink-drag-red.log`，修改前 5/5 测试因功能断言失败，非缺依赖或夹具构建错误。

测试夹具修正项已即时报告主代理：首次 `/private/tmp/xaanink-drag-green.log` 为 4/5 通过，其中 DRAG-02 的 `[role="tab"]:first-child svg` 匹配 Tab 图标与关闭图标两处，触发 Playwright strict-mode 错误。该 selector 应限定 Tab 直接子图标（`> svg`）或遍历全部命中；修正后必须重跑并记录实际通过，不得省略该断言。此项是测试执行阻断，不是产品实现缺陷。

最终复查：测试已将 selector 改为 `[role="tab"]:first-child > svg`，断言仍保留。重跑 `/private/tmp/xaanink-drag-green.log` 记录 5 tests / 5 pass / 0 fail / 0 skipped，三个 browser 与两项 unit 全部通过。当前无剩余 focused-test 执行阻断；native 和全量回归仍须以各自后续证据确认。
