# 工作区分割线与宣纸底色调研

日期：2026-10-10。源码基线：`b1af4fb9e2d75104974514ec674df33d723ebe4e`。

本次修改统一左导航与 AI 对话之间的分割线，并让宣纸主题的导航、AI 对话、右内容区具有轻微色差。当前左分隔条默认透明，导航与 AI 底色几乎相同。建议复用右分隔条已有的常驻细线，仅加深宣纸导航底色，保留对话及内容区现有配色。

## 用户要求与阶段顺序

用户提供的局部截图显示导航右缘存在浅色竖带，导航与相邻区域不易分辨。截图用于定位视觉问题；颜色和实现原因以当前源码及隔离预览的计算样式为依据。

本次按最新要求推进：调研文档 → UI 设计稿并由用户审核 → 代码实现 → 测试 → 全部通过后总结。最新的设计审核要求覆盖旧批准记录中无需重复审核的阶段约定。设计确认后，继续执行仓库要求的技术方案独立审核、测试用例独立审核、TDD、独立 code review 和真实目标系统验证。

## 分割线实现

[`DashboardShell.tsx`](../../src/components/layout/DashboardShell.tsx) 第 48–53 行的 `ResizeHandle` 使用原 `react-resizable-panels` 分隔条。拖拽区宽 4px，默认透明；设置 `withLine` 后，在中间绘制宽 1px 的 `bg-border` 细线。hover 和拖动仍使用现有 primary 高亮。

左分隔条在第 492 行未设置 `withLine`，右分隔条在第 511 行设置了该属性。因此两者的默认外观不同。源码没有左分隔条白色渐变或专属白线，不能把截图中的竖带直接归因为白线实现。

[`globals.css`](../../src/app/globals.css) 第 144 行的宣纸通用分隔色为 `#d8cba6`；第 215 行的玄墨通用分隔色为 `rgba(255, 248, 240, 0.09)`。AI 顶栏采用 `border-border`，右侧常驻分隔线采用 `bg-border`，二者使用同一颜色变量。左侧也使用这个变量即可统一默认外观，无需新增颜色或改变分栏宽度。

## 宣纸底色

| 区域 | 当前底色 | 真实组件来源 |
| --- | --- | --- |
| 左导航 | `#efe6cf` | `globals.css:147`，`SidebarTree.tsx:1673` 的 `bg-sidebar` |
| AI 对话 | `#f0e7d1` | `globals.css:275`，`ChatPanel.tsx:1664` 的 `.chatpane bg-chat-bg` |
| 右内容区 | `#f9f4e4` | `globals.css:158`，`ContentTabs.tsx:69` 的 `bg-editor` |

导航与 AI 底色的 RGB 差仅为 `(1, 1, 2)`。纸纹叠加后，两区很难依靠底色区分。右内容区已经较浅，适合继续保留作为编辑和阅读表面。

`ChatPanel` 的主返回始终包含 `.chatpane`，未选择会话时也没有缺失主题作用域的提前返回分支。无需重构空会话布局或新增假对话。

## 右侧面板的配色边界

多数业务面板根节点透明并透出 `ContentTabs` 的编辑底色，候选稿面板明确使用 `bg-editor`。正文 Monaco 在 [`monaco-setup.ts`](../../src/components/editor/monaco-setup.ts) 第 43 行也使用 `#f9f4e4`，保留右内容底色可以避免正文与容器断层。

规划面板共享 [`planning.module.css`](../../src/components/content/planning/planning.module.css) 第 1–4 行的 `var(--background)`，宣纸下为 `#f4edda`。因此把 AI 底色直接改为通用 `--background` 会让这些右侧规划面板与 AI 再次同色。本方案保留现有 AI 底色，规划面板仍比 AI 浅。

场景面板使用 `.scpane bg-chat-bg`，宣纸作用域未声明自身 `--chat-bg`；这需要实施后的计算样式确认。此次方案不全局扩展 `--chat-bg`，不改变场景消息、卡片、气泡及输入框的元素层样式。

## 拟议最小修改

1. 左 `ResizeHandle` 增加 `withLine`，复用右侧现有细线及通用分隔色。保留拖拽区、尺寸约束、hover 和 active 反馈。
2. 仅在桌面宣纸工作区的 `.workspace-sidebar` 内，将导航的 `--sidebar` 覆盖为 `#e9dec5`。AI 保留 `#f0e7d1`，内容主表面保留 `#f9f4e4`，形成从左到右逐步变浅的暖纸色。

局部覆盖不会改变全局 `--sidebar`，右侧标签条继续使用现有主题色。玄墨底色保持现有值；玄墨左分隔线同样复用通用 `--border`。纸纹、文本、选中态和原组件布局继续使用真实样式。

修改落点拟为 `src/app/desktop.css` 与 `src/components/layout/DashboardShell.tsx`。不修改上游目录，不以 `design/desktop-preview.*` 替代真实工作台，符合 [`implementation-boundaries.md`](../implementation-boundaries.md) 的组件复用边界。

## 验证范围

设计预览使用隔离数据的现有 React 工作台，在预览进程内临时覆盖样式；这属于待审核方案，不代表产品实现或测试通过。

实施后的用例需覆盖：两栏和三栏的默认分隔色；hover 和拖动；导航及内容区显隐；内容全屏；窄窗切换；无作品、空会话和有消息会话；普通面板、规划面板、场景面板、候选稿和正文编辑；宣纸与玄墨切换及重开后的主题状态。分别记录自动用例、构建检查与真实 Windows Electron 界面结果。

仓库既有全量验证记录存在失败，因此不能提前承诺全量通过。后续运行须保留真实结果，定位并处理失败，不能用局部样式检查替代整组业务验收，也不能把本机 Windows 结果记为 macOS 验收通过。

## 独立源码审核

独立子代理完成只读检查，确认左右 `withLine` 差异、导航与对话底色接近、真实组件持续复用，以及规划和 Monaco 配色边界。审核发现的右侧规划覆写已纳入最小方案。设计稿完成后还需独立核对方案与实际预览。

下一产物：[工作区分割线与宣纸底色设计](2026-10-10-workspace-surfaces-design.md)。
