# AI 标题栏拖动稳定性：独立技术审核

日期：2026-10-10（Asia/Shanghai）。审核范围：`2026-10-10-ai-caption-drag-plan.md`、真实 ChatPanel / ContentTabs / useContentTabStrip / desktop.css / DashboardShell 与 Electron 窗口入口。本审核只新增本文件；未修改产品和测试，未运行原生系统鼠标验收，也不声明全量用例或安装包通过。

结论：**按方案最后两段更正采用 `app-region:initial`，并将标签容量改为 caption 实际剩余空间后，技术方案通过。** 最初的显式 `none` 写法和只改 intrinsic viewport 的方案不能直接实施。最终原生命中结论仍须由主代理真实 Windows 隔离 Electron 的 RED / GREEN bounds 证据支持。

## 源依据与只读几何证据

- `ChatPanel.tsx:1658` 已将标题整行声明为 `desktop-drag`；标题 `span` 仅截断文字，不登记 no-drag。`desktop.css:5–6` 给父标题 drag，同时给全部 button / role=tab 登记 no-drag。再增加 AI 标题 drag 或重写原组件不能解决来自相邻区域的排除矩形。
- `ContentTabs.tsx:86–113` 的 viewport、track 和真实 tab 保留了滚动、指针与键盘行为。`desktop.css:32–34` 只对 viewport 做可视 `overflow:hidden`，track 宽为 max-content，tab 自身另登记 no-drag。`useContentTabStrip.ts:23–29,115–152` 在激活和尺寸改变后设置 scrollLeft 以显露当前标签。`DashboardShell.tsx:490–524` 的真实分栏改变 content 可用宽度，没有独立 app-region 裁剪处理。
- 通过离线 Chrome、内存 esbuild bundle 渲染**实际 ContentTabs 和 desktop.css**，使用隔离合成 8 个标签；业务正文模块仅用于隔离，不算正文业务验证。末标签激活、右栏 520px 时 viewport `[888,1138]`、宽 250px、scrollLeft=1079；早期 tab2–6 的 no-drag 布局矩形进入 AI `[230,880]`。其中 tab6 为 `[809.875,970.6875]`。分割线右移 70px 后 viewport 左缘=958、宽=180px、scrollLeft=1149，tab6 仍为上述布局区间，并覆盖扩宽后的 AI 右端；关闭按钮 `[944.6875,959.6875]` 也进入 AI `[230,950]`。激活首标签后 scrollLeft=0，越入 AI 的标签/按钮矩形为 0。此证据确认布局条件随激活和宽度变化，**不能单独证明 Electron 忽略祖先可视裁剪**。
- `desktop/main/index.ts:668` 的真实窗口使用 hidden title bar，Windows 才启用 titleBarOverlay；问题属于原生命中而非普通 DOM pointer handler。既有 `scripts/smoke-pane-window-drag.mjs` 只对指定 macOS fixture 和旧组件哈希进行观察，不能充抵本轮 Windows resize + overflow 回归。

## 两项已核实的必要更正

1. **解除后代区域必须使用 initial。** 已安装 Chrome 实测 `CSS.supports('app-region','none')` 为 true，但显式 `app-region:none` 的 computed 值为 `no-drag`；未声明时才为 `none`。真实组件内存注入同样得到 tab / close=`no-drag`，故原方案的显式 none 无效。改为 viewport 后代 `-webkit-app-region:initial; app-region:initial` 后，实际 tab 和关闭按钮 computed 均为 `none`，viewport 为 `no-drag`。规则须放在全局 button/role=tab 和 content-tab 规则之后并有足够 specificity，回归应断言真实 computed 值而非只检查源码字符串。
2. **容量不得取旧 viewport.clientWidth。** 采用真实 Tailwind globals.css 和 desktop.css，仅注入拟议 intrinsic viewport CSS 后，单长标签宽度序列实测为：caption 600 → 360 → 600px，viewport / tab 为 208 → 90 → 90px。窄过后因 `--content-tabs-viewport-width` 反过来限制自身 intrinsic 宽度而无法重新展开。内存替换 measure 为 `Math.max(0, available - tools.getBoundingClientRect().width - captionGap)` 后，同序列为 208 → 118 → 208px，容量变量为 358 → 118 → 358px；无需改标题或重建面板。这里 available 必须先扣 caption 两侧 padding，tools 用当前实际宽度，负值夹为 0。ResizeObserver / requestAnimationFrame 应负责菜单增删后的重新测量，并在回归中检查稳定后的值和无持续抖动。

## 实施与验收边界

- viewport `flex:0 1 auto;width:max-content;min-width:0` 允许其实际边界被剩余 flex 空间限制；tools `margin-left:auto` 把多余空白保留在父 caption 内。单短标签后空白仍需实测能拖窗；viewport 内标签间隙属于同一 no-drag 矩形。保持标题、窗控安全区、工具位置和原分栏，不把 AI 消息、输入框、workflow 状态行扩成 drag。
- viewport 的 no-drag 提供可见标签和关闭按钮的原生交互区域，子节点 initial 防止裁剪外布局矩形另行登记。真实系统仍须验证选择、关闭、中键、所有标签菜单、键盘和排序，不能只用浏览器点击来证明原生排除有效。
- 排序 ghost 是从 `.content-tab` 克隆并移到 body (`useContentTabStrip.ts:99–111`)，不受 viewport 后代 initial 规则影响；其短暂 no-drag 矩形位于指针处。方案允许排序期间的临时排除，但必须覆盖 Escape、lost capture、blur、resize、完成/卸载清理，证明移除 ghost 后 AI 标题命中恢复，不把 `pointer-events:none` 当成 app-region 排除无效的证据。
- 先 RED 再 GREEN：多标签首/中/末激活与滚动，真实分割线向右、向左，至少单长标签窄→宽、单短标签空白、零标签、zoom 变化。Windows 的 AI 左/中/右系统拖动应分别记录前后 BrowserWindow bounds；最终构建按同样场景复验。开发 CSS 注入、平台外观切换或浏览器几何只能用于调查，不能升级 W04 / 29 面板 / macOS / 最终安装包的真实验收状态。

审核使用只读 shell 执行内存 esbuild / headless Chrome；初次 sandbox 子进程报 EPERM，之后受控升级成功。仓库未生成浏览器 bundle 或测试 fixture 文件；本审核不保存真实作品、模型或 Key。

## 第二阶段方案审核（人工反馈仍失败后）

**续方案通过，可先建立新增回归并运行 RED；本审核不宣布问题已解决。** 用户人工失败位置为图标/首字附近，当前进程与新版开发构建对应且有大量消息。第一阶段及其 253/253 browser 不能覆盖此状态。主代理已将验证正文、requirements/migration（含 W04 development）和原 final-summary 的人工状态同步为 manual-failed-investigating；fullAcceptancePassed=false、W04 planned 均保留，符合实际反馈。

源依据支持检查 AI 自身纵向裁剪：ChatPanel:1752 是 overflow-y-auto 消息视口；ThinkingRow 左侧 button、旧式 WorkLine、CopyButton 与 Markdown a 均继续受 desktop.css:6 全局 no-drag 规则约束。ThinkingRow 横向覆盖图标/首字所在范围，纵向滚动可把布局矩形移入 caption；CopyButton opacity=0 也保留布局。这是待 RED / 实际命中验证的候选，不仅因用户描述就宣称根因已闭合。

ChatPanel:1656 根为正常列 flex；caption:1658 为固定 h-11/shrink-0。随后直属 workflow、恢复状态、消息 wrapper:1707（min-h-0/flex-1）及 composer:1811（有消息 shrink-0、空会话 flex-1/overflow-y-auto）在 caption 后方正常流。对 `.chatpane > :not(.desktop-drag)` 注册稳定 no-drag，再对其后代 initial，能同时解除消息、嵌套卡片、链接和空会话滚动后代的独立矩形，且无需改 overflow、尺寸、数据、组件或事件。

实施边界：不得把整个 chatpane 设 no-drag；不得 reset caption 或真实恢复按钮；reset 应使用已核实的 initial、真实 computed=none，并覆盖全局 button/a/role 等规则的 specificity。正常流的 bounded host 应实测 top>=caption.bottom 和非负尺寸；正文、输入和工作流仍由这些祖先排除。portal 菜单不在该后代范围，继续保留其原生交互排除。无需新增裁剪来隐藏真实控件。

隐藏 sidebar 仍挂载窗控的潜在相邻矩形、排序 ghost/菜单仍应观察，但当前侧栏可见，不能未经复现就扩大本轮根因或先改其它组件。续方案要求真实消息滚动、图标/首字坐标、分栏变化、标题恢复按钮、正文/输入交互与最终构建的人工拖窗，符合必要验证范围。第二阶段日志/hash 须另记，保留第一阶段失败；双击与物理拖动仍分开判定。
