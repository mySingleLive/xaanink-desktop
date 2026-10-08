# 启动恢复与关闭握手独立代码审核

日期：2026-10-07。审核者 `/root/product_revision_review`。本轮不修改作者实现。

结论：**限定范围 PASS**。独立新增的2项实际行为缺陷均已修复；另核对作者已知的来源安装失败和早期bootstrap关闭边界。此结论扩展53的启动/退出握手范围，不替代54的领域恢复审核，也不表示531条正式用例或真实平台验收已经完成。

## 审核范围和验证

定向审核 `src/lib/desktop/draft-session.ts`、DesktopApp启动/关闭effect与工作台挂载门、main的draftSession.ready、draft-ready/persist/read/bootstrap和flushDraftForClose、RendererCloseChannel的unmodified动作、shared/preload接口。SaveCoordinator只补审本轮emit对每个界面observer隔离异常的差异；其余恢复领域逻辑不重复审核。

审核者最终8文件合跑 **36/36**，0跳过/取消，见 `docs/evidence/implementation-08/55-independent-final-green.tap`：作者/既有29项，加本轮7项独立验证。emit相关的原SaveCoordinator和独立review另跑 **28/28**，见 `55-independent-observer-regression-green.tap`。全项目 `tsc --noEmit --incremental false` exit0，见 `55-independent-typecheck.txt`。作者bootstrap-observer日志实际是44/44，审核者读到该数量，没有将其误写成35或累计为自己的验证数。

独立测试执行真实DesktopDraftSession/SaveCoordinator；DesktopApp effect及main handler来自当前源码AST，bridge/native事件受控，不能证明React视觉表现或Electron事件。B55-07通过实际main handler、RendererCloseChannel和真实DraftJournal在隔离磁盘进行读/关闭，逐字节比较原文件。没有启动Electron、重建应用、读取真实作品或调用模型服务。

## 发现和处理

| 标识 | 严重度 | 证据与影响 | 修复/复核结论 |
| --- | --- | --- | --- |
| B55-02 | P2 | 初始化已写入恢复副本，但restore:false清理回调尚未完成时ready已为true；此刻close可直接saved，未等清理及第二次checkpoint。接口允许异步cleanup，独立gate在实际session/coordinator上复现1条早ACK。 | 已关闭。增加maintenance barrier，savedReceipt先等初始化维护settle，再进行新flush；失败维护不永久挡住可重试writer。原RED保留 `55-independent-first-red.tap`，定向测试同时等待清理和第二次磁盘ACK后才接受关闭。 |
| B55-03 | P2 | 来源安装成功后，真实SaveCoordinator observer在configurePersistence emit抛错；main已ready，但本地ready/writer release尚未建立，关闭只能回unmodified而main拒绝，导致半握手死锁。 | 已关闭。emit只隔离每个UI observer异常，保证注册、receipt记账和其他通知继续，不吞来源/业务错误。原RED保留 `55-independent-writer-setup-red.tap`、`55-independent-writer-setup-confirm-red.tap`。同一个observer持续在注册和flush期间抛错仍可得到真实saved；B55-04另证来源read失败依旧failed且零新写入。 |

首次定向阅读也发现markReady在installSources之前的风险；作者已先修复，故独立B55-01初次执行为PASS，不能冒称审核者保留了该项RED。来源准备现先于markReady，安装失败不改变main.ready；作者 `draft-source-install-red.tap` 有独立的1项失败，修后通过。B55-01和真实磁盘B55-07均验证失败启动可关闭而不写空快照。

DesktopApp在bootstrap回执前session=null时原本会丢prepare-close，是作者已知并自行修复的项。B55-05/06用实际effect验证：早期flush回复unmodified，export回复failed；之后取消关闭及bootstrap晚回也不构造session、不读取/标就绪/写journal、不发布可编辑工作台。原未完成启动显示错误页并提供重新打开入口；此处只有受控逻辑证据，没有将按钮交互称作GUI验收。

## 已确认的契约

main只允许当前可信主frame、owner、nonce标记ready；关闭屏障占有期间拒绝迟到ready。persist在未ready时拒绝，await后的frame和nonce仍复核。bootstrap捕获整个session对象，设置读取后对象/可信frame变化时拒绝旧结果。preload只转发当前session nonce到窄draft-ready通道，不让renderer指定ready值。

RendererCloseChannel只把unmodified当作flush的一种结果，不接受它代替export；token/action/nonce仍受原约束。flushDraftForClose在收到reply后重新检查当前owner/nonce，只有main仍未ready才允许unmodified跳过新journal；ready会话必须saved并经journal.confirm核实，不能一般降级为“未修改”。

renderer在读取/恢复尚未完成的关闭路径中中止初始化，避免迟到数据安装writer；markReady半握手则等待原回执，再走已就绪保存路径。来源安装先于main就绪，persistence只在握手完成后启用，Dashboard只在initialize完成后发布。关闭取消停止本次等待，迟到回执不ACK另一个请求。

restore:false的维护顺序是恢复副本checkpoint ACK→清理归属缓存→清理后checkpoint ACK。关闭不越过该维护门；首个checkpoint失败保留旧缓存和可重试writer，失败维护后关闭仍可通过当前完整快照的实际flush恢复。此处不重新评价54中的归属/领域恢复规则。

B55-07分别使用完整旧journal和损坏旧journal：来源安装失败或原记录校验失败时main保持未ready；实际close回复unmodified而不调用persist，关闭前后文件bytes完全一致。损坏原文件不会被空快照覆盖，也不会被读取失败当作空草稿。恢复副本和导出仍是惰性数据，未执行任务或批准正文。

## 剩余边界

本轮新增的comments来源与readiness约束使51旧范围指纹发生预期变化；这里验证握手与旧文件保留，不把51原清单自动宣称扩展为完整评论恢复证明。54另审恢复与候选评论，root执行真实Electron close/reopen；这些结果不计入本审核。

仍需真实目标平台检查窗口事件、启动失败页面重开/关闭、打包后恢复与完整UI行为。独立新增 `bootstrap-close-review.test.ts`、`desktop-bootstrap-effect-review.test.ts`、`bootstrap-main-review.test.ts`；确切命令、源码/限定片段指纹记录在 `docs/evidence/implementation-08/55-independent-manifest.json`。所有正式验收状态保持原样。
