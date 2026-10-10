# 工作区分割线与宣纸底色调研

日期：2026-10-10。当前方案：第三版。源码基线：`b1af4fb9e2d75104974514ec674df33d723ebe4e`。

本次修改统一 UI 结构分割线的细度、调浅分割色，并将宣纸三栏整体提浅、缩小色差。最新反馈要求导航与 AI 之间的线和其他 UI 分割线一样细，右内容区与 AI 的底色更接近。第三版采用左 `#f5eedc`、AI `#faf6e8`、右 `#f8f3e4`，分隔色恢复为通用 `#d8cba6`；竖线改用与横线相同的细边框绘制方式。

## 用户要求与阶段顺序

用户先要求去掉线旁亮带并将三栏改为两侧较深、中间较浅；第三轮继续要求所有 UI 分割线等细、颜色更浅，三栏往浅色收敛，尤其缩小右内容区与 AI 的色差。最新要求覆盖第二版的深分隔色及左右同色方案。截图用于定位视觉问题；颜色与线宽结论以源码和隔离预览为依据。

本次按最新要求推进：调研文档 → UI 设计稿并由用户审核 → 代码实现 → 测试 → 全部通过后总结。最新的设计审核要求覆盖旧批准记录中无需重复审核的阶段约定。设计确认后，继续执行仓库要求的技术方案独立审核、测试用例独立审核、TDD、独立 code review 和真实目标系统验证。

## 分割线实现

[`DashboardShell.tsx`](../../src/components/layout/DashboardShell.tsx) 第 48–53 行的 `ResizeHandle` 使用原 `react-resizable-panels` 分隔条。拖拽区宽 4px，默认透明；设置 `withLine` 后，在中间绘制宽 1px 的 `bg-border` 细线。hover 和拖动仍使用现有 primary 高亮。

左分隔条在第 492 行未设置 `withLine`，右分隔条在第 511 行设置了该属性。因此两者的默认外观不同。源码没有左分隔条白色渐变或专属白线，不能把截图中的竖带直接归因为白线实现。

[`globals.css`](../../src/app/globals.css) 第 144 行的宣纸通用分隔色为 `#d8cba6`；第 215 行的玄墨通用分隔色为 `rgba(255, 248, 240, 0.09)`。只补 1px 子线仍留下 3px 透明空隙，透出底层背景。第二版取消了空隙，但竖线使用 1px 实色条，横线使用边框；第三版把两者统一为边框绘制，并使用较浅的原通用分隔色。

第三版采集时 DPR 为 1.5：声明 `border:1px` 的现有横线计算使用宽度为 `0.666667px`，对应 1 个设备像素；第二版的实色条宽为 1 CSS px，对应 1.5 个设备像素。第三版竖线采用零内容宽度加 `border-left:1px`，总占位只有实际边框宽度，与横线相等，无额外透底空隙。这解释了前版虽然声明 1px，视觉上仍比普通 UI 线粗的情况。

普通 Separator、菜单和 Markdown `hr` 有使用 1px 实色层的情况：`ui/separator.tsx:17`、`ui/dropdown-menu.tsx:233`、`ui/select.tsx:146` 及 `globals.css:576–580`。第三版需要一并改为与边框相同的细线绘制方式；业务 section 已使用标准 1px 边框者保持。标题装饰、引用侧标、选中标记、时间轴和焦点圈不属于结构分割线，不应一刀切削薄。桌面 caption 部分边框当前有 `calc(1px / zoom)` 补偿，拟只统一结构边框宽度，保留窗控高度、安全区和间距补偿；实际缩放表现留待实施后验证。

本机实际安装的 `react-resizable-panels 4.14.2` 在 `dist/react-resizable-panels.js:3075` 默认配置鼠标命中宽度 10px、粗指针宽度 20px；第 126–139 行按中心扩展小元素的命中矩形，第 2037 行在 document 注册指针事件。细边框仍可使用不可见的扩展拖拽范围，不需要额外可见沟槽。实际拖动和遮挡命中须在实施后验证。

## 宣纸底色

| 区域 | 当前底色 | 真实组件来源 |
| --- | --- | --- |
| 左导航 | `#efe6cf` | `globals.css:147`，`SidebarTree.tsx:1673` 的 `bg-sidebar` |
| AI 对话 | `#f0e7d1` | `globals.css:275`，`ChatPanel.tsx:1664` 的 `.chatpane bg-chat-bg` |
| 右内容区 | `#f9f4e4` | `globals.css:158`，`ContentTabs.tsx:69` 的 `bg-editor` |

原导航与 AI 底色的 RGB 差仅为 `(1, 1, 2)`。第二版的左右色为 `#efe6cf`，AI 为 `#f9f4e4`，色差又偏大。第三版将三者全部提浅：左 `#f5eedc`、AI `#faf6e8`、右 `#f8f3e4`。AI 与左的 RGB 差从 `(10,14,21)` 缩为 `(5,8,12)`，AI 与右缩为 `(2,3,4)`，右侧更接近中间。

`ChatPanel` 的主返回始终包含 `.chatpane`，未选择会话时也没有缺失主题作用域的提前返回分支。无需重构空会话布局或新增假对话。

## 右侧面板的配色边界

多数业务面板根节点透明并透出 `ContentTabs` 的编辑底色，候选稿面板明确使用 `bg-editor`。正文 Monaco 在 [`monaco-setup.ts`](../../src/components/editor/monaco-setup.ts) 第 43 行也使用 `#f9f4e4`；第三版需同步右侧正文底面为 `#f8f3e4`，避免容器断层。

规划面板共享 [`planning.module.css`](../../src/components/content/planning/planning.module.css) 第 1–4 行的 `var(--background)`，宣纸下为 `#f4edda`。第三版需让规划底面读取专用内容底色变量，回退时使用原 `--background`，同步右侧 `#f8f3e4`；表单、卡片和图像遮罩继续使用自身原变量。

场景面板使用 `.scpane bg-chat-bg`，宣纸作用域未声明自身 `--chat-bg`。第三版在右内容区内让 `.scpane` 明确读取右侧底色。

Monaco 的纸色主题当前是全局注册。AI 中的任务详情也使用 `MarkdownEditor`，直接修改全局 Monaco 宣纸主题会连带改变 AI 里的编辑器。其运行样式在 `node_modules/monaco-editor/esm/vs/editor/browser/widget/codeEditor/editor.css:26,30` 读取 `--vscode-editor-background`，行号槽在 `viewParts/margin/margin.css:7` 读取 `--vscode-editorGutter-background`。第三版拟只在右内容区的 `.monaco-editor` 覆盖这两个变量，保留全局主题和编辑实例。

## 拟议最小修改

1. 左右 `ResizeHandle` 采用仅边框占位，声明 1px 边框，与横线绘制方式相同，不保留实色底条、内嵌子线或亮色沟槽。保留库的不可见拖拽命中范围、键盘调整和原分栏逻辑。
2. 宣纸导航改为 `#f5eedc`；AI 主底为 `#faf6e8`，气泡和输入框表面为 `#fcf8ee`，浮层保留 `#fefcf4`。右内容主表面、标签条和正文底面为 `#f8f3e4`。
3. 分区线恢复通用 `--border` 的 `#d8cba6`，结构分割线以相同的 1px 边框声明统一。hover、active 在线内反馈，不扩宽、不画亮边。标题装饰、焦点和状态标记保留自身语义。
4. 右内容区设置专用底色与 `--editor-bg`，规划底面、场景底面和 Monaco 正文及行号槽局部同步。不得全局覆写 `--background`、`--border` 或 Monaco 的宣纸主题。

第三版配色仅在宣纸工作区局部接入，右标签条与右内容区底色一致。玄墨底色保持现有值，分栏也改为与横线相同的边框绘制方式。纸纹、文本、选中态和原组件布局继续使用真实样式。

修改落点拟为 `src/app/desktop.css`、`src/components/layout/DashboardShell.tsx` 和规划工作区的 CSS 底色引用；通用 Separator、菜单分隔与 Markdown hr 可通过桌面 CSS 接入，无需替换组件。外观范围包含三栏底面、AI 元素层、右内容正文和结构分割线；已符合相同细边框方式的业务组件保持。仍复用原组件，不修改上游目录，不以 `design/desktop-preview.*` 替代真实工作台，符合 [`implementation-boundaries.md`](../implementation-boundaries.md) 的组件复用边界。

## 验证范围

设计预览使用隔离数据的现有 React 工作台，在预览进程内临时覆盖样式；这属于待审核方案，不代表产品实现或测试通过。

实施后的用例需覆盖：分栏、顶栏、账户、标签条、菜单和业务 section 的线宽一致，面板之间无亮色空隙；记录声明宽度、计算使用宽度、Electron zoom 和 DPR，覆盖 75%、100%、150%、200% 及字号变化。继续覆盖线旁拖动、遮挡、hover、键盘调整、显隐、全屏、窄窗、空态和有消息会话；普通、规划、场景、候选稿和正文 edit/split/preview、行号槽及 AI 内嵌编辑器；主题切换与重开。编辑器保持选区、撤销、输入法和草稿。分别记录自动、构建与真实 Windows 结果。

仓库既有全量验证记录存在失败，因此不能提前承诺全量通过。后续运行须保留真实结果，定位并处理失败，不能用局部样式检查替代整组业务验收，也不能把本机 Windows 结果记为 macOS 验收通过。

## 独立源码审核

独立子代理确认普通结构线原本大多为 1px、caption 的 zoom 补偿需单独收口，以及右规划、场景和 Monaco 的局部配色范围。第三版采集按实际横竖使用宽度相等检查，没有将声明 1px 冒充当前环境计算使用值为 1px。前两版保存在 `design/workspace-surfaces/archive-v1/` 和 `archive-v2/`，不作为当前实施依据。第三版另行独立审核。

下一产物：[工作区分割线与宣纸底色设计](2026-10-10-workspace-surfaces-design.md)。
