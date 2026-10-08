# 三栏顶部窗口拖动：本轮验证结果

2026-10-09。来源：本轮用户红框、只扩展 AI 与右侧顶部、双击最大化/复原、有 Tab 导轨空白可拖的要求。

结论：本轮三个顶部拖动区的实现、活动开发测试与 macOS 原生窗口验证通过。真实 React 组件继续复用；生产改动仅 `src/app/desktop.css`、`src/components/layout/ChatPanel.tsx`、`src/components/layout/ContentTabs.tsx`。无新 IPC 或自定义窗口双击事件。

AI 既有 44px 标题条移到该栏首行并成为 drag 区；工作流与恢复/创建状态完整保留在其下。右侧无 Tab 增加 44px 空白顶部，原空态仍保留；有 Tab 的既有 39px 导轨只增加 drag 命中。三个区域均从栏顶部 y=0 起，Tab 本身、关闭/面板按钮和输入区仍 no-drag，业务正文不增加拖动命中。没有要求把现有 Tab 导轨改成 44px，因此保留其原高度。

## 自动测试与构建

Node 24.18.0；所有活动 unit/integration 与 browser 用例均实际运行，无 fail/cancelled/skipped。为避免 PGlite 和构建并发耗尽本机空间，最终全量运行限制 test-concurrency=2。

| 检查 | 结果 | 本机原始日志 |
| --- | --- | --- |
| 修改前聚焦 unit/browser | 5/5 因功能断言失败（RED） | `/private/tmp/xaanink-drag-red.log` |
| 实现后聚焦 unit/browser | 5/5 通过 | `/private/tmp/xaanink-drag-green.log` |
| 全量 unit/integration | 1624/1624 通过 | `/private/tmp/xaanink-drag-core.log` |
| 全量 browser | 176/176 通过 | `/private/tmp/xaanink-drag-browser-final.log` |
| `npm run typecheck` | exit 0 | `/private/tmp/xaanink-drag-typecheck-final.log` |
| `npm run build:ui` | exit 0，离线静态导出生成 | `/private/tmp/xaanink-drag-build-ui.log` |
| `npm run build:desktop` | exit 0 | `/private/tmp/xaanink-drag-build-desktop.log` |

上述日志的本任务审查副本位于 `docs/evidence/implementation-44/{core,browser-final,typecheck-final,build-ui,build-desktop,red,green}.log`，只替换机器目录前缀。原始临时日志仍保留。

最终测试命令分别为 `node --import tsx --test --test-concurrency=2 --test-reporter=tap tests/unit/*.test.ts tests/integration/*.test.ts` 与相同参数的 `tests/browser/*.test.ts`。browser 指定本机已安装 Chromium headless shell；聚焦测试挂载真实 ContentTabs/stores/CSS、当前 ChatPanel 标题 JSX，并检查交互后代和溢出滚动；完整 ChatPanel 另在下述实际 Electron 中核验。详细隔离边界见 135、136。

全量回归发现的历史 browser 夹具已与当前真实导出格式、CSS chunks、恢复文案、命令目录及已退役的备份入口对齐。修复范围、独立审核和历史原件保存见 [139](139-pane-drag-browser-harness-repair.md)、[140](140-pane-drag-verification-review.md)。退役备份用例未计作本轮通过或跳过。此前磁盘 ENOSPC/PGlite Errno 51 与错误夹具运行没有算作最终通过结果；清理本任务生成依赖并重建后，以上最终运行均成功。

## macOS 原生窗口

使用实际离线 `xaanink://app/` 工作台和合成小说夹具；启动前检查指定隔离 dataRoot、模型数 0。观察脚本 `scripts/smoke-pane-window-drag.mjs` 只读 BrowserWindow 状态、DOM/CSS 与截图，不调用 setBounds/maximize 模拟结果。数据根位于本任务 `/private/tmp/xaanink-pane-drag-*`；未操作默认用户数据或 Key。

证据：[最终原生 JSON](../evidence/implementation-44/pane-window-drag-native.json)，内含三个生产文件 SHA-256、各次正常/最大化/复原 bounds、CSS 几何和错误数组（空）。同目录保留各次截图。

| 区域 | 真实鼠标拖动 | CUA 系统鼠标双击最大化 → 再次双击复原 |
| --- | --- | --- |
| AI 顶部 | 用户明确回复「两处都能移动」（与 Tab 导轨一起确认） | `(784,320,1440,940)` → `(0,25,3008,1603)` → 原 bounds |
| 右侧 Tab 导轨空白 | 同上人工确认 | `(784,320,1440,940)` → `(0,25,3008,1603)` → 原 bounds |
| 右侧无 Tab 顶部 | 用户明确回复「可以移动」；观察实际 `(784,320)` → `(887,326)`，尺寸均为 `1440×940` | `(887,326,1440,940)` → `(0,25,3008,1603)` → 原 bounds |

六次切换中最大化标记为 true/false 符合预期，fullscreen 均为 false。Tab、面板全屏按钮和 AI composer 的有效 CUA 双击均保持整个窗口状态不变；Tab 获得焦点、面板按钮两次切换后恢复原状态、composer 获得输入焦点。

自动拖动 driver 对原有左侧拖动条也没有移动效果，故不能用该 driver 的失败输入判定新区域失败或 Tab/按钮物理拖动排除通过。本轮三区拖动明确记为人工原生验证；交互排除由真实 CSS/浏览器行为及原生双击证明，**物理鼠标拖动 Tab/按钮的排除检查未执行**。AI/导轨人工移动的中间记录 `native-intermediate-baseline-error.json` 保留实际 `(784,320)` → `(897,352)` 的同尺寸变化及 failed 状态；其失败是复原检查错误引用移动前 baseline，不替代最终三组独立正常 baseline。

最终运行进程 exit 0。独立复查及当前脚本 `--verify-report docs/evidence/implementation-44/pane-window-drag-native.json` 均通过：每区唯一 baseline/maximize/restore，正常 baseline、kind、次序、真实最大化状态、非全屏及复原 bounds 都严格校验；源码 hashes 仍一致。该重验同时补验了运行进程在通过门增强前已经载入的旧脚本。额外用 12 种无效报告验证通过门均拒绝，包括错误 kind/次序/重复或缺记录、最大化 baseline、假最大化、全屏、错误复原、缺人工确认、排除区移动、缺或改源码 hash。

通过门负例的只读执行程序和结果分别是 [verify-native-gate.py](../evidence/implementation-44/verify-native-gate.py)、[native-gate-validation.log](../evidence/implementation-44/native-gate-validation.log)，exit 0；没有修改最终原生报告或操纵窗口。

## 验收范围

方案、用例与实现依次完成独立审核（133–137），最终夹具与原生证据独立复核见 140。本轮 1800 项活动开发测试通过；类型和构建通过。

这是 macOS development Electron 的真实鼠标与工作台证据。本轮没有 Windows 目标系统或新的安装包验收；未执行吸附、多屏/DPI、完整正式业务用例与安装包回归。W04 总状态和 29 类业务迁移总状态保留原计划状态，只登记本次顶部拖动的有限开发证据。
