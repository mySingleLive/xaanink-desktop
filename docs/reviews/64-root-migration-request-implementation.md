# 64 · 数据根迁移重启请求模块实现交接

日期：2026-10-08。作者：product_revision_review。独立审核由 product_review 的第66轮负责；本记录是作者交接，不作独立 PASS。

## 实现与主进程接线合同

新增 `desktop/main/root-migration-request.ts`，实现 `RootMigrationRequests`。没有修改 main、DataRoot 核心、preload、UI，也没有执行迁移进程/GUI。完整接口与提交边界见 `docs/evidence/implementation-11/root-migration-request-contract.md`。

请求单槽状态为 prepared→armed→executing。prepared 不能自动执行；arm 只授权重启，当前 assertClosed 仅表示业务与 worker DB 已关闭；启动时执行必须是在新进程持有稳定 bootstrap 锁且未打开 source session 的阶段。executing 跨进程只能由 main 先 DataRoot.recover，再关联 pointer/journal 明确完成或回滚，不能再自动 migrate。

prepare 自行通过注入的 DataRoot.resolve 取得完整权威 source，target 只能由 main 已 consume 的 data-root DirectoryProof 提供。arm/start 在初始操作及最终 rename 前核对 source 的 rootId/revision/migrationId/目录身份、target proof、stable lock；arm 还核对精确 ownerNonce。异步 assertClosed 返回后重读 source，避免最终关闭等待中指针漂移。

取消只允许精确 id/原 nonce 的 prepared/armed，包括关闭失败后的过期 owner 清理；不会取消 executing。finish 需要精确 executionNonce 和与请求/实际权威根匹配的 DataRoot 结果。fail 只落固定分类 code 与明确权威 root；source 未知时保留请求，pointer 已到本请求目标时要求 recover→finish，不能泛化 failed 清掉关联。

完成/取消/失败在同一个原子替换中清 active 并追加结果。最多16个未消费结果；满额拒绝新 prepare，不能丢旧结果。readResult 先返回副本，UI用 requestId 幂等展示后 exact id+receipt ACK，旧 ACK不能删除新任务。没有“读取之前就删除”的伪一次性保证。

文件最大256KiB，严格 schema/version/revision、UTF-8、普通单链接/no-follow文件、identity/size/mtime/ctime与内容复核；固定 bootstrap 身份变化时拒绝。队列串行处理 arm/cancel/finish/ACK。重复 finish/cancel 匹配原结果可幂等返回，不覆盖后来 active。v2采用模块私有 writer，保留现有 CommitDurabilityError/目录 fsync，新增 wx fd 提交身份；未修改通用 VersionedStore。

rename 前失败保持旧文件；rename 后 directory-sync/确认失败报 DURABILITY_UNCONFIRMED并保存实际已提交记录与文件身份。重新确认必须内容/身份精确匹配并重 sync，同内容换 inode 也拒绝。无法捕获提交文件身份时本进程保持 uncertain，须显式进程恢复，不能猜没有 commit。rename 后 owner过期不伪称撤销；main 必须按原id/nonce调用cancel，它排队等待正在进行的写入终态，再保存取消结果。

结果只落 status/migrationId/root/pendingCount，当前 pending 上限同步 DataRoot 的25002；不落任意 Error/cause/原始 pending 文本。未在模块中调用 DataRoot.migrate、复制任何作品、创建数据库或操作 Electron session。

## TDD 与验证

作者新增 `tests/unit/root-migration-request.test.ts`，36项行为验证：准备与重启惰性、关闭前拒绝 arm、来源/目录身份变化、owner和锁失效、相反状态/nonce/ticket、串行 arm/cancel、executing防重放、结果与当前指针匹配、未知source保留、导入文件安全、外部替换、文件消失、rename前故障、rename后durability ambiguity、结果ACK不误删新任务、16项结果上限、25002 pending有界计数、实际写入flush等待。用例35由测试调用者执行真实 DataRoot 核心迁移，再将其返回结果交给本模块；保留真实稿件字节，不用手写假结果替代这一接合验证。其closed lease仍为注入测试gate，不是真实PGlite关闭证明。用例36验证最后异步业务 guard 期间原记录变化仍由同步 CAS 拒绝，保留外部新记录。

证据全部保留：

- `root-migration-request-01-red.tap`：初始行为RED，30项29fail/1pass；原安全拒绝矩阵在骨架状态已拒绝。
- `02-green-attempt.tap`：首30项全部GREEN。
- `03-typecheck-attempt.txt`：BigIntStats类型写法错误2个诊断，已更正；不覆盖旧失败日志。
- `04-durability-lease-red.tap`：31/32 两个实际缺口RED，33上限契约通过。分别为 uncertain 同内容新 inode 替换被错误接受，以及最后异步closed等待期间source revision漂移漏过。
- `05-durability-lease-green.tap`：33作者+7原持久化回归=40/40；`06-typecheck.txt` exit0。
- `07-final-green.tap`：v1历史验证，35作者+7原持久化回归=42/42，fail/cancelled/skipped/todo均0、exit0。`08-final-typecheck.txt`全项目exit0，无诊断。
- `09-review-cas-green-attempt.tap`：第66轮首两条独立RED修复后的相关44/44；`10-review-identity-green-attempt.tap`：当时35作者+9独立+7原回归=51/51；`11-review-typecheck.txt` exit0。
- `12-final-review-green-attempt.tap`：当前v2，**36作者+10独立+7原回归=53/53**，fail/cancelled/skipped/todo均0、exit0。`13-final-review-typecheck.txt`全项目exit0，无诊断。

运行命令使用仓库Node24：

```sh
node --import tsx --test --test-reporter=tap tests/unit/root-migration-request.test.ts tests/unit/root-migration-request-review.test.ts tests/unit/versioned-store.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

冻结清单位于 `implementation-11/root-migration-request-frozen.json`（v2），原始v1另存 `root-migration-request-frozen-v1.json`。v2保留作者源、测试、合同、交接文档及10项独立测试SHA，独立测试作者是 product_review，本人没有修改其断言。相关依赖/日志SHA另列；依赖是当前执行版本的观察记录，不替其它作者的核心改动作独立审核。

## 第66轮独立发现的定向修复交接

RMR66-01：原业务 guard 后仍异步读原记录 CAS，等待窗口内 source revision/target inode 改变也能 arm。现在先做异步 CAS，再完成业务 guard，最后同步复核原记录和临时文件、lock/owner；MR64-36同时覆盖反向窗口中的原记录变化。

RMR66-02：rename 已提交后 directory-sync hook 将同字节文件换 inode 并失败，catch 原先会重新学习外部 inode 为 uncertain。现在提交身份从自有 wx fd锚定，hook前取得自有观察值，之后异常与恢复都不认领外部 inode。MR66-10另外验证临时文件相同字节换 inode被拒绝且不删除 foreign tmp。

以上独立RED由审核者保留；当前作者合跑53项已GREEN。最终独立结论及其自行重跑由第66轮给出，本交接不自批PASS。

## 尚待接线与验收

main 负责实际 stable lock、consume DirectoryProof、有效流程nonce、closeCoordinator 的成功关闭证明、重启与启动早期顺序、DataRoot恢复关联、UI结果显示/ACK及关闭失败cancel。本模块没有生产接线，因此不能把注入的gate测试称为真实单实例/数据库/session关闭通过。

本机真实隔离 macOS FS验证。没有实际 Windows、断电、OS进程重启、原生选择器、迁移进度或真实用户桌面验收，未更改531正式用例状态。等待第66轮独立审核及main接线后对应真实验收。
