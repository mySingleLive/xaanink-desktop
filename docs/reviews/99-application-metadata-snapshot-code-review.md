# 第 99 轮独立代码审核：应用备份元数据写入屏障

日期：2026-10-08。作者 `/root`，审核者 `/root/ui_revision_review`。最终结论：**限定范围 PASS**。本轮未发现需要修复的生产阻断，独立四组行为、相关实际主进程 AST 接线及类型检查通过。

## 范围与独立性

仅审核 root 第 32 批新增 `ApplicationMetadataGate`、worker 反向捕获 RPC、`atomicWrite` 可选 withWrite、头像物理写入接入，以及原 snapshot/session/Workspaces/worker/main 的屏障注入差异。第 17、24、27 批旧封包、暂存及 worker 租约代码由本审核者编写，只作依赖读取，不作为独立自审或重新授予其健康验证。本轮不运行大 PGlite、原生窗口或全站构建。

目标是保留原在线快照前后身份/hash 检查，通过短暂协调 state/drafts/global avatar 物理写入减少受管写入冲突。屏障仅在原 engine 双 mutex 内的 metadata capture/export 段持有，候选导入、语义核验、保留及清理段不持有它。

## 独立行为与实际复验

新增 `tests/unit/application-metadata-99-review.test.ts` 四组使用实际 Gate、ModelRepository、DraftJournal、AvatarAssetService、worker capture helper 和原 captureApplicationRoot；读取、写入及 PNG 规范化均真实发生在隔离临时目录。

| 编号 | 可观察行为 |
| --- | --- |
| AG99-01 | 旧 capture 撤销后立即取得新 capture，原排队 writer 不能穿过新屏障；旧 token 释放拒绝，最终精确释放后实际文件才出现。 |
| AG99-02 | 实际 state、草稿及头像 writer 在屏障等待期间取消 owner/session，解除屏障后拒绝；旧 state 字节原样保留，不发布旧草稿、头像或残留临时字节。 |
| AG99-03 | capture 内部失败仍等待精确 release，原物理 writer 随后完成；错误 token 不会解除下一次 capture。 |
| AG99-04 | 实际 snapshot pipeline 在 transaction/query 双 mutex 内才调用 acquire；故意在 dump 后、import 前停止，release 在两锁退出前执行，排队 state 写入随后真实完成。 |

`review99-01-independent-first-run.tap` 首次实际 4/4 GREEN，随后 AG99-02 补入实际 state writer 的旧字节保护，`review99-03-all-writer-owner-green.tap` 仍实际 4/4 GREEN，退出 0，无跳过。AG99-04 的 engine/export 是受控替身，并主动在 import 前停止，没有声称实际 PGlite 引擎锁实现或可恢复归档已经通过。其余三项也不证明原生窗口或系统 picker。

最终只合跑一次五个相关文件：本轮独立 4 项、Gate 3 项、实际三个 writer 3 项、worker capture 2 项、主进程 AST 接线 3 项，共 **15/15 PASS**，退出 0，0 skipped/cancelled，1829.77ms，见 `review99-04-final-related-green.tap`。AST 用例从当前源提取实际内部 RPC callback、构造表达式和断连 callback 执行，验证参数/schema、精确 token、三处 writer options、worker host 注入与 revoke；构造边界受控，不能代替真实 Electron 生命周期。

完整 TypeScript 检查 `review99-05-final-typecheck.txt` 实际退出 0、空诊断。此前 `review99-02-typecheck-attempt.txt` 的失败仅来自当时第 33 批在途 `root-relocation-controller.ts` 的类型诊断，原日志保留，没有记为本批产品 RED。本轮四组独立行为均首次 GREEN；作者已有 RED→GREEN 日志另保留，未混称为本审核者发现的缺陷。

## 实现边界复核

`ApplicationMetadataGate.write` 同步登记即将开始的物理操作，`acquire` 先建立阻挡新 writer 的 capture 再排空既有操作；撤销唤醒后的 writer 会重新检查当前 capture。随机 token 仅能释放其对应、已经 ready 的 capture，旧 release 不会解除新一轮屏障。

主进程只把 `withWrite` 注入实际 state/drafts atomic writer 和 avatar persist writer。`atomicWrite` 包装后移除该 hook，不发生递归获取；完整设置操作与 worker RPC 不持有此屏障。排队后仍执行原 owner/session/CAS 检查，原磁盘保存回执等待物理 IO，取消不会因新屏障获得发布权限。

worker 在事务 mutex 与 query mutex 均取得后才发内部 acquire；初始 metadata 扫描也已移入该段。原 metadata 前后清单/hash 校验继续执行，外部未受管修改仍会拒绝。`finally` 等待精确 release；候选导入、完整核验、保留与清理不持有屏障。该段只使用原租约/文件与引擎导出，不调用主进程 repository 读取或整个业务保存，因此未形成 metadata writer 等待 SQL、SQL 捕获等待该 writer 的反向等待链。

acquire/release 只属于 main-worker 的 `RpcPeer`，各自验证 undefined/UUID，preload 不提供 renderer 方法。worker error/exit callback 撤销 capture，并释放被阻挡的 writer；迟到结果不能以旧 token 解锁新 capture。真实断进程与平台级 IO 故障仍需后续原生验收。

## 作者附加证据

作者最终清单记录相关 Node **68/68** 与最小真实 PGlite **6/6**，包含原第 88 轮快照断言。这些由作者执行，和本轮 15 项有重叠，不累加成新的覆盖数量。本审核没有重新启动大库或执行这些引擎组。

作者 `native-application-backup.json` / `native-application-backup-run-14.txt` 记录实际 macOS 开发 Electron、原 schema PGlite 与真实磁盘三组通过：原设置立即备份；原恢复对话框读取可见历史；真实关闭排空后受控 activate 重开，历史与 plan 保持。审核者独立读取 JSON 并查看 settings/history/reopened 三张图片，其可见备份完成及历史列表与记录相符；图片本身不证明闭库、物理 Dock、系统 picker 或 Windows 行为。初始第 30 批真实失败及 `APPLICATION_SNAPSHOT_CHANGED` stderr 仍保留，没有被成功记录覆盖。

旧 unsafe-input snapshot fixture 仅补 readonly version/mutex 替身以继续到原 UNSAFE/no-write 断言。原 schema worker fixture 已支持反向 gate，但作者没有重复其整条昂贵链；本批真实原 schema 接线的证据来自作者此次原生开发运行，未扩大为最终异常分支或正式验收。

## 冻结与可复现记录

初始 v1 清单为 54 条记录、聚合 `99656191f99cb7c12c78a1aee0d99146e67fe4b86f08f9af7eece4be5178bee0`。本审核补入实际 state writer 取消断言后，初核 **53/54** 匹配；唯一差异是独立测试自身 SHA，生产与其余证据一致。`review99-06-initial-manifest-verification.json` 保留了该事实，未改旧测试结果或 v1。

作者据此仅更新测试/清单生成器及已产生的独立日志，生成正式 v2。`review99-07-final-manifest-verification.json` 独立核验 **58/58 SHA**、formal 与 immutable v2 同字节，并逐份确认 **9 份生产源码与 v1 完全相同**。按 `files → independentTests → dependencies → evidence` 顺序连接 `path:sha256`、每行 LF（含最终 LF）的 UTF-8 SHA-256，聚合为 **`d0f04cfd572cd15c9ed8257d9c089c2fb7a2494a48f04d03a79a23090946cfce`**。

最终四组独立测试 SHA 为 `3cf5bdc5a03df4d2f1f4ada88f388eae598c0c71be580b5d3b3da514837b11cd`，断言随后未修改。第 33 批另获授权的 DataRoot/startOwnedRoot/maintenance 入口增量属于后续范围；若其随后改变共享依赖，仅是已知邻接改动，不回写本批历史冻结或自动重新授予其验证。

本结论只覆盖第 32 批物理元数据屏障及其窄接线。应用恢复激活、完整故障恢复、物理平台交互、Windows 与发布验收均未由本轮判定通过；**531 正式用例保持 not-run**。
