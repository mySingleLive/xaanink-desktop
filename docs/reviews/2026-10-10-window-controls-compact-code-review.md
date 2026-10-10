# 紧凑窗控独立代码审核

日期：2026-10-10（Asia/Shanghai）。仅审核 `desktop/main/window-appearance.ts`、`src/app/desktop.css`、`tests/unit/window-appearance.test.ts`、`tests/browser/chat-caption-safe-area.test.ts` 的当前 Git diff 与相关源文件、聚焦 RED 日志。本审核只写本报告，未修改产品或测试。

结论：代码审核通过，未发现需修复的阻断项或可操作缺陷。可继续聚焦 GREEN、全量活动用例、构建/打包和真实 Windows 验证。本报告不构成全量或原生验收通过。

## 实现核对

- `desktop/main/window-appearance.ts:21-27` 仅将共享 overlay 高度从 44 改为 32 并添加紧凑原生区域注释，透明背景与 symbolColor 保持。三个活动窗口构造和 Windows 主题刷新仍引用同一 helper，没有复制配置或增加 React 系统按钮；macOS 的交通灯与非 Windows setter 分支未改。
- `src/app/desktop.css:10` 仅将 Windows 菜单 top 改为审核通过的 `max(0px, calc(16px / var(--desktop-caption-zoom, 1) - 14px))`。其 28 CSS px 控件尺寸、右侧 env/138/zoom 安全区、z-index、拖拽排除及 Web 顶栏均保留。默认缩放时 top 2、center 16；更高缩放顶部夹至 0，与先行方案一致。
- 此实现保留 Electron 原生 glyph/命中处理。高度变化会缩短原生命中区高度；没有代码支持或宣称分别调整原生 glyph 线宽/大小。产品变更与已通过方案和用户授权范围相符。

## 测试与 TDD 证据核对

- `window-appearance.test.ts:98,146` 只把明确高度期望从 44 改为 32。helper 实际导入、三个实际 BrowserWindow options AST 编译执行、主题 palette/system/source/revision 与缺失/销毁窗口、非 Windows setter 回归均保留，没有删测试或弱化断言。
- `chat-caption-safe-area.test.ts:30` 在隔离 fixture 给真实 WindowsMenuControl 的 `window.desktop.command` 增加有限调用记录；该 stub 没有代替待测 React handler，也没有影响原有恢复入口的事件记录。
- 新 WCO-C03 在真实组件与当前生产 CSS 上执行 5 档 zoom × 3 个字号，共 15 个场景。top 预期独立列为 `[7.333333, 2, 0, 0, 0]`，实际 boundingBox 有 0.05 px 亚像素容差；宽高 28、顶部不越界、默认中心 16、no-drag、caption/恢复安全间距与 click/Enter/Space 的 3 次 `app.menu` 均有明确断言。原 WCO-S01/S02/S03 仍保留；15 场景属于 1 个新增顶层 test，汇总不得额外当作 15 个独立测试重复计数。
- `docs/evidence/window-controls-compact/tdd-unit-red.tap` 的 footer 为 12 tests / 7 pass / 5 fail，两个 palette 与三个实际构造均在旧 height 44 下不满足 32；`tdd-menu-red.tap` 为 1 test / 0 pass / 1 fail，明确在 75% 场景报告 `Menu top at zoom 0.75: 7`。这些是本次变更的实质 RED，与 EPERM/缺失浏览器等启动失败有区别。
- 审核时 `targeted-green.tap` 仅有 TAP header，尚无完成 footer，因此本报告不将聚焦 GREEN 写成已通过。主代理应保留最终命令、exit code 与 footer 后再汇总。
- 对指定四文件运行 `git diff --check`，exit 0；只出现 Git 已有 LF→CRLF 提示，无补丁空白错误。

## 剩余验证范围

浏览器 fixture 的 zoom/env 值注入和 command 记录只证明 CSS 几何与 React 事件接入。原生菜单弹出、Electron 实际缩放、顶部命中、Snap、正常/最大化前后位置、最小化/最大化/恢复/关闭及主题后高度保持由真实 Windows 证据单列。全量活动 core/browser、类型检查、生产构建、Windows 包和隔离离线启动仍需完成并据实记录失败/取消/跳过状态，不因本次代码审核通过提升 DESK-W03/W04 或双平台正式验收状态。
