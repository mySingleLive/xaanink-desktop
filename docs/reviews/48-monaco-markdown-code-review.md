# Monaco、Markdown 格式及正文命令独立代码审核

- 日期：2026-10-07
- 审核者：独立子代理 `/root/ui_revision_review`，不是本批实现作者。
- 状态：**限定范围通过（PASS）。本批发现均已修复，相关95项 Node 回归、16项隔离真实 DOM 回归和全项目类型检查通过；独立核对主代理执行的6组 macOS Electron 命令场景。没有未关闭的本批阻断项，不代表全部桌面应用验收通过。**
- 范围：`monaco-commands.ts`、`markdown-actions.ts`、原 Monaco 实例接线；本轮关联的 `shortcut-context.ts`、Dispatcher/Controller、`command-scope.ts`；`editor-comment-command.ts`、原评论/引用组件的命令接线和预览编辑命令。AI composer 由47另审，导航由49另审；不合并这些审核的通过数量。
- 未操作主代理的浏览器、运行 Electron 或修改产品实现；新增独立测试、适配自有旧测试的 DOM 形状及记录证据，独立运行网络全阻的无界面 Chromium DOM 测试。真实 Electron 操作由主代理执行，JSON、脚本与本地截图由本审核只读核对。

## 发现与修复

| 发现 | 原行为与可观察后果 | 修复与独立验证 |
| --- | --- | --- |
| FORMAT48-01/02 · P2 | 给首尾包含反引号的文本加行内代码，定界符合并；作者已有首尾空格被渲染器去掉。 | 选择更长的完整定界符，并按代码标记规则加语法空格。独立使用项目真实 `renderMarkdown` 验证生成 `<code>`、原文空格、反引号和再次切换恢复；不是只比较规划器自身输出。[CommonMark 代码标记规则](https://spec.commonmark.org/0.31.2/#code-spans)支持这一核对。 |
| FORMAT48-03 · P2 | 对 `**原文**` 设置斜体，旧通用切换误删一层星号，原加粗丢失。 | 区分强强调与斜体定界符，真实预览同时保留 strong/em，再次切换恢复原加粗。 |
| FORMAT48-04 · P2 | 自定义20项格式使用 `editorWritable`，已安装 Monaco 0.56 没有这一键，真实编辑器动作恒不可用。 | 主代理在 Electron 的加粗失败后定位；独立对实际安装的 `ContextKeyExpr` 和全部20项 precondition 得到 RED，改为 `!editorReadonly` 后可写/只读均通过。首次规划器测试的简单替身未发现它，不能用原 GREEN 否定原生失败。 |
| MONACO48-01 · P2 | 命令恢复焦点的同步回调替换正文 model 后，操作落到新作品。 | focus 前捕获 model 与 DOM，恢复后核验身份及可用性。实际 hub/目标适配器的替换 model 行为探针不再修改新 model。 |
| MONACO48-02 · P2 | 同一 core 命令两个参数变体分别受 `popup` / `!popup` 保护；编辑一个原绑定却误报另一分支冲突，可能转移删除它。 | 仅对运行时强制检查其 when 的参数变体，使用注册条件的 OR 做有限布尔互斥证明；普通 action 的键位 when 不代表全部命令可用条件。独立保存原绑定且未删除另一分支。比较/正则/非法或过大表达式保守保留冲突。 |
| MONACO48-03 · P2 | `getSupportedActions()` 暴露实例前缀 ID，而 `getAction()` 按原 descriptor ID 查找；格式动作重复进入目录或无法执行。 | 按真实 `getId()` 的精确前缀规范化；无 editor 的纯目录调用只处理已知20项格式后缀。独立检查无重复共享 ID，作者新增公共 instance ID 与第三方冒号 ID 用例。 |
| MONACOCTRL48-02 · P2 | 保留默认 Cmd+F 后追加第二绑定，旧 `hasOwn(override)` 将原默认也拦截，绕过原生 when/weight，歧义时直接吞键。 | 只识别默认与确认集合的差异；独立验证原默认交给原生，新增键经过同一 hub 执行一次。 |
| MONACOCTRL48-04/05 · P2 | 新增 `Cmd+K Cmd+F` 后，Cmd+F 仅作为后段仍被视作命中；未开始、已超时或配置失效的组合破坏原生默认。 | Controller 只在有效等待状态匹配后段；查询核验当前 scope/modal、绑定配置、焦点和 deadline。独立验证未等待/超时/确认配置变化时不吞默认，完整自定义组合仍执行。 |
| CONTEXT48-01/02 · P2 | 布尔条件合并使用 `key in object`，`constructor` 等名称命中继承属性，被误判互斥；冲突检查甚至随比较方向变化。 | 使用自有属性比较。独立对四种原型成员名称、相反真值、双向冲突发现及未知表达式保守性复测。 |
| COMMENT48-01、MONACOCTRL48-03 · P2 | Monaco 内的评论 textarea/find input 被 contains 当成正文；原生菜单引用或评论可使用背后保留的正文选区。 | Monaco/评论目标共享 scope；菜单 md/monaco 路径也门控 markdown/preview。独立验证普通输入不创建正文评论/引用，而原生 inputarea 与真实预览仍可执行适用命令。 |
| IME 表面归属 · P2 | 真实 Monaco 的第二个 chord 按键落到 readonly `.ime-text-area`；旧 scope 将它识别成普通输入，Cmd+0 被全局缩放命令吞掉。 | 主代理原生折叠失败及事件诊断定位，公共 scope 和普通输入适配器补真实 IME 表面。独立 MONACO48-04 验证 inputarea/native-edit-context/IME 三种正文表面只有正文 owner，普通评论输入仍只有输入 owner；该探针在修复后首次执行通过，不冒称独立 RED。 |
| MONACO48-05、COMMENT48-02 · P2 | 三栏响应式隐藏正文时，实例和 DOM 仍 connected，已捕获的命令还可修改隐藏正文或打开评论。 | 本审核保存实际 visible→hidden 行为 RED；目标可用性和评论 accepts 增加可见矩形核验。独立证明捕获后隐藏及重新调用均拒绝，重新显示后仍正常执行。 |

ViewZone/find 的范围问题首先由主代理源码检查提出，作者补充原生 inputarea 与普通控件回归；本审核独立延伸发现评论 helper 和菜单引用路径仍有同类遗漏，保留了各自行为 RED。不是把测试替身缺少 `closest`/`matches` 或新依赖导入错误当成产品 RED。

## 源码边界

目录取当前本地装配的编辑器 actions、keybinding registrations 和实例 supported actions，包含未绑定动作，没有代表性条数上限。Monaco 私有接口固定0.56，版本/平台/接口形状不匹配时报不可用；不创建隐藏正文 model 或用静态表冒称完整目录。别名共享桌面编辑 ID，参数对象按值形成独立稳定 ID，null 与未提供参数区分，注册参数保存不可变副本。

完整 primary/secondary/chord、when 和两级权重进入元数据。未改动的原生键交由真实 Monaco 处理；修改/删除绑定经过应用确认集合，空绑定不补默认。参数命令在执行前检查自己的注册条件，不能用兄弟分支或更宽的 core precondition 替代。普通 action 使用自身 support/precondition，不能把一个键位的条件误当全部入口条件。

20项静态 Markdown 格式均有具体规划器输出。多选区编辑合并为一次 native `executeEdits`，前后 undo stop，光标返回使用安装包的 Selection 类型；重叠 inline 选区拒绝，block 按完整行合并，CRLF 与末行首列不吞未选段落。没有 setValue、换 model 或绕过原 onChange/保存链。单元中的 undo stop/executeEdits 记录只是调用契约，真实历史由 Electron 场景另证。

评论命令复用原 selectionSnapshot/评论 composer，引用命令使用原 referenceSelection/ReferencePicker；受控身份或 scope 测试不能证明评论/伏笔全部领域事务或每种渲染选区都已验收。readonly 的修改动作按原生/业务条件拒绝，复制/选择仍需适用目标支持。

主代理新增 Cmd+K 的 capture → Monaco → bubble 顺序：未自定义且与正文共域的全局键先交原生；只有未被消费才用 global-only 命令集合解析，避免未激活的原生 chord 前缀把全局 fallback 堵住。已自定义、有效等待中的组合继续由应用管理。实际 Controller 的显式事件阶段测试通过，真实折叠/展开另由本批最终 Electron 场景证明；受控消费替身本身不提供原生结论。

预览五项 text 命令只注册原 `previewRef`，共用原 `MarkdownEditorHandle`、正文块映射与 Monaco 的 executeEdits；不创建替代编辑器。复制从正文块抽取并移除评论展示、按钮和装饰；映射不可靠的选区只能复制。预览/审核的全选在 DOM 完成，只读和只提供预览的组件不等待挂载编辑器。修改操作仅能切到组件声明的 edit/split，挂载等待有10秒上限，executeEdits(false)按失败处理。

桌面桥读写剪贴板；Web仍保留 navigator.clipboard。等待后复查请求票据、焦点/Tab激活、源文、model、当前 Range 与实际只读状态；卸载、模型替换、最终帧改选区均拒绝旧修改。系统剪贴板已发出的写入不能回滚，迟到写入后的守卫保证不会继续剪切正文。本审核新增 MONACOCTRL48-06/07，通过真实 Controller/Dispatcher/共享文本命令目录证明预览默认 copy/selectAll 由正文 owner 接管，显式空绑定不补默认，普通输入仍使用原生复制；不以仅目标层测试替代默认键接线证明。

## 最终证据

全部路径以下均位于 `docs/evidence/implementation-07/`。作者 `freeze-review.json` version3 的7份 SHA、`input-ime-surface-frozen.json` 的2份 SHA、`preview-text-frozen.json` 的5份 SHA 已独立逐文件核对匹配；后两份聚合指纹也匹配。初始 freeze、version2及 nested-controls 清单保留历史，不与最终源码混用。最终受审源/测试/证据指纹与运行边界记入 `48-independent-summary.json`。

独立行为 RED 保存于 `48-format-independent-red.tap`、`48-monaco-independent-red.tap`、`48-runtime-context-independent-red.tap`、`48-native-default-independent-red.tap`、`48-context-prototype-red.tap`、`48-comment-scope-red.tap`、`48-menu-nested-scope-red.tap`、`48-secondary-chord-native-red.tap`、`48-secondary-chord-lifetime-red.tap` 和 `48-hidden-owner-independent-red.tap`。修复前失败不累计为最终通过。

- `48-final-related-independent-green.tap`：16个相关 Node 文件，**95/95通过，0跳过/取消，退出0**。其中本审核新测试为格式4、Monaco5、Controller7、上下文3、评论2，共21项；其余为作者及关联回归。较早的9/19/41项 GREEN 不累加。
- `48-preview-dom-independent.tap`：独立复跑作者16项，**16/16通过，0跳过/取消，退出0**。真实 Chromium DOM/Range，React生命周期、Monaco模型/剪贴板为受控替身，网络全部阻断；不等同于原生场景。先前的 missing-browser、Mach权限限制日志属于启动环境失败，没有产品行为 RED；使用已有1228无界面浏览器并获自动审批解除 Mach 限制后通过。
- `48-final-independent-typecheck.txt`：全项目 `tsc --noEmit --incremental false` **退出0**。先前的 mixed catalog 类型错误是本审核夹具把普通文本命令传进 Monaco 目标参数，已将目标注册与全局调度目录分开，未修改产品实现或断言；旧错误日志保留。
- 自有旧46 Controller/输入接线夹具只接入真实 commandScope，准确区分 `.inputarea` 与普通 input；不改变原行为断言。缺依赖/缺 DOM 方法不是产品 RED。

主代理最终 `commands-latest.json` 为 **6组真实 macOS arm64 Electron 场景通过、errors=[]、进程退出0**，开始14:47:44Z，build75412包含隐藏 owner 修复与预览冻结终稿：首文档前目录加载；AI clear/undo/newline；普通输入原生菜单 cut/undo 与自定义 paste/undo；原 Monaco 加粗/undo；Cmd+K Cmd+0 折叠与 Cmd+K Cmd+J 展开；预览 Cmd+A、原生菜单 copy 仅正文、Cmd+X切原编辑器、Cmd+Z恢复。JSON、实际 smoke 断言及 `native-commands.png` 已只读复核。这6组不加入95或16，不把先前失败 run、旧build或截图单帧作为通过证据；最终build不包含后续phase08正文日志/保存接线。

Windows、物理键盘长按/IME输入与平台词语行为、全部 runtime action 的逐项业务 oracle、所有副绑定/chord、应用菜单上下文实时置灰、评论/引用完整业务事务、两平台安装包以及正式531条顶层用例，均不由本审核替代。阶段07本批代码允许继续推进，整体桌面应用验收仍未完成。
