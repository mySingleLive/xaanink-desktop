# 第 35 批整应用恢复核心：独立代码审核 102

状态：**PASS（限定本批恢复核心）**。2026-10-08，以下五项独立发现已保持 oracle 转 GREEN，最终冻结、独立真实原 schema PG 与全仓类型核验通过。这个结论不表示整应用恢复产品入口已完成。

本次范围为整应用恢复 producer 私有能力、完整草稿保留、冷态恢复启用、指针 CAS/不确定写盘、统一权威历史、应用专用两次真实 checkpoint 屏障，以及 DataRoot/定位 getter/启动入口的窄衔接。主进程冷恢复编排、完整 UI、现存且数据库损坏根的原始冷源保留、原生系统选择器、Windows 和正式 531 条用例均不在本批核心通过范围；531 条仍为 `not-run`。

## 独立发现

| 编号 | 级别 | 实际触发与问题 | 当前状态 |
| --- | --- | --- | --- |
| AR102-R01 | P1 | 两次合法恢复后，新回执改为 `history:[]` 并重新计算 checksum，所有旧回执仍实际存在；全新 `readRootAuthority` 接受这份不完整的前序控制列表。 | 保持独立 oracle 转 GREEN：校验完整 before ancestry 和实际前序 append-only 文件。 |
| AR102-R02 | P2 | 同一个 bootstrap 中出现实际文件 proof/格式/checksum 都合法，但 `before/after.rootId` 属于另一个 app 的恢复回执；全新读取器接受为无关审计。 | 转 GREEN：所有记录绑定当前 app；合法同 app、未提交指针审计仍保留。 |
| AR102-R03 | P1 | 正式保留文件 `application-restore-drafts.json` 存在时，下一次在线应用捕获的元数据阶段不复制它，后续备份会静默漏掉完整原草稿。原因是原 `application-snapshot.ts` 固定元数据清单未包含新文件。 | 转 GREEN：精确固定文件纳入原元数据捕获租约，不泛化认领 candidate metadata 或任意文件。 |
| AR102-R04 | P1 | 实际当前根存在且最新恢复前 snapshot 可验，但 genuine producer 候选采用 `current:null` 生成保留草稿，reseal 后仍通过 `Activation.prepare`。最新来源的物理身份未绑定实际权威指针。 | 转 GREEN：最终私有能力绑定 exact current identity/null，Activation 核实际 pointer；同 app 错根也拒绝。 |
| AR102-R05 | P1 | genuine sealed 候选发行后撤销原生父目录的原 producer owner，最终 `validatePreparedApplicationRestoreForActivation(...).assertCurrent()` 仍通过。Activation 的 owner 与 producer 的原生目录 owner 不能假定永远同生共灭。 | 转 GREEN：reseal 强制原受信同步 native owner seal，并捕获原函数；撤销后换成 no-op 不能复活能力。 |

审核只增加独立测试与本报告，不修改生产。修复必须保留原 oracle；正确行为应拒绝损坏证据并保留指针、源数据、候选和审计文件，不得用清理未知文件或广泛忽略历史来使测试通过。

## 证据及测试边界

- `tests/unit/application-restore-102-review.test.ts`：冷控制真实文件身份、两次完整历史、外来 app 边界与实际在线捕获元数据复制。`review102-01-independent-authority-attempt.tap` 为 0/2，`review102-02-independent-snapshot-attempt.tap` 为 0/3。两项权威测试先证明完整合法链能读取，然后施加单一损坏；R03 在 `before-import` 主动停止，绝未启动候选 PGlite。
- `tests/unit/application-restore-102-capability-review.test.ts`：调用真实 producer 发行、完整复制与重新封口，私有 WeakMap 未伪造。SQL 引擎明确使用隔离 protocol double，测试不授数据库健康或 schema 正确性；其用途仅为来源绑定/能力撤销。`review102-03-private-capability-attempt.tap` 为 0/2。
- 作者实际原 schema PGlite `35-real-pg-reseal-activation-attempt.tap` 为 1/1、256.44 秒；这是作者证据，本审核尚未独立复跑，且后续修复仍需匹配最终冻结。
- 修复后 `review102-07-postfix-related-attempt.tap` 为 62/62，含三个独立文件及原恢复/草稿/权威/定位启动相关组。取消等待真实确认 flight、旧 pointer 同字节换 inode、receipt fsync 不确定锁定、正文/对话/批注/旧批准作为完整惰性副本经历两次实际 checkpoint 均通过。`review102-08-typecheck-attempt.txt` 为全仓 types exit 0。
- 作者随后补的同 identity 但草稿晚变更观察绑定，由独立 `AR102-F13` 再验：较新的健康 before-snapshot 不能掩盖 reseal 后 source journal 变化。`review102-09-late-source-attempt.tap` 为 1/1 GREEN；执行时修复已在，不称本审核取得 pre-fix RED。
- `AR102-F14` 实际 DataRoot 迁移验证合法未提交恢复审计可保留：只有原 `before` 及精确 pointer 文件 witness 能桥接实际 migration.source；冷检查返回 null、不重建确认，错 inode 拒绝。`review102-10-pending-audit-migration-attempt.tap` 为 1/1 GREEN；作者对应 pre-fix RED 另见 `54-uncommitted-audit-migration-red.tap`。不把作者先发现的增量称为本审核先 RED。
- 最终 `review102-12-final-related-attempt.tap` 为 **65/65**，含原样独立 oracle、晚变更观察绑定、合法 pending 审计与实际迁移、完整混合链及旧定位启动回归。
- 本审核冻结后按 root 授权的独占资源窗口执行 `tests/integration/application-restore-102-review.test.ts`，`review102-14-real-pg-attempt.tap` 为 **1/1 PASS、130.34 秒**。实际原 schema 全局会话/消息、系统配置、空 key 禁用模型及 PNG 从验证包恢复；源物理失联后严格确认启用，实际 `startOwnedRoot` 在提交目标打开原 Workspaces 并核对数据，随后完成两次真实应用 journal checkpoint。旧已批准请求保持惰性，原冷源最新 journal 字节保留。目录实际现存但 PG_VERSION 损坏时传 `false` 被拒绝，未打开损坏源、未伪造健康 snapshot。所有引擎顺序打开/关闭，测试进程 exit 0，成功隔离目录已清理；没有真实模型或网络请求。
- 本组使用受信测试 host 代理选择与严格确认，未操作物理 OS 文件选择器或产品恢复 UI；它是实际数据库/文件核心验收，不是完整桌面用户验收。作者 earlier healthy-source PG 仍仅作为前述历史基线，不冒充最终冻结后的同组重跑。
- 现存且 inbox/数据库损坏根无法生成健康恢复前 snapshot：当前 API 明确拒绝，不能传 `false` 绕过物理现存来源，也不能把原始副本命名为健康 snapshot。这是后续实现待办，不能据此授完整应用恢复验收。

## 冻结与有限结论

独立核验 `application-restore-activation-frozen-v1.json` 全 **113** 份 SHA256 与 bytes（16 生产、12 只读依赖、8 作者测试、4 独立测试、4 文档、69 原证据）前后完全一致。独立 aggregate 为 `e61b2f87c7f5ee8594257cbb7bddd261b4bef336681af9ec394f7f77e31aa43c`，manifest SHA256 为 `aff49fec3451de0cf55cd2fed572c314e1724da7e9f6a6863b2c6b2a0e90f077`。`review102-13-frozen-pre-pg.json`、`review102-17-frozen-post-pg.json` 记录前后核验；额外实际原 schema/迁移/Workspaces/context/锁文件等 **67** 份输入亦零变化，记录于 `review102-15-real-pg-inputs.json`。最终全仓 `review102-16-frozen-full-types.txt` 为 exit 0。旧第 29/31/33 批冻结和失败记录没有重写。

本次未发现仍未处理的本批阻断问题，授上述有限核心 PASS。支持的混合权威链包括 restore→migration→relocation、restore→relocation→migration、二次 restore 后 migration，以及精确见证的未提交审计→migration。连续 migration 中间缺少旧 journal append-only witness 的组合仍阻断为 `HISTORY_INCOMPLETE`，属于后续第 38 批协议待办，不猜测丢失链。现存且损坏源的原始冷保留属于第 36 批；完整 main/preload/React 冷恢复入口、原生文件选择器与用户确认、Windows 及 531 条正式用例继续未完成，不由本报告授 PASS。
