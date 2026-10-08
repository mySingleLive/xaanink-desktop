# 第36批普通恢复交接独立审核 106

2026-10-08；审核者 `/root/application_restore_review`。**限定范围PASS**：H07真实RED修复保持原oracle，冻结后7文件相关回归73/73 GREEN、全仓types exit0，55项冻结文件前后hash均一致。仅新增独立测试和审核证据，未改生产或作者测试。main107仍另审，本结论不覆盖其新发现。

## 范围

本次只审 `desktop/main/application-restore-handoff.ts`、`desktop/shared/application-restore-handoff.ts`、`desktop/main/close-coordinator.ts`，以及其真实目录授权依赖 `desktop/main/application-restore-layout.ts`。第105号限定PASS保留历史；本次不将 main/preload/renderer/冷worker接线、PG健康验证或原生桌面生命周期纳入结论，新接线另记107。

正常入口仅接受严格备份UUID、操作UUID和固定命令。原生选择路径、真实catalog物理witness、空父目录及新UUID子目录由main授予；prepared只记录选择。私有关闭owner在真实关闭回调与两次session flush之后才允许arm；arm仍仅是交接意图，不证明旧Electron PID退出。CloseCoordinator必须等待异步commit，原owner撤销、新窗口出现及窗口关闭升级退出不能复用旧owner保存授权。

## 独立发现

**H07 / P1，真实RED已修复：**创建UUID子目录后，原实现先await目录identity，再把观察结果视为自己创建的目录。真实FS攻击在异步lstat边界移出原新目录并放入外来空目录，实际select仍成功写prepared并发行native布局grant。原目录与外来目录均保留，故不是模拟单纯返回错误identity。

`review106-05-native-child-identity-red.tap` 与06保留原拒绝断言失败。作者修复为mkdirSync后同一JS turn立即钉住canonical/nonlink/dev+ino；所有后续异步观察只比较原pin，完整created集合在所有IO、fsync、发布及最后seal重验。独立fixture保留原拒绝/inspection/零prepared oracle，并在修复移除不安全异步lstat时继续于真实目录fsync边界替换子目录，避免无攻击的假绿色。07原oracle复验GREEN。

H03是静态发现destroy/session flush失败在try范围之外的问题；作者在本审核首次执行前已修复。本审核只有绿色回归，不将其冒称独立RED。H06的备份UUID软链接边界原实现已正确拒绝，真实外来包读取计数为0，不列为生产缺陷。

## 独立用例和阶段结果

`tests/unit/application-restore-handoff-106-review.test.ts` 8项：同字节catalog inode替换；原picker owner撤销与公开callback换noop；销毁后session flush实际ENOENT；arm发布后实际bootstrap目录fsync失败；取消普通关闭后保留prepared并显式取消；备份UUID symlink零外来读取；新UUID目录身份替换；物理data close已完成但后续关闭步骤缺少实际证据时保持closing，仅允许重试close。

`tests/unit/close-coordinator-106-review.test.ts` 4项：异步window commit升级quit；期间出现新renderer；闭库成功后commit失败仅重试commit；原owner消失后commit失败不向旧owner重试/导出。两份独立文件共12项。

H08审root追加的closedHandoffPending协议：data close后真实shutdown证据ENOENT导致requestClose=false，操作保持closing，不能显式cancel；同operation再次start只重试关闭，真实request最终armed，destroy/relaunch各一次且pointer不变。此为已实现增量的绿色负例，不列为独立RED。

| 阶段 | 结果 | 证据 |
| --- | --- | --- |
| H01..05首次执行 | 5/5 GREEN | review106-01-handoff-attempt.tap |
| 独立9项与原作者回归 | 23/23 GREEN | review106-02-handoff-close-related.tap |
| 当时全仓types | exit0，空诊断 | review106-03-current-types.txt |
| H06真实link边界 | 1/1 GREEN | review106-04-backup-link-check.tap |
| H07真实目录替换 | 0/1 RED，两次原oracle | review106-05-native-child-identity-red.tap；06-native-child-identity-attempt.tap |
| H07生产修复后，全部11独立及作者相关 | 25/25 GREEN，fail/cancelled/skipped=0，1246.216541ms | review106-07-handoff-child-fixed-related.tap |
| 107主流程开发中的全仓types | exit2，仅尚未落盘的新protected-service模块引用；原日志保留，不称最终通过 | review106-08-current-types.txt |
| 新关闭重试增量，全部12独立及作者相关 | 26/26 GREEN，fail/cancelled/skipped=0，1515.168292ms | review106-09-closed-intent-latest-related-attempt.tap |

## 最终冻结和验证

`root-ordinary-restore-handoff-frozen-v1.json` 固定9项：三份主审生产源、layout实现及shared schema依赖、两份作者测试、两份独立测试。10/13同时核对该freeze、新cold-entry freeze与protected-service freeze，共55去重项均与期望bytes/hash一致；聚合SHA256为 `da2e349af1b6cb55f9e28f8703a27bae80d7ed15d101857bfa19925bf4257c81`。借用cold-entry及protected-service freeze只是钉住真实layout和只读依赖，未把这些更广模块的完整范围纳入106 PASS。

`review106-11-frozen-final-related.tap`：7测试文件73/73 GREEN，9979.5425ms，fail/cancelled/skipped全部0；覆盖全部12独立106用例、作者handoff/CloseCoordinator、实际layout FS及原104请求私有owner/phase/history反例和原请求回归。`review106-12-frozen-full-types.txt`为全仓tsc exit0、空诊断。08与107-07的开发中类型失败日志保留，原source narrowing诊断已由作者修复；未覆盖旧失败证据。

关闭重试边界：closedHandoffPending只承认受信宿主的data close状态；它不证明旧PID退出。实际destroy/session flush失败转inspection；未确定arm的append-only记录保留，不授取消/重放；armed只交由下一冷进程凭实际ESRCH和完整控制链认定执行资格。`handoff.flush`仍不得从其自身start→CloseCoordinator→closeData调用形成自等待；当前main接线另由107审核。

测试使用实际隔离FS、真实request/layout/append-only阶段记录及实际IO错误；窗口、session flush、关闭owner与relaunch为受信宿主生命周期double。没有运行真实Electron窗口、实际旧session关闭、旧Electron PID退出、数据库恢复生产者、安装包或MacOS/Windows验收。正式531全部not-run。
