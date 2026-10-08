# 第36批恢复启动和受保护接线独立审核 107

2026-10-08；审核者 `/root/application_restore_review`。**107源码限定审核PASS。** 本轮九个接线生产文件、七份独立测试和已冻结依赖完成最终复验，六个真实发现均保留原RED并由原oracle验证修复。此结论不授予真实Electron/PG成功链、MacOS/Windows物理UI或531正式验收PASS。105/106限定结论保持各自历史范围。

## 当前真实发现

| 编号 | 实际反例及后果 | 证据/状态 |
| --- | --- | --- |
| W01 / P1 | 真正protected request/root下，原main仍启动普通service worker。实际service ready initializer执行Workspaces、initialize、inbox、templates、configure-conversation、recover-conversation、dispatcher；两个实际checkpoint完成前旧业务runtime已启动。 | review107-01-protected-worker-red.tap真实RED。root改main protected admission为实际只读ApplicationRestoreProtectedService，不构造普通worker/RpcPeer；消费后再单飞创建普通worker。06执行实际main admission和新只读服务，保留calls=[]原oracle，1/1 GREEN；原service initializer仍是误启动worker时会执行的观察callback。尚未授最终接线PASS。 |
| B01 / P1 | 两个实际journal checkpoint及consumed请求之后，initializeBusinessAfterApplicationProtection在晚期settings读取前先把applicationProtectedOperationId置null。真实ENOENT读取令初始化失败并terminate，但保护标记已解除，业务IPC、资产和菜单的admission不再保持受保护。 | review107-04-business-publication-red.tap，0/1；08同oracle再次RED。root改为read及owner/authority检查后同步发布，失败先恢复保护标记再drain；14原oracle GREEN。 |
| B02 / P1 | settings实际读取完成后暂停delivery并替换native window/session；refreshMenus(await repository.read())先发布原owner的process-global菜单，再校验owner失败。实际菜单发布1次，应0；保护标记也已null。 | review107-08-business-owner-publication-red.tap，B01+B02 0/2。root改为await/read→owner/authority→同步menu；14原oracle2/2 GREEN。只给fixture补新正常态closingFlow/quitting及actual readonlyservice符号，原assertions未改。 |
| UI01 / P2 | Windows受保护loading/error两条早返回均缺应用菜单按钮。protectedStartup只保存sessionId；普通bootstrap为null，WindowsMenuControl的platform selector也无法决定Windows。main允许安全app.menu，但界面无可点击入口，未满足用户两系统菜单适配。 | 13实际DesktopApp/WindowsMenuControl JSX的React SSR，0/2真实缺按钮；同时普通Dashboard/CommandController渲染计数均0。作者保存安全platform/theme并复用菜单override和readonly chrome，16原oracle2/2 GREEN。12只有export wrapper提取fixture错误，保留且不称生产RED。 |
| B03 / P1 | consumed root在main业务初始化首次bootstrap identity await期间被移出并替换为外来目录。实际ModelRepository仍从外来state.json初始化并发布，整个main函数成功解除保护。readRootAuthority.assertCurrent钉bootstrap controls，不能代替实际root物理identity检查。 | review107-15-business-physical-root-red.tap，0/1 Missing rejection；repo为实际实现而非double，普通worker/window为已ready宿主double，未跑PG。root添加原authority.pointer.root同步物理seal，18原B01/B02/B03 3/3 GREEN，foreignReads=0/menu=0/terminate=1。仅注入实际assertRootAuthorityDirectory依赖，原oracle未改。 |
| B04 / P1 | 实际ModelRepository.initialize的第一state.json readFile期间原root被移出，外来目录包含有效fixture模型记录。外层main post-await物理seal最终拒绝，但repository内部publish已提前调用gateway.replace 1次，把外来模型授权发布到gateway。 | review107-19-business-inner-authorization-red.tap，0/1，authorizations=1应0。真实FS/ModelRepository/两checkpoint，worker/window为host double；仅公开fixture字段，无真实key或网络。root把原同步seal传入实际initialize，读前、实际读后publish前及第二read后核验；24原B01..04 4/4 GREEN，32最终再次GREEN。普通无参数initialize契约保留。 |

W01的初始fixture执行实际service initializer；修复在main完全取消普通worker，因此新fixture执行实际main admission路由，并把同一真实普通service initializer接为若误准入worker会执行的观察器。零普通业务初始化oracle未改，初始RED保留。没有要求普通service接受一个实际main从未使用的protected参数来获得假绿色。

UI01应仅用protected bootstrap中的安全platform/theme元数据挂只读窗口chrome。不能为菜单按钮而提前发布普通bootstrap、挂业务CommandController或恢复旧工作台。SSR只证明React输出缺失；按钮物理位置、原生Windows菜单和OS窗口按钮仍需真实桌面验收。

B03必须钉住authority.pointer.root原physical identity，跨每个初始化await及repo读前/发布前同步核验，不能重新学习外来replacement。此反例限定本次恢复后业务初始化flight，不把普通worker实际PG启动作为已测事实。

B04证实“await repository.initialize后再seal”不能保护initialize内部的gateway发布。应把本flight原受信同步seal传递到实际repo读后、publish前，拒绝失效root；不能重学当前路径的新identity，不能用renderer配置充当guard。外来文件及原root均保留，不调用真实供应商。

## 最终冻结范围与验证

root明确委托审核者冻结九份本轮生产接线：`desktop/main/index.ts`、`desktop/main/model-repository.ts`、`desktop/shared/ipc.ts`、`desktop/preload/index.ts`、`scripts/build-desktop.mjs`、`src/app/page.tsx`、`src/components/desktop/ApplicationBackupsPanel.tsx`、`src/components/desktop/RecoveryDialog.tsx`、`src/lib/desktop/recovery-preview.ts`。源码在冻结后停止编辑。DTO/preload只传固定动作及实际receipt；protected main不初始化普通worker/模型仓库；消费后才单飞启动普通服务，原owner/authority/root同步seal跨业务await并控制仓库授权发布及菜单发布。protected图片与业务IPC拒绝；安全窗口菜单与原生关于保留。

`root-main-application-restore-frozen-v1.json`记录9生产、10作者测试、7独立测试、9依赖manifest和136当前依赖snapshot。v2追加两个root明确授权的normal旧AST fixture修正：`file-export-main.test.ts`和`recovery-export-main.test.ts`只给closeData原宿主注入`applicationBlocked:()=>false`，原物理IO、导出取消和关闭断言全部保留。26的158/160失败仅两个ReferenceError，保留并不计产品RED。v1未覆盖或改写，v2保留两文件修正前hash；后续整仓回归可直接执行修正后的源fixture。

三条历史supersession逐一明确：104 root-draft-session v1中的RecoveryDialog是本轮已授权protected recovery UI增量；helper v2中的root-authority/shared application-restore旧依赖是已独审105的source union增量。全部历史manifest原字节保留；当前依赖snapshot按105/107实际版本核验，不宣称历史源码hash未变。

31/36前后合核v1/v2共**175项全部一致**，聚合SHA256 `15b0b81e1414b86c406a3f1a84a0616442363f9c820802e67dca570d9dab6a86`。32最终34个相关unit/FS/AST/SSR/controlled lifecycle文件**160/160 GREEN**，fail/cancelled/skipped为0，10460.66175ms；其中七份独立测试16个case全部通过，六个真实RED原oracle均未削弱。34最终全仓TypeScript exit0、空诊断。ModelRepository既有普通用法回归包含在32中。

35使用已安装Chromium1228与临时隔离profile，两个组件文件**4/4 GREEN**，fail/cancelled/skipped为0，6435.5995ms：备份列表receipt/分页、空列表和失败状态、迟到回复不覆盖新面板；真实RecoveryDialog查看正文、复制、完整导出和零业务备份调用。保护组件测试仅将作者截图/JSON输出路径改为`review107-`别名，原作者源码及全部assertions保留，v2记录该等价执行副本hash。27仅默认浏览器未安装，33仅沙箱实际浏览器before/launch超时，原日志保留；35在允许的执行环境完成，不把环境失败称产品RED。

已查看`review107-protected-recovery-dialog.png`：实际恢复卡片和只读正文左右排列，复制/导出按钮可见，普通业务备份面板未挂载。这是mock bridge下真实React/Chromium开发证据，不是实际桌面窗口验收。root另提供fresh desktop02/UI02 build exit0证据，独审并未把作者构建或既有35PG结果归作本轮实际恢复运行。

## 当前独立绿色证据

`application-restore-entry-107-review.test.ts` 三项实际旧Node PID+FS请求/布局：原native确认owner撤销及公开callback替换不能接受启用；worker exit观察拒绝不授settled/quit；重复native窗口drain共享同一个flight，并等待结果及物理exit观察后仅退出一次。worker结果/exit和窗口回调仍是明确生命周期double，真实恢复producer未运行。03为3/3 GREEN。

02日志中的两项失败是审核fixture合同误判，**不是生产RED**：已结算私有worker允许追加未提交取消审计；native重复关闭应调用drainRevokedWindow，不能把已进入leaving状态的再次renderer命令当重复native关闭。修正fixture后测试断言旧pointer、原append-only回执均保留、确认不接受、无提前退出；未修改生产。

`application-restore-protected-service-107-review.test.ts` 两项实际受保护root负例：catalog在真实readonly delivery间变成hardlink则拒绝，两链接/草稿均保留；root变成同marker外来inode则拒绝，foreign openSync计数为0。05为2/2 GREEN。此helper只读取实际authority/marker/catalog，ready/status不表示数据库健康。

07全仓types目前exit2，仅root手头修改的handoff第79行TS2367 narrowing诊断；独立fixture无类型诊断。此为开发快照，保留原日志，不称最终types通过。

已冻结的新cold entry与protected service：09/11前后hash核验47项全部一致，聚合SHA256 `d828651727769f557ededcbb257e3ac94d52408b863a8c7304ef25fd9f0efc01`。10相关9个测试文件46/46 GREEN（3574.34675ms），包含全部5独立FS/lifecycle用例、作者14项只读service和27项冷入口/controlled Electron surface/实际Node malformed-package worker。main/root handoff并未包含在这两个author freeze中，不能用这组结果消除B01/B02或授整个107 PASS。

20复跑W01、UI01两分支、S01/S02与E01..03，8/8 GREEN（2736.744875ms）。17核验cold-entry/readonly-service/protected-chrome三个freeze共52项均一致，聚合SHA256 `cf30bbd29b2b32df579e75ad89cb3490ba9011124e467c4a5fb5af55f9c8a4eb`；UI作者freeze不覆盖main。

`application-restore-routing-107-review.test.ts` 四项执行实际main路由体的独立检查：全部实际注册ordinary business IPC在owner/schema/服务逻辑前拒绝；avatar与作品/情景图片GET/HEAD返回403，ordinary读取为0，静态UI可读；两OS实际menuTemplate/executeCommand中safe app.menu可用，业务菜单禁用且业务准入为0。22为4/4 GREEN。21的两项失败仅审核fixture错误（任意预期注册数量≥12、静态UI分支未注入join/app），保留并明确不计生产RED；修正后未改任何生产代码。

## 未授予的范围

当前FS authority fixture的core提交明确seeded；两真实journal/磁盘revision和PID请求不是实际PGproducer成功链。未运行真实数据库恢复、Electron窗口/session关闭、实例锁或原生文件选择器、安装包、MacOS/Windows菜单窗体验收。作者controlled Electron surface、mock bridge/Chromium及真实Node malformed-package worker仅属于各自开发证据。531正式用例全部not-run。

本轮源码稳定后的publication原oracle、protected/normal回归、owner/IPC/assets/menus路由与freeze/types核验已完成，可进入root统筹的受控完整成功链和真实桌面测试。未在本次审核运行原schema数据库恢复或真实Electron实例/session/文件选择器、安装包或MacOS/Windows菜单窗体；不能由源码限定PASS推断完整恢复体验或正式验收通过。
