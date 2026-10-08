# macOS 侧栏恢复按钮安全间距方案独立审核

2026-10-09（Asia/Shanghai）。审核 `143-sidebar-restore-safe-area-plan.md`，本审核只写此报告，不修改实现或测试。结论：**批准进入测试用例阶段；无阻塞发现。** 尚未执行本次回归或真实系统验收，不据此声明修复完成。

## 源码依据与判断

- `src/components/layout/ChatPanel.tsx:943,1666–1679` 已订阅 `bootstrap`；恢复按钮只在 `sidebarHidden && onShowSidebar` 时出现，原标题 `px-3` 为 `.75rem`，按钮 `-ml-1.5` 使收起后左缘贴近窗口边。仅在 `bootstrap.platform === "darwin"` 覆盖该按钮左外边距，保留其它平台和 Web 的现有位置，适用条件清楚。`DesktopApp.tsx` 在 bootstrap 完成前不会挂载 `DashboardShell`，真实桌面不需要另加平台猜测或默认 macOS 分支。
- `desktop/main/index.ts:641–643` 创建真实原生窗控 `{x:14,y:14}`，并用已保存的 `appearance.zoom` 设置 `webContents.setZoomFactor`。设置保存和配置导入路径也在发送新 state 前应用同一 zoom（`index.ts:384,490`）。`desktop/core/settings.ts:3–7` 保证 zoom 为 0.75–2，字号为 11–24，除数不会为零。`src/stores/desktop.ts:7–8` 保留平台并接收提交状态，已有订阅足以实时调整间距。
- `src/components/desktop/WindowControls.tsx:9–11` 默认字号/zoom 下首个控制按钮左缘为 `8 + 76 + 4 = 88px`，可作为本次视觉锚点。`DesktopApp.tsx:147–150` 会改变 root font size，所以减 `.75rem` 与实际标题 padding 抵消比减固定 12px 正确：相对 chat 左缘为 `padding + margin = 88 / zoom`，Electron zoom 后为 88 个原生窗口逻辑像素。88px 的验收仍须依据原生按钮截图/几何边界；“约 20px”只是方案预期，不能取代实际证据。
- `DashboardShell.tsx:157–188,452–464` 收起时立即设置隐藏状态后把 sidebar 宽度单调收敛到零。恢复按钮在动画中左缘为 chat 当前左缘加安全偏移，chat 左缘非负，未引入朝原生按钮组移动的负偏移；恢复时按钮按现有条件消失。无需改写 Web 分栏或动画。`src/app/desktop.css:5–6` 继续使标题可拖拽、按钮为 no-drag，新增 margin 不会改变命中与点击合同。
- 单点调整符合 `docs/implementation-boundaries.md` 的平台安全间距允许范围，也没有复制设计稿、引入示例数据或新 IPC。计划以隔离 `XAANINK_TEST_ROOT` 空目录执行真实 Electron，不读取正常数据根/Key；台账只登记 W05 本次有限修复和 W04 拖动回归，未把浏览器平台状态等同 Windows 原生通过，也不授予整个 W05 通过，符合验收边界。方案最初登记 W04 的文字应由主代理按已确认的 W05 归属修正。

## 测试阶段应保留的条件

用真实 `ChatPanel` 验证 macOS 收起、恢复和重复切换的按钮几何/点击；覆盖字号 11/24 与 zoom 0.75/2 的交叉组合和设置更新路径，避免只测默认 rem。Web 无 bootstrap 与 win32 应保持原位置。动画中/收敛后、重开恢复隐藏布局均需验证，真实 macOS 截图确认按钮左缘位于原生绿灯右缘并有间隙。现有侧栏展开态的 spacer 没有 zoom 抵消，此次方案没有改变该既有行为；若边界测试发现它存在独立问题，应据实记录，不能悄然扩大本次修复或将其报告为新回归。
