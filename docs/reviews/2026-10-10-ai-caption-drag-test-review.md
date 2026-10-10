# AI 标题拖动回归：独立用例审核

日期：2026-10-10（Asia/Shanghai）。审核对象：`2026-10-10-ai-caption-drag-test-cases.md`、`tests/browser/ai-caption-drag.test.ts`，并只读检查 `tests/helpers/content-tabs-fixture.ts` 与既有 `content-tabs.test.ts` / `pane-window-drag.test.ts` 的互补范围。仅新增本审核文件；未修改产品、夹具或测试。

结论：**用例审核通过，可进入 TDD 实现。** 浏览器用例覆盖本轮两项必要 CSS 边界和容量反馈，原生命中仍由 AIDRAG-WIN 单独执行；浏览器样式和鼠标事件不算 Electron 原生验证。旧测试的 app-region 契约需要随设计修订，业务交互断言必须完整保留。

## 独立执行与 RED 证据

在产品 `desktop.css` / `useContentTabStrip.ts` 尚无 diff 时，实际执行：

```powershell
$env:XAANINK_TEST_CHROMIUM='C:\Program Files\Google\Chrome\Application\chrome.exe'
node --import tsx --test --test-concurrency=1 tests/browser/ai-caption-drag.test.ts
```

结果 exit=1、3 tests、1 pass / 2 fail、0 skip / cancel。AIDRAG-01 失败于 `Clipped no-drag boxes must not invade the AI caption`，实际越界包含 role=tab、content-tab-close、图标及标题后代；AIDRAG-02 失败于 viewport / 单个标签宽度差断言，符合旧 viewport flex:1 占满空白的行为；AIDRAG-03 通过。没有浏览器启动或 `__name` 夹具错误。本次只读 RED 与主代理随后保存的正式 RED 记录分别保留，不以最初夹具故障算产品 RED。

AIDRAG-03 在旧 CSS 下通过是合理的：宽度锁定由拟议 intrinsic viewport 与旧容量变量互相依赖共同引入。它阻止“只改 viewport CSS、未改 measure”这种不完整修复；技术审核的内存原型已证明这种中间方案 600→360→600px 时标签宽度为 208→90→90px，而容量更正后恢复 208→118→208px。

## 覆盖有效性

- AIDRAG-01 使用实际 ContentTabs / hook / Tailwind 与桌面 CSS；20 标签覆盖首、中、末激活，520→450→650px 模拟可用宽度变化。末项必须具有 scrollLeft>0；扫描标题 y 区间内所有 computed no-drag 元素，要求排除矩形不越 pane 边界，并要求 viewport 本身 no-drag / 全部后代 none。这两类断言会同时捕捉滚动越界及显式 authored none 实际仍 no-drag 的错误。
- AIDRAG-02 用单短标签确认 viewport 紧包标签、剩余空白>80px、空白真实 DOM hit 属父 caption 且 computed drag，避免将整个剩余条设为 no-drag。仍点击 / Enter 激活 / 关闭真实标签；fixture 的 t0 类型是 chapter-content，因此关闭名保留“· 正文”符合实际命名。
- AIDRAG-03 在支持的 .75 / 1 / 1.25 / 1.5 / 2 缩放，验证单长标签窄→宽后恢复 208 DIP，且比窄态大至少 5px。该专项使用 font=14；字体 11 / 14 / 24 和字体指标变化由既有 TABS-04/05 覆盖，两者不能混称本专项已验证所有字体组合。
- AIDRAG-04 保留既有点击、中键、关闭、横向滚动、active/focus reveal、菜单与紧凑工具、排序 / 自动滚动 / 取消、ghost 清理、真实全局命令捕获和夹具实例/草稿状态断言。这些检查有效，但夹具正文不是 29 面板或 Monaco 的真实业务通过证据。
- AIDRAG-WIN 明确真实 Electron / 隔离数据根 / 合成有标题会话 / 零模型 / 离线条件，要求分割线左右变化和 AI 左中右 bounds 观测，覆盖可见标签、关闭/工具、单标签空白。最终编译 bundle 必须复验；调查 CSS 注入不算 GREEN。

## 验收记录要求

1. 实现后不能仅用 AIDRAG-01 成功来宣布用户问题已解决。Electron app-region 是否受祖先裁剪影响属于原生命中，必须记录真实系统坐标、窗口正常态、前后 bounds 和截图。
2. 系统鼠标驱动应先在可靠标题点得到正向拖窗对照；若原本可拖区域也无法改变 bounds，需区分驱动局限与产品失败。双击最大化/还原可提供命中差异证据，但不自动替代物理拖动通过。
3. ghost 移除后的静态标题命中恢复由原生步骤补证；浏览器 cancel / ghost 清理不得写为 OS 事件全部通过。完整 core/browser/typecheck/build 和平台未执行范围据实记录。

初次环境默认 Playwright Chromium/headless 文件缺失；本审核使用已安装 Chrome。无需下载浏览器，也没有生成含真实用户数据的证据。

## 第二阶段新增用例审核

已独立读取 test-cases 的 AIDRAG-05 / 06 / WIN2 和续方案。**新增设计通过，可建立真实源 AST 夹具并先运行 RED；以下条件须落实到测试代码再复核。** 尚未执行新增 RED/GREEN，不把设计通过写为产品通过。

- AIDRAG-05 必须从当前源提取真实 ThinkingRow、header 及消息 wrapper/scroller，提取失败显式报错；不能只渲染一个人工编写的 no-drag button 来充抵。20 条合成消息和第 10 行提供足够滚动距离；须实际断言 scrollTop>0、目标按钮矩形进入 caption y 区间，与实际 MessageSquare 及标题首字的 x 范围相交。首字可用真实文本 Range，不能把整个 flex span 宽度当首字。另检查目标被正文视口裁剪，实际 elementFromPoint 仍在 caption，避免“按钮本来可见地盖住标题”的错误夹具。
- 05 的“任何 no-drag 不得侵入标题”应明确使用 sidebarHidden=false/contentHidden=false（无合法恢复按钮），或只扫描非caption范围。不能把 06 必须保留的合法 caption 恢复按钮判为越界。需要检查 bounded host top>=caption.bottom、尺寸非负、host computed=no-drag、范围内全部后代 computed=none；否则全局 none/initial 错误或直接取消全部排除也可能混过。600→320→720 与五档 zoom 是组件宽度压力回归，不混称真实 DashboardShell 所有最小宽度组合。
- AIDRAG-06 在按钮尚处正文 viewport 可见范围时操作真实 ThinkingRow 展开/关闭，并检查折叠内容状态，证明 reset 未破坏鼠标交互。正文/输入需验证由实际 noncaption 祖先排除；真正 caption 恢复按钮须仍是 no-drag，并实际触发各自回调。不得为了 05 变绿删除这些按钮、只看回调函数源码或给它们隐藏样式。若输入区是隔离片段，应明确真实 wrapper 与夹具边界，不声称完整 composer 业务通过。
- AIDRAG-WIN2 对最终第二阶段构建及人工原失败点重复检查，包含右移分割线、消息历史滚动与其它标题点。人工仍失败就保留 investigating，不以浏览器全过/双击通过代替。第一阶段 13 条开发原生观察和旧 hash 不能直接标成第二阶段最终证据。

既有 AIDRAG-01–04、ContentTabs/窗控/完整 browser 和类型构建继续执行，必要夹具时序修订保留全部功能断言。核心未通过与其它平台/安装/业务范围仍据实保留。

## 第二阶段测试实现与有效 RED 复核

已只读审核 `tests/browser/ai-caption-message-drag.test.ts` 全源及两次原始日志。**测试实现审核通过，无阻断发现。** AST 从当前 ChatPanel 提取 root/header、实际消息 host/scroller 的 opening JSX、完整 ThinkingRow 函数和计时阈值；缺任一项直接报错。真实 Collapse、duration、cn、icons 与 React 状态继续运行；消息数据及无关 AI/恢复生命周期隔离，composer 明确为交互 probe，未声称完整 ChatPanel/composer 业务验收。

05 关闭两类恢复按钮，在五档 zoom 与 600→320→720 的组合中将第 10 个真实 ThinkingRow 滚到 y≈8，先检查 scrollTop>0、按钮与 caption y/实际图标 x/真实文本首字 Range x 相交、elementFromPoint 仍命中 caption、非负正文 host 完全在 caption 下方，再断言全体注册矩形无侵入、host no-drag、button/后代 computed none。没有用整个标题 span 冒充首字，没有以合法恢复按钮制造假红，也没有把可见浮层按钮当裁剪侵入。

06 真实点击首行 ThinkingRow，等待 Collapse 文本实际 visible/hidden，再点击隔离 composer probe 和两个真实 header 恢复按钮；后者仍须 computed no-drag，并严格检查三次回调顺序。最后验证 composer host / button / contenteditable = no-drag / none / none，确认内部解除独立注册时仍保留稳定祖先排除。

`message-red-final.log` 有效结果为 2 tests / 0 pass / 2 fail / 0 cancelled / 0 skipped：05 所有前置几何条件先通过，在 width=600 / zoom=.75 的 `Clipped body control invaded caption` 断言失败，实际包含 ThinkingRow button 等 no-drag 后代；06 已完成 Collapse 和所有回调检查，再于区域断言得到 none / no-drag / no-drag 而非预期祖先与后代契约。两项均是目标契约失败，没有启动/AST/__name 错误。初次 `message-red.log` 的 06 未等待 Collapse 动画而失败，保留但不计该项有效 RED。

独立执行同一测试文件时，主代理已按通过方案加入第二阶段 ChatPanel CSS，所以本审核实际获得的是 **GREEN 2/2、exit=0、0 cancel/skip**，duration=3820.9228ms；不倒写为独立 RED，也不重复加到完整 browser 总数。当时 desktop.css SHA256 为 `5d51744db3d7978115abaf54709b2e253734a0ec008e8b24b4128eb359c551f0`。这次执行独立证明新增全部组合与交互断言能运行，不代表用户实际移窗或最终开发 bundle 验收通过。

## AIDRAG-07 与三项最终独立执行

已审核新增 AIDRAG-07 及 floating-red.log / message-green-final.log。**新增浮层测试审核通过。** 使用真实 MentionPopup 及 20 个合成候选，确认其 listbox 根确实跨 caption、根 computed=no-drag、所有内部后代 computed=none；列表滚到末尾后显式确认 scrollTop>0 和首个隐藏按钮布局 top<caption.top，再通过真实 option 的 onMouseDown 选择末项。固定 tooltip 是明确标识的隔离 probe，检查其根排除及按钮回调，没有称其为完整 EntityHoverCard/ComposerChipHoverCard 业务测试。

测试严格检查浮层动作与 mention:probe-19 的调用顺序，真实选项触发状态卸载后 listbox 和 fixed probe 数量都为 0，caption 仍 computed=drag。AIDRAG-05/06 的真实源、几何前置、恢复按钮、Collapse 和 composer probe 断言未削弱。无恢复按钮的 05 继续在正常静态状态扫描全 caption 侵入，因此 07 的可见浮层合法排除没有混作静态泄漏。

floating-red.log 中筛选执行的 07 为 1 test / 0 pass / 1 fail / 0 cancel/skip，先通过跨 caption 前置，再失败于 listbox 根 none != no-drag，是所需浮层区域回归，不是夹具加载失败。主代理最终三项日志 3/3、0 fail/cancel/skip。

独立再次执行当前完整文件，得到 **3 tests / 3 pass / 0 fail / 0 cancelled / 0 skipped、exit=0**，duration=5650.6036ms。当前 desktop.css SHA256 为 `379fe189a03a158b9fdfabdad05e2233886d1b3a97f7769764eeceae55dbb4fd`。执行未修改产品或测试。真实 ChatPanel 主生命周期没有被夹具挂载；这些证据仅支持源片段/真实 ThinkingRow/MentionPopup 的布局与交互契约，不能替代业务加载、最终 bundle 或原生物理拖动验收。
