# 宣纸工作区细分割线与底色实施方案

2026-10-10。用户已明确通过第三版 UI。实施依据为本日调研、设计及独立设计审核，不沿用被替代的前两版。

## 修改与边界

1. `DashboardShell` 保留原 Group、Panel、动画、布局存储与组件，仅让两个 ResizeHandle 都使用无子元素的 `.workspace-resize-handle`。在桌面 CSS 中使用零内容宽度、content-box、1px border-left、flex 不增长；透明底色且仅边框占位。hover/active 只改变线色。沿用库原本的不可见命中扩展与键盘语义。
2. `desktop.css` 宣纸局部导航 `--sidebar:#f5eedc`、AI `--chat-bg:#faf6e8`、元素表面 `#fcf8ee`、overlay `#fefcf4`。右侧局部 `--workspace-content-bg:#f8f3e4`、`--editor-bg` 与 `--sidebar` 同步；导航与右标签条的 `--sidebar-border` 局部指向原 `--border`。不改全局主题背景、边框或 Monaco 注册值。
3. 规划 `.workspace` 底色读取 `var(--workspace-content-bg,var(--background))`，右试验场 `.scpane` 读取内容底色，场景 `.scene-workspace` 局部覆盖根背景；右 Monaco 实例覆盖正文与 gutter 的 CSS 变量。真实业务组件继续使用原有背景层次；AI 内嵌编辑器不会继承右侧变量。无需替换或重新挂载任何组件。独立代码审核发现场景根原本覆盖父底色，已用固定期望 SURF-05 记录 RED 后修正；详情见代码审核。
4. 通用 Separator（水平/竖直）、dropdown/select 分隔与 Markdown hr 从 1px 实色层改为 1px 细边框，颜色使用原 `--border`，桌面所有主题通用。独立审核发现 `MarkdownEditor.tsx:348,380` 的 split 中列也是固定 1px 实色层：给原 split 容器及分隔元素增加语义 class，在桌面 CSS 将中列改为 auto、分隔元素零内容宽加 border-left，以实际边框占位，继续保留左右 `minmax(0,1fr)` 和原编辑器生命周期。现有标准 1px 业务 section/设置边框保留；标题装饰、引用标记、选中 Tab、焦点与状态图形不属于结构分割线。
5. Windows caption 的结构 border-bottom 统一为 1px；同一头部 padding-top 同步为 1px，与底边平衡，保持现有 44 DIP 行高、16 DIP 按钮中心、原生安全区和其他尺寸。选中 Tab 的顶部标记保留原 zoom 补偿。不同 DPR/zoom 使用浏览器实际边框取整，与普通 UI 横线比较，不能强断言始终是 1 CSS px。

只改当前独立仓库，不改上游，不写入预览示例、真实用户数据或 Key。设计目录是审核媒介，安装版继续是原真实 React 工作台。

## 验证与执行

先独立审核本方案，再编写/审核测试清单与实际用例；先记录旧代码的实质失败，再修改产品并复跑。专项检查应使用独立固定颜色期望及实际线宽/面板几何，不以实现声明推导期望。浏览器夹具明确区分模拟数据与真实目标程序。

运行完整 unit/integration、完整 browser、types 与构建。运行新构建的离线 Windows Electron 工作台，隔离数据根，无模型，验证不同 zoom、字号、显隐/全屏/窄布局、边缘鼠标拖拽与键盘、空态与有消息、普通/规划/场景/候选稿/正文 edit/split/preview 及 AI 内嵌编辑器。保存原始截图、计算样式与来源哈希；对编辑器检查选区、撤销、输入/草稿不因配色切换丢失。需要包时构建并检查包；不能使用旧 bundle 代表新实现。

主代理负责组合与验收，独立子代理按只读范围审核方案、用例、代码及证据。更新本次 requirements 台账与迁移清单的有限证据，不把本次样式测试提升为全部业务、多供应商或 macOS 正式验收。既有全量失败必须真实记录并定位，不能用启动冒烟代替业务测试。

交付顺序：已交付调研 → 已批准 UI v3 → 本方案/用例审核与 TDD 实现 → 测试证据 → 全部要求通过后的总结。
