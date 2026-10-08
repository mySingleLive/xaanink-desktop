# 第 89 轮：异常作品锁恢复交接核心独立审核

日期：2026-10-08。审核者：ui_revision_review；第 23 批作者：product_revision_review。

## 范围与结论

针对 `desktop/main/work-lease-handoff.ts`、作者 22 项测试与交接合同，审查真实关闭流程的先后顺序、精确原生确认、取消和物理 IO、owner/host/closed 证明撤销、部分恢复事实、错误规范化与一次重启。**限定范围通过，无剩余阻断项**。主进程、worker target、IPC/preload、UI 和原生接线不在此结论中；后续 UI 增量没有自动纳入。

初始冻结的 5 个作者文件、10 个依赖与 15 个证据共 30 份 SHA 全匹配，按 ordered files 的 `path:sha256`、LF 含末尾 LF 重算聚合 `3787b2e6142e8b69645e753880a0efc17eb551bee0517f6073f2f3697fed3cba` 一致。原 v1 保留历史，不冒称初始版本通过下面新增边界。

最终 v2 的 5 个作者文件、1 个独立测试、10 个依赖和 17 个证据共 33 份 SHA 全匹配；按 ordered files + independentTests 同一算法重算聚合 `9ec9a9b438269c8b40b5f2be2f4b5110756f3c517042ad1f5f9350ba01f63e3b` 一致，核验记录 `review89-05-final-manifest.json`。

## 独立发现与修复

**LH89-01，P2：确认结果采用 truthiness，不能保证明确同意。** 实际隔离文件系统和已退出 child PID 的四个独立实例，分别让原生确认宿主返回 `'false'`、`{response:1}`、`[false]`、`1`，原实现均删除原 owner。数据库哨兵字节未改变，但四份 owner 全部消失。虽然宿主接口是 `Promise<boolean>`，破坏性授权出口仍不能把类型契约之外的 native-shaped 值当作确认。

`tests/unit/work-lease-handoff-89-review.test.ts` 四个顶层用例首次 3 PASS / 1 FAIL，`review89-01-independent-red.tap` 保留实际 `[false,false,false,false]` owner 保留结果。修复由作者完成：guard 后检查实际值类型，非 boolean 固定 `HANDOFF_CONFIRM_FAILED` 并保持 closed pending；只有明确 `true` 能进入恢复，`false` 为取消，已撤销在途返回仍按取消处理。作者没有修改独立数据/权限断言。

另外三项首次即通过，不作为 TDD RED：

- LH89-02：catalog target 返回前原目录被实际 rename，原路径出现外部新目录。core 拒绝旧身份，交接走 failed notice 和一次冷启动；原目录与新外部目录的 owner 和数据库哨兵字节均保留，不弹删除确认。
- LH89-03：实际 `CloseCoordinator` 在受控异步 flush 等待期间保持同一个 host close flight，模块取消返回不能让 coordinator 提前完成或执行重启。release 可以等待 handoff.cancel 而不形成循环；flush 终态后才完成关闭及取消结果，原 owner 保留。
- LH89-04：恢复后的 notice 期间 owner 失效，旧 handoff 永久失去重启权限；恢复旧 flag 不能恢复授权。已完成恢复的事实结果不被改写成未删除，外部修改 outcome 副本也不能改内部状态。

## 独立复验与责任边界

修复后独立串行运行作者 22 + 本轮 4 + core 27 + 第 87 轮独立 6 + CloseCoordinator 9，共 **68/68 PASS**，0 fail/cancelled/skipped，退出 0，`review89-03-related-green-attempt.tap`，实际 1.8 秒。完整 `tsc --noEmit --incremental false` 退出 0，`review89-04-typecheck.txt` 空诊断。作者另存 68 项 GREEN 不替代这次独立执行。

源码复核确认 identity 严格 UUID/CloseOwner，复制冻结，不接受 renderer 路径/PID/token；preview 深冻结，确认只绑定该 request/work/owner，确认不持久化。同步 guard 和 restart 不接受 Promise，错误固定无原 cause。进入 afterClose 即保留冷启动屏障；第一次 closed 证明尚未成立可重试，已成立后失效永久撤权。target/confirm/core IO/notice 未真正结束前不 ready；部分 owner 删除按 core 的 cleanup-pending 事实保留审计，不声称回滚。commit 在 restart 回调前占用一次权利，登记不确定不能自动重复 relaunch。

取消的范围须保持明确：handoff.cancel 等待模块拥有的 target、confirm、core IO 与 core.flush；**不等待 startFlight/options.close**，否则 CloseCoordinator.release → cancel → close 可能循环等待。真实 host close drain、业务门关闭及旧 renderer 不再 flush 的屏障由宿主 CloseCoordinator/main 保持，不能因 cancel 的 Promise 已完成就重新开放业务。本轮 LH89-03 验证了原 Coordinator 保持在途语义，但 flush/worker closed ACK 是受控闭包，不是实际数据库关闭。

测试使用真实 FS、真实已退出 child PID 和真实 core；数据库文件是数据保护哨兵，非 PGlite，确认/实例权限/关闭和重启均为可信受控宿主。模拟 Windows 分支不算 Windows 文件系统验收。没有 Electron、物理原生对话框、主进程回调归属、实际 relaunch 或系统崩溃证明；所有 531 条正式用例仍为 not-run。
