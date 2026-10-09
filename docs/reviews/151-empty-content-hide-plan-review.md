# 空右侧内容面板收起按钮技术方案独立审核

2026-10-09（Asia/Shanghai）。审核范围：`150-empty-content-hide-plan.md` 与指定真实布局、桌面窗控、桌面样式和 Electron 窗口初始化源码；未启动应用或执行测试，未修改实现。

结论：**通过，可进入测试用例及独立审核阶段。** 当前方案没有技术方案阻塞项；Windows 原生目标机验收仍须据实记录，浏览器几何合同通过不能替代该项。

## 源码依据与判断

- `src/components/layout/ContentTabs.tsx:69` 的零 Tab 分支只有 `h-11` 拖动条，而且父级 `aria-hidden=true`；有 Tab 的 `PanelRight` 按钮已经调用 `onToggleContent`。仅在零 Tab 分支加入原生 button、移除该父级 aria-hidden，保持相同图标/主题颜色和既有回调，符合本次最小范围及真实 Web 组件复用要求。原生 button 可接受 Tab、Enter 和 Space；建议沿用既有可见焦点样式，测试不能只断言 DOM 存在。
- `src/components/layout/DashboardShell.tsx` 的 `hideContent`/`toggleContent` 已完成动画、卸载、布局记忆及全屏复位，`ContentTabs` 已获得其回调；`ChatPanel` 已接收 `onShowContent` 恢复入口。无需增加状态、IPC 或改写工作台。现有最后 Tab 关闭订阅会自动收起，测试应保留这条行为，随后经恢复入口重新打开空态验证新按钮。
- `src/app/desktop.css:5-6` 分别声明拖动区和 button 的 no-drag；空工具条保留 drag，按钮沿用全局 no-drag 正确。验收仍需实际点击，因为 CSS 属性存在不能证明原生窗口命中正确。
- `src/components/desktop/WindowControls.tsx` 的 `WindowsMenuControl` 依据 bootstrap 的 win32 平台渲染；`src/components/desktop/DesktopApp.tsx:155-159` 在 bootstrap 就绪后同时挂载真实工作台和该菜单，因此空工具条订阅同一平台/zoom 状态可避免硬编码浏览器或操作系统猜测。Web/macOS 默认边距可保持现状。
- `src/app/desktop.css:7,10` 使菜单宽度固定为 28 CSS px，right 为 titlebar 剩余占区 + 6 CSS px；计划增加的 40 CSS px 等于这 6 + 菜单 28 + 间隔 6。在右面板右缘与窗口右缘一致的正常三栏布局中，空态按钮的右边界因此至少位于菜单左侧 6 CSS px，不受图标/按钮 rem 尺寸变化影响。
- `desktop/main/index.ts:641-643` 对 Windows 使用 hidden titlebar、44 原生逻辑像素 overlay，并把 appearance.zoom 传给 Electron setZoomFactor。计划的 `max(100vw - env(...), 138 / zoom)` 同时覆盖系统提供的真实 titlebar 占区以及 env 缺失时的保守原生逻辑像素换算；相较单纯固定 CSS px，在 zoom < 1 时能避免新按钮进入原生 caption 占区，在 zoom > 1 时保留与现有菜单一致的 fallback 避让。该公式应只应用于空分支，不扩大为全工作台安全区重构。

## 进入实现前的验证要求

1. 用例需覆盖零 Tab 按钮唯一性、可访问名称、原生键盘激活、真实 shell 收起/恢复，以及有 Tab 导轨与关闭最后 Tab 的既有行为。
2. Windows 几何矩阵要分别包含 env 存在/缺失、zoom 低于/等于/高于 1、UI 字体最小/最大、窄面板和实时设置更新；断言按钮可见且在所属面板内，按钮与原生占区及固定菜单互不重叠。只断言 padding 字符串不足以验收布局。
3. 在真实 macOS Electron 隔离 dataRoot 下验证本地协议离线启动、点击、键盘、恢复和重开；有 Windows 目标机时再验证原生 caption 的真实占区与命中。没有 Windows 目标机时记录未执行，不能给出跨平台全部通过结论。

以上是技术方案审核结果，不是实现审核或测试通过证据。
