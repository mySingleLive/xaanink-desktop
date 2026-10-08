# 93 · 应用级在线备份编排与候选完整证明独立审核

日期：2026-10-08。审核者：独立子代理 `product_revision_review`。

最终结论：**限定 PASS**。ABS93-01 / P2 已关闭；独立最终相关合跑 7/7 PASS，全量 TypeScript 检查退出 0；正式冻结 42 份 SHA 与聚合全部匹配。以下保留原始缺陷和失败尝试，不再重复真实数据库测试。

## 范围与独立性

只审第 26 批 `desktop/service/application-backup-session.ts` 的在线编排，以及 `desktop/service/database/application-restore.ts` 本轮新增 `prepareApplicationRestoreWithProof` 完整 tree 返回值和旧 wrapper 的兼容边界。作者测试为 `tests/integration/application-backup-session.test.ts`。

17 备份包、22 快照、24 staging 清理及 25 维护元数据验证作为只读依赖。本审核者是 25 helper 的作者，本轮不对该依赖重新授予独立通过。Workspaces 的第 27 批宿主接线不在本轮范围；本轮不修改生产代码、作者测试或其他代理的审核文件。

## 发现

### ABS93-01 / P2（已定向关闭）：作品清单读取后变化仍能在新作品中建立备份目录

`containers()` 只在建立命名空间前读取一次 `catalog.json`。之后 `ensure()` 和 `guardContainers()` 复核 source/已知目录身份及 inbox lease，但未复核在线作品清单是否已占用该命名空间。

独立用例先提供空清单。在第一次真实 catalog 文件句柄读取并关闭后，下一次受信 `assertLive` 等待中实际创建 `root/backups`，写入作者原文件，并将此目录登记为合法作品（真实目录 dev/ino，catalog revision 从 0 更新到 1）。当前 `session.list()` 仍成功，并在该作品中建立 `application/packages`、`staging`、`validation`。原 `author-note` 字节未改变，但列出备份这一操作越过作品与应用备份的命名空间边界。

这不是只改虚拟 stat 的夹具：目录、清单和作者文件均为真实隔离文件系统。仅 `SHOW server_version` 使用受控 engine；此用例未执行、也不声称执行真实 PostgreSQL 备份或候选验证。公开合同只要求保留 exact inbox lease，没有要求独占 catalog。

建议在实际创建目录及后续保护动作前复核清单的命名空间授权，或由可信宿主持有覆盖整次操作的 catalog 排他屏障，并在公开合同与真实接线测试中证明。不能仅在操作开始时校验一次。

证据：`docs/evidence/implementation-26/review93-01-namespace-red.tap`（首次实际 RED）；`review93-03-stable-postread-red.tap`（采用真实句柄关闭信号定位注入，不依赖 guard 调用次数，4 项中 3 PASS / 1 FAIL）。独立测试文件：`tests/integration/application-backup-session-93-review.test.ts`，原数据与拒绝 oracle 未放宽。

修复后，`guard()` 在受信 host 等待后同步、有界、nofollow 读取 catalog，核对句柄与路径的 inode/revision/size，再校验命名空间；`ensure()` 在真实 mkdir 前再次同步核对清单和父目录，随后采用同步 mkdir，避免另一 JS 任务插入目录登记。目录容量与 original inbox lease 合同仍保留。独立原 4 项复跑全部 PASS（`review93-05-first-fix-green.tap`），ABS93-01 的原断言未改变。本轮没有再次发现已复现的阻断项。

## 已核验的新证明接口边界

独立 ABS93-02 至 04 首次均 GREEN：候选 engine 的 close 挂起期间不得发布 receipt；成功返回的 tree 包含候选 receipt 自身的 inode、revision 和完整 hash，而 receipt 的 files 不递归包含自身；该原始完整 seal 可清理完整候选。返回后出现 unknown 文件时，使用原 producer tree 的清理拒绝执行，整树与 unknown 字节保留。旧 `prepareApplicationRestore` wrapper 仍返回 checksum 有效的 ready receipt，没有泄漏新 tree 包装类型。

这些用例调用实际生产 API，执行真实复制、hash、receipt 写入与 staging 清理。为隔离新增返回/close 接口，它们对 `PGlite.create` 及固定验证查询结果作显式受控替换，因此不构成候选 PostgreSQL 健康、迁移或原 schema 的独立证据。日志：`review93-02-proof-first-run.tap`、`review93-03-stable-postread-red.tap`。

作者的完整新 fresh 日志 `application-backup-session-05-final-green-attempt.tap` 为实际 3/3 PASS（约 146.75 秒），包含真实最小 PGlite 的 snapshot → package → 隔离候选验证 → 原 proof 清理；本审核者未把该作者运行计为独立执行。

首次全量 TypeScript 检查退出 2，唯一诊断为邻接第 27 批在途 `tests/unit/application-backup-workspace-lifecycle.test.ts:37` 的 mock 类型（`'list'` 对 `never`）。已保留 `review93-04-types-attempt.txt`；没有将这个相邻诊断归为第 26 批缺陷，也没有称全量类型通过。

修复后再次全量 TypeScript 检查退出 0、无诊断（`review93-06-fixed-types.txt`）。随后启动作者 3 项加独立 4 项合跑，因正在修改的只读依赖 `desktop/main/owned-root-files.ts` 缺失 `readdir` 导入，真实 PG 原用例和三个 proof 用例同栈提前失败，实际为 3 PASS / 4 FAIL（`review93-07-final-related-green-attempt.tap`）。这次失败未计为新的第 26 批行为缺陷，也未删除或覆盖日志。主代理已确认导入修复；第 29 批正在统一 inventory helper，按协调要求等其依赖明确稳定后再开始下一次真实数据库合跑与最终冻结核验。

共享依赖具备运行条件后，本审核者独立执行最终相关合跑：作者 3 项加独立 4 项全部 PASS，0 skip/cancel，进程退出 0（`review93-08-final-related-green.tap`，总 183.52 秒）。其中真实最小 PGlite 场景独立执行了在线导出、备份包、候选实际打开/验证/关闭、原 producer tree 清理、源库继续写入和后续失效 lease 拒绝；该场景约 183.06 秒。后三项 proof 探针仍按上文明确为真实 FS 加受控验证 engine，不能与真实 PG 场景混同。最终全量 TypeScript 再次检查退出 0、空诊断（`review93-09-final-types.txt`）。大库测试队列已立即释放，不再重复相同大库场景。

## 最终冻结核验

正式清单 `docs/evidence/implementation-26/application-backup-session-frozen.json` 与历史 `-frozen-v1.json` 字节相同。独立读取每份当前文件重算 SHA：5 author files、1 independent test、20 readonly dependencies、16 evidence，合计 42/42 匹配；按 `files → independentTests → dependencies → evidence` 顺序，将 `path:sha256` 记录以 LF 连接且保留最后 LF，独立重算聚合为 `bac8260cefbe987c7f5ad434da27266489494faad298a856e3db3457e932ba66`，与作者清单完全一致。核验脚本 `review93-manifest-check.mjs`，结果 `review93-10-final-manifest.json`，均为本审核者新增证据，未运行作者生成器覆盖清单。

该冻结明确记录第 27 批 Workspaces lazy import 和第 29 批 inventory 为只读依赖快照；本轮检查其对应 SHA 和本次整合运行条件，不重授它们的独立代码审核结论。后续依赖修订需按新的快照和各自审核记录追踪。未修改生产源、作者测试、正式清单或其他代理的报告。

## 验收限制

本记录仅针对第 26 批源代码与上述独立行为探针。尚不构成第 27 批 worker lease/close 接线、Electron 原生操作、完整原业务 schema、Windows 或正式 531 条用例的最终验收。
