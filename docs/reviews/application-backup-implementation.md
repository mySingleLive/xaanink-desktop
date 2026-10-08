# 第 17 批应用根备份与隔离恢复作者移交

日期：2026-10-08。作者实现与证据移交，等待第 84 轮独立代码审核。本文不是独立 PASS，也不更新 531 条正式用例状态。

## 已实现边界

新增四个源文件：

| 文件 | 职责 |
| --- | --- |
| desktop/shared/application-backup.ts | 目录封包与候选 receipt 的严格 schema、阶段和资源上限。 |
| desktop/core/application-backup-files.ts | 有界复制/散列、canonical checksum、目录/文件身份和版本复核。 |
| desktop/core/application-backups.ts | 已闭库 capture、强制隔离语义核验门槛、verified 封存与保守 pin/retention。 |
| desktop/service/database/application-restore.ts | 受信空目录的 UUID 候选、实际 PGlite/迁移/作者/模型引用/设置/草稿/头像校验、关闭后的 seal 及只标记取消。 |

合同见 [application-backup-contract.md](../evidence/implementation-17/application-backup-contract.md)。本批未修改 main/index、IPC/preload、Workspaces 或已有 DataRoot 迁移核心；没有启用候选或更新权威指针。源始终不被本批删除或覆写。

备份包含当前全局库、配置密文、全局头像及恢复数据；排除独立作品、Chromium、迁移 JSON、未知邻文件和 inbox/snapshots 历史备份归档。历史归档仍留原处，不将已有备份递归装入新包。新包没有实际隔离 PGlite 核验成功时只保持 captured，不能以 byte/hash 自洽删除旧可恢复包。

## TDD 与发现来源

保留所有失败尝试，不把夹具错误或缺依赖伪装成产品 RED：

- application-backups-01-red：已存在类的行为骨架下 6 项中 5 FAIL/1 PASS；03 GREEN 6/6。链接拒绝的那项骨架已经 PASS，不能用它证明当时已有真实链接保护；最后使用实际文件系统重验。
- application-restore-04-red：真实原 schema 和原模板/会话夹具完成后，恢复函数行为骨架未实现产生 1 FAIL，05 初次 1 GREEN。
- application-backups-06-identities-red-attempt：空目录替换夹具把旧目录移到包内，实现正确拒绝了多余内容，但错误码 oracle 不匹配；此日志是夹具失败。07 改为移出包后出现真正 Missing expected rejection，08 修 seal 的创建目录身份后 8/8。
- application-candidate-12-metadata-red.txt：两项真实 FS Missing expected rejection；verify 返回迟到旧 ready、cancel 覆盖已变 metadata。13 加 metadata 身份/版本 CAS 后 13/13。这一 RED 文件是 Node spec 文本输出，不是 TAP。
- application-backups-17-retention-red：新加四项全部真实 FAIL；已 hash 文件迟到变化、缺语义核验仍 prune、缺 verifier 构造未拒绝、核验中新包变化。18 修 final file check、必需 verifyCaptured、captured→verified 原子阶段及前后全量 hash 后 17/17。
- application-backups-23-storage-boundary-red：不安全容器仍能写入源目录，真实 Missing expected rejection。24 加源/引擎/头像/cache/作品角色边界后，本组 18 + 原 inventory 7 共 25/25。
- application-restore-14-global-boundaries-green-attempt：扩充外来 User 夹具时漏了原 schema 的 email 必填字段，保留真实 SQL NOT NULL 失败日志；不是产品 RED。19 修夹具后实际坏控制文件/外来作者/保留旧健康包组通过。22 在最终真 PNG、合法密文 state 和原 journal 等组合下再次通过。
- 11/16/21/26 typecheck 历史尝试仅记录其他作者在途 file-export/desktop-export/work-lease-recovery 类型诊断；本批自身没有这些诊断。最终型别结果以冻结清单所列最新文件为准。

上述日志逐个保留，计数不累计历史回放。最终作者相关集为 18 个真实 FS 顶层 unit + 1 个原 PGlite 顶层 integration + 7 个已有 inventory 回归，共 26；独立审核的新测试不计入作者先验通过数。

## 第 84 轮独立审核后的定向修复

第 84 轮的失败日志和断言由独立 reviewer 创建，作者未改写。v1 冻结原样保留，当前源已完成 v2 最终复验，等待独立结论：

- AB84-01：新包在清理旧包中途失去证明后，剩余历史仍被删。每次不可逆删除前加入完整已 hash seal 的同步身份/版本/成员复核，损坏时停止后续删除，保留尚未删除的历史。
- AB84-02：候选在最终 owner await 中改动文件却返回旧 ready。producer/verifier 最后异步检查后均同步复核完整 seal，成功路径没有多余 finally await。
- AB84-04：容器已 1,000 项还创建第 1,001 包并报成功，后续 list 却不能读取。预留一项并在封存/删除/成功之前重验容量；扫描最多观察 1,001 项即拒绝，未知邻文件不清理。
- AB84-05：通用 atomicWrite 失败 finally 按路径删除被替换的外来临时文件。经主代理明确允许，新增仅用于本批 receipt 的 fd 身份/版本/字节 writer，rename 与失败清理前同步复核归属；不改通用 VersionedStore。第 30 次修复尝试因 rename 正常改变 ctime 导致 14 个实际回归失败，原日志保留；第 31 次捕获同一 inode 的 rename 后版本，25/25 unit 通过，未将失败称为夹具问题。
- AB84-I02：真实 PGlite 候选已返回 ready，但原 Workspaces 实际拒绝坏 catalog。复用主代理窄导出的原 catalogSchema 校验，保留合法但失联作品索引，不打开独立作品。
- AB84-I05：真实设置引用合法 UUID 头像，但包里无对应 PNG，仍返回 ready。当前头像必须存在于备份文件清单，且沿用实际 PNG 解码；失败保持 captured 和旧健康包。

最终相关组为作者 19 个、旧 inventory 7 个，加独立 7 个 FS 和 5 个实际 PGlite 检查，共 38 个顶层测试。第 31 次 FS 组 25/25，第 33 次完整类型检查为 0。第 32 次并行大库尝试出现独立 I01 的 180 秒预算超时（实测 264 秒），随后受控中止并保留 Interrupted 日志，不能称为完整通过。reviewer 自行只将其五个真实 PGlite 检查的执行预算改为 600 秒，未修改数据/权限断言；最终由 reviewer 唯一串行运行，review84-11-final-related-serial-green.tap 已实际完成 38/38 PASS，0 fail/cancelled/skipped，退出 0，总 784.2 秒。正式 v2 清单纳入该稳定完整日志；原 v1、pending-v2、32 超时中断及所有真实 RED 均保留，不累计旧 26/25 次回放。此最终运行由独立 reviewer 执行，作者未启动重复大库或将自己的实现记录当作独立 PASS。

## 真实集成实际证明了什么

APP17-I01 用原 Workspaces 初始化原完整 Prisma schema，原 LocalTemplateLibrary 创建用户提示词与向导，写入 local-author 的无作品会话/消息和不可调用 AIModel 引用，随后真实关闭 Workspaces。原 DraftJournal 写入合法带排队执行意图的数据，原 stateSchema 形状的状态保留密文字节，sharp 生成并实际解码 PNG。

完整字节包移入另一容器后，原当前源的 inbox/database 删除。恢复和只读包读取的宿主 assertClosed 刻意抛错，确认它们不依赖坏当前源。候选在新空目录完成实际迁移和作者归属验证，关闭后封存；其数据库复制到单独检查目录再次冷开，核自定义提示词、变量、向导、无作品会话/完整消息与 disabled 空 Key 模型引用。状态、草稿和 PNG 精确字节一致，历史排队意图不执行。取消仅改候选 receipt，数据库原字节仍在。

非空目标、失效 owner、预取消、不同 appUUID、错误迁移都失败并保字节。外来作者和真实损坏 pg_control 的源仍可被封存为 captured；宿主实际打开隔离 PGlite 后拒绝，两种失败均不清理原 verified 健康包，不打开封存包或原源数据库。未将 raw “字节可封存”当作“数据库可恢复”。

## 交接给主进程的要求

1. 从原生/实例 grant 创建备份容器 RootIdentity，提供真实 directory role 授权。source 必须在业务 gate 排空、数据库/附件/writer 关闭同步后使用，不能由 renderer 直接传路径授权。
2. verifyCaptured 是强制宿主实现；复用 prepareApplicationRestore 时另建独占空校验父目录，使用只读 inspect，不在 create 回调中排队调用同一 store 的 read/list/create。成功前后核心重验新包。失败保管 captured 包和隔离候选，不能自动递归清掉未知字节。
3. 故障根恢复只要求包容器与目标父目录所有权，expectedAppId 和已安装迁移来自受信流程，不能要求坏当前源先能打开。当前引擎声明需与受支持版本匹配；未引入版本猜测或自动降级。
4. 候选始终独立。激活、恢复草稿隔离、后台任务停止、应用根 marker/指针、重启和其他启动服务兼容检查由后续主流程负责；本批已核原 catalog、设置、草稿和当前头像等必要应用数据。本批不自动批准草稿、运行保存的工具请求、清空模型历史引用或替换当前权威根。
5. 取消与激活用同一串行租约；传真实 isActive，保管准备阶段尚无 ready receipt 的失败/取消字节。未知/损坏包保留，captured 不作为成功备份列表项。

## 限制与冻结

没有 Electron/原生选择器/实际关闭所有 writer/Windows/物理断电验收，没有真实 safeStorage 或付费模型请求。受控 core verifier 不作为真实数据库证明；真实库证明来自 APP17-I01 的实际隔离 PGlite 运行。所有正式顶层用例仍 not-run。

最终 source/test/合同/作者报告、证据与只读依赖的 SHA 在 implementation-17/application-backups-frozen.json，由同目录 manifest generator 生成。已完成源码暂冻结，若独立审核发现问题，按真实 RED 修复并保留历史冻结版本。
