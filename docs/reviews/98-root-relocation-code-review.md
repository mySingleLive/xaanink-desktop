# 98 原应用根重新定位核心独立审核

审核者：`/root/product_review`。日期：2026-10-08。结论：本轮限定范围 PASS。原三个真实失败分支已修复并保持原断言通过，独立六项及相关四文件 75/75、全量 types0 和正式v2指纹均已核验；无未关闭发现。本报告不是主进程、启动入口、原生或 Windows 验收。

## 范围和独立性

仅审核第31批新增 `desktop/core/root-relocation.ts`，按 root-relocation-contract.md 审核冷宿主、同一物理目录重新定位、CAS 与 append-only receipt、控制记录保留和精确 ACK 子集演进。没有修改生产或作者29条断言。

只读使用原 DataRootManager.parsePointer/recordedMigration、RootMigrationRequests 的严格 decoder 与真实 ACK writer、根布局/元数据格式。29 库存迁移是 reviewer 的作者范围，不能在本轮自审为 PASS。根主接线、启动 recover 精确 disposition hook、维护 UI 仍未实现，不将缺接线写作核心缺陷，也不授完整用户流程通过。

## 实际发现及定向修复

| ID / 严重程度 | 证实行为 | 修复与复验 |
| --- | --- | --- |
| RL98-A / P2（01、02） | pointer 已 rename 后，在真实目录同步等待阶段同 inode 目标再次被改名，或原 cleanup-pending journal 被改写，commit 仍返回普通成功 ACK。目标失联或原证据不成立，不能兑现可冷启动和保留 disposition 的合同。 | 作者新增最终 committedSeal：在全部 durability await 后同步核新 pointer 精确 proof、owner/cold/lock、完整候选 layout、journal/request、原/本次 receipt 及集合。失效固定 DURABILITY_UNCONFIRMED，不猜 rollback；独立01/02原拒绝、保留数据/外部文件与已提交指针 oracle 全部通过。 |
| RL98-B / P2（03） | cold getter 先读取 receipt 集合，再等待实际 bootstrap directory handle.sync；期间新增 foreign receipt。收尾只查旧记录的文件，遗漏集合 CAS，发布过时 disposition。 | 作者在同步等待之后最终同步复核 receiptNames 与本次完整已读集合；独立03保持原拒绝、外部 receipt 原字节和 pointer 原字节不变 oracle 通过。 |

`review98-01-independent-boundaries-red.tap` 是实际隔离 FS 0 PASS/3 FAIL、exit1，三项均 Missing expected rejection，没有编译、缺接口或夹具失败。所有原行为断言保留，由作者改源，reviewer 没有修实现。

## 独立方法与通过边界

`tests/unit/root-relocation-review.test.ts` 六项直接执行生产 core、真实小型目录和原 DataRootManager.adopt；cold/owner/lock 是注入合同，没有模拟其等价于 Electron session 或数据库关闭。03只在实际 handle.sync 等待点注入外部文件，不重建 getter。

原失败三项之外，三个首次 GREEN 用例验证：

- 两个原结果经真实 RootMigrationRequests.acknowledgeResult 持久化后，每次 getter 只看到剩余精确子集；第二次同 inode 改名后再次 ACK，完整审计链仍成立，两个 receipt 字节不变，原数据库夹具字节保留。
- receipt 的 directory sync 不确定时不提交 pointer，不自动续执行；另一个明确新 attempt 能提交，同时保留先前未提交 receipt；冷 getter 唯一识别实际新 pointer 对应的 receipt。
- pointer 已 rename 时再取消，cancel/flush 等实际在途 durability 阶段，新 prepare 被 busy 阻断；最终不给普通 ACK、不回旧 pointer，冷只读核验可识别已提交新 authority，原数据保留。

`review98-03-post-fix-boundaries-green.tap` 实际6/6、exit0。`review98-04-final-related-green.tap` 实际四文件75/75、0fail/skip/cancel、exit0（作者29+独立6+既有request36+record4）。共享回归不累计为正式531覆盖。

独立全量 types05 的两个诊断仅 root32 在途 `atomicWrite` 可选 withWrite 委托递归返回推断错误，已经由主代理窄加 Promise<void>，未改31生产或独立测试；保留该日志，不称当时类型通过。独立最终类型 `review98-06-final-typecheck.txt` 已实际 exit0、空诊断；没有为邻接的纯返回类型注解重复业务回归。

## 源码与合同限制

代码只定位原 RootPointer dev/ino 的实际目录，不支持跨卷、复制或备份恢复。pointer 必须有效；原 ready/inboxReady marker、目录身份、bounded普通文件/UTF8/JSON与PG_VERSION布局证明不等于数据库健康。未读取或写入API Key，没有调用模型、远端或 PGlite。

确认严格 true；宿主断言同步 void、Promise/boolean 拒绝；固定 bootstrap 身份与原 owner 防迟到授权。不可变 receipt 在 pointer 提交之前持久，未提交 receipt 不授权执行。原 terminal/pending journal 字节和生产 ledger 结果保留，只有精确原结果子集可演进。失败/新外部 inode不能被重新认领，临时清理仅限本次精确 inode/版本。

第31批尚未接实际 cold main/picker/UI、DataRoot恢复抑制与冷启动串联。稳定实例锁、原引擎/session完全结束由后续真实宿主兑现。Windows unsupported分支作者受控测试仅只读引用，不当本机实物Windows验收。本轮无原生、物理选择器、大型PG或531正式验收。

## 冻结记录

v1 38份记录的声明聚合 a05749f187b44640fed0e643617e3586bb810d124148d0966b0ae3911ef96434 重算匹配。初核37/38实际SHA相同，唯一 versioned-store 为主代理32新增可选withWrite入口的已知邻接变更；无选项的原body未改变，31不使用该选项。不篡改v1或把该历史差异藏掉；记录在 review98-02-initial-manifest.json。最终v2/base同字节，5作者文件+1独立测试+15只读依赖+29证据共50份实际SHA全匹配，按上述四组顺序path:sha256、LF含末LF，聚合 `0fcbe2ad23ba2cc98c73903632232bc6faca24a8cb7a133b804223f80f966527` 全匹配。最终记录 `review98-07-final-manifest.json`。v2引用当前已知邻接依赖时点，v1保持原字节，其历史差异不被抹掉。

追加 v3 文档/证据复核：作者移交 v2 曾误称其23类型日志exit0，实际23只有邻接33 controller的三条在途类型诊断。作者保留v1/v2原样，修正文档、追加真实24类型exit0空诊断与v3清单，未改31核心、29作者断言或6独立断言。reviewer 仅核新增文档、日志及全部51份SHA，聚合 c0127bdd905d5ae7acff577a97e4d76f815516f98fdcd84f68afb602546ca557 匹配，正式base/v3同字节；记录review98-09。没有重复75项。独立06类型实际0及原限定PASS仍成立，旧07/08的v2指纹记录保留不覆盖。
