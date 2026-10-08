# 116 · 全局收件箱冷启动租约修复代码审核

结论：**PASS_LIMITED**。三项独立实际 FS 反例均由作者修复，原 oracle 转绿；当前限定源码与隔离 FS/native-port/main-routing 检查无遗留阻断。本结论不授予真实 Electron、系统对话框、默认数据修复、跨平台或正式 530 项 PASS。

审核日期：2026-10-08。审核者未修改生产源码；仅新增三份 `-116-review.test.ts`、本报告及独立日志/冻结清单。没有启动 App、Electron、PG 或模型网络，没有读取 `~/.xuanxiang` 或现存 appData 内容，没有操作阶段 41 的实际锁或用户数据。测试的 Node 子进程和文件均来自隔离 fixture，且已结算、清理。

## 范围与已核行为

直接审核 `desktop/main/inbox-lease-recovery.ts`、`inbox-lease-recovery-window.ts`、`desktop/main/index.ts` 的 before-worker 分流，以及 `desktop/core/work-lease-recovery.ts` 的 strict audit decoder 提取、只读观察/封口增量。相关 authority、session、原启动和 root inventory 文件只读核对。此前本人 authored 的 service 移除实现不属于本轮独立 PASS 范围。

新的实际 top-level main 分支保持 legacy → relocation → maintenance 优先顺序，再执行 inbox preflight。普通首次启动与现存无租约根仍进入原 `launch()`，原真实 worker constructor/startup barrier 仍在 first await 前；inbox 冷分支在普通 worker、工作台、模型 vault 与源持久 session 创建前进入独立系统 dialog 流程。根作者的冷宿主 closure 又检查真实主进程 globals、原预检和 single-instance lock，不能把新建 worker/noop closed callback当源已关闭。

`prepareInboxLeaseRecovery()` 从 fresh `readRootAuthority()` 取得固定 root，绑定 ready/inboxReady marker 的原文件观察与 canonical root/inbox/database 物理身份。它捕获原 `assertColdHost`，在核心 host 与 confirmation 同步回调中重新核这些观察；native confirmation 返回后、最后 await 后的 unlink/rmdir 前仍有效。private request 由真正 `WorkLeaseRecovery` 发行，入口不接受 work path/workId、owner DTO 或历史诊断 JSON 授权。核心原 owner/dead-PID/audit parser 与 audit-before-unlink 协议继续使用。

无锁且无 audit、或合法同物理 inbox 的 recovered audit，允许正常启动；observed 下 empty-lock/lock-absent 仍通过新 private request 与新明确确认收尾。未知/篡改/copied audit、链接、未知 lock 邻居、live/foreign/不确定 PID、partial marker、authority/marker/database 替换均不授予修复。原 schema 不含 process start time，PID 复用为 live 时保守拒绝，不能依靠阶段 41 的旧 PID 或历史摘要认定可删。

`assertRecovered()` 核当前 authority、marker、目录、strict recovered audit 和实际 lock absence；最后在所有其他同步读取后再次检查 lock absence。它在 recover 返回、结果提示前、结果 dialog 返回后使用，cached recovered 请求不能批准后来出现的新锁。系统 dialog 明确 [修复并退出]/[退出]；退出前实际 repair flight 已结束，before-quit 在真实写入期间被阻止，结果不回落普通工作台、不自动 relaunch。该流程不导入/构造 Workspaces、SQL/PG/Prisma 或模型服务。

普通 `Workspaces.lockDirectory()` 未改为自动偷锁；新入口只绑定当前应用的固定 inbox。没有增加 backup/restore API、snapshot 或数据复制。`inbox/.xuanxiang-lease-recovery.json` 未扩大 root inventory 认领，旧迁移对它仍按未知项原地保留；copied audit 不能给不同物理 inbox 授权。本入口对 application restore 历史、未读迁移结果或非 terminal maintenance 的保守拒绝保持，不授予绕过旧 legacy/maintenance 控制的能力。

## 独立发现与原 oracle 修复

| 发现 | 独立实际复现 | 修复与验证 |
| --- | --- | --- |
| R01：撤销原 host 后替换 options.assertColdHost 为 noop 可继续修复（P2） | genuine prepare 后撤销原 callback；`recover(true)` 未拒绝。`review116-01-independent-attempt.tap` 原 RED。 | 作者捕获原函数，原 IL116-R01 转绿。原 callback 的撤销仍有效，替换公开 options 不能换掉 lifetime。 |
| R02：strict recovered audit 在后续 lock probe 期间变为未知 bytes，preflight 仍返回正常（P2） | 真修复完成、正常基线为 false；在实际 `lstatSync(lock)` ENOENT 观察中改 audit。原 IL116-R02 RED，日志 01 保留。 | 作者添加 `observeWorkLeaseAudit()`，封住原文件版本/字节或原缺失状态；marker 与 audit 在 preflight 最后同步复核。原 oracle 转绿。 |
| R03：结果 seal 早先确认 lock absent 后，新 live lock 在 recovered audit 读取中出现，seal 仍成功（P2） | 真修复与 seal 基线绿；在实际 `openSync(audit)` 后创建新 lease。`review116-05-late-completion-seal-attempt.tap` 原 RED。 | 作者在 bound/audit 封口后最终再检查 lock absence；原 IL116-R03 转绿，新 owner 原字节保留。 |

审核者没有改生产来修复这些问题，没有删除原 RED 日志，没有改原 oracle 迎合实现。两个 fixture 问题单列：日志 02 的 native function extraction 首次用 CJS export scaffold，缺 module 导致四例在执行实际函数前失败；改为只去掉抽取 declaration 的 export 后执行原函数。日志 06 的类型失败仅为独立 fixture 对 readonly `fs.lstatSync` 的赋值，改用 `Object.defineProperty` 安装相同 hook，所有断言、调用与变更注入点不变。这些不称产品 RED。

## 有限验证

- `tests/unit/inbox-lease-recovery-116-review.test.ts`：6 条独立实际 FS 检查，包括三项原 RED、真实 observed/no-lock 新确认收尾、marker/database inode 替换、cached request 新锁保护。PID 来自实际已退出的 owned Node 子进程；没有模拟数据库健康。
- `tests/unit/inbox-lease-window-116-review.test.ts`：4 条执行当前 actual `launchInboxLeaseRecovery` 函数，系统 app/dialog/Menu 端口受控，session/authority/recovery 文件操作真实。覆盖取消零写入、真实 before-unlink flight 期间阻止退出、结果 dialog 期间出现新锁导致失败退出、确认 dialog 期间撤销 native stable host。它们不代表实际 Electron/系统 dialog 生命周期验收。
- `tests/unit/inbox-lease-startup-116-review.test.ts`：4 条执行实际 top-level main AST 分支和实际只读预检，只有 window/ordinary launch 端口受控。覆盖首次/现存根正常分流、inbox 冷分支且宿主 closure 再核原 triage、真正 `RootMigrationRequests.prepare → arm` 后 maintenance 优先、未知 audit 不创建普通或修复入口。
- 最终 `review116-07-related-final-attempt.tap`：9 文件 **68/68**，6.96 秒，exit 0。包括上述 14 独立检查、作者 inbox 10 条、原 WL 27 条、87 独审回归、原正常 main barrier/relocation/maintenance 检查。
- `review116-08-types-final.log`：全仓 `tsc --noEmit --incremental false` exit 0，空输出；避免共享 incremental cache 写入。原 01/02/05/06 失败日志仍保留。

作者另有 `inbox-pg-03.tap` 实际 built worker/PGlite 2/2（9.14 秒）：stale inbox lease 阻止普通 worker 就绪、取消保留闭库字节，真正修复后 worker 重开保留的用户模板并正常关闭新租约。本审核只读该日志，不重复启动 PG，不把作者 PG 成绩称为独立运行。初次 PG fixture 对合法本地 `model.defaults` 配置读取的误拒绝及其日志也由作者保留。本报告不给旧 `.app` 或仍未进行的真实系统修复行为 PASS。

## 冻结及限制

本报告对应 `docs/evidence/implementation-42/review116-frozen-v1.json` 的输入 SHA/bytes 清单；一次读回写入 `review116-10-frozen-readback.json`。作者确认四生产源码稳定后，审核者停止增加测试范围，仅完成当前相关检查、报告与指纹。根作者正式阶段冻结可以引用这些独立文件与报告，不能回写旧 39/40/41 冻结或失败证据。

真实 packaged native dialog 选择、系统退出时序、阶段 41 留下的实际 default inbox lease、真实再次启动和用户可读业务数据尚需授权后验收。当前默认数据已存在且来源不能由本审核推断，禁止重新套用 fresh-empty-default 假设。跨设备、Windows、不同物理根的旧 audit 搬运、未知旧锁/manual 数据处理、正式 530 项不在本结论范围。
