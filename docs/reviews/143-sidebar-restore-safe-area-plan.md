# macOS 侧栏恢复按钮安全间距方案

2026-10-09（Asia/Shanghai）。本轮用户要求：收起左导航后，AI 标题左侧恢复按钮必须位于 macOS 红黄绿窗口按钮组右侧并保留适当间距。

原因：`SidebarWindowControls` 已有 macOS 占位，`ChatPanel` 的恢复按钮仍用 `.75rem` 标题内边距和 `-.375rem` 左外边距；侧栏宽度归零后恢复按钮移到窗口左边，覆盖原生关闭按钮。`desktop/main/index.ts` 保持真实原生按钮位置 `{x:14,y:14}`。

实施仅修改复用的 `src/components/layout/ChatPanel.tsx` 标题恢复按钮：利用已订阅的 `desktopBootstrap`，仅在 darwin 的恢复按钮上覆盖左外边距为 `calc(<88 / appearance.zoom>px - .75rem)`。标题内边距是 `.75rem`，因此按钮左缘离 AI 面板左缘为 `88 / zoom` 个 CSS 像素，Electron 缩放后为 88 个原生窗口逻辑像素。88 与既有侧栏默认字号/缩放的首个控制按钮左缘一致，位于原生按钮组右侧约 20px；最终以真实窗口截图核对。

界面字号会改变 rem，故不使用固定 CSS spacer 或仅减 12px；`.75rem` 在计算中抵消真实标题内边距。平台/zoom 取实时桌面状态，无新 IPC、原生按钮移动、全局 CSS 或分栏/动画重写。Web 与 Windows 恢复按钮、侧栏展开态、44px 标题和 drag/no-drag 保留现有合同。本次不扩展到窄屏导航、右栏全屏等其它布局问题。

按 AGENTS.md 顺序：独立方案审核 → 编写并独立审核用例 → 修改前断言失败 → 实现与独立 code review → 全量活动 unit/integration/browser、typecheck、UI/desktop build → macOS 实际 Electron 隔离空 dataRoot，侧栏收起/恢复、多次切换、持久化恢复与缩放/字号边界截图和几何检查。浏览器平台矩阵只能证明布局合同，不能称 Windows 原生验证；本机 macOS 真实运行另记证据。

只登记 W05 和迁移台账的本次有限修复与证据，W04 仅回归拖动合同，不改变整组业务/跨平台验收状态。隔离数据目录不读取真实 Key 或默认数据根；本次不自动安装或发布应用。
