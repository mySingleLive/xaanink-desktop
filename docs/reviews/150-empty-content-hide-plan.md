# 空右侧内容面板收起按钮方案

2026-10-09（Asia/Shanghai）。用户要求：没有任何面板页时，在右侧区域顶部右侧增加收起图标按钮；Windows 不得覆盖原生窗口按钮组；点击收起整个右侧区域。

当前真实 `ContentTabs.tsx` 在 tabs.length===0 时仅渲染 h-11 的空拖动条，收起按钮只存在于有 Tab 的导轨。`DashboardShell.tsx` 已提供 `onToggleContent`，负责既有动画、卸载、AI 恢复入口及布局持久化；无需新增状态或 IPC。

仅把空拖动条改成 h-11、flex、items-center、justify-end、px-2 的工具条，并添加 type=button、aria-label/title=隐藏内容面板、PanelRight 图标的 size-6 控件，接入原 `onToggleContent`。移除父条 aria-hidden，保证键盘和辅助技术可达。空白继续 desktop-drag；桌面 CSS 的 button no-drag 继续生效。空态正文、有 Tab 导轨/全屏/关闭/编辑实例均保持。

Windows 已有固定 `WindowsMenuControl`：右距 `100vw - env(titlebar-area-width, calc(100vw - 138px)) + 6px`，按钮宽28px。新空工具条订阅现有 desktop bootstrap；仅 win32 设右 padding：`calc(max(100vw - env(titlebar-area-width, calc(100vw - 138px)), <138 / appearance.zoom>px) + 40px)`。env 接收真实系统/DPI窗控占区；fallback 与既有菜单一致，同时以138原生逻辑像素除实时 zoom 作最低保守避让。40px包含菜单右距6+宽28+间距6；新按钮位于窗控和菜单左侧，仍在右面板顶部靠右位置。max避免zoom>1且env缺失时覆盖既有菜单。macOS/Web保留px-2原边距。不改原生窗口/菜单按钮；本次不修整组安全区。

顺序：独立方案审核 → 用例及独立审核 → 修改前真实功能失败 → 最小实现/独立code review → 完整活动unit/integration/browser、typecheck、UI/desktop build → 本机macOS真实离线协议Electron与隔离空dataRoot验证点击、恢复、最后Tab关闭、键盘、重开/缩放。Windows环境几何矩阵含env及fallback、zoom/font/窄面板、菜单互不覆盖，明确只算浏览器布局合同；若无Windows目标机保留原生验收未执行。

更新 W05 的本次有限development和迁移台账；不覆盖完整业务迁移或跨平台状态。不读取默认用户数据或Key，不安装/发布应用。当前会话没有CodeGraph工具且仓库没有.codegraph，本机PATH及常用CLI目录未找到codegraph；用户已授权若命令可用则建索引，本轮按实际本地源码执行。
