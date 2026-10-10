# Windows 紧凑窗控方案

日期：2026-10-10。用户要求解释最小化/最大化比关闭显粗，并将窗控往上移，位置和尺寸接近 Codex。

## 原因与边界

- `desktop/main/window-appearance.ts` 的原生 overlay 高度为 44，三种窗口构造与实时主题刷新共用该配置。缩短高度会将居中的原生符号上移。
- Electron 原生 WinCaptionButton 使用 Chromium WindowsIconPainter：直线、圆角方框和斜线的像素覆盖不同，关闭斜线使用抗锯齿。DPI 又参与符号尺寸与 stroke 取整。这是视觉粗细差异的原因，并非 React 设置了不同 strokeWidth。
- 上游依据：[Electron 原生按钮](https://github.com/electron/electron/blob/main/shell/browser/ui/views/win_caption_button.cc)、[Chromium 图标绘制](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/views/frame/windows_icon_painter.cc)、[公开 overlay 接口](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar#custom-window-controls)。main 分支仅作为机制依据，实际效果必须由本机 Electron 44.6.0 实测。
- 公开 overlay API 仅提供高度、背景色和符号色，不提供分别修改 stroke 或图标尺寸的接口。按已批准原生窗控约束，保留原生 glyph、Snap 和关闭流程。不得声称已统一原生图标线宽，也不引入替代 SVG 按钮。首个问题以解释真实原因和接口限制处理。

## 实施

1. 共享原生 overlay 高度从 44 改为 32 个设备独立像素；在正常/最大化状态保留系统宽度和原生命中处理，命中区高度随配置缩短。图标中心预期上移约 6 DIP，实测结果单列。不是对 Codex 窗口的逐像素测量或复制。
2. Windows 菜单仅在默认缩放时随窗控中心从 top7 调至 top2；为应用缩放采用 `max(0px, calc(16px / var(--desktop-caption-zoom, 1) - 14px))`，使 28 CSS px 菜单尽可能对齐原生 32 DIP 高度，且顶部不越界。右侧既有 env/138/zoom 安全间距不变。
3. 不改原 44px Web 顶栏、内容/侧栏布局、macOS 交通灯、IPC、数据目录或模型。

## 验证顺序

独立方案审核 → 测试清单审核 → 现有真实 helper/构造期望改为 32 并添加实际菜单几何断言，记录红灯 → 实现 → 独立 code review → 全量活动 core/browser、类型检查、构建、Windows 包 → 隔离原生截图/操作及证据审核。

真实 Windows 验证包括同一窗口前后高度、原生最小化/最大化/恢复/关闭、菜单、主题切换不复位高度、75/100/200% 安全区。未执行及全量失败据实列出，不提升 DESK-W03/W04 正式验收状态。迁移清单不涉及任何新增业务迁移，仅追加有限验证记录。
