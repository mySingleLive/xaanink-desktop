# 78 · 恢复旧草稿隔离核心独立审核

结论：**限定范围 PASS**。v1 首审发现四处实际缺陷，作者修复并冻结 v2 后，原独立行为断言全部通过；独立合跑 6 文件 52/52、0 跳过/取消、exit0，全量 TypeScript exit0。此结论只覆盖已冻结的屏障、提交编排和 renderer 可选 ACK 核心。

## 范围与证据

受审源为 `desktop/main/work-restore-draft-barrier.ts`、`desktop/main/work-restore-commit.ts` 和 `src/lib/desktop/draft-session.ts` 的可选 `restoreBarrier.confirm`。审核者未修改生产源、作者测试、main/shared IPC/DesktopApp 或恢复 UI；新增 `tests/unit/work-restore-draft-review.test.ts` 的 11 项独立用例。

v1 清单的 6 文件、7 依赖、7 证据及 Python JSON aggregate 已逐项核对，均匹配；首次观察保存在 `review78-04-v1-manifest-observation.json`。v2 的作者清单 aggregate 为 `f70ad09abb8346992ec99a093eb7ef6c434e5ddfc735d01c5a02da4d91f3d1f6`，最终逐项核验见 `review78-08-final-manifest.json`。不改写旧 v1 或作者 RED。

测试使用隔离临时目录中的真实文件、`atomicWrite`/rename、真实 `DraftJournal.persist/confirm`，通过 StoreOptions 注入目录同步拒绝；owner、业务关库及重新打开引擎状态由受控函数提供。renderer 验证使用真实 `DesktopDraftSession` 与 `DesktopSaveCoordinator`，缓存清理/归档来源为受控普通数据，不把它们冒称为原 UI 或真正数据库引擎关闭。

## 首审发现与复审

| ID / 严重度 | v1 具体缺陷与影响 | 独立证据 | v2 修复与复审 |
| --- | --- | --- | --- |
| RD78-01 / P1 | `begin` 的 rename 成功但目录 fsync 失败，磁盘已有 pending；同身份重试直接返回 pending，不重新同步，却允许 activate。无法确认“先持久屏障再恢复”的顺序。 | R78-01；01/02/03 RED。02 后改为在 activate 回调记录实际 sync 次数、在回调外断言，避免测试断言本身被当成恢复失败；实际 activation 前仅 1 次失败同步。 | 实例 issued grant 区分已确认和不确定；不确定 begin 复用原 token 原子重写并完成目录同步后才返回。R78-01 原行为断言 GREEN。 |
| RD78-02 / P1 | 新 barrier 实例从前一进程读取同 work/candidate 的未知 pending，或同 barrier 的另一 Commit 读取进行中的 pending，均会再次 activate；ID 相同不能证明旧操作未执行。 | R78-02 与 R78-09。03 纯行为日志 11 项 6 PASS/5 FAIL，两个 pending 变体归为同一缺陷。 | 每个 Commit mint operationId，barrier pending 必须匹配本实例 issued token 与该 operationId；未知旧 pending 保留并拒绝重新执行。已知终态重新确认持久化后沿用，不 activate。02/09 GREEN，04 终态守卫 GREEN。 |
| RD78-03 / P2 | 最后 `current()` 先检查 owner，随后仍 await root/磁盘 CAS；owner 在这些 await 期间失效，仍 rename 新屏障，写完后才报失效。产生无授权 owner 的新 pending，阻塞后续恢复。 | R78-03 受控 owner 在最后 guard 返回后的微任务失效，真实磁盘出现 pending，预期无新屏障；01/02/03 RED。 | 所有异步磁盘 CAS 完成后再次检查 owner，失效在 rename 前阻断。03 原断言 GREEN。该探针证明此等待窗口，未声称验证任意跨进程调度。 |
| RD78-04 / P2 | activate 已重新打开数据，第一次 re-close 失败留下 open；下一次 finish 开头无条件 assertClosed，直接拒绝，无法进入重试 re-close。作者原测试的 closed 恒成功未覆盖这个状态。 | R78-08；02/03 RED，“actual reopened engine remains open”。 | 已有 outcome 时不再要求引擎已关闭，只继续同一结果的 settle/re-close，owner 仍校验；原首次 activate 前保留 closed 闸。08 GREEN，06 真实 settle fsync 失败重试仍只 activate 一次。 |

独立 RED 均为行为断言或实际错误结果，0 夹具/编译失败、0 取消。作者源修复由主代理执行，审核者只追加测试、记录证据和复验。

## ACK、失败与关闭的明确语义

- 有 barrier 的 host 必须请求现有 `restoreSession=false` 管线：旧缓存/草稿进入 inert 恢复数据，不能重放请求或直接覆盖恢复后的库。这是接线合同；本轮没有将尚未接 main/bootstrap 列为代码缺陷，也没有假称已接。
- 初始化在 installSources/writer 后，先归档快照得到 durable receipt，再执行清 owned 缓存，再 checkpoint 清理后的快照，最后用精确 journal receipt 确认并清 barrier。R78-11 使用真实 FS/DraftJournal 证明两个快照的前后数据、精确 receipt、ACK 在途 close 不得提前 saved。
- 错 digest、失效窗口/会话 owner 或不匹配 token 无法清屏障。R78-05 使用真实 journal receipt 确认拒绝且原 token 保留；作者过期 token、root 置换及 dispose 迟到用例亦纳入最终合跑。
- **ACK 已失败时允许保存当前 journal 后带屏障退出**，下一启动继续强制隔离。`saved` close 只证明当前 journal，不证明 barrier 已清。主代理明确确认该既有关闭合同；R78-10 独立验证 failed initialize、后续 saved receipt 实际可 confirm、屏障仍在。不能将此合法行为误判为缺陷，也不能把失败 bootstrap 当可编辑初始化成功。
- 所有 finish 先登记共享 flight，同步重入共享同一个结果；settle/re-close 失败重试保留已执行的 outcome，不调用第二次 activate。作者重入及独立真实 settle fsync 用例均通过。

## 最终验证

独立执行 `work-restore-draft-barrier.test.ts` 5 项、`work-restore-commit.test.ts` 5 项、`work-restore-draft-session.test.ts` 5 项、原 `draft-session.test.ts` 13 项、原 `draft-journal.test.ts` 13 项以及本审核新增 11 项：合计 **52/52**，0 fail/skip/cancel，exit0。日志为 `review78-06-final-related-green.tap`。全量 `tsc --noEmit --pretty false` 为 exit0、空诊断：`review78-07-final-typecheck.txt`。作者 v2 的“restore29 23 PASS”只执行当时 8 项独立测试，未把其历史日志称为本次 11 项全量执行。

最终测试与受审源/依赖/证据 hash 逐项匹配 v2 后给出限定通过。main/renderer bootstrap/UI 尚待接线，真实 Electron 闭库、恢复后重启及 Windows 仍待后续真实 App 验收；未改正式用例 status，不把 Node 受控 closed 状态提升为原生验收通过。
