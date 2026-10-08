# 71 · 主进程根迁移与维护进程实际接线独立审核

日期：2026-10-08。审核者：ui_revision_review。主代理实现，审核者只读源码并新增独立行为测试；未运行 Electron 或操作主代理的窗口。

## 最终结论与范围

**限定 PASS**。本轮独立复现的四处接线问题已修复，24项新独立测试、78项相关回归与最终全量 tsc通过，无本范围剩余阻断。531条正式验收用例仍 not-run。

范围：`desktop/main/index.ts` 新增 businessHandle、closeData/release/commit、恢复接纳/普通复开窗、迁移 IPC/native选择确认与 owner、启动维护分支；`root-maintenance-window.ts` 的隔离会话/窗口/IPC/冷启动回调；`static-ui.ts`、maintenance preload、工作台 preload 的迁移桥；CloseCoordinator 的异步 release屏障；启动 page的模式选择、DataRootMigrationButton以及 DesktopApp 的取消失败提示/重试接线。full-file SHA用于版本识别，不意味着重新批准 index/DesktopApp 的所有既有模型/图片/设置业务。

第70轮小模块是本轮依赖。RootMaintenanceRunner 和 RootMaintenanceScreen由其他代理分别审核72/73，不纳入71的实现批准。主代理后续发现 runner退出回调同步重入问题，其v3尚在修复时本轮已冻结 main范围；下述原生v2证据不代表最终runner版本的整体验收。

## 实际 RED 与修复

| 编号 | 实际问题 | 修复与独立复验 |
| --- | --- | --- |
| M71-01 | 取消持久失败后 closingFlow 已释放，但 gate仍closed；原生 file.open只检查closingFlow，仍能 picker→consume→worker open-work→event。 | 原生命令也检查已关闭的 gate；quit/close保留取消重试入口。file.open整个异步动作登记 gate，picker/consume回执后重核窗口、closing与gate。取消pending或晚到已关门选择不能打开作品。 |
| M71-02 | 图片协议直接 image-asset RPC，不计入 drain；读取暂停时 gate.close已完成，可能在已闭库后重新打开作品数据库。 | work/scene图片RPC及全局头像读取都登记真实 gate；晚到读取拒绝，已接纳读取等待完成，静态UI仍可读取。新 bootstrap读取也登记 gate。 |
| M71-06 | 迁移已prepare，但用户在运行任务确认中取消停止；未到 closeData，取消持久化失败只发pending事件，gate仍open。提示“暂不接受修改”时实际还能接纳新修改。 | release错误先同步停止接纳，再发pending；不把尚未关闭的资源谎称businessClosed。beginClose的取消重试条件使用gate.closed；restoreBusiness为异步，真正drain后才reopen。既有任务允许完成，新的业务拒绝。 |
| M71-10 | macOS正常window-only close已提交后 gate/businessClosed保持关闭；activate新建窗口只resume模型服务，gated bootstrap被拒绝。 | 正常复开先安全恢复门控；有closingFlow、待处理迁移或quitting时拒绝复开。独立正/负分支均通过，并有主代理实际Electron close→activate事件复验。 |

真实失败记录：`review71-menu-asset-red.tap` 3项/1PASS/2FAIL；`review71-early-cancel-red.tap`、`review71-window-reopen-red.tap` 各1项/1FAIL，均exit1。第一份的异步release正向测试原本即通过。以上是执行当前函数的副作用/等待断言，不是静态字符串检查。

旧第55轮 effect夹具在相关回归中缺新setMigrationPending注入，产生 ReferenceError；74/75的原日志保留为 `review71-related-harness-attempt.tap`。只补受控setter，原“未就绪关闭不能初始化/覆盖草稿”断言不变。原生图片协议旧第60轮夹具已由主代理注入真实BusinessGate，仍保留原响应/配额断言。原审核历史指纹不重写，夹具接线错误不计产品RED。

## 新独立测试覆盖

四个新文件，24个顶层用例：

- `root-maintenance-main-review.test.ts` 11项。运行实际 main函数、协议回调和CloseServices对象，并用真实BusinessGate/CloseCoordinator：native命令阻隔、资产读取drain、异步release仍属于同一flight、草稿ACK→请求取消/已接纳工作→配置flush/repository→worker close ACK→arm ACK→relaunch/quit顺序；取消不确定保持门控与模型暂停；早期取消不虚构closed且恢复等待既有工作；bootstrap拒绝关门后的读取；已打开picker晚到选择不产生consume/worker副作用；正常复开及三个拒绝复开分支。
- `root-maintenance-window-review.test.ts` 6项。实际维护窗口模块及真实DataRoot/FS/static UI，Electron和runner边界受控：首个await前设置bootstrap/session；source目录及设置字节保持、未创建source/session；只使用memory partition，disk partition立即拒绝；只注册两个维护IPC，要求当前未销毁窗口/精确主frame/精确URL，非法frame/URL/action拒绝；权限、导航、webview、window-open和远程/file请求拒绝；不提供asset/API桥；native close与before-quit共享取消等待；continue只有持锁时才安排冷relaunch；restricted preload仅暴露state/command/subscribe且能卸载监听；实际入口根据同步preflight选择维护、普通启动或锁拒绝，不在维护分支调用workbench launch。
- `root-migration-ipc-review.test.ts` 4项。实际迁移handler、真实DirectoryAuthority、DataRootManager和RootMigrationRequests；chooser/确认回执及worker回复受控。只有当前主frame能调用合法action；取消选择或确认不留ledger/不关闭；有效目录grant生成实际prepared记录，原owner草稿ACK前不arm，worker close后才arm/relaunch/quit；picker或确认之后换draft session不产生请求，也不关闭新owner。
- `root-migration-renderer-review.test.ts` 3项。运行原组件/effect/JSX分支的受控hook和AST流程：迁移按钮同步阻止重复start且卸载后忽略晚到失败；取消pending对话保持，重试失败显示固定提示且不暴露私有异常，只在close-cancelled事件后解除；启动page有restricted bridge时选择maintenance、未选择workbench。

上述第三、第四组不冒充GUI：renderer测试没有实现React调度、BaseUI focus trap或指针命中；worker close是可暂停回复，用以证明主进程等待顺序，不证明实际PGlite/后台任务已退出。维护测试实际执行窗口模块而非假写一份窗口实现，但Electron表面与runner行为仍是替身，未审runner内部迁移/取消/退出算法。

## 接线与安全判断

迁移IPC与关门恢复控制不登记普通业务gate，避免其等待自己drain造成死锁；它们受独立trusted主frame、captured窗口/draft session、RootMigrationHandoff nonce和当前关闭状态保护。选定并消费native directory grant、确认后才prepare；renderer没有prepare/arm/任意root路径能力。业务回执/取消IPC、journal草稿保存和固定静态UI可服务关闭过程；读根bootstrap、模型测试/目录/设置、原生打开作品和作品/头像资源不再绕过接纳屏障。

closeData先停止新业务，取消response并等待真实gate登记操作，等待配置写队列和repository，再等待worker close；只有成功回复后才businessClosed及armClosed。模型停止也等待ModelService/worker stop-tasks（保留已审超时及owner保护）。commit才调用handoff relaunch/quit；旧进程退出前可能仍有Chromium最终写入，因此只能由冷维护进程在稳定instance lock下收集迁移文件，不能在同一source session中直接迁移。本轮没有用closed布尔值代替原生进程退出证明。

取消持久化失败，release仍等待其异步结果并发出pending；新业务停止，原窗口/草稿保留。ACK成功后也等待已有gate工作完成才能resume/reopen/close-cancelled。早期取消未经过closeData时businessClosed保持false，不能据此授权arm。普通macOS复开与这个异常状态分开：pending、closing或quitting不得顺带恢复接纳。

维护启动在ready之前设置bootstrap专用sessionData，使用无persist前缀且storagePath=null的独立partition，窗口无Node、sandbox/contextIsolation/webSecurity启用，全部权限拒绝；staticUiResponse只读export目录，host/method/路径边界及CSP存在，协议不实例化workspaces/model vault。维护窗口的host检查要求稳定lock、sessionData及唯一memory窗口；只读theme读取不初始化root、数据库或模型。维护的两个IPC无工作台桥，普通page不会因缺workbench bootstrap转而初始化源服务。是否所有runner出口保持上述条件由72继续审核。

## 实际执行结果

审核者独立执行 Node v24.18.0：

```sh
node --import tsx --test --test-reporter=tap tests/unit/root-maintenance-main-review.test.ts tests/unit/root-maintenance-window-review.test.ts tests/unit/root-migration-ipc-review.test.ts tests/unit/root-migration-renderer-review.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
```

`review71-independent-green.tap`：24/24、exit0。相关最终 `review71-final-related.tap`：**78/78**，fail/cancelled/skipped/todo均0，exit0；包括24新独立、13既有CloseCoordinator、3关闭超时、6作者Handoff、3Gate、10第70轮、5RendererCloseChannel、5关闭IPC、3startup、3未就绪bootstrap和3第60轮图片协议回归。完整命令/文件列表与最终SHA见 `review71-independent-summary.json`。最终 `review71-final-typecheck.txt`：全量tsc exit0、空诊断；前复开修复的空诊断记录另保留，不用其证明之后的新源。

## 主代理原生证据与限制

主代理执行，审核者只读JSON/日志并查看截图。为避免后续runner修复重跑覆盖，保存当前副本于 `review71-native-author-v2/`：

- `native-runtime-migration-run-02.txt`/JSON：修复后实际macOS Electron开发运行4组通过、零pageerror。两次真实app.relaunch、旧PID退出、restricted维护进程、1391/1391文件拷贝、pending0、回执ACK及再次冷启动原作品/新根设置。系统chooser及确认的返回值由脚本控制，不是OS chooser交互验收。
- `native-macos-reopen-run-01.txt`/JSON：实际window.close并保存/闭服务，进程无窗口但保留；受控Electron activate事件创建新window、新draftSession，原作品及设置bootstrap可用。不是物理Dock鼠标点击。
- 截图能看到完成维护界面及正常复开后的工作台设置，不能用截图替代PID/ledger/数据断言。旧修复前v1记录仍在原目录，不将其当作本轮最终证据。v2使用的runner早于后续v3退出重入修复，完整最终运行仍需该修复后的重建及受影响原生复验。

没有审核者独立原生运行，没有Windows/真实系统picker/物理Dock或IME验收，没有在真实应用中人为使取消fsync持续失败或注入断电；此类分支由受控真实FS/回调测试证明有限行为。没有通过所有531条正式业务/桌面用例，不能将本轮限定PASS或上述原生开发检查写成整体完成。
