# AI 标题拖动稳定性：独立代码审核

日期：2026-10-10（Asia/Shanghai）。仅新增本文件；未修改产品、夹具、测试或观察脚本。审核当前工作区 diff 与 `scripts/verify-ai-caption-drag.mjs`，保留其他人修改。

结论：**代码审核通过，未发现本次实现中须阻塞合入的产品缺陷。** 此结论只覆盖代码与下面实际运行的浏览器检查；全量、构建和真实 Windows 系统鼠标验收由主代理组合记录，未执行/驱动无法得到可靠正控的步骤不能写为通过。

## 实现核对

- `src/app/desktop.css` 将 `.content-tabs-viewport` 改为 `flex:0 1 auto;width:max-content;min-width:0` 并独占 no-drag。宽度被真实 caption 剩余空间约束，track 仍 max-content / 保留局部滚动。追加的 `.content-tabs-viewport *` 同时重置 prefixed / 标准属性为 initial，位于全局 button / role=tab 及 `.content-tab` 的 no-drag 声明之后，实际后代 computed 为 none。未把 authored none 当成解除区域的值。
- tools 增加 margin-left:auto，剩余空白由父 desktop-drag caption 接受原生命中。标题高度、标签尺寸、原生工具与安全区、真实 ChatPanel / ContentTabs / 分栏及正文挂载方式保持原实现。
- `useContentTabStrip.ts:127–137` 将容量来源改为 caption 扣两侧 padding 后的 available，再减当前实际 tools 矩形宽度与 caption gap，并夹为 0；不再由 intrinsic viewport 旧宽反向限制自身。现有 ResizeObserver 和 requestAnimationFrame 继续监听 viewport / track / caption，菜单增删后会再次测量。overflow / compact 原判定、激活/焦点显露、滚动、排序和清理没有被移除。
- ghost 从 tab 克隆到 body，不匹配 viewport 后代 reset，保留短暂 no-drag；不会把浏览器 pointer-events:none 错当成原生区域自动失效。原来的 finish / Escape / capture / blur / resize 清理继续保留；静态排除恢复仍需原生步骤验证。

## 独立运行的针对性检查

只读使用实际 `tests/helpers/content-tabs-fixture.ts` 与已安装 Chrome，执行内存脚本，使用合成短标题并阻断网络：

| caption 可用布局宽度 | viewport 实际宽度 | capacity 变量 | 标签之后空白 | 标签 computed |
| --- | ---: | ---: | ---: | --- |
| 700px，3 个短标签 | 322.171875px | 458px | 139.828125px | 全部 none |
| 350px | 80px | 80px | 4px | 全部 none |
| 再到 700px | 322.171875px | 458px | 139.828125px | 全部 none |

两次宽栏的空白 `elementFromPoint` 均命中 `desktop-drag content-tabs-caption` 且 computed drag。各尺寸在 ResizeObserver 帧后再等 150ms，capacity 保持稳定。开始真实组件指针排序后 ghost 为 no-drag；Escape / mouseup 后 ghost 数量为 0。脚本 exit=0，没有 page errors。此为浏览器检查，不是系统拖窗证据。

旧 `pane-window-drag.test.ts` 初次 scoped 失败由主代理保留，审核了两项修订：

1. DRAG-03 使用真实 role=tablist viewport 检查 scrollWidth/clientWidth，并用 `closest('[role="tablist"]')` 检查选中项显露。旧 track 本身 max-content，不是滚动视口，不能作为当前可见边界。
2. DRAG-02 先 focus inactive tab0 将其显露，再断言 active2 仍 true，然后点击其关闭入口并再次断言 active2 未变。该步骤避免自动化在裁剪外点击时发生焦点 reveal 引起的坐标改变，仍完整保留关闭与 active 不变的业务检查，不用删除断言抵消失败。

独立执行修订后的命令：

```powershell
$env:XAANINK_TEST_CHROMIUM='C:\Program Files\Google\Chrome\Application\chrome.exe'
node --import tsx --test --test-concurrency=1 tests/browser/pane-window-drag.test.ts
```

结果 exit=0、3 tests / 3 pass、0 fail / skip / cancel。原菜单按钮、点击 / Enter / 中键 / 关闭、正文不可拖动、空态拖动与选中项显露断言全部仍在。

## 测试和观察程序边界

- `content-tabs.test.ts`、`pane-window-drag.test.ts` 和 `verify-content-tabs.mjs` 只把 tab 的 app-region 期望调整为 none，并新增/改正 bounded viewport no-drag 断言；没有删除排序、键盘、滚动、菜单、取消、实例/草稿或工具行为检查。新 AIDRAG-01/02/03 保留真实布局/computed 断言和容量恢复回归。
- `verify-ai-caption-drag.mjs` 使用 mkdtemp + 合成 seed，核对 bootstrap.dataRoot 和零模型，Electron renderer 设离线，观察 BrowserWindow bounds / 最大化 / scale / zoom、实际 DOM rect 和 computed region，保存数字序号截图及报告。它不伪造系统拖动、不自行断言 status=passed，也不把 JS 选中标签操作写为系统鼠标操作。
- observer 的报告是原始观测集合。主代理必须将请求、OS 操作坐标、标签滚动状态和 bounds 变化对应起来，并用最终构建复验；不能从脚本正常退出或 completedAt 得出拖动通过。报告当前记录源文件、主进程 bundle 与 out/index.html 哈希，完整 UI chunk 与最终安装包身份仍由构建/包检查台账提供，不将这些有限哈希升级为最终安装包验证。
- 本审核未重新执行全量或构建。主代理正在执行的全量结果、历史失败、最终 Electron 验收及平台未执行范围据实补入验收台账。

## 全量暴露的旧 SURF 选择器补充调查

主代理本轮完整 browser 日志 `docs/evidence/ai-caption-drag/browser-full.log` 实际为 253 tests / 251 pass / 2 fail、0 skip / cancel；两项失败是 SURF-01 背景及 SURF-02/03 底线。独立只读核对源、Git 版本和历史日志后，确认这两项测试仍以旧结构中的 role=tablist 充当整个 caption；本轮拖动 diff 没有修改标题背景、底线或 role 所在结构。

- `git show c22efdf:src/components/layout/ContentTabs.tsx` 的 role=tablist 在最外 caption，含 border-b / bg-sidebar；历史 `workspace-surfaces/green-scene-final.json` 和 `browser-windows-directory-final.log` 记录该阶段 SURF 两项通过。
- `git show HEAD:src/components/layout/ContentTabs.tsx` 已是父 `.content-tabs-caption` 与内部 `.content-tabs-viewport[role=tablist]` 分离。HEAD 桌面 CSS 已把 viewport 设为无背景的透明裁剪视口，父 caption 的 bottom line 是 `::after` 的固定 1px 背景条。该变更来自已批准 `ink-xy-v4` 的此前 ContentTabs 实施，本轮只改变 viewport 命中和宽度。
- `docs/reviews/2026-10-10-content-tabs-verification.md` 明确此前只跑专项和直接相关测试，没有全量；因此不能拿此前 SURF 历史成功推导新结构下测试一直成功。
- `design/content-tabs/index.html:23,36` 的已批准宣纸 chrome 为 `#f5eedc`，主体为 `#f8f3e4`；`preview-observations.json` 也实际记录 chrome=`rgb(245,238,220)`。SURF-01 当前第二项期望主体颜色，但选中的是透明 viewport；单纯把 selector 换父 caption 后还须按照最新批准 chrome 明确调整该目标颜色，不能把透明当成新的批准背景。

建议的最小测试修复不修改产品，也不删除固定色与 1px 断言：

1. SURF-01 的“标题表面”改选 `.content-tabs-caption`，严格期望批准 `paper.sidebar` / `rgb(245,238,220)`；另断言 viewport 透明，以及 selected tab 背景严格为 `paper.content` / `rgb(248,243,228)`。其它 AI / 业务 / 编辑器 / 全局 token 与固定颜色断言全部保留。
2. equalLines 的普通 border 数组仅移除旧 role=tablist 项，其他 common border 厚度/颜色/样式断言保持。另单独读真实 `.content-tabs-caption::after`，严格验证生成 content、position:absolute、height=1px、bottom / left / right=0、backgroundColor=paper.border、backgroundImage=none、pointer-events:none；可同时比较伪元素 width 与 caption CSS 宽度，证明连续底线覆盖全栏。最新标签底线采用固定 1 CSS px 填充条，而普通 border 在 CSS zoom 下有浏览器边框量化，不能继续读取不存在的 viewport border 或把两种 painted primitive 混作同一 computed border 字段。
3. SURF-02/03 的 44 DIP row selector 改父 `.content-tabs-caption`；工具 selector 改 `.content-tabs-caption .content-tabs-tools > button`。当前旧 `[role=tablist] > button` 已无匹配，必须让真实工具重新被尺寸和中心验证覆盖，并可断言右侧两枚工具的数量，防止空集合静默通过。

此为只读调查和最小建议，未自行修改或执行修订后的 SURF 测试；主代理应保存当前完整失败日志，并原样复跑修订专项和全量。

## Green observer 追加身份与输入核对

再次只读检查 `scripts/verify-ai-caption-drag.mjs`：已增加递归 out / dist 的 css / js / cjs SHA256，以及每次 `observe(label,input)` 中保存 request.input。先前“仅源与入口 hash”的限制已经由新增 executable resource 身份记录补足，安装包验收仍独立。

实际读取当时 `green/report.json` 并对每一条已登记 hash 重新计算：6 条 source / 入口 hash、177 条 UI / desktop 执行资源 hash全部与当前文件相同，0 mismatch；7 条观测、errors=[]，其中 4 条携带 driver 和输入坐标。此为当前开发构建的身份一致性核对，不把 hash 本身当作行为通过。

当时报告的 `green-ai-right-large-OS-drag` 记录 sky.drag `[800,16]→[1000,300]`，前后 bounds 仍为 `{x:180,y:160,width:1441,height:901}`，因此**没有实际移窗证据**。`green-separator-right-OS` 的 sky.drag `[866,250]→[945,250]` 后 scrollLeft 从 539.3333 变为 618.6667；右移后的 `[900,16]` 两次真实双击分别产生 maximized=true / false，并回到相同 normal bounds。该组支持真实分割线变化后的原生命中与双击还原，不支持把失败/无法可靠正控的物理拖动标为通过。后续主代理新增观测另行组合验收。

## 第二阶段 ChatPanel 补修代码审核

用户实际反馈第一阶段仍失败，位置为标题图标及首字，第二阶段代码不能沿用上文第一阶段通过作为问题解决结论。当前第二阶段产品 diff 仅在 desktop.css 的全局区域声明后添加注释和两条 `.chatpane > :not(.desktop-drag)` 规则；根未设 no-drag，caption 本身及其恢复按钮未被 reset，非caption 祖先 no-drag/后代 initial 与已通过方案一致。未改 JSX、数据、overflow、尺寸、事件或后端。scope 和 specificity 正确，正文范围真实 computed 及点击由新增用例支持。

独立运行新增 AIDRAG-05/06 为 2/2、exit=0；主代理 `message-scoped-green.log` 合并新增两项、第一阶段三项和既有 pane 三项为 8/8、0 fail/cancel/skip，保留了标签及窗控断言。真实 ThinkingRow 的折叠采用原 Collapse 的两帧挂载/240ms 卸载，测试等待实际 visible/hidden，未删交互以取得通过。完整回归、最终构建/原生及人工失败点验证尚待第二阶段完成。

### 浮层交互：当前还需补 MentionPopup 的稳定根排除

`ChatPanel.tsx:1864` 在 composer 内挂载真实 MentionPopup；`MentionPopup.tsx:101–104` 的根为非portal `role=listbox`、absolute bottom-full、max-height=280px/overflow-y-auto。上述宽泛 descendant initial 也解除此浮层根和其所有 option 的注册。当可见候选向上覆盖 caption，正常正文 host 的 no-drag 矩形并不覆盖那部分浮层，原生 drag 可能抢走候选交互；这与本轮需要保留的真实 @ 选择功能有关。

独立只读内存原型渲染实际 MentionPopup、当前完整 Tailwind/desktop CSS 与 20 个合成人物：caption=[200,0,600,44]，正文 host top=44/no-drag，低锚点使 popup top=-144 / bottom=136 / height=280。popup computed=none；[250,16] 实际命中其“合成人物4” span，computed=none。Chrome 点击确实调用合成 onSelect(c4)，但浏览器不执行原生 app-region 命中，这不是 Electron 点击通过。该证据确认可见浮层覆盖标题却未注册根排除，支持在最终补修前增加 root no-drag 及回归。

建议最小范围为 noncaption 内 `[role=listbox]` 与 `.fixed[role=tooltip]` 根重新 no-drag，其后代继续 initial。EntityHoverCard 与 ComposerChipHoverCard 的 fixed tooltip 是条件挂载，y=anchor.bottom+8 通常从正文下方开始，尚未证实它们是用户失败根因；保留其浮层边界符合交互契约。**不得不加限制地重登全部 role=tooltip**：`StagedChips.tsx:55–60` 另有常驻 invisible/opacity0 的 absolute tooltip，历史消息中的同类节点也随滚动移动，泛化可能重新带入裁剪外或隐藏矩形。固定两类与 MentionPopup 的稳定浮层根不会因其内部候选滚动而移动边界。

必要回归：可见 listbox/fixed tooltip 覆盖 caption 时 root no-drag、内部控件 none，真实 MentionPopup 可选择；滚动候选时隐藏按钮不得单独登记越出根；关闭/卸载后浮层排除消失，标题恢复拖动区域。若 tooltip 以隔离 role probe 检查，应明确非完整悬停业务验收。此项尚未追加产品规则/测试时，不给第二阶段最终 code review 完成结论。

### 浮层最小追加后的第二阶段最终代码审核

**第二阶段代码审核通过，无阻断发现。** desktop.css 在后代 reset 后新增 `.chatpane > :not(.desktop-drag) :is([role="listbox"], [role="tooltip"].fixed)` 的 prefixed/标准 no-drag 声明：仅重登稳定可见浮层根，内部滚动后代仍匹配 initial。selector 比通用后代 reset specificity 更高；不会匹配 caption、caption 恢复按钮、body 以外的 portal，亦不匹配 StagedChips 常驻 absolute tooltip。scope 精确响应前述真实 MentionPopup 覆盖标题的证据，无需改 React JSX、数据、后端、事件或布局。

新增 AIDRAG-07 实测真实 MentionPopup 跨 caption、根排除/后代解除、内部滚动裁剪、真实 onMouseDown 选择、浮层卸载和 caption 区域恢复；fixed tooltip 仅作为明确隔离交互 probe。独立运行 AIDRAG-05/06/07 为 3/3、exit=0、0 fail/cancel/skip；CSS hash=`379fe189a03a158b9fdfabdad05e2233886d1b3a97f7769764eeceae55dbb4fd`，git diff --check 为 exit=0。前述“需追加浮层根排除”项至此闭合；全部原区域/几何和功能断言保留。

这项 code review 结束不等于用户目标验收完成。当前完整 ChatPanel 生命周期没有在新增夹具挂载；第一阶段人工失败、核心未通过、第二阶段完整 browser/构建身份/真实目标系统与人工原失败点均须继续据实组合。第二阶段不能复用第一阶段 native/hash 作为其最终版本证据，也不能以浏览器点击或双击替代实际移窗。

### ALIGN-03 额外夹具包装的独立核查与最小修复

主代理随后传达用户第二次重新启动、实际滚动及分栏复验后明确反馈“这些位置都可以拖动”，原图标/首字人工物理拖窗通过。该人工结果单独记录，不能覆盖 `message-browser-full.log` 的 256 tests / 255 pass / 1 fail / 0 cancel/skip；其唯一失败是 ALIGN-03 最后的全部 button no-drag 断言。

源与失败路径相符：真实 ChatPanel:1656–1658 的 caption 为 chatpane 直属孩子；旧 `caption-alignment.test.ts:28` 在真实 header 外另包 `<div id=chat-header className=contents>`。虽然 display:contents 不增加布局盒，这层 DOM 仍是非desktop-drag 直属孩子，因此第二阶段 reset 同时匹配其内部真实 caption 根和恢复按钮；它们被错误重置为 initial。原日志显示 ALIGN-03 已完成导航/菜单/全屏/隐藏/关闭和尺寸检查，最后在 regions.every(no-drag) 失败。不能据此修改真实产品规则来适配不存在的包装。

已审最终 diff：先 assert 抽出的真实 header 从 div 开始，仅给根添加测试 id；去掉 display:contents 包装；ALIGN-01 与两类 ALIGN-04 的高度 selector 从 #chat-header>div 改 #chat-header。controls selector、可见控件数量、固定位置/尺寸、44 DIP 与正文起点、narrow Shell 切换、所有回调顺序、Tab 关闭和最后全部 button no-drag 断言完整保留，没有删断言或扩大容差。**最小夹具修复审核通过，无需改产品。**

独立运行当前修订后的 ALIGN-03：1 test / 1 pass / 0 fail/cancel/skip、exit=0，duration=2281.5178ms；执行时产品 CSS hash 仍为 `379fe189a03a158b9fdfabdad05e2233886d1b3a97f7769764eeceae55dbb4fd`。只复核该失败项，未把单项结果宣称完整 browser 通过；完整文件和第二阶段最终全量结果由后续真实日志确认，前一轮失败应继续保留。
