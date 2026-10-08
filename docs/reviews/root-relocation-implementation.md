# 第31批应用根定位核心作者移交（2026-10-08）

作者 `/root/product_revision_review`，不是独立审核结论。合同在 `docs/evidence/implementation-31/root-relocation-contract.md`，作者范围仅新增 `desktop/core/root-relocation.ts`、`tests/unit/root-relocation.test.ts` 与本批证据/文档。主代理新增 `DataRootManager.parsePointer` 是只读依赖增量；未修改第29批库存/迁移行为，也未接主进程或 UI。

公共接口：

- `new RootRelocation(bootstrapIdentity, host)`，host 为受信同步 `assertStableLock/assertCold/assertOwner` 及真实原生 `confirm(preview):Promise<boolean>`。确认只接受 `=== true`。
- `inspectLost()` 读取原有效指针，要求其 canonical 原位置失联；不创建默认根。
- `prepare(ownerNonce, consumedDirectoryIdentity)` 返回随机 attemptId 与源/目标/旧迁移摘要/未读结果数量，不持久化授权或触碰数据。
- `commit(ownerNonce, attemptId)` 在当前 host 内明确确认、最终同步 CAS 后返回 `{pointer,receiptId,requiresColdStart:true}`。只有成功回执可进入冷启动；不回原已关闭编辑器。
- `cancel(ownerNonce,attemptId)` 撤销内存授权并等待本实例实际 IO；`flush()` 只等待本模块实际 flight，不能代替 Electron/PGlite 关闭证明。
- `inspectRootRelocation(bootstrapIdentity,coldHost)` 返回只读保留 disposition，按精确 pointer 文件身份/链/journal/ledger 演进校验并重同步目录，未提交记录返回 null，不执行迁移或删除。

受信宿主必须是旧 Electron 完全退出、稳定单实例锁已取得、当前尚未开引擎/session 的维护宿主。caller 不能发送 renderer 路径或 closed 布尔值，候选目录须由 main 原生选择并 consume。same-dev/ino 仅支持原物理目录同卷改名/规范路径变化；复制/跨卷/备份恢复不支持。目录 marker/rootId 与只读布局验证不能称为数据库健康验证。

启动接线仍必需由主代理独立实现审核：在 recover 读到 journal 后复核匹配当前 pointer 的只读 disposition，旧 pending 精确匹配才保留并停止旧路径 rollback/cleanup。不得把 migrationId、receiptId 或 canContinue 布尔值当成删除授权。原 request active 一律拒绝；未读结果由原维护 UI 显示并显式 ACK，本模块不 ACK；真实原 `RootMigrationRequests.acknowledgeResult` 持久化后重新读取已覆盖。

证据语义：

- `01-behavior-red.tap`：真实 FS 14/14行为 RED（骨架固定 NOT_IMPLEMENTED），不是编译失败。
- `02-first-green-attempt.tap`：python 路径执行未成功后仍骨架 RED，保留为执行失误，不另计新增产品缺陷。
- `03-green-attempt.tap`：10PASS/4FAIL，内部 FileProof 意外包含 path 被严格 receipt schema 拒绝；修正后 `04-core-green.tap` 为14/14。
- `06-final-cas-red.tap`：21中19PASS/2真实FAIL，新增外部 receipt 漏最终集合 CAS，以及 pointer 提交后 owner 失效错误归属；修复后 `07`21/21。未改独立他人断言。
- `08`25/25，新增未提交回执分叉/16容量/foreign同字节临时文件/Windows目录同步受控分支等首次 GREEN。
- `10-explicit-ack-red.tap`：27中26PASS/1真实FAIL，旧 ledger 全文件绑定阻断合法显式 ACK；合同与实现增加精确子集只读演进，`11`27/27。
- `13-final-related-green.tap`：实际67/67、0skip/cancel，含本批27、原 request36、原 migration-record4。没有启动 PGlite、访问外网或调用付费模型。
- `15-host-contract-red.tap`：29中27PASS/2真实FAIL，async/boolean 宿主断言未被拒绝、调用方修改 bootstrap identity 后核心接受了移动后的控制目录。修复后 `16-final-related-green.tap` 为实际69/69（本批29+request36+record4）、0skip/cancel、exit0；`17-final-types.txt` 为完整 TypeScript exit0、空诊断。构造身份固定，运行时拒绝非同步void断言。

早期 `05/09/12` TypeScript 失败均保留：05同时有作者两条 readSync/return 类型错误和相邻96在途测试类型错误，作者已窄修；09/12只剩相邻96测试错误，未修改他人测试。14/17全量检查已实际0。本次作者源无需新增依赖。

真实 FS 测试包含同 inode 改名、指针/父根/marker身份复核、receipt持久化/不确定写入重读、old cleanup-pending journal 字节保留与两次改名链、原 request 生产 ACK writer、迟到取消、容量、symlink/hardlink/UTF8/大小限制。独立 Node 子进程反例只证明受信测试 host 在子进程活着时拒绝，退出后放行，不能升格为真实 Electron session/PGlite 静默证明。Windows 仅在实际 macOS FS 上控制 platform+目录 handle.sync 的 EINVAL/EIO 分支，不能称 Windows 验收。

后续仍需独立 code review、主进程/维护 UI/冷启动 integration、macOS真实应用验收、Windows实体环境及正式531测试。作者 GREEN 不等于独立 PASS 或用户入口完成。

v2 定向修复独立98三项真实RED：RL98-01/02 pointer directory sync期间目标目录改名/原journal修改，旧实现错误ACK；增加 committedSeal，使用新pointer身份并复核完整目标/控制/所有回执与集合，失败统一DURABILITY_UNCONFIRMED。RL98-03 getter实际sync期间新增foreign receipt漏集合CAS；末次名字集合校验已补。原3独立断言未改，独立文件由reviewer扩为6项稳定（另外3首次GREEN，不造RED）。`20`72/72，`21`75/75（作者29+独立6+request36+record4），完整types24实际0。types22仅相邻32在途atomicWrite返回类型诊断；types23仅本作者第33批入口在途三条类型诊断，均保留原日志。独立reviewer亦75/75和06types0。v1/v2清单保持原字节，追加v3仅纠正23日志引用并纳24实际0；第31批核心源与29/6测试均未再改。这不是作者自授独立PASS。
