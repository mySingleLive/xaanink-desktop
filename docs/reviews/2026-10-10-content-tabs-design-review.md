# 右侧内容 Tabs：独立设计与技术方案审核

日期：2026-10-10（Asia/Shanghai）。本审核只读检查本次调研、产品设计、实际组件及既有标题栏证据，仅编辑本文件；未改产品源码、未运行全量或专项产品测试。

技术及 HTML 设计审核结论：**本阶段通过，无新增阻断；可以提交用户审核，用户 UI 批准尚未取得。** 当前结论只覆盖设计阶段。用户最新指定的“调研 → 产品 → HTML 用户审核 → 实现 → 专项测试”顺序优先于旧的自动推进及全量测试要求。本审核不能替代用户的 HTML 批准。

## 源码依据

- `src/components/layout/ContentTabs.tsx:96–111` 实际 tablist 使用 `border-b`、`pt-1.5`、`top-px` 和 `overflow-x-auto`；`src/app/desktop.css:13–24` 的 Windows 通用 caption 下内边距为 `12/zoom`，tablist 子容器又被覆盖为 `top:0`。局部重新安排 Tabs 底缘并隐藏视口滚动条能针对用户指出的两项问题，不需要重写右栏。
- `ContentTabs.tsx:127–150` 实际长标题使用 `truncate`，图标、暂定标题 badge、类型后缀与关闭按钮均是独立子元素。只给标题 span 设置实际溢出 mask，并将其余项保持固定占位，能实现不使用省略号的渐隐；不能给整个 Tab 遮罩。
- `src/app/globals.css:59` 将 `bg-editor` 接到 `--editor-bg`；`src/app/desktop.css:31` 的 paper 右侧局部令牌为 `#f8f3e4`，`globals.css:229` 的 ink 编辑区令牌为 `#100d0c`。选中标签及主体应都读取同一个作用域下的 `--editor-bg`，不能在正式组件中复制 HTML 的硬编码颜色。
- `ContentTabs.tsx:49–66` 实际选中项显露使用 `scrollIntoView` 和视口 ResizeObserver。改为只移动本地 `scrollLeft`、观察标题及字体变化，能避免滚动外层工作台，并覆盖长标题和窗口变化。`overflow:hidden` 的视口仍需通过菜单、横向输入及键盘显露保持可达。
- `src/stores/tabs.ts:239–287` 的激活和关闭经过 `afterSceneLeave`，关闭当前项先选前一项、否则后一项。正式重构必须沿用 `activateTab`/`closeTab`，不能复制一个绕过 guard 的局部 Tabs 状态；菜单关闭同样遵守这些 API。
- `ContentTabs.tsx:204–216` 以 `key={tab.id}` 渲染所有打开项，未激活项通过 `hidden` 保留实例。`docs/implementation-boundaries.md` 要求复用真实 ContentTabs、registry 及 MarkdownEditor，并保留选区/撤销/草稿。只重构标签头部、保留现有内容 map 和 key 满足该边界。
- `docs/reviews/2026-10-10-caption-height-verification-review.md:7,26` 记录上一轮 Windows 44 DIP 标题栏及控件中心仍在 16 DIP；这解释了本次必须单独把 Tab 移到下缘，同时保留面板工具和原生菜单位置。上一轮完整 core/browser 未通过不能被本次设计覆盖。

## 首轮审查提出的落实点

1. **底缘坐标包含边线。** 32 DIP 标签从 y=12 到 y=44；如果父容器的 1px 下边框扣掉内容高度，不能让标签实际停在 y=43。应在同一坐标绘制底线并由 active 标签底部背景覆盖，视觉审核和后续专项几何都检查该点；不要为覆盖边线重新引入容器 `top-px` 与纵向溢出。
2. **窄视口菜单具有关闭途径。** 产品设计允许标签视口降到 0，并明确菜单仍能选择和关闭项。HTML 需显示该入口及关闭操作，后续使用实际 DropdownMenu 构件时避免把独立关闭按钮嵌入 menuitem 造成焦点/事件冲突；可以用独立、可命名的菜单操作。若工具组本身不足宽，具体紧凑行为及最小可用范围需在专项用例中定义，不能只声明“仍可达”。
3. **手动激活键盘模型落实为单一入口焦点。** 左右/Home/End 移动焦点，Enter/空格激活，与当前每项 `tabIndex=0` 不同。HTML 应验证 roving tabindex、阻止相应浏览器默认行为、菜单 Escape 返回触发器；焦点显露也只滚动标签视口。关闭按钮在键盘焦点时必须可见。
4. **仅对实际溢出的标题启用渐隐。** 保留完整 tooltip/ARIA 文本及类型后缀，短标题没有 mask；固定最大 208 DIP 和 zoom 换算应保持明确，不能随 root rem 字号突破最大宽。小于最小宽时图标/后缀/badge/关闭的优先级需要可见或在菜单有等价路径，不能仅靠允许 Tab 缩小掩盖内部溢出。

## HTML 复审及设计预览证据

已只读复审修订后的 `design/content-tabs/index.html`、`capture-preview.mjs`、`preview-observations.json`，并独立查看 `preview-paper.png`、`preview-ink.png`、`preview-narrow.png`、`preview-menu.png`、`preview-last-tab.png`、`preview-small-viewer.png` 六张原始截图。预览执行由主代理完成，本审核没有重复执行脚本，也没有把设计脚本当作产品专项测试。

- `index.html:34–55` 用独立 `caption::before` 绘制下缘，不用 border 扣去高度；选中 Tab 的背景覆盖同坐标底线，截图可见标签直接连接主体。五个几何场景均实际记录栏高 44、标签 top 12、高 32、标签底缘减主体上缘为 0，工具中心 y=16。该证据支持设计稿的坐标方案，正式 zoom 换算尚需真实组件验证。
- 同五个场景的 computed `overflowX/overflowY` 均为 hidden，视口 `scrollHeight=clientHeight=32`。脚本显式移除 Playwright 的默认 `--hide-scrollbars`，截图没有依赖浏览器启动参数隐藏标签条滚动条；菜单内自己的纵向滚动条可见，与产品设计的区别一致。
- 纸主题选中与主体均为 `rgb(248, 243, 228)`，墨主题两者均为 `rgb(16, 13, 12)`。截图支持一体底色及未选中项区别；原生占位不是实际系统窗控。
- 正常场景最大标签宽 208；430px 窄面板中视口 162，最大标签宽 162。长标题仅文字 span 使用 mask，短标题 `mask=none`；后缀与关闭按钮未被渐隐。截图展示中英文标题和长名称完整 tooltip 的源码路径，但 HTML 未含真实小说封面或暂定 badge，不能据此认为正式组合验证已通过。
- 菜单已由 `right:174px` 改为 `right:clamp(8px,calc(100% - 348px),174px)`，脚本实际断言窄面板菜单左右边界均在面板内，记录左边距 9、右边距 81。`index.html:235–245` 将切换 `menuitemradio` 与关闭 `menuitem` 置为独立同级按钮，消除了首轮嵌套操作问题；长名称换行及关闭入口在截图中可见。
- `index.html:204` 关闭当前项已改为前项优先，与真实 store 一致；`:218` 在焦点变化时更新唯一 Tab 的 tabindex。最终预览脚本检查菜单 14 项、选择最后项完整显露、Home 只移焦点且保持唯一标签入口而 Enter 激活、Escape 返回触发器、关闭屏幕外项，以及关闭激活中间项后激活前项。结果记录六项交互及零 pageError，不宣称未记录的交互已执行。

## 待批准后落实的窄宽边界

设计稿的可选窄面板是 430px，560px 浏览器查看器另有截图。当前占位安全区 174、左 padding 8、工具组约 80 和间隙合计约 266px，因此本稿不保证更小面板的工具与原生占位互不重叠；没有将其写成已通过。真实 `DashboardShell.tsx:507` 平稳布局的内容 minSize 为 30%，动画可临时降到 0；`desktop/main/index.ts:668` 主窗口 minWidth 为 760，窄布局还会切为单面板。这些是后续定义最小可交互范围和动画处理规则的真实依据，不能以隐藏裁切按钮代替可达性。

产品设计现已明确：菜单可达保证限定于仍可容纳工具组，零宽分栏收起动画不承诺区内交互，沿用左树/对话的恢复入口，430px 设计稿不外推极窄验收。批准后技术细化及专项用例仍需明确安全区优先时的紧凑入口、恢复后的焦点及标签显露、内部固定元素的最小宽度优先级。非焦点/非选中标签的关闭按钮还应避免额外制造整串 Tab 序列，焦点进入关闭按钮时应显露对应项。上述事项不阻断当前 430px HTML 的用户视觉审核，也不提前宣布正式实现满足这些边界。

## 验证边界

本次 HTML 是明确的设计示意，不能成为安装版工作台或正式业务数据来源。主题切换与原生窗控占位不证明 macOS/Windows 原生验证。UI 批准后才细化并审核专项用例，后续 TDD、code review、目标 Windows 检查和通过结论另据实际证据记录；不运行全量或全量回归，不提升旧 29 类面板或旧失败记录的状态。
