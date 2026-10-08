# 恢复目标与原工作台布局接线独立审核

- 日期：2026-10-08。
- 审核者：独立子代理 `/root/ui_revision_review`，不是本批实现作者。
- 结论：**限定范围通过（PASS）**。一项实际卸载布局缺陷由两个独立行为探针复现，修复后复验通过；本批没有未关闭的阻断项。独立执行Node 14/14、隔离Chromium 4/4，完整项目类型检查退出0。所有531条正式用例保持既有not-run状态，不把本结论当成两平台或整体桌面验收。
- 范围：`recovery-targets.ts`、`workspace-layout.ts`、原 `DashboardShell.tsx` 的恢复adapter接线、`RecoveryDialog.tsx`，以及 `DesktopApp.tsx` 中实际 `restore` / `installSources` 回调。本审核不修改实现或作者测试，不运行Electron。
- 不在本结论内：DesktopApp完整启动、DraftSession初始化/关闭/取消握手、main journal持久性、IPC归属代数、原生文件导出和系统剪贴板。这些由51/55及后续实际验收证明；54的恢复算法结论不重计为本轮新增测试。

## 实际发现、修复与复验

| 问题 | 独立失败行为 | 修复及最终结果 |
| --- | --- | --- |
| REC56-L01/L02 · P2 · 同一根因的两个探针 | 实际 `react-resizable-panels` 的Group先清除imperative ref，原DashboardShell父级随后释放adapter。释放时read把已量测20/35/45%的三栏宽度写成 `{}`；重挂载使用默认宽度。第二探针在隐藏侧栏、退出内容全屏、收起内容后卸载，恢复的标志仍为sidebarVisible=false，但实际侧栏占420px、聊天只有1020px。 | 主代理新增lastMeasuredSizes，只接受包含sidebar/chat的完整量测，Group已卸载时保留最近有效值。原有visibility规范化、面板集合、动画及布局API保持复用。两项原断言均不变；最终三栏重挂载宽度误差小于2px，隐藏侧栏恢复后聊天占完整1440px、内容保持卸载。 |

`56-layout-detach-red.tap` 的4项中2项失败，正是上表两个探针，其余窄窗与恢复对话框当时已通过。`56-browser-layout-fix-green.tap` 4/4通过。最早的 `56-browser-first-run.tap` 是esbuild同步构建不支持plugins的夹具错误；改成异步构建后才产生实际行为RED，不把该日志当产品失败。

## 目标归属与恢复来源

目标校验只构造现有本地只读GET路径，先检查作品，再检查集合或详情中的记录；未知类型、危险id、跨作品记录及错误payload不恢复。没有从恢复元数据取URL、HTTP方法或body，也不调用原保存、审批或模型入口。Abort发生后迟到GET/json不能授权恢复。

候选评论缺少chapterId时使用原 `comments GET`，不猜测章节。独立REC56-T01执行当前该GET及原 `readTextTarget` 的实际函数体、实际query schema/ContentError/contentHash，使用按真实where条件过滤的受控数据表；只有当前作者、当前作品、存在的候选能返回threads，其他作品、其他作者及不存在的候选均拒绝，且不调用listThreads。该测试不是对Prisma/PGlite、实际鉴权或IPC的完整验收；getOwnedNovel与数据库是受控依赖，实际readTextTarget的作者/作品查询约束则确实执行。

DesktopApp测试提取并执行当前AST中 `new DesktopDraftSession` 的两个实际回调，不重写回调逻辑，也不执行整个bootstrap effect。restore复用原评论store和来源恢复函数，仅只读查询候选目标；保留的执行元数据仍是查看/导出数据，提示中的“查看草稿”打开恢复入口，没有重放。

installSources实际注册chat、scene、staged、workspace、recovery、comments共六来源，原评论修改触发coordinator revision变化。正常释放清除六来源；中途已有workspace造成注册失败时逆序释放本次已注册来源，保留原workspace，不留下部分订阅。

关闭自动恢复时，实际restore回调返回deferred afterCheckpoint；原owned缓存在回调返回时未清理。测试由调用方先完成受控writer的checkpoint ACK，再执行清理并完成第二checkpoint。回调本身不证明主进程fsync或完整初始化顺序，55仍须证明实际调用方在双ACK之后才开放编辑。

## 原工作台与恢复对话框的实际DOM验证

布局测试挂载当前原DashboardShell、真实React与安装的 `react-resizable-panels`，执行真实Group/Panel/Separator、原minSize/默认宽度、visibility及动画回调；使用当前构建生成的Web CSS。业务子组件ChatPanel/SidebarTree/ContentTabs只替换为调用原传入callback的简小按钮，命令和通知受控；不据此宣称29业务面板全部可用。

1440px实际矩形验证三栏20/35/45%恢复、卸载保存及重挂载，内容全屏、退出全屏和收起内容后的可见区/宽度一致。640px执行原“返回对话”按钮，聊天与内容实例均保留、可见区切换到聊天，narrowPane更新；没有另建响应式工作台。没有实际拖拽分割线、缩放/字体组合、Windows或物理屏幕宽度验收。

恢复对话框挂载当前React/BaseUI/Dialog/Button及实际recovery store/coordinator：选择第二项，读取只读原内容，复制正确当前项；导出包含未执行operationId的完整合法snapshot，使用当前draftSessionId，等待时按钮禁用。受控导出拒绝后按钮恢复、两份原稿仍在、错误提示不回显异常中的私有路径。640px对话框边界位于视口内，Escape关闭。含HTML字样的稿件只作为textarea值，不执行。复制/导出桥是内存替身，不接系统剪贴板、原生picker或磁盘。

## 独立执行证据

证据位于 `docs/evidence/implementation-08/`：

- `56-layout-detach-red.tap`：4项，2通过2失败，退出1，0跳过/取消。两个失败同一根因，不声称发现两项独立缺陷。
- `56-browser-layout-fix-green.tap`：本审核新增4项**4/4通过**，退出0，0跳过/取消；实际隔离Chromium/React/Group/BaseUI。
- `56-final-node-independent-green.tap`：本审核新增4项与作者target 6项、layout 4项，共**14/14通过**，退出0，0跳过/取消。不把早期bindings/重复复跑或54的数量累加。
- `56-final-independent-typecheck.txt`：完整项目 `tsc --noEmit --incremental false --pretty false` **退出0**，空诊断。
- `56-independent-summary.json`：当前受审版本、独立测试、实际CSS/依赖与上述证据的SHA指纹。DesktopApp整文件指纹只标识版本，通过范围仍限两回调，不覆盖55负责的完整启动/关闭逻辑。

浏览器无可见用户窗口；所有导航由隔离测试内存响应，其余请求全部abort，未访问用户缓存、作品、数据库、付费模型或系统剪贴板。Node依赖用隔离owned storage、受控target fetch与writer，执行真实来源安装和原store逻辑。独立新增8项均为可观察行为断言，没有以静态字符串存在当接线成功。

主代理另执行真实macOS开发Electron，`native-recovery.json` 记录4组通过：窗口关闭保存未批准staged正文且不改原正文，activate恢复tab/layout/composer；直接destroy窗口恢复已ACK输入且不发模型请求；关闭恢复保留副本并开空工作台；坏journal阻止编辑但未修改窗口可关闭且原字节保留。本审核只读取其结果，不冒称自己独立执行；该证据没有分栏拖拽宽度、物理Dock点击、系统崩溃、原生picker或Windows验证，不扩展到531项正式验收。

本批批准的是恢复目标、来源接线、原工作台尺寸/可见状态和保留稿查看/导出UI的上述边界。实际持久writer、双ACK启动门禁、原生退出与双平台完整验收继续按各自范围验证。
