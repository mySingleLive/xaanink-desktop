# ContentTabs 实施独立审核

审核日期：2026-10-10。用户已明确批准 `ink-xy-v4`，本记录审核实施方案和专项用例，不代替用户 UI 批准，也不声明代码或目标系统验收完成。

## 阶段一：技术方案

审核对象：`docs/reviews/2026-10-10-content-tabs-implementation-plan.md`。

结论：**无阻塞，可以进入专项用例审核**。

已独立读取真实 `src/components/layout/ContentTabs.tsx`、`src/stores/tabs.ts`、`src/components/ui/dropdown-menu.tsx`、`src/app/desktop.css`、`docs/implementation-boundaries.md` 及直接相关标题栏/空态测试。现有 ContentTabs 的业务内容通过 `tabs.map`、稳定的 `tab.id` key 与 `hidden` 保持实例；方案明确保留此结构以及 Story/StagedSaveSurface/封面/类型后缀。现有 store 的激活和关闭经过 `afterSceneLeave`，方案中重排只移动原对象、不进入 guard、不修改 nonce/焦点/子视图，符合重排保留编辑状态的要求。

方案覆盖无滚动条但允许程序性局部显露、真实宽度测量与仅溢出标题渐隐、极窄时视口降至零与工具/原生安全区优先、使用现有 DropdownMenu 的完整标签菜单、鼠标/键盘重排、body 内 fixed 预览与二维抓取偏移、所有取消路径及点击抑制。CSS 方案保留 Windows 44 DIP 标题栏和现有原生按钮中心，单独处理标签 32 DIP/上下 6 DIP 与工具组位置，避免将已批准的浮动标签几何强加到窗控。

代码审核时需要核实：克隆预览实际字体/子元素尺寸/主题也随源项而保持；重新测量不会在拖动中把激活项滚回而干扰边缘横移；菜单入口显示/隐藏不会造成测量振荡；外部删除与 capture 释放不会二次提交。这些属于实现核查点，不构成方案阶段阻塞。

证据来源为上述源文件和方案文本；本阶段未运行产品测试、全量测试或目标系统验证。

## 阶段二：专项用例

审核对象：`docs/reviews/2026-10-10-content-tabs-test-plan.md`，在阶段一无阻塞后独立读取和核对。

结论：**无阻塞，可以进入 TDD 实现**。范围明确只覆盖 TABS-01 至 TABS-12 以及直接受影响标题栏/空态/导航，符合用户本次不做全量和全量回归的要求。

清单包含宣纸/玄墨与极窄/缩放/字号组合的几何检查、长短标题实际渐隐、完整菜单的切换和独立关闭、焦点与激活分离、鼠标二维抓取偏移/边缘横移/有效落点提交、store 原对象及面板实例/输入状态保留、重排后邻项关闭、全部取消/清理路径及后续点击。真实组件夹具与完整 Windows Electron 的证据分层明确，受控 DOM 取消事件、合成鼠标和未执行平台不会替代真实目标验收；保留旧组件的实际失败结果，再验证新组件通过，具备 TDD 顺序。

已向主代理补充三个明确核查点：横向滚轮以及激活/聚焦显露只改变标签视口 `scrollLeft`，不滚动外层工作台；store 无效 index 指 NaN、Infinity 或非整数，超范围有限整数按技术方案裁切到首尾；原生拖窗必须真正触发 OS 行为并读取窗口位置才报告通过，CDP 合成输入的二维预览测试单列。前两项可纳入已有行为用例，第三项保持证据如实，不增加全量或跨平台测试。

证据来源为专项清单和真实源文件；本阶段未运行产品测试、全量测试或目标系统验证。

## 阶段三：代码审核

审核对象：真实 `ContentTabs.tsx`、`useContentTabStrip.ts`、`tabs.ts` 的 `moveTab`、`desktop.css` 新增 ContentTabs 段，以及新增 12 个浏览器/4 个 store 用例、共享真实组件夹具和两份直接相关既有浏览器测试的 diff。审核只读取这些源文件，不修改生产或测试，不执行全量。

结论：**独立代码终审无阻塞，已读取的专项用例通过，可以进入/继续 Windows Electron 目标验证**。代码保留全部业务 `map/key/hidden`、Story 附加组件和 StagedSaveSurface；`moveTab` 仅返回重排的新数组并保留原对象，整数/缺失 id/同位动作校验不会触发 guard、nonce、子视图或面板焦点更新。标题测量和聚焦只改变本地视口滚动；拖动时重新测量更新预览而不把激活项滚回。overflow 使用未添加菜单入口时的容量预算，compact 使用扣除实际原生安全 padding 后的三工具预算，极窄只保留菜单并在菜单内提供全屏/隐藏。预览用 body 内 fixed clone、来源主题/尺寸变量和二维偏移；清理先清空拖动状态再释放 capture，避免 lostcapture 二次提交，取消路径移除 ghost/marker/source 状态并取消 RAF。

初审提出 novel 封面 `<img>` 原生图像拖拽风险，随后新增的封面中心鼠标拖动用例在旧源码实际观察到 `dragstart=1` 而失败（`docs/evidence/content-tabs/scoped-image-drag-red.log`）。生产封面已增加 `draggable={false}`；复核源文件与用例，专项绿测证明不再触发原生 DnD，同时维持二维预览。新增用例还在 zoom 1.5/font 24 下比较 body 内 ghost 的图标、关闭按钮、标题和后缀尺寸/字号/行高，覆盖原阶段一的克隆尺寸核查点。

独立读取 `tests/browser/empty-content-hide.test.ts` 与 `caption-alignment.test.ts` 的 diff，确认仅调整 tablist 父栏 selector、标签中心由 16 改为批准的 22 DIP 和 compact 菜单入口可达断言；原工具中心仍为 16 DIP，尺寸、原生安全区、空态和恢复行为验证保留。`docs/evidence/content-tabs/related-browser.log` 记录 15 组通过、0 失败；其中 Darwin/Web 夹具不是实际 macOS 系统验收。

已读取 `scoped-red.log`、`scoped-image-drag-red.log`、`scoped-green.log` 及 `related-browser.log`。最终新增限定组为 12 个浏览器用例加 4 个 store 用例，共 16 个通过、0 失败、exit 0；旧组件/缺失 moveTab 的失败和封面后补红测均保留。浏览器夹具使用真实 ContentTabs/store/DropdownMenu/CSS，业务正文替身仅用于实例/草稿状态检查。受控 pointercancel/blur/visibility 与 Playwright 合成鼠标不计物理 OS 操作。此审核不声明全量通过、真实 Windows/OS 通过、macOS 通过或安装包验收完成，目标证据由主代理继续核验。

## 目标脚本补充阅读

仅读取 `scripts/seed-content-tabs.ts` 与 `scripts/verify-content-tabs.mjs`，未修改脚本、未启动另一 Electron 或执行全量。验证脚本通过 `mkdtemp` 创建 `xaanink-tabs-` 独立目录，Electron bootstrap 核对实际 dataRoot、零模型、离线状态及 `xaanink://app/`；seed 通过真实 Workspaces/Prisma/DraftJournal 创建 19 章和 20 个合法业务标签，正文均为合成测试文本。脚本记录源文件、bundle、Electron exe 与截图 SHA256 以及真实 Electron/Node/Chromium/Windows 版本。作用是审计本次目标运行，不把 hash 本身作为业务成功证明。

`target-01-electron` 保留 seed 子进程超时，未把数据准备失败算 UI 失败。`target-02-electron` 已走通 seed，首次编辑保持断言错误地读取隐藏 Monaco 的虚拟化 `.view-lines`；独立阅读指出该 DOM 不代表完整模型。脚本现对隐藏编辑器只核对同一节点连接，并在正常菜单重新激活后等待可见全文/草稿比较，最后使用真实 Ctrl+Z 验证撤销保持。失败记录保留，未降低模型/撤销保持的实际要求。

目标验证代理报告 `target-03-electron` 的 Alt 排序失败被完整工作台的 CommandController 全局捕获导航快捷键截获，构成真实整合缺陷，超出先前真实 ContentTabs 夹具所覆盖的边界。已向主代理请求提供修复源范围和包含真实 Controller 的专项回归用例，待独立复核后闭合。上文阶段三结论仅针对当时静态/已有夹具，不提前宣称此整合缺陷已修复或目标运行通过。

## 全局快捷键整合补充方案审核

独立读取 `DesktopCommandController.tsx`、`desktop/shared/commands.json`、Tabs hook 与新真实 Controller/Navigation 夹具。commands 的 Windows `view.back`/`view.forward` 默认分别是全局 Alt+左右键；Controller 在 window capture 阶段匹配后 `preventDefault/stopImmediatePropagation`，确实先于 Tab 自身 React handler。最小修复方案无阻塞：只在真实标签根元素获得焦点且按无 Ctrl/Meta/Shift 的 Alt+左右键时，让 Controller reset dispatcher 后继续传递给本地排序。关闭按钮、编辑器及标签以外焦点仍用原全局导航，命令表和用户快捷键配置不改；hook 的排序条件使用相同修饰键边界，避免将 macOS 的 Cmd+Alt 导航误视为排序。

另补充同类 Escape 优先级风险：拖动中的纯 Escape 先到 window capture，可被启用的全局 `ai.stop` 或用户绑定消费；需要只在本 Tabs 拖动源存在时把纯 Escape 交给拖动取消，并以真实 Controller 加启用全局 Escape handler 的专项用例验证取消优先级和非拖动时原全局行为。这是本次拖拽取消要求的直接关联验证，不扩展 AI 或快捷键全量。

菜单选择自动收起可仅在现有 RadioItem 设置 `closeOnClick=true`，安装的 Base UI MenuRadioItem 默认 false，源码支持该属性。已另读安装的 MenuRadioGroup：其 setValue 每次调用 onValueChange，没有过滤相同值，因此保留 Group onValueChange 即可保留重复点击 activationNonce 语义，不应另加 item onClick 造成双激活/双 guard。专项断言覆盖重复选中和未选中项只激活一次、自动关闭及焦点回触发器。

复核结果：**实际整合修复与专项回归无阻塞，target-03 暴露的快捷键缺陷已在源码和真实 Controller 组件验证层闭合**。最终 Windows 目标运行仍单独核验。

已独立读取实际 diff：Controller 只增加聚焦标签根元素的 plain Alt+左右和存在真实拖拽源时的 plain Escape 两项退让；录制、菜单、对话、IME、原生编辑与其它全局分派逻辑保留。hook 同步限定 Alt 排序和纯 Escape 的修饰键边界，其它 Alt/Ctrl/Meta 组合返回；RadioItem 仅增加 `closeOnClick=true`，Group 单次激活路径未变。`desktop/shared/commands.json` 没有修改。

新夹具运行真实 DesktopCommandController、DesktopNavigation、命令 catalog、store 与 history。`activateTabForNavigation` 的包装只计数并调用原 action；没有把 window/document 捕获 listener 替换为模拟实现，没有通过模拟事件顺序绕过实际 Controller。Alt 用例实际键盘验证排序不激活/不进入历史、首项边界不泄漏为导航、关闭按钮及其它/输入焦点仍正常导航，以及 Ctrl/Meta/Shift 修饰组合不误排序。Escape 用例实际鼠标启动拖动、实际键盘按 Escape，只有 `ai.stop` 业务动作替换为真实注册的计数 handler；验证取消优先、ghost/source 清理与非拖动时原全局 Escape 可用。这是捕获优先级测试，不宣称 AI 业务通过。

已读取 `scoped-command-red.log`（菜单自动关闭与真实 Alt 整合两组失败）及 `scoped-escape-red.log`（修复前 stops/ghosts/sources 各为 1）和最终 `scoped-green.log`。最新为 14 个浏览器组加 4 个 store 用例，共 **18/18 通过、exit 0**；先前 16 项绿测移至 `scoped-green-initial.log` 保持历史证据。另读 `related-navigation-controller.log`，原 Controller 与导航直接关联单元 **12/12 通过**。未运行全量或另一 Electron。

最终目标脚本已补入 Controller、Navigation 和 commands.json 源 hash；radio 点击后等待真实菜单隐藏，不再额外发送 Escape 迁就菜单不收起。脚本继续保留前三次失败记录，目标通过状态待真实报告核验。

## 极窄目标断言补充审核

独立读取 `target-04-electron/windows-electron.json`、查看 `failure.png`，并对照批准产品设计、技术方案及专项用例。该次目标运行在 980 CSS px 窗口的右栏只有 332 DIP，原生安全区和三个工具后标签视口为 62 DIP；固定图标/类型后缀/关闭/间距不能全部装入，初版目标脚本无条件要求内联 X 完整而失败。截图和几何一致，不把此次失败改记通过。

判定：**无需为此修改产品，按批准极窄边界修正额外断言无阻塞，不降低验收**。产品设计明确允许视口小于最小 96 DIP 时缩到视口，且“不足以容纳一个完整标签”时允许视口为 0、优先原生安全区和工具，要求所有标签菜单仍可选择和关闭。因此“关闭不被长标题挤走”约束容量足够的标签，不能推导为固定装饰本身都装不下时也必须保留内联关闭；否则与已批准零宽边界矛盾。

已独立读取修订目标脚本：以真实非标题子元素宽度、margin、所有 gap、padding 和 border 计算固定装饰最小容量；足够时继续验证关闭按钮 15 DIP 且完整位于 Tab 内，不因长标题放宽；不足时真实打开所有标签菜单，滚到当前项的独立关闭入口，验证 visible/enabled 并以 Escape 返回触发器。所有几何、无滚动条、最大宽、默认箭头、主题和原生安全区断言保留。真实组件浏览器 240px 极窄用例已实际点击选中项独立关闭并验证 t19 → t18；目标脚本此分支仅证明关闭入口“可达”，不能报告已点击关闭。后续目标通过需由新运行产生，target-04 失败继续保留。

## 样式作用范围终检

主代理发现新增 `.content-tabs button` 的 cursor 和 focus-visible 规则会覆盖整个右侧业务正文，超出顶部 Tabs 目标。独立核对真实 DOM 和 CSS，确认两项收窄为 `.content-tabs > .desktop-drag button` 正确且必要；已读取实际收窄后的源文件，**无阻塞**。该 selector 覆盖非空 caption 内 Tab 关闭/菜单/工具按钮和原空态 caption 的隐藏按钮，排除 StagedSaveSurface、Story 及全部业务正文按钮。Tab 根自身的 cursor/focus 保留，`.content-tab *` 继续覆盖 body 内拖动 ghost 的关闭和图标，菜单 portal 的角色 selector 仍独立覆盖菜单。没有扩大业务样式范围。

这是可逆的局部作用范围修正，无需新增测试组或全量验证；已有标题栏箭头/焦点/空态/ghost 专项覆盖受影响语义。另提醒主代理把既有 `allDefault` 断言的 DOM 查询也限于 caption 按钮，避免将测试契约误写为正文按钮必须箭头。最后 CSS 需要重建后以新专项日志和 target-06 源/bundle hash 绑定；不能用修正前目标运行代替最终版本证据。

## 最终专项证据独立核验

结论：**最终代码及本次专项证据审核无阻塞，可以按已批准 UI 和本次测试范围总结交付**。已独立复核收窄后的两条 CSS selector，并确认浏览器几何用例的 `allDefault` 查询现限定于 caption。读取最后一次 `scoped-green.log` 为新增 **18/18** 通过，`related-browser.log` 为直接相关标题栏/空态 **15/15** 通过，`related-navigation-controller.log` 为直接相关导航/Controller **12/12** 通过；没有以全量测试或全量回归替代用户限定范围。

已独立读取 `docs/evidence/content-tabs/target-06-electron/windows-electron.json`：`status=passed`，**37 checks、0 errors**，完成于 `2026-10-10T12:28:04.991Z`，运行于 Windows x64 / Electron 44.6.0 / Chromium 152.0.7977.130 / Node 24.21.0。该次运行验证真实完整 React 工作台中的 ContentTabs：空态、主题和间距、标题渐隐、20 标签菜单选择/关闭、选择自动收起、真实全局 Controller 下的 Alt 排序与 Escape 取消、二维预览及边缘横移、极窄入口可达、五档缩放、重排后相邻项关闭，以及真实 Monaco 草稿/模型和 Ctrl+Z 撤销保持。极窄分支仅报告菜单关闭入口可见且启用，未将未点击的动作标为已执行。

以只读 PowerShell `Get-FileHash -Algorithm SHA256` 重新计算报告内全部 **10 个源文件、177 个 bundle 文件、4 张截图及 Electron executable**，没有直接沿用验证代理的 hash 结论。先核对路径均解析在本仓库内，再逐项比较；结果 executable 相符、`mismatches=[]`。因此最终报告和截图对应当前含 CSS 作用范围修正、Controller 优先级修复及 Radio 自动关闭的源码/构建。先前 target-01 至 target-04 失败和 target-05 通过记录仍保留，不能替代最后版本证据。

已独立查看最后的 `real-ink-tabs.png`、`real-paper-tabs.png`、`real-xy-drag-preview.png` 和 `real-narrow-tabs.png`：玄墨选中项的中性高亮清晰，宣纸与主体颜色协调，小圆角仍呈矩形，上下留白符合批准版，拖动预览确实离开标题栏沿 Y 轴移动；极窄截图的固定装饰裁切符合上述已批准容量边界，菜单和工具仍可达。没有发现本次目标的视觉阻塞。

本阶段只核验既有日志、源文件、报告、hash 和截图，没有启动第二个 Electron，也未执行全量。目标运行使用隔离合成数据、零模型、离线 renderer，鼠标/键盘输入由 Playwright/CDP 合成。此次通过范围是实际 Windows Electron 中的本次 Tabs 功能，不含物理 OS 鼠标/原生拖窗、Windows IME、macOS、安装包或 29 类业务面板全量验收；这些未执行内容不记为通过。
