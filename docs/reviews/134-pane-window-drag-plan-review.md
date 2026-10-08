# 三栏顶部窗口拖动：独立方案审核

2026-10-09（Asia/Shanghai）。审核范围：`133-pane-window-drag-plan.md`、真实 `ChatPanel` 标题、`ContentTabs` Tab 导轨/空态、桌面 CSS、`SidebarWindowControls` 与主窗口构造；未运行实现或验收测试。

结论：**复审通过，可进入用例阶段**。原生拖动与 Tab 排除方向正确。`133` 已补齐以下两点：标题置顶；真实双击为通过门，失败则修订原生方案。此处批准的是实现和验证方案，尚不声明双击功能通过。

1. **AI 标题必须始终位于面板顶部。** `ChatPanel.tsx:1665-1668` 在 h-11 标题之前渲染 `StoryWorkflowBar` 和恢复、存储、创建作品状态行。`StoryWorkflowPanel.tsx:23-30` 在有 novelId 时始终返回创作进度按钮，因此只是给现有标题加 `desktop-drag` 会使它低于左侧 `WindowControls.tsx:9` 的顶部。复审方案已要求把现有 h-11 标题放到这些原有行之前；各行继续保留在标题下方，不扩展它们的拖动范围。用例要以真实工作流、恢复和存储状态验证标题 y 与面板/侧栏顶部一致。

2. **双击最大化/复原不能由 CSS 断言替代原生验收。** 主窗口 `desktop/main/index.ts:641` 使用 hidden 标题且未禁用最大化，`desktop.css:5` 已有原生 drag，沿用它适合最小改动。Electron [官方拖动文档](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)说明拖动区屏蔽 DOM 指针事件，所以不应给同一区域叠加 DOM dblclick。不过文档未保证所有目标系统设置下双击恒定最大化。Apple [窗口标题栏设置](https://support.apple.com/en-az/guide/mac-help/mchlp1119/mac)允许填满、缩放、最小化或无动作。复审方案已将原生双击设为通过门：在安装的 Electron 44.6.0 上，对 AI 标题、右空态标题、Tab 导轨空白分别执行真实双击并记录正常→最大化→复原、窗口 bounds 和非全屏状态；如目标运行时不能满足，必须先修订技术方案，不能报完成。无需为此更改用户系统偏好。

其余审查通过：

- `ContentTabs.tsx:98` 的可点击 Tab 为 `div role="tab"`，不在现有 CSS 的 button/role=button 排除清单中；新增 `[role="tab"]` no-drag 是必需的。Tab 整体（含标题、封面、徽标、关闭按钮）均应排除；导轨剩余空白和内边距保持 drag。
- 全屏切换与面板显隐都是 button，现有 no-drag 已覆盖；ChatPanel 恢复侧栏/内容按钮亦然。保持事件处理、键盘激活、中键关闭和溢出滚动不变。
- 右无 Tab 添加 h-11 shrink-0 空白条仅改变请求中的顶部区域，保留原空态及真实业务组件，符合范围。右有 Tab 应复用现有导轨，无须另叠加标题条或调整原 Tab 排版。
- `desktop-drag` 禁选文字符合原生拖动需要；不要给面板根、消息区、composer、业务内容或正文增加 drag。
- macOS 真实窗口与 Windows 待实际验收必须分别记录，不能把 browser computed-style、模拟平台或 BrowserWindow.maximize() API 的直接调用当作鼠标双击通过证据。

本次仅新增本审核文件；无实现修改、无依赖安装、无全量测试执行。
