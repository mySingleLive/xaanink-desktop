# 第109批独立审核：第38批迁移历史合同与用例提案

2026-10-08。**结论：需修订后再审，尚不能进入生产实现。** 覆盖前封存旧终态 journal、保留完整原字节、独立钉住封存文件实际身份、严格拒绝 pending/unknown、统一 restore/relocation reader 的方向成立。但当前草案尚有三个持久协议断点，以及两个必须定稿的接口/用例问题。

这是合同与 proposed oracle 的静态审核，**不是实现 code review PASS，不是 RED/GREEN 执行结果，也不是平台或正式531用例验收**。本审核未修改生产文件或作者草案，未启动 PGlite、Electron 或真实迁移。Windows 仍按用户答复待验收。

## 审核对象与实际证据

- 作者草案：[迁移历史合同](../evidence/implementation-38/migration-history-contract-draft.md)，SHA-256 `868ea48f96e9abe749c07fb13593a143d417efcc8a808dcb9c969b95d707d2ce`。
- 定向阅读 `desktop/core/data-root.ts`、`root-authority.ts`、`root-relocation.ts`、`root-relocation-retention.ts`，以及 `desktop/main/root-migration-request.ts`、`root-maintenance-runner.ts`、`root-maintenance-preflight.ts`；只读第35批 activation 合同与第36批 entry/source-union API 相关历史章节。
- 未进行源码探索委派，CodeGraph 当前不可用，按项目约定使用 `rg` 和定向阅读。
- 哈希工具 `shasum` 因本机 Perl locale 配置失败，随后使用已配置 Node.js 的 `crypto` 只读核对成功；该工具失败不属于产品 RED。

实际源码支持草案对缺口的判断：`DataRootManager.migrate` 只拒绝非终态旧 journal，随后覆盖固定路径；迁移 journal v1 仅有可选 `authoritySourcePointerFile`；`readRootAuthority` 候选仅来自 live journal 和 application receipt 内复制的 journal。`RootMaintenanceRunner` 确实先 `startArmed`、再 `migrate`、最后 `finish`，故迁移 writer 面临实际 executing ledger，不能放宽通用冷 reader。

## 必须修订的合同问题

### H109-R01 · P1：迁移 after-pointer 的实际文件见证尚未定义

位置：草案第3.2节（第52–54行）、第4节（第88行）、第8节第1项。实际来源：`data-root.ts` journal schema 第81行及 `migrate` pointer CAS 第856–886行；`root-authority.ts` `follow` 第94–95行。

`source + target + revision` 可以推导语义 outcome，却不能推导提交后 pointer 的真实 inode/原字节。当前 reader 跟随 migration 时仅用语义 pointer 匹配；草案虽要求每步串联原 pointer proof，却将「是否额外记录首次 commit proof」留给实现阶段。封存时当前 anchor 也可能已经是后续 restore/relocation 的 pointer，不能把其 file proof 填入旧 migration outcome。

修订要求：在合同内确定新 migration 的精确 before/outcome pointer text/file witness、发行时刻、以及 rename 导致的 ctime 变化规则。若采用真实 pointer 临时 inode proof + 提交后的封口 observation，必须规定 pointer CAS 前后、directory fsync 失败、terminal journal 尚未写时的重开规则。若合法旧 journal 的 outcome proof 来自既有 receipt 的 `beforePointerFile`，必须列出可接受的精确关联分支；缺证据时保守阻断，不补造 after-file、不把新 anchor 当成旧结果。reader 遍历 migration 必须核验传入 headFile 与该 outcome witness，而不是只核语义 outcome。

oracle 补充：实际 writer 产生 A outcome，随后同字节替换 pointer inode；另测 A→restore/relocation→封存 A；以及 pointer rename 后、committed/terminal journal 前退出。正向证明必须来自实际 CAS；负向替换可重算 checksum，但应零清理、零源 DB 打开且不发行下一次写能力。

### H109-R02 · P1：下一次 executing 时的一份 ledger 不能证明已消失的完成/ACK 转换

位置：草案第3.2节第55–56行、第5节第108–110行及 H38-F06。实际来源：`root-migration-request.ts` 的 `finish`、`acknowledgeResult`；`root-authority.ts` `ledgerSubset` 第70行及 migration step 第118行。

合法轨迹可以是 `A terminal → A finish → 用户 ACK A → B prepared/armed/executing → 封存 A`。封存时完整 ledger 只有 B active，A 的 completion 原字节、receiptId 与实际 finish 文件身份已不存在。若此前 restore 保存了旧 results，reader 仍需要区分合法 ACK 子集和由真实新请求追加的 completion。单份新 snapshot、revision 递增和 A terminal journal 无法补全所有缺失转换；沿每条 migration 直接把 expectedLedger 清空，正是草案禁止的弱化。

修订要求：明确哪些合法 ledger 转换需要持久见证、见证在原字节消失前由哪个实际 writer 发行，及其 crash/ACK 顺序。可采用有界 append-only request/terminal transition 见证，或将真实 executing/terminal/完成 observation 嵌入明确的新格式控制记录；具体方式由作者定稿，但不能以计数、时间戳、任意新的 completion 或同 ID 当前 DTO 证明旧 writer。必须明确 ACK 删除精确条目时保留其余项的原顺序和完整 hash，以及 canceled/failed 且没有新 journal 的请求如何关联。若旧版已经 ACK 导致缺证据，明确 legacy 保守分支，不能声称已补回完整历史。

同时定稿实际 decoder 的 nonce 条件：当前 `validSnapshot` 只要求迁移 outcome 的 `executionNonce !== null`，并没有断言其等于 `outcome.migrationId`；实际 `finish` 也未自行核验这个等式，依赖 runner 的关联。新历史 reader 不得把 strict shape decoder 的成功误称为已满足该等式。

oracle 补充：分别保留 A 未ACK、ACK A 后 B executing、ACK 任意一个旧结果并保留另两个有序结果；替换其中一个完整 row、调换剩余 FIFO 顺序、伪造 completion 的 executionNonce/migrationId 不同、用 checksummed 新增结果填补链。每种情况下 fresh reader 断言完整结果原字节/hash/顺序，不只核结果数量。正向新完成和 ACK 均调用真实 request writer。

### H109-R03 · P1：不可变 successor 绑定会阻断明确取消后的下一次授权

位置：草案第3.2节第56、61–63行、第6节「封存已确认但新 journal 尚未写」及 H38-L02。

假设 A complete 的封存已持久发行，record 绑定本次 B executing 的 successor intent。B 在首次新 journal 前取消或失败，原 runner 将 B 写成真实 failed completion；用户 ACK 后显式授权 C。A 的旧 live journal、pointer 和封存原字节仍完全一致，但 C nonce 与 B 不同。按「唯一 A 封存、不可改 successor、复用必须核本次 executing」的现规则，C 既不能重写 A，也无法精确复用 A；一次合法取消会永久变成需检查。

修订要求：分离不可变的旧历史事实和后继 attempt 的执行授权。明确由哪个持久控制对象钉住 B 发行时的 owner/nonce，并证明 B 已明确终结后 C 可在新的原生授权下引用同一 A 封存；不改变封存原字节、不重放 B、不复用 B 执行能力。若需要 append-only attempt binding/terminal 见证，将其纳入容量、namespace、reader 与 crash 顺序。未知/执行未停/目录 fsync 未确认仍不得走该分支。

oracle 补充：真正发行 A 封存，分别在新 copying 前注入明确取消和确定失败，真实完成 B 的结果并 ACK，fresh process 显式 C 授权成功；对照 B unknown、B 仍 active、同字节 foreign 封存、B completion 被替换全部阻断。不能将确定取消路径的预期改成「需检查」来使测试通过。

### H109-R04 · P2：版本、私有执行上下文与 history 基线不能继续留白

位置：草案第3.2节第59行、第4节第86、96、98行、第8节第2、4项。

生产实现前应补充可实现的最小接口表和状态矩阵：新 journal/封存/restore/relocation record 的具体 version 与字段；新 journal 首次写/每次阶段写/history 全引用的规则；`links` 保持 application/relocation 语义时，内部 migration/attempt 集合的类型和前驱含义；仅 migration-history 的统一入口、完整 namespace 识别。现有 relocation v1 没有 history 字段，不能仅切换 reader 而宣称已记录全部迁移见证。

迁移 writer 的 executing 例外需要受信 main/request writer 发行、原始 closure 捕获且可撤销的狭窄能力，或同等明确的私有接口；`RootOptions.migrationId` 字符串加结构相同 ledger DTO 不能自行变成能力。应明确 fresh migrate 与 cold recover 的不同权限，拒绝普通 reader、复制/变异的 public object、Promise/non-void guard。FS fixture 的 direct-manager 模式也应记录其受控 host 证据，不能冒充原生 request 路径。

定义 ancestry 的停止规则。尤其 `A→B` 已真实丢失 A 但没有 restore 时，B.source 含旧 migrationId/revision；不能从该 source 直接宣布完整历史。legacy 完整链和缺链的准入条件必须逐字段描述；现有 v1 回执原字节不能补写或用 ctime 猜测完整性。

oracle 补充：通用 reader 遇真实 active 仍拒绝；只有原发行上下文可封存，复制/修改其可见 DTO、撤销 owner、变更 source/target 或不同 executionNonce 均拒绝。删除最早前驱、但保留所有较新合法文件，测试无 application receipt 的链也阻断；v1/v2 历史分别重开，不改原 bytes。

### H109-R05 · P2：容量及崩溃提案需要展开成有限、可记录的子例

17行提案覆盖面合适，但它们是17个场景族，不能直接计为17个已覆盖案例。H38-C01/C02 应列出逐点子例、实际注入点、允许新增对象清单、实际 durability 状态及 fresh-process 预期；尤其临时文件已删除、封存无覆盖发行成功但目录 fsync 未确认、首个新 journal 临时文件写出但未替换、finish/ACK rename 已发生，都不能用同一个「原目录零变化」断言。

16封存/512扫描/256MiB聚合可以作为独立预算草案，但必须定稿单条的实际 UTF-8 envelope 上限、新 journal 最坏大小及 restore/relocation 引用容量，并明确是已发行历史、未发行临时文件还是所有记录共同计数。新增 ledger/attempt witness 若采纳，同样消费预算。先有界计数/文件 size 求预算再读 bytes，避免先构造所有巨大 raw-text/envelope 后才拒绝。以实际合法 writer 字节为正向边界；恶意超限可构造，不必把 PG 执行扩大到容量测试。

补充后应固定每个子例的 timeout、bytes/inode/目录差量、copy/promote/pointer/ACK/quiesce/DB-open 的观察点；逻辑上的 fail closed 用 FS/有限 host oracle 检查，平台文件 sync/安全无覆盖发行仍独立记录 macOS 实证与 Windows 待验收。受控 native dialog/PID smoke 不替代物理系统选择器或正式用例。

## 建议的下一步及审核门槛

1. 作者修订合同，先回答 R01–R03 的持久顺序/兼容分支，再定稿 R04 的接口与 R05 的子例矩阵；不要修改本稿作者原 SHA 对应的历史版本或旧35/36冻结记录。
2. 新正向用例由真实 DataRootManager/request writer/restore producer 产生；独立审核 oracle 后保留首轮真正产品缺口 RED，再实现。本文尚未确认合同可供生产实现定稿，也不授正式 PASS。
3. 实现 review 应冻结 reader、writer、request/attempt ledger、retention/preflight、所有相关新格式和原测试；资源协调后的实际原 schema/native 执行分别报告。531正式用例状态仍为 not-run，Windows保留待验收。

## 本次只读源码哈希

| 文件 | SHA-256 |
| --- | --- |
| `desktop/core/root-authority.ts` | `abdff335e106b0f5b8d16a6d2d8ccca6cc3f887c4de09b7798450535a8fc376e` |
| `desktop/core/data-root.ts` | `c134d40b8ae45f79f2ceb5373380fda6ab8777a60d18a38571349a1ddb3e0b73` |
| `desktop/main/root-migration-request.ts` | `a700edd8b5bb2a53fb9379382b9feb547d9a8cb5ed843ba767a74577f1c3d0b1` |
| `desktop/main/root-maintenance-runner.ts` | `7b71d08c0196b455d9fab52577ad6d811f232b338b3362335919f93bf2dd8e27` |
| `desktop/core/root-relocation.ts` | `d1696865d75b61bfe9d41994c6090ee70402c26aacfd5de5454d58f6f591d475` |
| `desktop/core/root-relocation-retention.ts` | `f55ca9f42d7aaaa36a792036f5841d46b891208562fd244e8b84f5d1b65d2598` |
| `desktop/main/root-maintenance-preflight.ts` | `499bdfc5a6c5ee6998641596beeba3cc8f10a009feb48587200fba6099e55698` |
