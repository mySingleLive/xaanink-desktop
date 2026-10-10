# AI 标题拖动稳定性：独立验收证据审核

日期：2026-10-10（Asia/Shanghai）。只读审核当前产品、修订测试、原始日志、Windows observer、验证文档与两份台账；仅新增本审核文件，未修改产品或测试。审核不把开发构建、原生命中、全量或人工物理拖窗互相替代。

结论：**实现及目前有限证据记录可信；物理移窗和完整正式验收仍未通过。** 修复后专项 26/26、修订 SURF 7/7 与 compact 夹具 10/10 的日志支持各自有限范围。完整 browser 已记录前两轮失败，第三轮待主代理完成并据实更新；核心完整回归仍为 1766 tests / 1733 pass / 30 fail / 1 cancelled / 2 skipped。W04 的正式 planned、fullAcceptancePassed=false 与物理移窗 pending 必须保留。

## SURF 最小修订复核

已读取 `tests/browser/workspace-surfaces.test.ts` 最终 diff。SURF-01 改读真实父 `.content-tabs-caption`，严格使用最新批准 chrome 的 paper.sidebar 固定色，同时新增 viewport 透明和选中 tab=paper.content，其他 AI、业务、Monaco CSS probe、设置与全局 token 固定色断言保留。

equalLines 保留普通 UI 与分栏 border 比较，单独验证真实 caption `::after` 的 content 非 none、height=1px、bottom / left / right=0、backgroundColor=paper.border；这是已批准独立连续底线，不再检查不存在的 viewport border。44 DIP 行改父 caption，真实工具通过 `.content-tabs-tools > button` 被中心/尺寸检查覆盖，并严格断言右栏工具数量为 2，避免空集合静默通过。没有修改产品颜色/底线，未弱化批准颜色或 1px 要求。新增 position / pointer-events / width 等可进一步强化，但不是本次现有批准断言失效的必要修复。

`surface-fixture-green.log` 为 7/7、exit=0；第二轮完整 browser 的 SURF 七项也均通过。前一轮 SURF 两项失败仍在 `browser-full.log`，未覆盖为通过。此前 HEAD 已有 caption / viewport 分离，而 ContentTabs 上轮只做专项不做全量，因此这属于未随结构升级的测试对象错误，不靠泛称历史失败排除。

## WCO-S04 独立时序调查与修订核验

`browser-full-final.log` 中唯一失败为 WCO-S04，在 `empty-content-hide.test.ts:167` 的 compact 菜单可见断言。第一轮该项通过，第二轮失败。不能仅凭这一次差异判断偶发；独立使用 Node 24.19.0 和本机 Chrome、未经修改的 TSX 用例按 WCO-S04 名称筛选重跑，确实同句失败、exit=1。

源依据：测试每轮设置 appearance / 原生安全 padding 后立刻调用 railSafe；产品尺寸变化经 ResizeObserver → requestAnimationFrame measure → React 工具重新渲染完成。原 railSafe 先异步读取 compact 快照，随后在另一次异步 isVisible 读取菜单，可能混合前后两个状态。

为取得实证，未改测试文件，运行原 TSX 并仅在 Playwright 菜单 `isVisible` 返回 false 时追加只读观测。原断言进入分支说明此前快照 g.compact=true；失败时的真实 DOM 则是 compact=false、菜单不存在。具体捕获：

| 时点 | pane / zoom / font | compact / 菜单 | capacity / 实际剩余容量 | viewport / tab |
| --- | --- | --- | --- | --- |
| 原 isVisible=false 时 | 280px / 1 / 11（root 12.5714px） | false / 无 | 66px / 38px | 38px / 66px |
| 之后三帧 | 同上 | false / 无 | 38px / 38px | 38px / 38px |
| 再等 250ms | 同上 | false / 无 | 38px / 38px | 38px / 38px |

另一捕获为 root font 16px，同样 g 的旧 compact=true 与当前 DOM false 相冲突。两次内存重编译诊断因执行时序改变而通过；它们不计正式 GREEN。原 TSX 的真实失败观测证明跨异步旧/新状态混读，三帧与 250ms 观测则未显示该组合的稳定容量或工具布局缺陷，不能把瞬态变量当成已证实的稳定产品错误，也不能推导任意组合皆稳定。

主代理最终只修 railSafe：先等三帧，然后在同一次 evaluate 返回 compact、所有标签菜单的非零 rect 与 visibility，compact 仍严格要求实际可见；工具数量、原生 menu/caption 安全间距、容量足够时的 pane containment 全保留。等待有明确 RO/RAF/React 路径依据，没有 retry 吞失败、只等到预期值再无条件通过或跳过产品状态。该修订符合最小夹具修复。

独立运行修订后相同命令：

```powershell
$env:XAANINK_TEST_CHROMIUM='C:\Program Files\Google\Chrome\Application\chrome.exe'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --import tsx --test --test-name-pattern='WCO-S04' tests/browser/empty-content-hide.test.ts
```

结果 1 test / 1 pass / 0 fail / cancel / skip、exit=0，WCO-S04 耗时约 18s。主代理随后保存的整个文件 `caption-fixture-green.log` 为 10/10。两项不是不同功能重复计数，独立单项复核不加到完整 browser 总数。

## 完整核心失败的具体关联边界

已读取 `core-full.log` 的全部 31 条 not-ok 和总计、对应测试 imports / 断言与必要的后端源片段。当前实际产品 diff 仅 `src/app/desktop.css` 与 `src/components/layout/useContentTabStrip.ts`；以下失败测试不执行这两个文件。故没有源调用链或失败堆栈支持把这些核心失败归因于本轮 caption CSS/容量修复；但本轮没有针对每一项跑修改前/后的后端对照，**不能声称它们全部已证明是历史失败、环境误报或已修复**。

| 文件与具体失败 | 日志实证与关联判断 |
| --- | --- |
| `tests/integration/desktop-worker.test.ts` IPC-01 | 返回 `novels:[]` 另含 `unavailableWorks:[]`，旧 exact 形状断言失败。运行 worker/local handlers，与 viewport CSS/strip hook 无调用关系。 |
| `tests/unit/application-cold-source-104-review.test.ts` AR104-C01/02/03/04；`tests/unit/application-cold-source.test.ts` AC36-20/01/02/06、07 的 source/copy/receipt/unknown-source、08 的 owner/cold/lock、13、14 的 data/inbox-global、15/16/17 | 合计 20 fail + 1 timeout/cancel。直接异常堆栈指向 `desktop/core/application-cold-source.ts` 同步 walk 的 UNREADABLE；其他项是 destination/proof 未产生、guard 计数/changed 标志不符或 10s 超时。walk:151–155 读取目录 mode 的 POSIX read/execute 位，提示 Windows 权限契约需专门审查；相关断言失败是否全部由此前置拒绝导致尚未逐项闭合。不能用 UI 修复或 skip 抵消冷源/权限安全测试。 |
| `tests/unit/application-metadata-flight-105-review.test.ts` AR105-G02 | 生成的动态 import 使用 Windows `D:` 绝对路径，Node ESM 拒绝 protocol d，实际尚未到目标 writer/rejection 断言。测试 source:15 直接 JSON.stringify(join(...)) 支持此定位，与 CSS/hook 无关。 |
| `tests/unit/avatar-assets.test.ts` AVATAR-10 | symlink 资产读取的 ASSET_READ_FAILED 预期未拒绝；堆栈在 source:152。是实际资产安全断言失败，未在本轮证明根因/修复，不泛称平台噪声。 |
| `tests/unit/draft-journal.test.ts` durable drafts | mode & 0777 实际 438（0666），预期 384（0600）；source:12 的 POSIX 模式断言，与 UI 无关。是否按 Windows ACL 重写验收需单独授权范围与验证，不能在本轮降级后算通过。 |
| `tests/unit/macos-menu-bundle-119-review.test.ts` MB119-N04 | 预期 Info.plist/CFBundleName 错误，实际当前 inspector 明确拒绝 Windows 静态 app 验包；不是本轮 CSS 造成的资源错误，也不是 macOS 验包通过。 |
| `tests/unit/packaging-config.test.ts` 本地 Electron 预检 | POSIX `/node_modules/electron/dist$` regex 与实际 Windows 反斜线路径不匹配。平台路径断言在 builder 前失败，不是 caption 代码失败。 |
| `tests/unit/root-maintenance-main-review.test.ts` M71-10 | 提取/eval 的 createWindow 执行时 `installWindowsCloseAccent is not defined`；属于 main 函数夹具依赖/平台分支问题，未验证真实 main 重开流程成功。 |
| `tests/unit/root-relocation-window.test.ts` RW33-01 / RW33-04 | 前者 `/preload/root-relocation.cjs$` 与实际反斜线路径不符；后者实际报 RELOCATION_COMMAND_NOT_COMPLETED，尚未闭合，不把两者共同简写为 regex 问题。 |
| `tests/unit/root-startup-main.test.ts` canonical root startup | `/chosen/canonical-root/session` 与实际 `\chosen\canonical-root\session` 深比较不符；startup/path 夹具不执行 UI CSS/hook。 |

两项 skip 也保留：AC36-04 特殊 managed FIFO；WA57-10 POSIX permission failure 明示 Windows ACL 验收另行进行。以上逐项记录解释关联范围，不让 1733 pass 掩盖 30 fail / 1 cancel / 2 skip，也不在本轮实施无关后端修复。

## Windows 观测、构建身份与台账复核

已独立读取最终 green/report.json 的 13 条观测、输入坐标、bounds/maximized、errors=[] 与 completedAt；三组右/左/中双击分别真实最大化后回到原 normal bounds，可见 tab 的双击仍 normal。实际查看 green/5.png 与 green/12.png：标题显示 fallback“新会话”，侧栏仍加载、正文显示“章节加载失败，请稍后重试”，与主代理限制说明一致，不把这些截图认定为业务加载成功或真实长标题端到端通过。

最终开发构建 hash-verification.json 为 6 份源/入口 + 177 份实际 css/js/cjs 文件、mismatches=[]；此前独立重算全部一致。另独立核对新增 productResourceCount=176 与 retainedNonProductTestArtifacts：其中 1 条是 `dist/root-startup-test-6ec87fdc-7ab8-446f-980c-f9d940ed66f9/index.cjs`，与原报告实际登记名称一致。主代理验证文档和 requirements buildIdentity 已明确 176 产品资源 / 1 非产品旧测试产物，未将旧产物算成产品或安装包证据，也未删除其他任务文件。身份一致性、三处原生命中/双击和真实分割线右移可计入本轮有限开发证据；sky.drag 在已知正控也不移动窗口，物理移窗证据仍缺，不能按旧“脚本正常退出”或原生双击代替。没有实测 macOS、安装/升级、多屏DPI、吸附或 29 类业务功能。

已审 `2026-10-10-ai-caption-drag-verification.md`、requirements-traceability / migration-map 的 aiCaptionDragFix，当前均准确记录第二轮 browser 252/253、核心 1733/1766、physical drag pending、fullAcceptancePassed=false，并保留 W04 正式 planned；没有升级全业务或其它平台状态。主代理后续若完成第三轮 browser，应追加实际日志、更新最终计数与本审核后续段，不能覆盖前两轮失败。用户人工确认未收到时 pending 继续保留。

## 最终完整回归及台账终审

本段更新上文“第三轮待完成”状态，保留此前两轮失败及其调查过程。已只读核对 `browser-full-settled.log` 最终 TAP：253 tests / 253 pass / 0 fail / 0 cancelled / 0 skipped，duration=156313.7786ms；主代理命令结果 exit=0。验证文档新增第三轮表行，第一轮 251/253、第二轮 252/253 及原日志仍保留。`typecheck-settled.log` 无诊断，主代理命令结果 exit=0；独立执行 `git diff --check` 也为 exit=0。

独立解析最终 browser 和 core TAP，并逐字段比对 `final-summary.json` 与两份台账 aiCaptionDragFix 的 tests / pass / fail / cancelled / skipped，全部一致。核心结果仍为 1766 / 1733 / 30 / 1 / 2，没有被最终 browser 全过覆盖。汇总的 Windows 13 条观测、0 page errors 与原始 green/report.json 一致。独立再次重算其 6 份源/入口和 177 份实际资源的全部 183 条 hash 记录，0 mismatch；因 `dist/main/index.cjs` 同时属于源/入口与资源清单，对应 182 个不同文件。正式产品资源仍为 176，另 1 份保留的非产品旧测试产物仍明确列出；这些身份检查没有升级为安装包验证。

再次核对 requirements 的 W04 正式 status=planned、两份台账 fullAcceptancePassed=false、status=implemented-physical-drag-pending；requirements 的 physicalWindowDrag 与最终汇总 physicalWindowDragging 均继续 pending。验证文档保留正控物理移窗失败、隔离业务加载失败、其它平台/安装/多屏DPI未验收的具体限制。最终更新与证据边界相符。

最终完整 browser 已通过，技术实现、功能保留和记录一致性在上述有限范围内审核完成；这些结果没有证明人工实际移窗成功。后续实际反馈以如下段落为准。

## 人工实际失败反馈与继续调查

终审之后用户人工反馈：重新启动并右移分割线后“仍有位置无法拖动”。**当前修复尚未解决用户报告的问题，不能结束为通过，也不能继续用“等待人工确认”描述已收到的失败反馈。** 撤回无需进一步修改的结论，进入 manual-failed-investigating。产品/测试是否需新增修改取决于下一步定位，不能凭重启、版本猜测或此前双击最大化证据推翻用户实际反馈。

此前 253/253 browser、13 条有限原生观测与 hash 结果继续保留为各自范围的证据；实际 drag 与双击是不同交互，现有 driver 的拖窗正控也失败，双击成功只能支持所测坐标的原生命中。fullAcceptancePassed=false 和 W04 planned 仍需保留。继续只读检查 AI 自身及其它滚动/隐藏后代的排除矩形、菜单/ghost/native overlay，待具体失败位置与真实运行身份补齐后再形成可复现根因。

主代理随后传达用户具体位置：AI 标题左侧图标周围及右边第一个字附近；主代理核对当前 dev Electron 的启动时间晚于本轮 out/main 构建，实际页面有长标题、大量消息且侧栏/内容加载。该身份与状态信息不包含用户正文，不以版本不明排除反馈。

只读新增源依据：`desktop.css:6` 全局把 button / a / role=button 等注册为 no-drag；`ChatPanel.tsx:1752` 的真实消息区纵向滚动，消息后代注册矩形仍可能与旧 tab 一样越出视觉裁剪。`UserMessage:288–291` 与 `AssistantMessage:669–672` 的 CopyButton 即使 opacity=0 仍有按钮布局；`ThinkingRow:445`、ThinkingPlaceholder 的左侧按钮及 `AssistantMessage:681–709` 的 WorkLine 可以覆盖图标/首字所在横向区间，Markdown 链接同样受全局 a 规则影响。分栏变化会改变文本折行与这些纵向布局位置。当前修复只解除右侧 viewport 后代，没有处理这些 AI 后代。此处是有源依据的待复现候选，尚未把用户具体失败点与某一消息节点相交证据闭合。

独立重查现有 green/report.json 的 13 组全体 no-drag 记录，其非零布局矩形与每组 AI header 矩形的相交集合均为空；此结论只适用于此前未正常加载业务的隔离状态，不能反证用户大量真实消息滚动时的失败。caption 自身 MessageSquare 与标题 span 没有按钮/交互角色；真实恢复按钮仅在 sidebar/content 隐藏时存在，应继续排除拖动。WindowsMenuControl 的 fixed 区位于原生右侧控件前，native-close-accent 仅右侧 46 DIP 且 setIgnoreMouseEvents(true)；没有这些源节点遮住目前左侧失败点的实证。Tab ghost 是独立 body 下的 fixed no-drag 节点，结束/Escape会移除；caption ::after 仅底部 1px，pointer-events:none，均不是目前已确认根因。

续方案可采用 `.chatpane > :not(.desktop-drag)` 的稳定 bounded no-drag，范围内后代 initial；不能把整个 chatpane 设 no-drag，不能解除真实 caption 恢复按钮。源中 caption 为 h-11/shrink-0，workflow、恢复状态、min-h-0 消息 wrapper、有消息 shrink-0/空会话 flex-1 的 composer 作为后续正常流直属孩子，这一范围能覆盖消息、嵌套卡片与空会话 composer，且无需新增 overflow/尺寸或复制真实组件。须以实际组件消息滚动、原生命中和用户人工移窗验证闭合，不把新增 CSS 直接记为通过。另隐藏 sidebar 时仍挂载其内容，旧 SidebarWindowControls 交互矩形也应在回归中检查；当前用户侧栏可见，因此只记潜在同类状态，不归因为这次左侧失败。

续方案/用例审核时再次只读核对：verification 正文已明确收到实际失败；requirements/migration 顶层 aiCaptionDragFix、W04 development 及原 final-summary 已同步 manual-failed-investigating，fullAcceptancePassed=false 与 W04 planned 保留。第一阶段成功计数仍为其原日志有限证据，未伪改为第二阶段或人工成功。第二阶段方案及新增用例设计审核另追加于相应 plan-review / test-review，新增测试实现、RED 和后续证据仍待执行。

## 第二阶段最终有限验收终审

本段更新前述 manual-failed-investigating 状态，保留第一阶段人工失败与全部原始记录。第二阶段补修真实 ChatPanel 正文的稳定 no-drag 容器、解除滚动后代注册，并为跨标题的 listbox / fixed tooltip 保留根排除；有效 RED 分别为消息两项目标 region 失败和浮层一项目标 region 失败。最终三项消息用例已独立复跑 3/3，通过实际 ThinkingRow、消息滚动和真实 MentionPopup；完整 ChatPanel 生命周期及隔离 composer / tooltip probe 的范围限制继续保留。用户在第二次重启、滚动真实消息并右移分割线后明确回复“这些位置都可以拖动”，对应原图标、首字及周围位置的人工实际移窗通过；没有将第一阶段双击观测升级为第二阶段自动物理拖窗，也没有虚构新坐标、窗口 bounds 或截图。

已核对第一轮第二阶段完整 browser 为 256/255，唯一 ALIGN-03 失败来自夹具额外 display:contents 包装把真实 caption 置于非 caption 直属孩子内部。最终修订仅去掉包装、把 id 放到真实 header 根并同步高度选择器，全部按钮区域、尺寸与回调断言保留；专项 5/5，独立 ALIGN-03 1/1 通过。最终 `message-browser-settled.log` TAP 为 **256 tests / 256 pass / 0 fail / 0 cancelled / 0 skipped**，duration=159923.9727ms，主代理命令结果 exit=0。`message-typecheck-settled.log` 无诊断、命令结果 exit=0；UI 与 desktop 重建日志及命令结果均成功。独立 `git diff --check` 为 exit=0。无需扩大复跑或追加产品/测试修改。

当前第二阶段 `message-build-identity.json` 的 6 份源/入口与 177 份实际 JS/CSS/CJS 资源共对应 182 个不同文件，独立重算全部 0 mismatch，实际资源枚举与登记清单完整一致；其中 176 份产品资源、1 份保留的非产品旧 root-startup 测试产物，未计作安装包验收。当前 CSS SHA-256 为 `379fe189a03a158b9fdfabdad05e2233886d1b3a97f7769764eeceae55dbb4fd`，编译资源包含正文根 no-drag、后代 initial、listbox / fixed tooltip 根 no-drag 三条规则。`message-final-integrity.json` 的 182 distinct / 0 mismatch 与独立结果一致；第一阶段 native / hash 证据仅保留在历史阶段，没有冒充当前构建验证。

已独立解析最终 browser 与已有 core TAP，并逐字段核对 `message-final-summary.json`、两份台账当前 aiCaptionDragFix 及 secondStage：当前 browser 256/256、构建身份与人工反馈一致，旧 `final-summary.json` 已标历史并指向新报告，首轮 256/255 和第一阶段失败记录保留。核心全量仍是 **1766 tests / 1733 pass / 30 fail / 1 cancelled / 2 skipped**，第二阶段未重跑或修复该组；上文全部 31 条 not-ok 及其具体关联边界继续有效，不能称全项目通过。两台账及 W04 development 为 limited-windows-development-verified；current physical=user-manual-passed，automatedPhysicalWindowDragPassed=false。独立 HEAD 语义比较确认其他要求与 29 类业务迁移状态未变，W04 只追加本轮 hook / 用例 / development 记录，正式 status 仍为 **planned**，两台账及最终汇总 **fullAcceptancePassed=false**。

终审结论：用户报告的原位置拖动问题已有第二阶段人工成功及对应自动回归支持，当前有限 Windows 开发修复范围内无交付阻断，无需进一步产品或测试改动。该结论不升级为核心全量、W04 正式验收、安装/升级、macOS、多屏 DPI 或全部业务验收通过。
