# 三栏顶部窗口拖动测试用例

2026-10-09；对应本轮用户要求和 W04，非整个 W04 的跨平台验收。

- DRAG-01：真实 ChatPanel 标题栏、ContentTabs 无 Tab 顶部、SidebarWindowControls 计算样式为 drag；无 Tab 顶部和左右现有标题栏等高。正文、空态和 AI composer 无拖动声明。
- DRAG-02：真实 ContentTabs 有 Tab 时导轨空白为 drag；Tab（含文字/图标命中）、关闭按钮、全屏和面板显隐按钮为 no-drag；单击、键盘激活、中键关闭、关闭按钮不误触父 Tab。
- DRAG-03：多 Tab 溢出时保留横向滚动、选中 Tab 自动可见；导轨之外不扩展为拖动区。最后一个 Tab 关闭时出现顶部空白拖动条。
- DRAG-04：浏览器源代码/CSS 合同先在修改前运行并失败；实现后通过。浏览器只证明 DOM/样式/业务交互，不能证明 native 拖动或双击。
- DRAG-05：当前 macOS 真实离线 Electron + 原 React 工作台 + 隔离根；分别对 AI 顶部、右侧无 Tab 顶部、有 Tab 导轨空白执行系统鼠标拖动，读取实际 BrowserWindow bounds 前后差。逐区双击并观察最大化、再次双击观察复原；Tab 和按钮位置拖动不得移动窗口。截图、bounds、源码版本与错误记录本次证据。
- DRAG-06：全量活动单元/集成和 browser 用例、完整 typecheck、静态 UI 与主进程构建；不运行退役备份测试。Windows 原生没有目标机时记录未执行。

浏览器挂载真实 ContentTabs，隔离 registry/StagedSaveSurface/StoryWorkflowPanel 的无关业务内容，保留真实 tabs store/React/query 与滚动逻辑。ChatPanel 标题栏只提取当前源文件的真实 JSX 挂载，避免为仅标题栏变更引入 AI 网络与复杂恢复生命周期；完整 ChatPanel 本轮另外在实际 Electron 验证。源码 AST 合同确认新增 drag 不落在工作台根、消息区或 composer。所有夹具只写隔离目录，不访问默认数据根或 Key。
