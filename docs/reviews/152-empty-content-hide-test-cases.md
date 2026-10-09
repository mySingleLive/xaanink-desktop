# 空右侧内容面板收起按钮用例

2026-10-09（Asia/Shanghai）。150/151方案已独立通过。

- EMPTY-01：运行真实 ContentTabs 的零Tab分支；隐藏内容面板按钮唯一、可见、有title和button类型，父级不aria-hidden。位置在内容区顶行右侧，几何包含于面板，macOS/Web右距8px、顶行44px（默认字号）。空白drag、按钮no-drag、原空态正文保留。修改前按钮缺失必须使实际可见性断言失败。
- EMPTY-02：浏览器真实按钮鼠标/Enter/Space调用既有回调，测试宿主收起/重挂载空面板，按钮恢复可用。只证明组件回调；DashboardShell实际动画/恢复另由原生完整工作台验证。
- EMPTY-03：win32 fallback下，同一组件实时更新zoom .75/1/1.25/1.5/2与ui字号11/14/24，宽内容面板440px和窄320px（另默认fallback280px），检查按钮始终在面板内、顶部右侧、原生138/zoom预期占区左侧、应用菜单左侧至少6px；没有扩大按钮热区到窗控。
- EMPTY-04：同一win32实例的系统env占区106/138/184/216 CSSpx进行几何矩阵，宽/窄320px及缩放/字号。普通Chromium不提供原生titlebar env，仅将当前真实元素style的env读取替换成fixture CSS variable，同时对真实菜单CSS作相同env值注入；保留原calc/max/剩余表达式，明确是env结果注入的浏览器合同，不是Windows原生证据。fallback矩阵使用未经替换的产品表达式。
- EMPTY-05：三个真实tab→逐个关闭→最后Tab关闭后空工具条按钮出现；点击收起/恢复后仍无Tab。确认有Tab时原收起/全屏各唯一、空态按钮不重复；保留原pane-window-drag滚动/选中/全屏回归。
- EMPTY-06：新隔离dataRoot、真实macOS Electron完整原组件、xaanink离线协议。新根小说/模型均零，AI显示内容按钮打开空区；实际CUA点击新增按钮收起，并通过AI入口恢复、键盘再次收起、多次切换。用真实临时小说打开Tab、关闭最后Tab仍自动收起，再经AI入口打开空面板验证新按钮。真实zoom/font边界、默认外观关闭重开后保持既有恢复规则（draft-recovery.ts零Tab会收起并保留原layout），经AI入口再次打开/收起空面板。窗口不移动/最大化/退出，无pageerror；原生截图与DOM截图明确区分。
- EMPTY-07：完整活动unit/integration/browser、完整typecheck、UI/desktop构建、diff检查。本次源构建为开发验证，不声称安装包已更新。没有Windows目标机时明确原生窗控/DPI验证未执行；不把平台字段切换称真实Windows通过。

浏览器隔离真实ContentTabs与WindowsMenuControl，只stub与本轮无关的业务面板正文/保存层和缓存小说列表，fixture不读取真实数据。新代码RED必须是按钮缺失/功能失败，不把依赖/浏览器运行权限失败当TDD证据。
