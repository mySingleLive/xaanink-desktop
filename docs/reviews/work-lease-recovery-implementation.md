# 第19批作者移交：显式恢复异常遗留作品锁

日期：2026-10-08。作者 `product_revision_review`。状态：核心实现完成，等待独立代码审核；尚未接 Workspaces/main/IPC/UI。

新增 `desktop/core/work-lease-recovery.ts`，保留原 writer lock 结构与普通 open 的拒绝规则，补只读预览、受信确认后死 PID 恢复、持久 inert 审计、部分 rmdir/fsync 失败的显式重试。没有修改已有正文/资产/作品服务，不对数据库执行恢复或重建。

合同：[work-lease-recovery-contract.md](../evidence/implementation-19/work-lease-recovery-contract.md)。独立审核只读这一个新增生产源及对应测试即可；相邻 main/worker 正在其他批次接入，不属于本轮冻结。

## TDD与验证

作者测试 `tests/unit/work-lease-recovery.test.ts` 最终27/27、0跳过、exit0；Node24全量 TypeScript 检查 exit0、无诊断。实际 child 已退出并验证 ESRCH，活 PID 为测试进程；测试保证数据库 fixture、附件、manifest 的字节不变。同步重入共享 flight，异步取消仍由 flush 等真实IO。Windows支持判定的5个分支是平台/IO注入，未运行Windows系统。

原始失败证据保留并分清归属：

| 证据 | 结果与归属 |
| --- | --- |
| 01-red | 初始测试文件缺闭合括号，纯夹具编译失败，不是行为RED |
| 02-behavior-red、03-durable-red | 占位实现 NOT_IMPLEMENTED；分别11和15项真实行为RED |
| 04-green-attempt | 14通过/1失败；fixture用rm删除空目录触发EISDIR，改用rmdir，不是产品缺陷 |
| 05-typecheck-attempt | 本作者7个nullable诊断及root在途runner一项；分别由各作者修正，不计行为RED |
| 06-cancel-flight-red→07-green | 第16项真实RED：cancel删除Map使flush提前返回；pending独立跟踪真实flight，16/16GREEN |
| 09-final-sync-red→10-green | 第18项真实RED：完成回执rename但dirsync失败后，无锁的新实例误报OWNER_INVALID；重确认后只完成同步/回执，19/19GREEN |
| 11-safety-boundaries | 新增坏/未知审计、目录替换、temporary替换、同步重入；24/24首次GREEN |
| 12-temp-cleanup-red→13-green | 第25项真实RED：finally async lstat后外来临时替换被unlink；最终同步复核并只删own文件，25/25GREEN |
| 15-guard-red→16-green | 第26项真实RED：误用异步同步guard时产生unhandled rejection；拒绝该guard且收束late rejection，26/26GREEN |
| 18-final-green、19-final-typecheck | 最终27/27与完整tsc0；不累计前面日志重复用例 |
| review87-01-red→20-review-fixes-green | 独立实际unlink(EIO)/readdir(EACCES)暴露raw路径/cause；public prepare/recover白名单safe error修复，作者27+独立5=32/32GREEN |
| review87-02-limit-red→21-limit-fix-green | 独立预备33作品后recover绕过pending预算；真正新flight入口复核32上限，同flight/已完成仍优先共享，27+6=33/33GREEN |
| 22-review-final-typecheck | 最新全量tsc有3条诊断，全部来自root在途application-snapshot.test（模块未落盘与2条推断any），本批源无诊断；失败原样保留 |
| 23-scoped-typecheck→24-scoped-typecheck | 首次program脚本缺configFilePath导致TS5074，属于检查脚本夹具；改用原tsconfig解析API后，只排除上述一个在途测试的全部program诊断0，exit0；独立87的04此前完整tsc0另外保留，不混称最新全量通过 |

固定 safe error code 不含原异常/cause。审计最多16KiB，owner最多4KiB，普通/单链接/身份/revision/实际 bytes 验证；审计自身记录wx fd身份，未知替换保留。临时文件只清自己且未变化的一份，没有递归rm或锁目录rename。

## 后续边界

主进程必须以真实单实例锁、当前nonce、真实closed worker和持续停止准入屏障实现受信闭包，原生确认后才执行；不能传renderer布尔。本作者只写核心，没有原生对话框、实际崩溃、Windows或PGlite闭库验收。主进程应保护新的审计/temporary命名空间并单独冻结接线。正式531顶层用例状态不变。

冻结清单v2 `implementation-19/work-lease-recovery-frozen.json` 区分5个作者文件、1个独立测试、只读依赖和历史证据，聚合按 ordered files 然后 independentTests 的 `path:sha256`、LF及末LF。原v1清单另存。第87轮独立原6断言未由本作者修改，scope已收敛待最终核验；本移交不作独立PASS结论。
