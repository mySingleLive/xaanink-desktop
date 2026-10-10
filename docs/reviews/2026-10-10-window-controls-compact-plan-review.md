# Windows 紧凑窗控方案独立审核

日期：2026-10-10（Asia/Shanghai）。审核范围仅限 `2026-10-10-window-controls-compact-plan.md` 技术方案及其引用的现有源文件；未审核后续测试清单、未实施、未运行原生验收。

结论：技术方案通过，可进入独立测试用例审核。未发现阻断项。32 DIP 原生 overlay 与菜单 `max(0px, calc(16px / var(--desktop-caption-zoom, 1) - 14px))` 属于用户本轮授权的 Windows 桌面差异，保持 Web 顶栏和业务组件来源，符合实施边界。

## 来源核对

- `desktop/main/window-appearance.ts:16-34` 的共享配置目前为 44，构造期与实时刷新使用同一函数；`desktop/main/index.ts:666-667`、`root-maintenance-window.ts:43-44`、`root-relocation-window.ts:44-46` 均引用该配置。改共享高度可覆盖三种活动窗口，主题刷新不会独立写回旧高度。
- `src/components/desktop/WindowControls.tsx:16-20` 仅渲染 Windows 菜单，三枚系统窗控由 Electron 提供，React 未分别设置其线宽；现有菜单通过 `--desktop-caption-zoom` 获得实际应用缩放。
- `src/app/desktop.css:7-10` 菜单为 28 CSS px、当前 top 为 7 CSS px；方案在 100% 缩放时给出 top 2 px、中心 16 px，在 75% 时 top 约 7.33 px、中心约 21.33 CSS px，乘缩放后均为 16 DIP；200% 时顶部夹至 0，28 CSS px 菜单无法完全居中于 16 DIP，方案已明确“尽可能对齐”。既有 right/env/138/zoom 安全区表达式应保留。
- `AGENTS.md` 和 `docs/implementation-boundaries.md` 允许桌面原生窗控与安全间距修改，要求阶段审核、真实 Electron/目标系统验证，禁止使用模拟工作台替代业务组件。方案保留原生控件、Web 44 px 顶栏及 macOS 交通灯，并明确不提升 DESK-W03/W04 正式验收状态。
- `package.json:73` 固定 Electron 44.6.0。在线核对的 [Electron WinCaptionButton](https://github.com/electron/electron/blob/main/shell/browser/ui/views/win_caption_button.cc) 的 `PaintSymbol` 根据设备比例取整符号尺寸与基础 stroke，并居中绘制；[Chromium WindowsIconPainter](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/views/frame/windows_icon_painter.cc) 的最小化用横线、最大化用矩形/Windows 11 圆角矩形、关闭斜线启用抗锯齿。[Electron 公开接口](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar#custom-window-controls) 只列出高度、背景色、符号色。该机制支持方案的原因解释与接口限制；上游 main 不是本机 44.6.0 的实际像素证明。

## 非阻断风险与交付约束

1. 高度从 44 改 32 会缩短原生按钮命中区的高度，不能把“保持系统宽度和命中区”解释成命中区尺寸完全不变。应表述为保持原生命中行为与系统横向布局；真实验证需覆盖顶部点击、最小化/最大化/恢复/关闭及 Windows Snap。
2. 32 DIP 是拟定 overlay 高度，约上移 6 DIP 是居中几何预期。最大化边框、系统 DPI 与 Electron 原生实现可能影响实际坐标，必须在同一窗口前后截图/坐标证据中单列真实结果，不能直接把预期写成实测通过。
3. 该高度调整不改变公开接口之外的 glyph 尺寸或分别调整线宽。用户交付说明应明确原生按钮区域更紧凑、位置上移，勿声称图标已缩小或三枚原生 glyph 已统一线宽。关闭斜线的抗锯齿与形状覆盖支持视觉差异解释，不支持把所有设备上的“最小化一定更粗”当成恒定事实。
4. 菜单在 200% 缩放时只能保证顶部不越界；其物理尺寸为 56 DIP，无法与 32 DIP 窗控区完全等高。保留方案中的“尽可能对齐”，在后续用例与本机检查中验证菜单没有遮挡、右侧安全区正确、仍能点击，不能只以源码字符串断言视为完成。

本阶段通过只表示技术路径与授权边界成立，后续测试用例审核、TDD、代码审核、全量用例及真实 Windows 验证仍是独立门槛。
