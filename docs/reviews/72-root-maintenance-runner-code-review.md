# 72 · 迁移runner独立审核（限定通过）

日期：2026-10-08。审核者：product_review。首审为64作者的runner v1冻结 `eb23b3d…`，最终复审为v3 `34cc96f149bc99938f6947a6a310c4c38e142acec6371b129ff83177d2b98ae7`。维护UI由本审核者实现并交第73轮他人审核，不在本报告自审。

最终结论：限定通过。四个P2实际行为缺陷均由实现作者定向修复，独立10项保持原断言并全部通过；审核者独立合跑相关5文件93/93、0跳过/取消，exit0，full项目tsc exit0。冻结v3的6作者文件、1独立测试、7只读依赖、24证据全部SHA及聚合匹配。审核者仅新增 `tests/unit/root-maintenance-runner-review.test.ts`、本报告和review72证据，没有改实现或作者测试。

## RMR72-01 · P2 · 初次发布重入start提前确认

`start()` 设置started并同步publish，却在publish之后才赋值this.running。订阅者在revision1事件内同步再次start，走already-started分支，返回准备中的快照，而非同一实际执行Promise。独立用例等待真实迁移完成后确认：外层complete、实际migrate仅一次，内层await得到preparing。这个调用者已经收到完成承诺，却没有等待真实IO。未声称重复复制或数据损坏。

建议：同步发布前先建立并登记唯一flight，再执行/发布状态；重入调用只返回该flight。独立RMR72-01原断言保留等待作者修复。

复审关闭：running在publish前登记；外内调用共享同一Promise并等待真实迁移终态，copy仅一次。

## RMR72-02 · P2 · 首次prepared通知中取消未持久化

prepared的首次canCancel通知发生于start仍有running期间。同步订阅者按已发布权限调用cancel，取消器仅等待running后return；prepared执行分支不处理AbortSignal，也不写cancelled回执。实际cancel承诺完成后，隔离磁盘请求仍prepared，界面phase仍preparing、canCancelfalse。用户本进程不能再取消，只能退出再打开。所有源数据保留、目标没有复制，不把此问题夸为数据丢失。

建议：等待running后复核精确当前请求；未执行的prepared应通过原requestId/ownerNonce持久取消，再发布权威结果。真实执行已经落到终态时不能重复取消；执行不确定/guard失败则保留关联并明确未确认。独立RMR72-02保持原断言。

复审关闭：cancelling在publish前登记，等待running后重新inspect；prepared经原requestId/ownerNonce真实持久取消。终态无active不重复cancel，未知executing保留关联。

## RMR72-09 · P2 · 退出绕过已受理的取消

prepared的cancel已登记取消flight，随后发布canCancelfalse；通知中的quit既不再按canCancel发起取消，也不等待this.cancelling。取消在维护closed guard内等待、尚未进入ledger写队列时，quit仅等待requests.flush，实际提前调用onQuit，磁盘仍为prepared。独立真实FS回归观察quits=1，预期0。作者RMT12-32同时自检确认同一窗口，不将其重复计算为两个产品缺陷。

建议：退出等待已受理的取消flight，不依赖此刻canCancel；取消失败也必须等其真实IO完成，再保留请求退出。复审关闭：作者增加对cancelling的等待，独立09旧断言证明guard gate期间quits=0、取消持久后quits=1、结果未ACK。

## RMR72-10 · P2 · 退出同步重入产生两次回调

exit先调用action()，返回后才登记this.handoff。外层quit同步调用cancel并发布canCancelfalse，订阅者在此通知中再次quit；此时handoff仍空，两条退出flight等待同一取消后，各执行一次onQuit。独立隔离真实FS回归实际quits=2，预期1，取消回执本身仍正确。本问题仅为重复退出回调，不宣称产生重复迁移或源数据丢失。

建议：与start/cancel相同，先构建、登记单一handoff，再在microtask执行action；所有同步重入共享原Promise，回调仅一次。复审关闭：作者以Promise.resolve().then(action)先登记flight；独立10原断言确认nested===outer、onQuit仅一次、cancel回执仍正确。

## 独立证据与已通过边界

`docs/evidence/implementation-12/review72-01-independent-red.tap`：6项4PASS/2FAIL、0跳过/取消，exit1，纯行为失败，无编译/夹具错误。

`review72-02-independent-attempt.tap`：新增07/08后8项6PASS/2FAIL，仍仅01/02失败。`review72-03-accepted-cancel-quit-red.tap`：01/02修复后9项8PASS/1FAIL，新增09实际提前退出。`review72-04-quit-flight-red.tap`：09修复后10项9PASS/1FAIL，新增10实际重复退出回调。上述日志均为原断言的真实行为失败，没有编译或夹具错误。

RMR72-03使用实际ACK目录同步gate，证明continue/quit并发共享单次handoff且保留下一FIFO回执和新armed active；04实际先建立另一nonce的rolled-back journal，executing不复用、不recover或重migrate；05实际commit/cleanup后release内删除journal，保留executing和new-root副本，重启runner不重migrate；06实际finish持久后关闭证明失效，不启用continue，恢复guard后显示原回执且不重复copy。

RMR72-07在ACK真实rename后注入目录同步失败，拒绝重启回调；原精确回执重试后仅移除该回执，保留下一个FIFO结果和armed active。08在真实pointer commit后挂起core hook，确认取消被拒绝、quit等待release和持久终态、退出不ACK结果。

最终独立执行：`review72-05-final-independent-green.tap` 实际93/93（作者runner33、独立runner10、请求作者36、请求独立10、core关联4），无跳过/取消，exit0。`review72-06-final-independent-typecheck.txt` 全量tsc退出0、无诊断。`review72-07-final-manifest.json` 核验v3的全部38份文件SHA与LF含末LF的聚合；64纯decoder export增量去掉两行后严格匹配66所审旧v2源码，未将新源码指纹冒称旧冻结未变。过渡v2已保留，其91执行计数仅包含当轮9项独立测试，最终v3才纳入并实跑第10项。

用例使用隔离真实FS、实际DataRootManager/RootMigrationRequests与扫描清单，只包装计数、注入受控维护closed/lock gate。审核者没有运行Electron、真实PGlite或Chromium session；不把closed gate当OS单实例/前进程退出证明，不提升正式531项用例或完整App验收状态。最终host/main仍须以真实前进程退出和稳定单实例锁兑现closed lease合同，本报告仅批准受审runner范围。
