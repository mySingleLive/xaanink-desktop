# AI 标题栏拖动稳定性修复方案

来源：2026-10-10 用户报告及截图。范围仅桌面拖动命中，保留真实 ChatPanel、ContentTabs 和原分栏。

源证据：ChatPanel.tsx 标题整条为 desktop-drag，标题 span 不排除拖动。ContentTabs 的 overflow:hidden viewport 内包含 width:max-content 的 track；useContentTabStrip.reveal/measure 通过 scrollLeft 显露当前标签。desktop.css 全局 button/role=tab 和 content-tab 都登记 no-drag。当早期标签被滚动到 viewport 左侧，其布局矩形可进入 AI 标题范围；CSS 可视裁剪是否约束 Electron 命中须在真实 Windows 系统鼠标中复现，不能只用 computed style 声称根因。

拟采用最小修复：让 content-tabs-viewport 成为唯一受布局约束的 no-drag 矩形；其宽度随实际标签总宽度增长、受 flex 可用空间限制（flex:0 1 auto、width:max-content），tools 用 margin-left:auto 保持右对齐，剩余标题空白仍属于父 desktop-drag。viewport 内 tab 和所有后代的 app-region 显式设为 none，避免裁剪外的标签及关闭按钮继续登记排除矩形。保留标签选择、关闭、中键、排序、横向滚动、键盘和真实面板实例。拖动 ghost 的矩形位于指针处，只在排序过程中存在，不扩展静态标题命中。

审核发现的宽度依赖同步修正：现有 measure 将 --content-tabs-viewport-width 写为 viewport.clientWidth；改为 caption 实际可用宽度减当前 tools 宽度和 caption gap，避免新 intrinsic viewport 被过去窄栏宽度锁死。用单长标签窄→宽回归证明标题能够重新展开。

属性值更正：调查发现 Chromium 将显式 app-region:none 规范化为 no-drag，不能解除登记。最终用 app-region:initial / -webkit-app-region:initial 覆盖 viewport 后代；浏览器必须断言最终 computed 为 none，且真实 Electron 再确认拖窗。

先建立回归测试及独立用例审核，再运行 RED；实现后 GREEN 和独立代码审核。浏览器验证多标签滚动首/中/末、面板宽度变化、单标签空白仍 drag、所有按钮交互与缩放。真实 Windows 使用隔离合成数据/零模型/离线 Electron，通过 computer-use 系统鼠标，比较 AI 标题左/中/右拖动前后 BrowserWindow bounds，分割线右移后再验；标签与关闭按钮不得移动窗口，仍验证标签排序/操作。构建后再验最终 bundle；CSS 临时注入仅作调查，不计最终通过。

最终运行完整 unit/integration/browser、类型检查和构建。历史平台失败如仍存在据实报告，不通过收窄命令或跳过来声称全通过。记录 W04 与 ContentTabs 迁移的有限修复证据，不升级全业务/macOS/安装包验收状态。更新最终开发构建，但未授权覆盖现有用户数据或安装路径。

## 人工失败后的第二阶段方案

用户在第一阶段重建/重新启动后反馈仍无法拖动，明确位置为 AI 标题左侧图标及右边第一个字。第一阶段只约束 ContentTabs，尚未解决用户问题。用户当前开发 Electron 的新进程时间晚于最新 UI/main 构建；不能以旧版本猜测否定反馈。

新增源证据：ChatPanel 消息 wrapper（1707）包含 overflow-y-auto 消息视口（1748），ThinkingRow 的左侧 button（445）与 CopyButton、折叠工作行、Markdown 链接等仍被 desktop.css 全局登记 no-drag。垂直滚动能将这些隐藏后代的布局矩形移到标题 y 范围；ThinkingRow 的 x 位置恰在图标及首字附近。需新增真实 ThinkingRow 与原 header/消息 wrapper/scroller JSX 回归，先取得红测再实现，不从用户现象直接宣称该候选已证实。

续修只在 desktop.css 把 `.chatpane > :not(.desktop-drag)` 设为 bounded no-drag，并将这些非caption孩子的后代 app-region 重置 initial。根本身不设 no-drag，caption 和其恢复按钮保持原契约。直属 workflow/status、消息 wrapper、composer 都是 caption 后的正常 flex 流，只有具体后代滚动，因此边界矩形本身稳定在标题下方。保持全部 overflow、尺寸、JSX、数据和交互；portal 菜单仍按自身全局 no-drag 交互。消息按钮点击/折叠、正文/编辑不可拖和 caption 恢复按钮需回归。侧栏隐藏窗控的潜在越界另观察，不在未复现时扩大本次根因。

第二阶段构建后再请求用户人工验证失败的具体点；收到人工失败就记录 manual-failed-investigating，不能继续写 pending 或总结为修复完成。第一阶段全部原始结果和构建 hash 只对应其阶段，第二阶段另记，不覆盖为最终结果。

浮层边界补充：真实 MentionPopup 是非portal bottom-full/overflow-y-auto listbox，短窗口可见浮层会伸入caption；EntityHoverCard/ComposerChipHoverCard 是条件挂载 fixed tooltip。reset后为这两类可见浮层根恢复一个 bounded no-drag，内部滚动后代仍initial。不得笼统恢复所有 tooltip：StagedChips 含常驻 invisible/opacity0 absolute tooltip，宽泛规则会重新引入隐藏矩形。范围限定 `.chatpane > :not(.desktop-drag) :is([role="listbox"], [role="tooltip"].fixed)`。
