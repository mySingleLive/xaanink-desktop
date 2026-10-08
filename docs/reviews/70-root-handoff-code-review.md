# 70 · 根迁移交接、业务门控与启动分流独立审核

日期：2026-10-08。审核者：ui_revision_review。独立审核源码并新增真实临时 FS/受控回调测试，不修改实现。

## 范围与最终结论

范围为 `desktop/main/business-gate.ts`、`root-migration-handoff.ts`、`root-maintenance-preflight.ts`，以及第69轮之后 `desktop/core/data-root.ts` 的可信 `migrationId` 选项和只读 `recordedMigration` API。`root-migration-request.ts` 本轮仅审核新增纯 decoder 导出及其在 preflight 中对原严格 schema 的复用；请求 writer 作为第64/66轮已审依赖在独立 FS 测试中实际执行，不重新宣称审核全部 writer。主进程实际接线、CloseCoordinator、runner、maintenance preload/窗口/UI 均另审。

最终结论：**限定 PASS**。四个独立实际 RED 已修复，10个新顶层独立用例全部通过；77项相关回归及全量 tsc 通过。本轮无剩余阻断，不能据此标记实际迁移流程或531条正式用例通过。

## 实际缺陷、修复与复验

以下四份原失败记录各为1项/1失败/exit1，保留原日志，未将夹具错误计入产品 RED。

| 编号 | 实际失败与影响 | 修复及最终验证 |
| --- | --- | --- |
| H70-01 | `review70-cancel-owner-red.tap`：实际 arm rename 后持续 directory sync 失败，cancel 也不能确认，磁盘仍为 armed；finally 却清掉唯一 owner nonce，后续取消无法重试。 | pending 保留 prepareAttempted、nonce、requestId；新 start 在 picker 前拒绝。明确取消共享一次 flight，实际故障解除后 cancel+ACK 成功才释放 pending。原始 armed 记录、无 restart、同 owner 可重试均验证。 |
| P70-01 | `review70-preflight-bootstrap-red.tap`：missing-ledger lstat 边界实际 rename 原 bootstrap、在同路径 mkdir 新目录；旧 ENOENT 分支直接返回普通启动。 | ENOENT 也重新核 bootstrap 的目录类型、dev/inode、realpath。独立故障注入执行真实 rename/mkdir，返回维护分流，未伪造 stat。 |
| H70-04 | `review70-cancel-commit-red.tap`：已 armed 后 cancel 在真实请求写入 beforeRename 暂停，commit 仍成功调用 restart。 | cancelPrepared 在首个 await 前设置取消意图并 disarm；commit 拒绝，armClosed 在请求前/回执后均检查取消意图。实际并发用例在取消未完成期间断言 commit=false、restart=0，完成后 ledger revision4 严格空。 |
| H70-05 | `review70-ack-owner-red.tap`：取消已 rename 到结果清除状态但 ACK directory sync 失败；显式 retry 成功后旧 nonce 仍能通过 assertOwner。 | durable ACK 成功或 inspect 确认该 owner 无请求/结果后清 nonce。测试使用实际 writer，重试同 receipt 两次 ACK、只 cancel 一次；确认完成前拒绝新 picker，完成后旧 owner 立即失效。 |

取消与 ACK 不确定状态不能被 UI 说成取消成功。Handoff 保留待处理授权，使调用者能明确重试；若外部强制终止发生在仍 armed 的持久记录上，下一启动 preflight 必须进入隔离维护，不能假称该取消已持久化。这也是后续 main 集成必须遵守的边界，本轮没有证明 main 已全部满足。

## 独立行为覆盖

新文件 `tests/unit/root-handoff-review.test.ts` 实际10个顶层用例：

- H70-01、H70-04、H70-05：上述取消/提交/ACK并发与不确定回执，用真正 RootMigrationRequests 原子写入和故障 hook。
- H70-02：分别在 prepared 和 armed 持久化后使 owner 失效；仅撤销并 ACK 本 owner，无 restart，最终严格空 ledger。
- H70-06：prepare 已 rename、尚未能返回 requestId 即 sync 失败；通过 inspect 的精确 owner 找回该请求，持久取消/ACK，无 close 或 restart。
- G70-01：在已接纳操作的微任务开始前关闭门控；等待真正文件写入和一个拒绝操作，拒绝新的文件写入，draining 时禁止 reopen，完成后可重新接纳；原调用者仍收到原错误。
- P70-02：缺 ledger 和严格合法空 ledger允许普通分流且不写文件；损坏 JSON、未知字段、负 revision、非法结果、非 UTF-8、超过256KiB均保留字节并进入维护；合法空记录读前后 inode、长度、mtime/ctime不变。
- P70-03：ledger hardlink/symlink、bootstrap symlink及祖先 symlink、缺 bootstrap 均 fail closed，不改外部文件。
- P70-01：上述实际 bootstrap 替换竞态。
- R70-01：实际 core 迁移撤销留下旧 rolled-back；仅精确 execution nonce可查询，另 UUID返回null；返回值为独立 clone；即使查询 UUID不匹配，坏 checksum仍抛 JOURNAL_INVALID且不改记录。

作者另有16项 gate/handoff/record/preflight测试。审阅其顺序断言及真实 core 用例：选择和确认先于 prepare，取消 picker/确认不产生请求；close回调先于 arm/restart；显式 migrationId写入 journal/stage/结果，重复旧已回滚 nonce拒绝 MIGRATION_ID_REUSED；copy crash非终态只读返回 result=null，精确完成/回滚才有相应结果。作者 handoff 的 picker、closed标志和 restart是受控替身，不能把其测试名称中的 native/flush字样当作原生操作证据。

## 安全边界判断

BusinessGate 在首个 await 前停止接纳、登记每个操作 promise，allSettled 等候当前操作成功或失败；它不替调用者保存草稿或自动重试业务。后续主进程必须让 promise涵盖真实 response body、后台工作和资源退出；只返回 headers、fire-and-forget，或在同一被 gate登记的操作中反向等待 gate.close，均不能被本轮门控测试证明安全。

Handoff 同一 start共享 picker flight；准备写入不确定时不丢 nonce。armClosed依赖调用者提供真实 closed guard；close callback的返回布尔值本身不证明 worker/PGlite/sessionData关闭。取消仍 pending时，主进程不得重新开放业务或把普通 quit当作已经取消；真正 durable取消/ACK后才能恢复。这些 main接线要求是后续审核条件，不纳入70通过范围。

preflight 是同步、bounded、nofollow、严格 schema的只读分流：prepared也进入维护，armed/executing/未ACK结果同样进入维护；错误或不确定记录不打开普通 source session。它不执行迁移、不自动清坏记录、不把合法字段本身当作迁移授权。必须由启动方在 session/AppReady/任何业务 await之前调用，并在隔离状态下由另审 runner重新校验 lock、请求、source/target及 nonce。

recordedMigration先严格读原 journal、校验 checksum，再比较 exact nonce；返回 clone和快照结果。查询不是授权或当前 root资格验证，runner仍需核对请求/source/target及权威 pointer；不能将同源同目标的旧回滚记录代替新执行。

## 实际执行与证据

Node v24.18.0：

```sh
node --import tsx --test --test-reporter=tap tests/unit/root-handoff-review.test.ts
node --import tsx --test --test-reporter=tap tests/unit/business-gate.test.ts tests/unit/root-migration-handoff.test.ts tests/unit/root-migration-record.test.ts tests/unit/root-maintenance-preflight.test.ts tests/unit/root-handoff-review.test.ts tests/unit/data-root.test.ts tests/unit/data-root-review.test.ts tests/unit/data-root-active-pending-review.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
```

- `review70-independent-green.tap`：10/10，exit0。
- `review70-final-related-green.tap`：**77/77**、fail/cancelled/skipped/todo均0，exit0。16项作者新测试、10项新独立测试、34原core、15第59轮独立、2第69轮独立；不累计65独立用例冒充本轮执行。
- `review70-final-typecheck.txt`：全量tsc exit0，空诊断。先前另一作者正在写 RootMaintenanceScreen 时缺两个 phase枚举产生的 exit2日志保留为 `review70-typecheck-ui-attempt.txt`，不算70产品 RED。
- 三个独立 harness失败保留：preflight 的 namespace fs.mock getter错误、ACK夹具期望了内部异常而非公开 DURABILITY_UNCONFIRMED、一个独立夹具括号编译错误；对应 `review70-*-harness-attempt.tap`。均在有效行为断言运行前/错误oracle处修正，未改产品行为要求。

最终指纹与计数见 `docs/evidence/implementation-12/review70-independent-summary.json`。第69轮历史快照保持不变；本轮核心通过仅覆盖其新 API增量和已实际运行相关回归。root随后执行的 main接线79项或 maintenance UI/runner日志不计入上述77项。

## 未验证事项

未操作系统 chooser、真实窗口 close/destroy/activate/restart、完整 main/worker/session资源退出、真实维护窗口 IPC/preload隔离、运行中迁移 UI、Windows、断电或全量业务验收。FS故障 hook是可重复边界注入，不是断电测试。没有正式531项状态变化，所有正式用例仍 not-run。
