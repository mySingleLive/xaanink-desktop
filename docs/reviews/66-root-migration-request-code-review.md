# 66 · RootMigrationRequests 独立审核（限定通过）

范围仅 `desktop/main/root-migration-request.ts` 与其合同，基线为64作者v1冻结（source `50feb3f7…`，35作者测试）。审核者仅新增 `tests/unit/root-migration-request-review.test.ts` 和本报告/证据，不修改实现、作者测试或共享core；63启动模块由本审核者实现，不由本报告自审。

最终结论：在64作者v2冻结范围内限定通过。两项P2实际缺陷均由作者修复，独立原回归保持不变并通过；审核者实际合跑36作者、10独立、7既有VersionedStore测试，共53/53，通过全量项目类型检查与冻结指纹核验。没有修改实现或作者测试。

## RMR66-01 · P2 · 业务身份guard后仍有异步记录CAS窗口

原 `write.beforeRename` 先 await 源指针/目标身份/closed guard，然后又 await bootstrap/path 及 `readRaw` 记录CAS。两项独立受控真实FS回归分别在记录leaf lstat等待中实际改写权威pointer revision、以及rename目标目录并建立外部替代目录；模块仍将prepared写为armed并成功返回。

MR66-01/02使用Node test mock仅调度真实lstat等待，返回真实内核stat；没有伪造指针、inode或文件内容。`review66-01-cas-identity-red.tap` 为2/2实际行为失败，exit1，0编译/夹具错误。影响为误报durable armed、主进程可能多余重启；后续start/load会重新核对，因此未声称已发生复制或数据丢失。

建议：记录CAS异步读取放在业务guard之前，guard后只做有界同步的原记录/目录CAS与owner/lock检查，避免逆向窗口。作者已实施该方向；原两个独立断言在最终v2合跑中均GREEN。另作者MR64-36验证反向窗口：业务guard等待中替换记录也不能覆盖新的记录。RMR66-01关闭。

## RMR66-02 · P2 · 不确定提交重新认领外部inode

在实际atomic rename已提交的 `beforeDirectorySync` hook内，将该记录用完全相同bytes替换为另一个真实inode，然后模拟sync失败。原catch只凭 `same(committed.state,validated)` 设置 `uncertainObservation`，把外部inode作为自身已提交身份；删除hook后inspect重sync成功，未返回RECORD_CHANGED。

MR66-03没有mock文件系统；真实write/rename、断言换了inode后再抛hook错误。`review66-02-durability-red.tap` 共9项8PASS/1FAIL，唯一失败为该行为。建议在自身wx临时文件时锚定identity，并在rename后/dirsync前后核对同一身份；catch和重sync不得学习未知inode。

作者新增模块内窄atomic writer，使用wx fd的dev/inode锚定本次写入，rename后仍只认自身inode，dirsync hook前锚定观察值、hook后复验，catch不重新学习身份；未修改共享core。MR66-03原断言及MR66-06重sync等待期间外部换inode均通过。补充MR66-10直接替换自身临时文件为同bytes新inode，实际返回RECORD_CHANGED并保留外部临时文件、原正文不变，证明失败清理不会盲删替代文件。RMR66-02关闭。

## 已独立验证的正向边界

MR66-04…09首次均GREEN：executing提交sync失败后重开不能自动再start；精确executionNonce和结果receipt；旧cancel/ACK不清新active；重sync等待期间同bytes换inode阻断；实际source失联不猜失败、不清请求；真实文件open后增长超过256KiB有界拒绝；25002项pending只持久化count，原文本不写入结果。闭库/实例锁/owner仅注入业务gate，未伪称实际Electron单实例、真实PGlite关闭或session静默。

## 最终复审证据

- `docs/evidence/implementation-11/review66-05-final-independent-green.tap`：审核者执行三个测试文件，53/53，0失败、跳过、取消，exit0。包括保持原行为断言的10个独立测试。
- `docs/evidence/implementation-11/review66-06-final-independent-typecheck.txt`：审核者执行全量 `tsc --noEmit --pretty false`，exit0、空诊断。
- `docs/evidence/implementation-11/review66-07-final-manifest.json`：实际核验4个作者范围文件、1个独立测试、5个执行依赖、13项作者历史证据，共23项SHA全部匹配。冻结聚合按有序 `path:sha256` 每项末尾LF计算，匹配 `88ee9c2a95f21e7248d2f5a715a3afd351a1c1afd5052104ec45164d0773a727`；最终源码SHA为 `dfdd36e23d63725d3a9db010e25e0c61d4d35761487936ce5e74615e8a09dc68`。

这是RootMigrationRequests模块的限定PASS。主进程迁移host、app.relaunch/执行恢复、Chromium session关闭、系统断电、Windows与完整用户App验收不在本报告范围；正式业务/桌面用例状态没有据此升级。`assertClosed`仅为调用者提供的业务服务关闭检查，真正执行迁移仍必须由持稳定单实例锁、从未打开源session的新进程承担。
