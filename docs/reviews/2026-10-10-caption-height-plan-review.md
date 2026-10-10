# 三栏顶部高度恢复：独立方案审核

结论：通过，无阻断。仅审核本轮三条 Windows CSS 声明及对应几何验证方案；不重新验收此前窗控装饰或业务流程。产品尚未实现，此结论不等同于测试或实际 Windows 验收通过。

源依据为 `2026-10-10-caption-height-plan.md`、`src/app/desktop.css:10-24`、`src/components/desktop/WindowControls.tsx:9`、`src/components/layout/ChatPanel.tsx:1666`、`src/components/layout/ContentTabs.tsx:73-104`、`src/components/desktop/DesktopApp.tsx:146` 及 `docs/implementation-boundaries.md`。三个头部继续使用真实组件；Windows 属性仅在真实平台为 win32 时设置，反缩放变量沿用现有根节点设置。

无底边的左导航头部和内容空态头部，行高由 `32/zoom` 改为 `44/zoom`，新增 `12/zoom` 下内边距后，flex 控件布局区仍为 `32/zoom`，中心仍是 16 DIP。ChatPanel 与有 Tab 的内容头部已有 `1/zoom` 底边及 `1/zoom` 上内边距；变更后有效内容高度为 `30/zoom`，中心为 `1 + 30/2 = 16` DIP，和当前布局相同。现有 Tailwind border-box 模型下，该计算保留控件顶部坐标。保留现有 border compensation 是必要条件。

有 Tab 的容器也命中同一 Windows 头部选择器。Tab 自身保持 32 DIP，内部顶边与底部 padding 的平衡规则保留；Tab 关闭按钮、图标和直接工具按钮的尺寸声明不改。现有 scroller 的 `top:0`、`align-items:center` 不改，因此新增空间在原 32 DIP 控件区下方。其底边移到新头部底部，正文相应下移 12 DIP。测试必须直接检查 scroller 的实际纵向溢出，不能仅凭外层高度推断；方案已覆盖此项。

固定菜单的 2 DIP 顶部位置、28 DIP 尺寸及安全区公式独立于头部高度，保持不变。原生 overlay 32 DIP、关闭装饰以及横向保留区没有本轮改动。选择器限定 `[data-desktop-caption="win32"]`，Web/mac 不命中；原组件的 rem 尺寸保持原行为。“上一版 44px”指默认字号的 h-11，Windows 本轮采用固定 44 DIP，并非承诺旧 rem 在所有字号下的同值尺寸。

后续按既有五档 zoom、三档字号、空/单/多 Tab 矩阵验证 44 DIP 行高、原 16 DIP 控件中心及固定按钮/SVG 几何，沿用窄布局与 handlers 验证。实际新包截图、原生最大化/还原/关闭和来源一致性仍须后续执行；完整测试失败据实保留，不将专项通过提升为 W03/W04 或业务正式通过。
