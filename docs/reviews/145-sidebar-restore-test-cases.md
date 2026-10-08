# macOS 侧栏恢复按钮测试用例

2026-10-09（Asia/Shanghai）。对应 143/144 方案及本轮用户要求。

- SAFE-01：浏览器编译当前真实 `ChatPanel` 标题 JSX 与真实 Tailwind/desktop CSS。darwin 侧栏收起，zoom=1、字号14时，恢复按钮原生逻辑坐标左缘落在84–96px安全带；修改前必须由实际几何断言失败，不接受编译/浏览器环境失败为 RED。
- SAFE-02：同一标题实例将 darwin zoom 切换 .75/1/1.25/1.5/2，字号11/14/24，模拟 DesktopApp 的 root rem 更新；通过 CSS 几何乘 zoom 检查左缘仍在安全带。该矩阵是浏览器布局计算，非原生缩放或 Windows 验收。
- SAFE-03：Windows 与 bootstrap 缺失（Web）的恢复按钮仍在原 .375rem 左缘；darwin、win32、Web 侧栏展开时没有恢复按钮，标题内边距及拖动区不新增占位；无恢复 callback 时不渲染按钮。
- SAFE-04：同一 React 标题执行鼠标恢复、再次隐藏、Enter 键恢复；恢复按钮 no-drag、标题 drag、右栏恢复按钮可点击，侧栏来回切换后安全间距稳定。保留既有 pane-window-drag unit/browser 回归。
- SAFE-05：新隔离 dataRoot、实际离线协议 Electron、完整真实 SidebarTree/DashboardShell/ChatPanel。侧栏收起到零宽后测按钮坐标乘真实 webContents zoom，核对原生按钮组截图；点击按钮确实恢复侧栏并保持窗口存活/未关闭，多次切换和键盘恢复。设置通过真实 IPC 持久化，检查 .75..2 及字号11/24边界；关闭重开保留折叠态时再次检查按钮可达。原生截图通过 CUA 捕获窗口，renderer截图只证明 DOM，不把后者当原生按钮可视证据。
- SAFE-06：全量活动 unit/integration/browser、完整 typecheck、UI/desktop build 和 diff 检查。本次不跑退役备份用例，不运行既有旧安装包测试来声称当前修复包通过；没有 Windows 目标机则记录原生未执行。

新 browser 用例只提取当前源文件的真实标题 JSX；桌面 bootstrap/settings、会话和左右回调为隔离夹具，标题内部没有复制产品 JSX。完整生命周期/分栏/持久化由实际 macOS Electron另验。测试不访问真实目录、用户小说或模型 Key。
