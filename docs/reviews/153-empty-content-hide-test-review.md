# 空右侧内容面板收起按钮用例独立审核

2026-10-09（Asia/Shanghai）。审核 `152-empty-content-hide-test-cases.md`，参考 150/151 方案、指定真实组件/桌面样式/窗口初始化，以及既有 `pane-window-drag.test.ts`、`sidebar-restore-safe-area.test.ts`。只读审核，未修改实现或测试，未启动应用或测试。

结论：**通过，可进入 RED → 最小实现阶段。** 用例覆盖用户目标、顶部右侧位置、Windows 不重叠约束和既有行为；没有用例设计阻塞项。以下执行细节必须保留，最终结果仍取决于实际执行证据。

## 覆盖依据

- EMPTY-01/02 验证真实 `ContentTabs` 零 Tab 分支的按钮唯一、可见、名称/title/type、无 aria-hidden 祖先、面板内几何，以及点击/Enter/Space与恢复；能让现状 `ContentTabs.tsx:69` 的空拖动条因按钮缺失明确失败，属于有效功能 RED。
- EMPTY-03/04 分开 fallback 产品表达式和 env 结果注入，包含 .75/1/1.25/1.5/2 实时 zoom、11/14/24 UI 字号、宽/窄面板及多种系统占区。真实按钮/菜单矩形、至少6px间隔和所属面板边界比只断言样式字符串更有验收意义；`desktop.css:7,10` 的菜单宽28px、偏移6px也被纳入，而非只考虑原生138px占区。
- EMPTY-05 保留有 Tab 导轨、全屏、关闭、选中/滚动，以及最后 Tab 转空态。既有 `pane-window-drag.test.ts` 已直接挂载真实 `ContentTabs`、编译真实 Tailwind/desktop CSS、验证拖动区和真实 Tab 操作；新用例可沿用其与无关正文/保存层隔离方式，不需复制产品 JSX。
- EMPTY-06 明确使用隔离 dataRoot、完整真实 macOS Electron/DashboardShell/ChatPanel 和离线 xaanink 协议，弥补组件宿主无法证明 `DashboardShell` 动画卸载、恢复、布局记忆和原生 no-drag 命中的边界。点击及键盘后验证窗口没有移动、最大化或退出，可发现实际拖动命中错误。
- EMPTY-07 明确完整活动 unit/integration/browser、完整 typecheck 和两类构建，且把源构建、安装包状态和 Windows 目标机未执行分开陈述，符合仓库实施/验收台账要求。

## 证据边界与执行要求

1. 普通 Chromium 不提供真实 Windows titlebar env。EMPTY-04 只替换真实元素中 env 的读取，并对真实菜单使用同一 fixture 值，保留 calc/max 其它表达式，是可接受的布局合同；必须标为注入测试，不能描述为 Windows/DPI 原生通过。EMPTY-03 不应经过该替换，并应断言页面没有加载外部网络或默认用户数据。
2. 浏览器宿主的隐藏/重挂载回调属于组件行为；应按152说明另用真实 DashboardShell 原生流程验收，不能用宿主 state 替代工作台实际收起。既有 `sidebar-restore-safe-area.test.ts` 也明确浏览器 safeLeft 是几何合同、实际 Electron zoom另验，此次应维持同样诚实边界。
3. 原生关闭最后 Tab 时，`DashboardShell` 原有订阅会收起整个右区。EMPTY-06 的“按钮保持可达”应执行为：确认自动收起，再点击AI恢复入口打开零 Tab 内容区，新按钮再次可达；不得为了该字面表述改变自动收起行为。
4. 键盘验证至少包含一次实际 Tab 到达按钮、可见焦点及 Enter/Space 激活；仅在脚本中直接调用回调不能计为键盘通过。对 Windows矩阵，按钮必须全部可见且边界在面板内，不能接受因窄面板裁切而只剩部分命中区的结果。
5. RED必须记录实际按钮缺失的可见性/功能断言；运行权限、依赖缺失或浏览器启动错误只能记录环境失败。Windows目标机缺失继续记未执行，即使全部本机自动化通过也不能升级为跨平台原生验收完成。

以上是用例设计审核，不是实现/code review或测试通过证据。

## 重启边界追加审核

后续真实原生运行揭示EMPTY-06原先“零Tab空面板保持可见跨重启”预期不符合既有恢复规则。只读 `src/lib/desktop/draft-recovery.ts:218-220` 可见：tabs为空且layout.contentVisible为true时，layout保留TARGET_UNAVAILABLE并提交layout:null；这不是本次按钮导致的回归。

主代理已将152修正为保留该规则：重启后确认内容收起和AI恢复入口可见，再由真实入口展开空面板，验证新增按钮位置/可用性及再次收起。该流程仍验证本次按钮重启后可用，范围适当，**追加用例审核通过**。不得用原生初次在旧预期处超时的failed报告声称完整通过；需保留失败记录并完成修正后真实重跑。
