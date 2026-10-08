# 91 · 应用恢复候选暂存核心独立审核

日期：2026-10-08。审核者：product_revision_review；24作者：ui_revision_review。审核者未编写24或其17/22生产依赖；25维护元数据作者范围独立，未纳本次审核。

结论：有限 **PASS**。仅24核心所列范围，未发现需修复阻断项。独立8项首次GREEN；最终作者21+独立8共29/29，无skip/cancel、exit0；完整项目类型检查0。作者v1全部21份SHA及聚合严格匹配。

## 范围

仅 desktop/core/application-staging.ts 的私有容器直接UUID子目录创建，以及使用原producer StoredTree 完整封口的回收；读原 application-backup-files、root-ownership、application-backup schema。26新session/prepareWithProof、main/worker/IPC、实际PGlite关闭、Electron原生入口均不纳入。

作者源码/作者测试未修改。新增独立 tests/unit/application-staging-91-review.test.ts 八项，使用真实隔离FS；无真实用户数据/Key/网络/GUI。首次八项均为GREEN，不伪造产品RED，也不重复累计作者历史RED。

## 发现和边界

未复现需修复的阻断项。当前源码符合范围内的数据保护合同：root/tree在首个await前复制与解析；必须直接UUID子目录和完整路径/身份/修订/哈希封口；先比较实际完整树，随后每个删除前检查原目标文件版本与全部祖先身份，不以重新扫描学习unknown为删除授权；目录仅同身份且为空才能非递归rmdir。未知邻居与新替换均保留。

单飞回收登记发生在异步guard之前，finally在物理同步/IO已结算后才释放；取消不假装底层fsync已结束。错误只包含固定code和实际已发生的删除计数，不携任意cause/path；最后目录同步失败不能报告removed成功。创建不采用已有UUID碰撞目录，授权失败后不按路径清理新目录，保留不确定现场。

宿主仍须证明私有命名空间独占、producer的原封口来源和数据库真实关闭，并保持到promise实际结算。StoredTree类型本身不是renderer授权；本轮只验证交入原producer proof的消费方式。错误中部分删除计数为已发生系统调用事实，不等同所有目录同步已确认；上层不得把它翻译成完全回收成功，也不能重学未知目录强制重试。

## 独立行为验证

| 用例 | 实际观察 |
| --- | --- |
| ST91-01 | 原receipt和engine文件精确回收，邻近候选字节不变。 |
| ST91-02 | 原seal缺少后来新增receipt时，首次删除前拒绝，全部字节保留。 |
| ST91-03 | 首次unlink后同inode改写并恢复mtime，剩余外来内容仍被ctime/原修订保护，实际计数为1。 |
| ST91-04 | 实际目录fsync等待中cancel，promise未提前完成且重复调用BUSY；等待结束后取消，剩余engine文件保留。 |
| ST91-05 | 容器最后一个容量槽两次并行创建只有一次成功，原997未知项和另一候选保留。 |
| ST91-06 | 最后parent fsync真实故障，报告IO_FAILED及实际2文件/3目录计数，无成功回执、无邻居删除。 |
| ST91-07 | 重复producer路径在删除前拒绝，不泄漏BUSY；后续原合法proof可正常消费。 |
| ST91-08 | exclusive创建后的第二次授权拒绝，保留该不确定空目录，不偷删/认领其他候选。 |

证据：implementation-24/review91-01-independent-first-run.tap=8/8，review91-02-typecheck-attempt.txt为空、命令exit0。公开Node syscall mock只控制真实FS操作时点/故障；未伪造返回的dev/ino/内容，也未把受控guard当Electron闭库证明。

最终证据：`review91-03-final-independent-green.tap`为29/29，耗时约9秒、退出0；`review91-04-final-independent-typecheck.txt`为空、完整项目退出0。作者v1 `application-staging-frozen.json` 的5作者文件、1独立测试、7只读依赖、8作者证据共21份SHA全部匹配；按 files/independentTests/dependencies/evidence 顺序、path:sha256 LF含末LF复算聚合 `3faad2ba50923bebd5a1e90d6aba065bea22fd2fec22faa6ed6ac03f289952d1`。独立核验记录为 `review91-05-final-manifest.json`。

独立八项oracle未改，作者源与21项测试未改。作者02行为RED与04空目录终态RED保留且未混为独立发现；01骨架/guard等待夹具问题按作者合同明确记录，不冒称完整行为RED。未对17/22重新授予通过，未把1402文件复杂度测试当完整数据库性能验收。Windows目录同步继承既有跳过策略，真实断电/崩溃、原生/26端到端、正式531仍未由本轮验收。
