# 第 87 轮：作品 writer lease 显式恢复独立审核

日期：2026-10-08。审核者：ui_revision_review；实现作者：product_revision_review。

## 审核范围与结论

针对第 19 批 `desktop/core/work-lease-recovery.ts`、对应合同、作者测试与冻结清单，独立检查显式授权、同机死 PID、目录和 owner 身份、持久审计、部分失败、新实例重试、取消与并发资源上限。结论：限定范围通过，无剩余阻断项。此结论只覆盖核心模块，不是主进程或正式桌面验收。

初始 5 个作者文件、8 个只读依赖与 19 个证据的 SHA 全部匹配；按作者公布算法重算初始聚合 `ed6bbc57f44d6beb66ae2cbd8427bc6ed15fd41827ba804f9f6d844c9d168c5a` 一致。初始冻结是审阅基线，以下修复不冒充该版本原本通过。

最终 v2 的 5 个作者文件、1 个独立测试、8 个只读依赖与 28 个证据共 42 份 SHA 全部匹配；按 ordered files + independentTests 的 `path:sha256`、LF 分隔含末尾 LF 算法重算聚合 `7b02835c38b96241a04e9784af395fa7ec692997062a5aebf87a760a70ce7e2c` 一致。v1 原冻结保留为历史。

## 独立发现与修复

| 编号 | 实际缺陷与证据 | 修复后的行为 |
| --- | --- | --- |
| WL87-01，P2 | 实际 owner `unlinkSync` 的 EIO 故障直接逸出原始 Error 与本机路径。`work-lease-review87-01-red.tap` 保存真实失败。 | recover 的物理 flight 出口统一转换为白名单固定 `WorkLeaseRecoveryError`；不附原始 cause。owner、作品和 observed 审计保留。 |
| WL87-02，P2 | prepare 实际读取锁目录遇 EACCES 时逸出原始 Error 与路径，同一 RED 日志保留。 | prepare 出口同样规范化未知故障为 `RECOVERY_IO_FAILED`，不产生执行授权或删除 owner。 |
| WL87-06，P2 | 先准备 33 个不同作品，再让前 32 个真实恢复等待闭库证明，第 33 个仍登记物理 flight。上限仅在 prepare 检查，不能限制预先创建的请求。`work-lease-review87-02-limit-red.tap` 为 6 项中 1 个真实失败。 | recover 在登记新的 flight 之前检查 32 个 pending 上限；同 request 的共享 flight 与完成回放仍先返回，不能多占物理操作。 |

独立测试文件为 `tests/unit/work-lease-recovery-87-review.test.ts`，作者未修改这些断言。其余三项首次即通过，分别验证：等待真实异步闭库证明期间失去宿主权限，不能发布预览；取消不能提前释放 busy 或越过真实 flush；owner 已删除后的部分失败，未知邻居保留，新实例必须重新明确确认才能删除仍为空的原锁目录。这些首次通过项不记录为 TDD RED。

## 复验与证明边界

本审核独立运行作者 27 项与新增 6 项，共 33/33 通过，0 跳过、0 取消、退出 0，日志为 `docs/evidence/implementation-19/work-lease-review87-03-related-green-attempt.tap`。完整 `tsc --noEmit --incremental false` 退出 0，`work-lease-review87-04-typecheck.txt` 为零诊断。作者另存的修复 GREEN 可作交叉证据，不替代本次独立运行。

上述独立完整类型检查有明确时间边界；作者随后第 22 次全量检查记录了相邻 `application-snapshot.test.ts` 的三条在途诊断，第 23 次初始排除脚本为 TS5074 夹具失败，第 24 次只排除该在途文件的原 tsconfig program 检查为 0。本审核不将第 24 次称为新的全量类型检查，亦不将相邻作者在途诊断归为本模块通过或失败。

测试使用真实隔离文件系统、真实已退出 child PID 和真实活 PID；精确 syscall 故障在真实文件路径上注入。宿主实例锁、作品闭库、用户确认是受控可信闭包。未运行真实数据库关闭或物理系统崩溃，没有 Electron、OS 原生确认、Windows 文件系统验收，也没有把模拟 Windows 分支升级为 Windows 通过。

源码复核确认普通 open 不在本模块自动回收锁；主机不符、PID 活跃或 EPERM/未知错误均拒绝。审计仅保存惰性身份和原 owner 证明，不保存用户确认；读回核验 schema、字节和 inode。恢复只删除自己核验过的单链接 owner，然后移除同一空锁目录，不递归删除作品或未知邻文件。取消撤销内存授权但保留实际 flight，flush 等待物理终态。完成 request 的回放只返回旧结果，不再删除后来新建的锁。

宿主必须从受信 catalog 提供 canonical 作品身份，维持实例权限、停止新业务准入并真实闭库，且在新的 requestId 上完成确认。Node 路径检查不是跨进程的内核 inode CAS；本模块没有承诺抵抗同权限恶意本地进程。所有 531 条正式用例仍为 not-run。
