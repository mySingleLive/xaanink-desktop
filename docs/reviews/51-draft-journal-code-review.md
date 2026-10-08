# 草稿日志主进程独立代码审核

日期：2026-10-07。审核者 `/root/product_revision_review`；只审核，不修改实现。

最终结论：**限定范围 PASS**。4项真实发现均已修复并独立复核；confirm、不可读取来源保护和新来源schema已纳入本轮审核。本报告不包含新增关闭协调/草稿导出原生对话框，也不进行完整退出流程或平台验收。

## 范围与证据

定向阅读 `desktop/main/draft-journal.ts`、`desktop/shared/drafts.ts`、main的trusted/draft IPC及窗口生命周期nonce、preload两条草稿接口；读取既有atomicWrite理解实际文件/目录同步顺序，不扩大审核其他main功能。所有磁盘测试使用隔离临时目录，没有真实作品或GUI；IPC只执行实际注册函数的受控handler，不能证明Electron窗口事件。

原10项journal+2项IPC由审核者重新运行，`docs/evidence/implementation-08/51-independent-baseline.tap`为12/12。新增独立 `tests/unit/draft-journal-review.test.ts` 的 `51-independent-journal-red.tap` 为4项1通过3失败；错误是实际行为断言，不是缺导入、编译或mock异常。

主代理修复后，4文件合跑 `51-independent-fixed-green.tap` 为22/22，关闭前三项。审核者随后新增未消除不确定性后的历史Envelope重放，`51-independent-uncertainty-red.tap` 为4通过1失败。加上排队confirm/新来源独立验证，`51-independent-confirm-sources-current.tap` 为25项24通过1失败，唯一失败为J51-05。

幂等条件改为uncertain===null后，审核者最终独立运行 `51-independent-final-green.tap` 为25/25，0跳过/取消：原13 journal+2 IPC，加独立7 journal+3 IPC/preload。`51-independent-typecheck.txt`为全项目tsc exit0。本报告没有把主代理其他rendererSession或关闭用例累计成自己的验证数，也未变更正式531条验收状态。

## 发现

| 标识 | 严重度 | 证据与影响 | 修复建议/状态 |
| --- | --- | --- | --- |
| J51-01 | P1 | atomicWrite已经rename，beforeDirectorySync期间原子替换成另一份校验合法的journal；persist仍返回旧next.digest的保存确认。目录同步不保证确认的那份文件仍在该路径，renderer可能误以为完整草稿已经保存在权威根。独立测试实际为Missing expected rejection。 | 已修复并关闭：写入后先标uncertain，重核根/磁盘完整Envelope==next/current owner后才清除并ACK。独立同一测试GREEN。 |
| J51-02 | P1 | 同阶段把原root移到其他路径、重建同路径目录，atomicWrite对新目录sync并返回；persist只复核owner便ACK，而同一journal.read已因根dev/inode变化拒绝。写入文件留在旧目录，ACK不是当前权威根中的durable确认。 | 已修复并关闭：写入后复核捕获根的canonical/dev/inode，拒绝不匹配ACK，保留旧目录中的已提交文件；独立同一测试GREEN。 |
| J51-03 | P2 | constructor启动rootIdentity Promise而没有拒绝处理。隔离子进程对不存在根构造后延迟30ms才read，进程因unhandled rejection退出1，来不及由read或main的调用链报告可恢复目录错误。 | 已修复并关闭：初始化Promise增加拒绝sink，仍让后续read/persist拒绝；独立子进程正常存活且read失败，未变为空草稿。 |
| J51-05 | P1 | ACK snapshot1后snapshot2目录sync失败，外部恢复Envelope1再重放snapshot1，`uncertain!==before.digest`因为旧/新digest不同而直接返回旧ACK，不实际再sync。故障仍然存在时persist错误宣称保存确认；confirm会拒绝该receipt，但不能使persist误报成立。 | 已修复并关闭：只有uncertain===null才直接幂等ACK，其他情况实际重写/同步并最终核对。独立原RED断言现在GREEN，sync故障持续时仍拒绝、同步计数为3。 |

J51-04独立验证rename后owner被撤销：旧persist正确拒绝，已写入内容仍能作为不执行的恢复快照读取。该行为不需要回滚已提交文件，不算发现。

## 已核对的边界与剩余工作

主进程单队列、owner对象生命期与client revision共同限制旧请求；同revision相同内容（忽略createdAt）允许幂等回执，不同内容/旧revision拒绝。根canonical/dev/inode和file lstat/O_NOFOLLOW/fstat、单硬链接/大小约束、校验摘要保护已有受控磁盘证据。beforeDirectorySync失败不返ACK，原bytes保留且同请求重试再次同步；这些既有通过不抵消上表晚期替换缺口。

共享schema已支持workspace/recovery、issue来源UUID；issues非空只可经validateDraftSnapshot生成导出数据，persist拒绝覆盖完整journal。独立J51-07同时检查输入复制隔离和未知issue source拒绝。

confirm已排队检查当前owner/session对象、receipt三字段、client sequence及磁盘真实记录；任何uncertain非空拒绝。独立J51-06用真实写入gate验证排队confirm不能跨同owner ID的新生命期，既有confirm测试也覆盖未知摘要/旧receipt和未确认rename。

新增 `tests/unit/draft-ipc-review.test.ts` 的 `51-independent-ipc-green.tap` 为3/3：实际handler await后nonce变化与mainFrame变化均不返回旧receipt/正文，preload仅传两条窄通道的nonce/snapshot。不是Electron窗口事件验收。

Windows atomicWrite当前不执行目录fsync；这属于已声明平台边界，需要真实Windows崩溃/重启验收，macOS临时目录测试不能替代它。SHA校验是数据损坏检测，不是对拥有用户文件权限的外部修改者的认证。未对所有平台声称消除了文件系统TOCTOU。

独立验证命令：`node --import tsx --test --test-reporter=tap tests/unit/draft-journal.test.ts tests/unit/draft-ipc.test.ts tests/unit/draft-journal-review.test.ts tests/unit/draft-ipc-review.test.ts`。当前审核文件/用例与限定IPC片段指纹另存 `docs/evidence/implementation-08/51-independent-manifest.json`；index正在集成退出，只对trusted和draft-persist/read片段记录指纹，不冻结整份main文件。
