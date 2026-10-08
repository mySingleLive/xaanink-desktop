# 92 · 应用维护元数据只读辅助模块独立审核

审核者：product_review；2026-10-08。结论：**限定通过**。本轮没有发现生产缺陷；新增 7 项独立真实文件系统行为全部通过，相关 4 文件实际 29/29，通过全项目 TypeScript 检查（退出 0、空诊断）。未修改生产源码、作者测试或冻结文件。

## 范围

受审作者快照为 `docs/evidence/implementation-25/application-maintenance-frozen.json`，file-only aggregate `b6d6911eb38774155b19291bf3933e7d270be9f39d1aa8317b5112297397e057`。范围为 `desktop/service/database/application-maintenance-metadata.ts`、共享 `backupPlanSchema`、`WorkBackupManager` 的 schema 复用改动，以及对应原读写器上下文。7 作者文件、13 只读依赖、7 历史证据共 27 份 SHA 和声明聚合核验匹配。

本函数针对受信宿主已拥有的目录 identity，只读 `backup-plan.json` 与 `restore-draft-barrier.json`。未接应用备份的 verifyCaptured、候选恢复、main 或 Workspaces，也未证明闭库、稳定进程锁或数据库健康；这些是后续调用方的职责，不把尚未接线作为本模块代码缺陷。本轮没有打开 PGlite、定时器、真实用户数据或原生窗口。

## 独立行为

新增 `tests/unit/application-maintenance-metadata-review.test.ts`，使用实际隔离文件、原 `VersionedStore`、原 `WorkRestoreDraftBarrier.inspect`，必要时在原读/guard 边界注入迟到变动。原始文件字节和 inode/size/mtimeNs/ctimeNs 是副作用观察，未将 mock 返回当磁盘真实性。

| 用例 | 独立可观察预期 | 结果 |
| --- | --- | --- |
| AM92-01 | 已读 plan 在原 barrier reader 期间被移走，拒绝 CHANGED；保留原副本与 marker，不能返回默认成功 | 通过 |
| AM92-02 | 最初不存在的 marker 迟到出现，拒绝 CHANGED；未知 pending 原样保留，不认领或 acknowledge | 通过 |
| AM92-03 | 最后 awaited guard 里 plan 同字节换 inode，拒绝 CHANGED；新旧文件都保留 | 通过 |
| AM92-04 | 原 reader 后宿主失效，固定 GUARD_REJECTED；begin/settle/acknowledge 均不得调用，合法文件不变 | 通过 |
| AM92-05 | 两个合法文件精确 16384 字节，原信封注释与 failed/未知 operationId 保持惰性，邻居未知文件与所有原字节/stat 不变 | 通过 |
| AM92-06 | 原 inspect 抛任意私有 cause，只有固定 BARRIER_INVALID，无 cause 泄漏，无默认写入 | 通过 |
| AM92-07 | 8 个并发只读返回相互隔离；修改一个返回值不影响其他结果或磁盘，不重写 plan/执行 pending | 通过 |

作者原 15 项同时独立重跑，包括缺失 null、原 strict schema、16KiB 超限、symlink/hardlink、非法 UTF8、目录换位、最后真实 lstat 期间 guard 失效等行为。原 manager 2 项、原 barrier 5 项用于验证共享 schema 改动及读器契约。

## 源码核对

共享 schema 原样保留 scheduler 的 strict lastSuccess 值语义，manager 仅替换 import/parse，调度与部分失败写入规则保持。plan envelope 接受原 VersionedStore 能读取的注释；输出仅 revision/value。缺文件返回 null，未建立默认文件。barrier 通过原 strict reader 解析；pending、历史缺 operationId、activated/failed 均是数据，没有 begin/settle/acknowledge 或重放路径。

两文件分别有 16KiB 读取上限、UTF8 严格解码、regular/single-link/no-follow 和目录授权检查。初始存在或缺失观察贯穿整个异步验证；最后 guard/目录 await 后进行同步 root 和两文件身份/版本/缺失核验，没有之后的异步 yield，防读取过程中合法文件被替换或缺失被转成默认值。错误输出使用固定 ApplicationMaintenanceMetadataError code，不携任意 cause。合法 failed.message 属于原数据，后续展示或授权不能将它视为指令。

## 实际执行与冻结

Node v24.19.0，使用 `--import tsx --test --test-concurrency=1 --test-reporter=tap`：

- `review92-02-independent-behavior.tap`：7/7，0 FAIL/CANCELLED/SKIPPED，退出 0；首次独立行为执行即通过，没有本轮生产缺陷 RED。
- `review92-04-related-green.tap`：4 文件、29/29（15 作者 + 7 独立 + 2 manager + 5 barrier），0 FAIL/CANCELLED/SKIPPED，退出 0。共享历史用例不重复累计覆盖率。
- `review92-03-typecheck.txt`：全项目 `tsc --noEmit --pretty false` 退出 0，空诊断。
- `review92-01-initial-manifest.json` / `review92-05-final-manifest.json`：受审 27 份文件全部匹配，ordered files 的 UTF8 `path:sha256` 逐条 LF（含末 LF）聚合匹配 b6d6911…；依赖/证据独立逐份核验。
- `review92-06-final-summary.json`：本轮报告、独立测试、实际日志和核验文件的只读指纹记录。

限定结论只涉及上述 helper/共享 schema/manager 窄改动与实际执行场景。它不是完整应用备份健康门槛、Electron main 接线、Windows 或 531 项正式验收的通过证明。
