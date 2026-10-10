# AI 标题拖动稳定性修复：验证记录

日期：2026-10-10，Windows x64。用户报告 AI 标题的原生拖动命中随右侧分栏与标签滚动变化。本文保留第一阶段实现、TDD、审核及构建证据。**第一阶段人工反馈仍失败；第二阶段消息滚动排除区域补修重建后，用户已确认图标、首字及周围都能拖动。最终浏览器回归 256/256 通过，类型、构建及独立审核通过；完整核心回归仍未通过。**

## 原因与实现

真实 ChatPanel 的第一行原本已经是 desktop-drag；问题来自旁边的真实 ContentTabs。其 max-content 标签轨道在 overflow:hidden 视口内滚动，裁剪外的 tab / 关闭按钮仍登记 no-drag 布局矩形，向左侵入 AI 标题。移动分割线改变矩形位置，因此出现部分标题或整行偶发无法拖动。

`src/app/desktop.css` 改由受布局约束的 `.content-tabs-viewport` 独占 no-drag，内部所有后代以 initial 解除各自登记；视口按标签实际宽度收缩，工具右对齐，剩余标题空白仍属于父 drag。显式 none 在 Chromium 中会被规范化为 no-drag，因此实现和浏览器 computed 断言分开记录。`useContentTabStrip.ts` 的容量变量改为 caption 可用空间减真实工具宽和 gap，避免单标签从窄栏回到宽栏时被旧宽度锁死。

ChatPanel / ContentTabs 的 JSX、真实 29 类面板、业务数据与主进程拖动逻辑没有改动。未引入示例内容或 HTTP 服务。保留原标签选择、关闭、中键、键盘、排序、菜单、滚动、取消和正文实例。

审核文件：`2026-10-10-ai-caption-drag-plan-review.md`、`2026-10-10-ai-caption-drag-test-review.md`、`2026-10-10-ai-caption-drag-code-review.md`，独立审核由指定子代理执行。

## 实际测试

原始日志位于 `docs/evidence/ai-caption-drag/`，被仓库忽略；失败日志保留，不覆盖为通过。

| 执行 | tests | pass | fail | cancel / skip | 证据 |
| --- | ---: | ---: | ---: | --- | --- |
| 新增 AIDRAG 红测 | 3 | 1 | 2 | 0 / 0 | red-browser-final.log |
| 修复后专项与相关用例 | 26 | 26 | 0 | 0 / 0 | green-scoped-final.log |
| SURF 夹具修正后专项 | 7 | 7 | 0 | 0 / 0 | surface-fixture-green.log |
| 标题安全区时序夹具修正后专项 | 10 | 10 | 0 | 0 / 0 | caption-fixture-green.log |
| 完整 browser 第一轮 | 253 | 251 | 2 | 0 / 0 | browser-full.log |
| 完整 browser 第二轮 | 253 | 252 | 1 | 0 / 0 | browser-full-final.log |
| 最终完整 browser | 253 | 253 | 0 | 0 / 0 | browser-full-settled.log |
| 完整 unit / integration | 1766 | 1733 | 30 | 1 / 2 | core-full.log |

专项覆盖 20 标签首/中/末激活、分栏 520→450→650、裁剪矩形不侵入邻栏、短标签留下拖动空白、单长标签窄→宽恢复以及五档 zoom。相关用例保留标签排序/键盘/关闭/中键/菜单和正文不拖动检查。首次 scoped 中两个旧 DRAG 选择器/焦点步骤失败保留在 green-scoped.log，修正后完整原断言通过。

完整 browser 首轮失败是旧 SURF 夹具仍把内部 role=tablist 视口当成整个标题表面；Git HEAD 已包含批准的矩形 ContentTabs 结构。本轮只把检查对象改为父 caption，严格固定 chrome / selected tab / 透明 viewport 颜色，验证实际 ::after 1px 底线，并恢复两枚真实工具的数量、中心和尺寸断言，没有修改产品颜色/底线。第二轮剩余 WCO-S04 的 compact 菜单检查失败，独立复跑同样失败，不能只称偶发。只读插桩证实旧 compact=true 快照与更新后 compact=false / 菜单不存在被两次异步查询混合；三帧后 capacity 与当前工具几何一致，250ms 后稳定。夹具在 appearance / padding 更新后等待三帧，把 compact 与菜单实际矩形/visibility 放在同次 evaluate 读取；compact 必须有可见菜单、工具数量与原生安全区全部断言仍保留。修正后的完整文件 10/10、独立 WCO-S04 1/1、最终完整 browser 253/253 通过，exit=0，无取消或跳过；前两轮失败日志保留。

完整核心 30 项失败涉及 worker 返回形状、Windows 文件/路径、冷源/迁移权限、打包平台/路径、旧 main 函数夹具等；另有 1 项取消、2 项跳过。本轮未修改这些产品或测试文件，未用跳过、删断言或宣称历史失败来抵消。逐项关联核查见独立验收审核。

类型检查 exit=0（最终夹具后 typecheck-settled.log，前次 typecheck-final.log 也保留）；Next 静态 UI 构建 exit=0（build-ui.log）；桌面 bundle 构建 exit=0（build-desktop.log）。产品构建后没有修改产品源文件。git diff --check 通过。

命令使用 Node 24.19.0 和本机 Chrome，浏览器与 Electron 子进程在允许的隔离测试执行环境中启动：

```text
node --import tsx --test --test-concurrency=1 tests/browser/ai-caption-drag.test.ts tests/browser/content-tabs.test.ts tests/browser/pane-window-drag.test.ts tests/unit/content-tabs-reorder.test.ts tests/unit/pane-window-drag.test.ts
node --import tsx --test --test-concurrency=1 tests/browser/workspace-surfaces.test.ts
node --import tsx --test --test-concurrency=2 --test-reporter=tap tests/browser/*.test.ts
node --import tsx --test --test-concurrency=2 --test-reporter=tap tests/unit/*.test.ts tests/integration/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
node scripts/build-desktop.mjs
```

## 真实 Windows 原生命中

`scripts/verify-ai-caption-drag.mjs` 仅观察真实 BrowserWindow 和 DOM；OS 输入来自 computer-use skill 的 sky API。每步从新截图定位，操作后读取 bounds / maximized / scrollLeft；Playwright 只用于标签选择和观测。新建合成 seed，bootstrap 核对隔离 dataRoot / 零模型，renderer 离线；没有读取、关闭或覆盖用户真实窗口与数据。隔离观察器已正常关闭，exit=0。

环境：Electron 44.6.0、Chromium 152.0.7977.130、运行时 Node 24.21.0、实际 OS scale=1.5、zoom=1。最终开发构建身份为 green/report.json 中 6 条源/入口 hash 和 177 条 out/dist JS/CSS/CJS 文件 hash，最终再次核对全部匹配（hash-verification.json）。177 条含 176 份正式产品资源和 1 份此前保留的 dist/root-startup-test-* 非产品测试产物；这份测试产物也匹配，但不作为产品资源或安装包证据，未删除其它任务的文件。

RED `red/report.json` 共 10 条原始观测。首标签且 scrollLeft=0 时，AI `[800,16]` 真实双击使 maximized=true；最后标签且 scrollLeft=540 时，相同点真实双击不再最大化。此时若干裁剪标签 no-drag 矩形位于 AI 标题内。该对比支持原生区域被裁剪外矩形遮挡的原因。

GREEN `green/report.json` 共 13 条原始观测，页面错误数组为空。系统鼠标将分割线 `[866,250]→[945,250]` 右移，AI 标题 right 从 863.86 变为 943.18，标签 scrollLeft 从 539.33 变为 618.67。之后如下原生双击均观察到最大化与复原：

| AI 标题位置 | 窗口相对坐标 | max / restore 标签 |
| --- | --- | --- |
| 右侧 | [900,16] | green-resized-right-native-max / restore |
| 左侧 | [420,16] | green-resized-left-native-max / restore |
| 中部 | [640,16] | green-resized-middle-native-max / restore |

normal bounds 均回到 `{x:180,y:160,width:1441,height:901}`；max bounds 为 `{x:-7,y:-7,width:2576,height:1408}`。最后可见 tab 的 `[1090,16]` 真实双击仍保留 normal bounds，没有错误触发最大化。这些是原生命中与双击证据，不与自动测试数量相加，也不等同于物理拖窗通过。

## 验收边界

sky.drag 在 RED 首标签正控、标题底部空白正控和 GREEN 修复位置均未改变 window bounds；相同驱动能够移动分割线。由于可拖位置正控也失败，不能据此得出修复后物理移窗通过或失败。随后用户按人工验证请求反馈“仍有位置无法拖动”，明确为图标周围及右边第一个字。人工实际反馈为失败，记录 manual-failed-investigating；此前自动化命中/浏览器通过不能覆盖该反馈。续方案/用例已追加消息纵向滚动候选，等待红测闭合后补修。

隔离窗口当前业务区仍显示章节加载失败、侧栏加载等待，标题显示真实 fallback“新会话”；本轮有限 DOM / 原生命中检查不升级为业务加载成功或真实长标题端到端验收。浏览器的真实组件合成长标题检查另外记录。没有执行多屏/DPI、吸附、macOS、NSIS 安装/升级或全业务验收，W04 正式状态仍为 planned。源修复及开发构建完成；全量验收与人工移窗不得标为全部通过。

## 第二阶段：图标及首字附近的消息滚动排除

用户重新启动后仍报告图标周围及第一个字附近不能拖动；当前开发 Electron 进程启动时间晚于第一阶段 UI/main 构建时间，没有以旧版本推测否定反馈。第二阶段不修改 ChatPanel JSX、消息数据、组件尺寸或业务事件，只补 desktop.css 的区域登记。

新增夹具通过 TypeScript AST 读取当前真实 ChatPanel 的根、标题、消息 host/scroller JSX，以及 ThinkingRow 函数，使用真实 Collapse 与 MentionPopup。数据全部合成，AI/后端主生命周期隔离；composer 与 fixed tooltip 明确是交互探针，不能作为完整输入框或悬停业务验收。05 用实际首字 DOM Range 与图标矩形定位，20 行消息滚动到第十行真实 ThinkingRow 按钮布局覆盖标题处；elementFromPoint 仍命中标题，证明控件视觉上已被裁剪。宽度 600→320→720、zoom 0.75/1/1.25/1.5/2 时检查稳定 host 位于标题下方、所有 no-drag 矩形不侵入标题。

有效 RED `message-red-final.log`：2 tests / 0 pass / 2 fail，05 在上述覆盖前置条件通过后因隐藏按钮矩形仍 no-drag 失败；06 完成真实 ThinkingRow 折叠、隔离 composer 点击与真实标题恢复按钮回调后，因 host/后代区域仍为旧分散登记失败。最初 `message-red.log` 另包含未等待 Collapse 异步卸载的夹具时序错误，保留但不作为有效 RED 统计。

产品修复让 `.chatpane > :not(.desktop-drag)` 稳定容器登记 no-drag，内部所有后代使用 initial 解除独立登记。标题根及其恢复按钮保持原 drag/no-drag。不能直接给整个 chatpane no-drag，也不能使用 Chromium 会规范化为 no-drag 的显式 none。

独立审核发现真实非portal MentionPopup 的 bottom-full listbox 可向上覆盖标题，需保留可见浮层根排除；泛化所有 tooltip 又会重登 StagedChips 常驻隐藏 absolute tooltip。最终仅恢复非caption 内 `[role=listbox]` 与 `[role=tooltip].fixed` 根 no-drag，内部滚动后代仍 initial。07 用真实 MentionPopup 证明覆盖标题、滚动裁剪选项不单独登记、onMouseDown 选中卸载；fixed tooltip 仅以隔离探针验证根排除和回调。`floating-red.log` 在根恢复前 1 test / 0 pass / 1 fail，真实 popup 覆盖标题前置成立、computed none 不符合 no-drag。

| 第二阶段执行 | tests | pass | fail | cancel / skip | 证据 |
| --- | ---: | ---: | ---: | --- | --- |
| 有效消息 RED | 2 | 0 | 2 | 0 / 0 | message-red-final.log |
| 浮层 RED | 1 | 0 | 1 | 0 / 0 | floating-red.log |
| 初步补修相关浏览器用例 | 8 | 8 | 0 | 0 / 0 | message-scoped-green.log |
| 最终新增消息及浮层用例 | 3 | 3 | 0 | 0 / 0 | message-green-final.log |
| 标签/窗口直接相关 unit | 6 | 6 | 0 | 0 / 0 | message-unit-related.log |
| 第二阶段完整 browser 第一轮 | 256 | 255 | 1 | 0 / 0 | message-browser-full.log |
| 真实标题层级夹具修正专项 | 5 | 5 | 0 | 0 / 0 | message-alignment-fixture.log |
| 第二阶段最终完整 browser | 256 | 256 | 0 | 0 / 0 | message-browser-settled.log |

独立子代理按最终 CSS 复跑 05/06/07：3/3，exit=0，无 fail/cancel/skip，duration=5650.6036ms；代码与用例审核无阻断发现。审核追加在本任务 test-review/code-review，第一阶段人工失败和浮层修复前状态仍保留。

最终类型检查 exit=0（message-typecheck-final.log）；静态 UI 与 Electron bundle 构建 exit=0（message-build-ui.log、message-build-desktop.log）。第二阶段构建身份另存 message-build-identity.json：6 项源/入口，177 份 out/dist JS/CSS/CJS（其中包含先前保留的 1 份非产品测试产物），编译后的 out/_next/static/chunks/27r22quautsd4.css 已含最终 ChatPanel 规则；desktop.css SHA256 为 379fe189a03a158b9fdfabdad05e2233886d1b3a97f7769764eeceae55dbb4fd。第一阶段 green/report 的 hash 只代表第一阶段，不冒充第二阶段原生执行身份。

核心完整执行仍沿用本任务第一阶段真实结果 1766 / 1733 pass / 30 fail / 1 cancelled / 2 skipped；补修仅 CSS，未为取得全绿修改失败核心用例或后端。最终请求用户保存、退出并重新启动，在有消息的会话滚动、右移分割线后复验图标、首字及附近物理拖窗。第二次人工回复为“这些位置都可以拖动”，记录 AIDRAG-WIN2 用户人工通过；不附虚构坐标/bounds/截图，也不将这条反馈推广为其它平台、安装包或完整 DPI 验收。第一阶段失败记录保留。

第二阶段完整 browser 第一轮 `message-browser-full.log` 为 256 tests / 255 pass / 1 fail、无 cancel/skip，exit=1。失败仅 ALIGN-03 最后所有标题按钮 no-drag 断言：caption-alignment 的隔离 ChatPanel 把真实 header 包进 `#chat-header.contents`，该包装是 noncaption 直属孩子，使新规则连真实 header 自身 drag 和恢复按钮一起 reset。真实 ChatPanel 标题直接在 chatpane 根下，没有这层。独立源核对确认后，只去掉夹具额外包装、把测试 id 加真实 header 根，两处高度 selector 同步改为 `#chat-header`；全部回调、尺寸/中心/高度、最后区域断言原样保留，产品不再修改。`message-alignment-fixture.log` 5/5、exit=0、无 cancel/skip；独立 ALIGN-03 复跑 1/1。夹具后类型检查 `message-typecheck-settled.log` exit=0。

最终完整 browser `message-browser-settled.log` 为 **256 tests / 256 pass / 0 fail / 0 cancel / 0 skip、exit=0、duration=159923.9727ms**，第一轮失败日志原样保留。第二阶段 identity 经独立复算所有 hash 为 0 mismatch，实际 out/dist 执行资源 177 条与清单无遗漏或多记，编译 CSS 确实包含 host、后代与两类浮层根三条规则。最终 `git diff --check` exit=0；`message-final-integrity.json` 复算 182 个不同文件 hash、0 mismatch（6 项源/入口与 177 资源共享 main entry，因此不同文件数为 182）。两台账 JSON 有效，HEAD 语义差异只涉及 root aiCaptionDragFix 与 W04 的 hook/testIds/开发证据，其它要求和业务迁移状态均未改变。

本次用户故障记录为 limited-windows-development-verified：原失败点人工通过、相关浏览器/unit、类型/构建和独立审核通过。完整 core 仍为上述失败结果，W04 正式 status=planned、fullAcceptancePassed=false；不声称完整项目、所有业务或安装包全量验收通过。第二阶段重建之后只修正测试夹具和记录，没有再次修改产品源，也未自动关闭或覆盖用户工作。
