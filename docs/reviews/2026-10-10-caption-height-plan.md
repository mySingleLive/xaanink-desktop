# 三栏顶部高度恢复方案

用户最新要求：三栏顶部空间恢复上一版高度，所有顶部按钮的位置、尺寸保持本轮对齐后的值。

源依据：SidebarWindowControls、ChatPanel 和空态 ContentTabs 原类名为 h-11（默认 44px）；当前 desktop.css Windows 覆盖为 32/zoom，原生 overlay 保持 32 DIP。恢复 Windows 行高度为 44/zoom，增加 12/zoom 下内边距，保留现有 border-b 的 1/zoom 上内边距及底边。有效控件布局区仍 32 DIP，中心仍 16 DIP。已有 Tab 保持 32 DIP、子关闭按钮 15 DIP；所有按钮/SVG、安全区、菜单、原生 X 绘制及原生窗控不变。Web/mac 样式不改。

仅修改 src/app/desktop.css 与现有 tests/browser/caption-alignment.test.ts；不改业务组件/数据流程，不覆盖上轮未提交改动。测试扩充真实 header/ContentTabs 夹具：五 zoom×三字号×空/单/多 Tab 的三个头部必须同高 44 DIP，全部按钮/SVG 的 top/width/height/center 与现有 32 DIP 控件区一致，正文从新高度开始，Tab 无额外纵向溢出。窄布局、隐藏恢复和原 handlers 保留。

顺序：独立方案审核 → 测试清单及独立审核 → 44 DIP 期望的实质 RED → CSS 实现 → 独立 code review → 相关/完整 core/browser、类型、构建及包 → 隔离真实 Windows 截图/几何及正常/最大化/原生关闭 → 独立证据审核。完整测试失败据实列出，不提升 W03/W04 或业务正式 planned 状态。
