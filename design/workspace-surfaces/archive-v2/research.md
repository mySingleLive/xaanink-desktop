# 工作区分割线与宣纸底色调研

日期：2026-10-10。当前方案：第二版。源码基线：`b1af4fb9e2d75104974514ec674df33d723ebe4e`。

本次修改统一工作区分割线，并让宣纸三栏形成两侧较深、中间较浅的色差。最新反馈要求只保留 1px 深色单线、去掉旁边亮色竖带，覆盖首版的 4px 透明拖拽区与左深右浅方案。第二版采用左右 `#efe6cf`、AI 中间 `#f9f4e4`，分栏由元素本身绘制 1px 暖棕深线。

## 用户要求与阶段顺序

用户提供的局部截图显示导航右缘存在浅色竖带，导航与相邻区域不易分辨。首版预览保留了 4px 透明分隔区，用户进一步明确去掉线旁亮带，并将三栏底色改为两侧深、中间浅。截图用于定位视觉问题；颜色和实现原因以当前源码及隔离预览的计算样式为依据。

本次按最新要求推进：调研文档 → UI 设计稿并由用户审核 → 代码实现 → 测试 → 全部通过后总结。最新的设计审核要求覆盖旧批准记录中无需重复审核的阶段约定。设计确认后，继续执行仓库要求的技术方案独立审核、测试用例独立审核、TDD、独立 code review 和真实目标系统验证。

## 分割线实现

[`DashboardShell.tsx`](../../src/components/layout/DashboardShell.tsx) 第 48–53 行的 `ResizeHandle` 使用原 `react-resizable-panels` 分隔条。拖拽区宽 4px，默认透明；设置 `withLine` 后，在中间绘制宽 1px 的 `bg-border` 细线。hover 和拖动仍使用现有 primary 高亮。

左分隔条在第 492 行未设置 `withLine`，右分隔条在第 511 行设置了该属性。因此两者的默认外观不同。源码没有左分隔条白色渐变或专属白线，不能把截图中的竖带直接归因为白线实现。

[`globals.css`](../../src/app/globals.css) 第 144 行的宣纸通用分隔色为 `#d8cba6`；第 215 行的玄墨通用分隔色为 `rgba(255, 248, 240, 0.09)`。AI 顶栏和右侧常驻分隔线使用同一通用变量。但只补 1px 子线仍留下 3px 透明空隙，透出底层较亮背景。第二版把整个分隔元素从 4px 改为 1px，直接绘制深色，不保留子线或透底沟槽。

本机实际安装的 `react-resizable-panels 4.14.2` 在 `dist/react-resizable-panels.js:3075` 默认配置鼠标命中宽度 10px、粗指针宽度 20px；第 126–139 行按中心扩展小元素的命中矩形，第 2037 行在 document 注册指针事件。由此，1px 占位仍可保留不可见的扩展拖拽范围，不需要额外可见沟槽。实际拖动和遮挡命中须在实施后验证。

## 宣纸底色

| 区域 | 当前底色 | 真实组件来源 |
| --- | --- | --- |
| 左导航 | `#efe6cf` | `globals.css:147`，`SidebarTree.tsx:1673` 的 `bg-sidebar` |
| AI 对话 | `#f0e7d1` | `globals.css:275`，`ChatPanel.tsx:1664` 的 `.chatpane bg-chat-bg` |
| 右内容区 | `#f9f4e4` | `globals.css:158`，`ContentTabs.tsx:69` 的 `bg-editor` |

导航与 AI 底色的 RGB 差仅为 `(1, 1, 2)`。纸纹叠加后，两区很难依靠底色区分。第二版把原来右内容区的浅纸色用于 AI 中间主底，右内容区调整为与左导航一致的较深纸色。

`ChatPanel` 的主返回始终包含 `.chatpane`，未选择会话时也没有缺失主题作用域的提前返回分支。无需重构空会话布局或新增假对话。

## 右侧面板的配色边界

多数业务面板根节点透明并透出 `ContentTabs` 的编辑底色，候选稿面板明确使用 `bg-editor`。正文 Monaco 在 [`monaco-setup.ts`](../../src/components/editor/monaco-setup.ts) 第 43 行也使用 `#f9f4e4`；第二版需同步其右侧底面，避免正文与调整后的容器断层。

规划面板共享 [`planning.module.css`](../../src/components/content/planning/planning.module.css) 第 1–4 行的 `var(--background)`，宣纸下为 `#f4edda`。第二版需让规划的工作区底面读取专用内容底色变量，回退时使用原 `--background`，以同步右侧深纸色。这样可保留右侧表单、卡片和图像遮罩自身的原变量。

场景面板使用 `.scpane bg-chat-bg`，宣纸作用域未声明自身 `--chat-bg`。第二版在右内容区内让 `.scpane` 明确读取右侧底色，防止后续继承 AI 中间的浅色。

Monaco 的纸色主题当前是全局注册。AI 中的任务详情也使用 `MarkdownEditor`，直接修改全局 Monaco 宣纸主题会连带改变 AI 里的编辑器。其运行样式在 `node_modules/monaco-editor/esm/vs/editor/browser/widget/codeEditor/editor.css:26,30` 读取 `--vscode-editor-background`，行号槽在 `viewParts/margin/margin.css:7` 读取 `--vscode-editorGutter-background`。第二版拟只在右内容区的 `.monaco-editor` 覆盖这两个变量，保留全局主题和编辑实例。

## 拟议最小修改

1. 左右 `ResizeHandle` 都以 1px 元素本身绘制分割线，不保留 4px 透明区或内嵌子线。保留库的不可见拖拽命中范围、键盘调整和原分栏逻辑。
2. 宣纸导航保留现有 `#efe6cf`；AI 主底改为 `#f9f4e4`，气泡和输入框表面略浅为 `#fcf8ee`，浮层保留 `#fefcf4`。右内容主表面及正文底面改为 `#efe6cf`。
3. 新增局部工作区分割变量 `#b8a783`，只统一两条分栏、AI 顶栏、账户横线、内容标签条底边和窄窗导航边界。hover、active 可在同一 1px 线内反馈，不扩宽、不画亮边。卡片、表单及徽章描边保留原变量。
4. 右内容区设置专用底色与 `--editor-bg`，规划底面、场景底面和 Monaco 正文及行号槽局部同步。不得全局覆写 `--background`、`--border` 或 Monaco 的宣纸主题。

第二版保持全局 `--sidebar`，右标签条原本就使用 `#efe6cf`，可与两侧保持一致。玄墨底色保持现有值，分栏占位同样为 1px 并读取玄墨已有分隔色。纸纹、文本、选中态和原组件布局继续使用真实样式。

修改落点拟为 `src/app/desktop.css`、`src/components/layout/DashboardShell.tsx` 和规划工作区的 CSS 底色引用。相比首版，外观范围扩展至 AI 元素层、右内容正文及分区横线；仍复用原组件，不修改上游目录，不以 `design/desktop-preview.*` 替代真实工作台，符合 [`implementation-boundaries.md`](../implementation-boundaries.md) 的组件复用边界。

## 验证范围

设计预览使用隔离数据的现有 React 工作台，在预览进程内临时覆盖样式；这属于待审核方案，不代表产品实现或测试通过。

实施后的用例需覆盖：两栏和三栏仅 1px 深线、相邻面板之间没有亮色空隙；线旁拖动和遮挡命中、hover 和键盘调整；导航及内容区显隐；内容全屏；窄窗切换；无作品、空会话和有消息会话；普通面板、规划面板、场景面板、候选稿、正文 edit/split/preview、行号槽及 AI 内嵌编辑器；宣纸与玄墨切换及重开后的主题状态。编辑器适配须保持选区、撤销、输入法和草稿。分别记录自动用例、构建检查与真实 Windows Electron 界面结果。

仓库既有全量验证记录存在失败，因此不能提前承诺全量通过。后续运行须保留真实结果，定位并处理失败，不能用局部样式检查替代整组业务验收，也不能把本机 Windows 结果记为 macOS 验收通过。

## 独立源码审核

独立子代理完成源码只读检查，确认原分隔条差异、第二版 1px 元素可使用库默认扩展命中区，以及右规划、场景和 Monaco 的局部配色范围。首版产物保存于 `design/workspace-surfaces/archive-v1/`，不再作为当前实施依据。第二版设计预览另行审核。

下一产物：[工作区分割线与宣纸底色设计](2026-10-10-workspace-surfaces-design.md)。
