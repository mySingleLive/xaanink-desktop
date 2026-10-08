# 第 96 轮独立代码审核：应用备份库存随根迁移

日期：2026-10-08。审核者 `/root/ui_revision_review`，第 29 批核心作者 `/root/product_review`，runner/request/UI 增量作者 `/root`。最终结论：**限定范围 PASS**。四项独立实际 RED 已按原数据 oracle 修复并复验；本范围没有剩余阻断项。

## 范围与独立性

审核第 29 批的只读应用包识别、关闭根 inventory、root allowlist、迁移 journal/preserved 容量，以及应用备份创建时排除历史库存。根作者的 glue 仅包括 `RootMaintenanceRunner` quiesce 透传 preserved、`RootMigrationRequests` finish/decoder 待处理容量、原 `RootMaintenanceScreen` 接收容量；不重新授予这些完整文件的其他业务验收。

第 17 批封包 helper 和第 27 批 worker 的原实现由本审核者编写，旧模块仅作为依赖读取。本轮新增库存/迁移差异及 root glue 由其他作者实现；不把第 27 批称为独立自审，其审核见第 95 轮。本轮没有运行 PGlite、Electron、全站 build 或真实用户目录测试。

## 独立发现与修复

| 编号 | 严重度 | 实际反例及最终保护 |
| --- | --- | --- |
| AM96-01 | P1 | 在真实 catalog ownership 读取 handle.close 后写入合法历史作品记录，路径指向原包的 data。旧 core 沿用旧 workPaths，却为新版 catalog 建立 hash 基线，完整迁移实际删除新登记目录的 state.json。现 catalog 保护名单绑定同一次身份/hash 基线，后续读取与关键宿主检查持续核对同步 seal，变更拒绝且源作品字节保留。 |
| AM96-02 | P2 | 62502 个允许记录的回滚在 target/stage 两处都拒绝删除时，真实 rollback/writeJournal 产生超过原 125002 的 pending，无法持久。现统一上限为 225002，接受的清单及读写条件支持完整最坏结果，或在初始阶段拒绝过大字节清单，不截断回滚结果。 |
| AM96-05 | P2 | 排除历史库存的 collector 在最后 assertClosed await 处真实替换 root，仍返回旧身份清单。现最后异步宿主检查之后同步核根身份，拒绝替换目录，外部字节保留。 |
| AM96-09 | P1 | 初始 catalog 修复后，cleanup 删除首个包内文件前最后一次 lease.assertClosed await 写入新合法 catalog，新登记路径仍被删。现最终异步检查和文件版本检查之后同步核 catalog/root seal、文件身份及版本，再执行 unlink，保留尚未删的数据。 |

`review96-02-independent-boundaries-red.tap` 首跑实际 2PASS/3FAIL，`review96-09-final-cleanup-guard-red.tap` 单独执行第九项实际 1FAIL；没有编译、导入或夹具错误。AM96-09 不包装 unlink、不模拟删除，失败时旧文件真实读回为 null。两组原 RED 均保留。

AM96-02 没有建立 62502 个 OS 文件：实际执行原 capacity/rollback/writer，仅控制逐副本身份删除拒绝。共享 pending 增加后，driver 以 files 上限 clamp，现测试 100000 个允许记录的双位置结果能持久并被冷实例读回；持久结果 oracle 不变。

作者另自行补出 ABM29-12 指针提交前 catalog 变更、ABM29-14 最后源目录 lstat 后变更 catalog 的实际 RED，见作者 15/17 日志。现 pointer 尾检查和源目录、parents、inbox 清理也有最终同步 seal；本审核者审读并合跑其不变断言，明确两项是作者发现，未冒称独立首发现。

## 最终行为核对

225002 = entries 125000 + files 100000 + 2，覆盖每个文件的 target/stage 两个位置、受管目录及额外恢复/未知目标标记。journal 读写均保留组合清单预算，拒绝 producer 不可能的 recovery.stageIdentity，写初始日志前预留后续身份、回滚路径及恢复记录的字节；每次写入、冷读取同用 64 MiB 限制。

独立首次 GREEN 的其他守卫覆盖最终 package await 后 seal、宿主撤销不可降级成普通坏包、真实小 FS migrate/recover 保留未知 package 和未批准候选、移动包可读与不递归历史、实际 request 最大结果及 overflow 后 authority 保留、原 runner preserved/进度透传，以及实际 Dir 在身份失败时释放。实际 React 检查使用原 Screen/Button，验证 225002 最大 count、overflow 不替换有效回执、明细分页和坏明细不展示/不执行。

| 独立运行 | 实际结果 | 证据 |
| --- | --- | --- |
| 12 个相关 Node 文件，包含独立 9 项和作者/旧核心/glue 回归 | 190/190 PASS，0 fail/cancel/skip，退出 0，80594ms | `review96-12-final-related-green.tap` |
| 隔离 Chromium 中实际 React 两项，新 225002 常量 | 2/2 PASS，退出 0 | `review96-11-final-react-green.tap` |
| 完整 TypeScript | 退出 0、空诊断 | `review96-13-final-typecheck.txt` |

作者最终 Node 120 项及 types 结果来自作者 19/20 日志；与独立 190 项有共享回归，不累计。独立 9 项已经包含在 190 中，React 两项单列，不能宣称 531 正式用例被覆盖。

## 冻结及过程记录

正式历史 v2 aggregate 为 `1a515510289df1093b6e813cb26ca37c9d308fa5c2596cb9a55eb3e0fd2a330f`，ordered files 后 independentTests 的 path:sha256 记录以 LF 连接并含末尾 LF。最终 `review96-16-final-historical-scope-verification.json` 实际核 73 条，72 个原 SHA 相同；七个生产、两份独立测试及 aggregate 全匹配，base 与 immutable v2 字节一致。

唯一原 SHA 差异是 root 第 32 批新增 `VersionedStore/atomicWrite` 可选 withWrite。已用历史原字节和精确 diff 核对：无 hook 时原 writer body 不变，本轮 29 调用均未使用 hook，属于已声明相邻增量，不授予第 32 批审核通过。第 30 批纯 limits 抽取及第 31 批 static parsePointer 也明确为邻接变化，已在 v2 记录，未倒改旧 v1。

14 保留初次核验的同一 readonly 差异。15 捕获交错生成的新 75 条 adjacent snapshot，当时 75 条全匹配；随后作者将正式 base/v2 和原 generator 恢复为 73 条原字节，保留 adjacent snapshot，16 对恢复后的历史 v2 作最终审核。因此不声称历史 73 条全部与当前逐字节相同，也不覆盖旧失败或中间快照。

`review96-04` 默认 Playwright cache 缺失、05 sandbox 内 Chrome SIGABRT 均未执行 UI，是环境尝试，不是产品 RED。07 在旧容量下两项 GREEN，11 在最终容量下复验。06 类型尝试含独立 RootPointer fixture 未收窄及相邻第 31 批在途诊断；后续仅修 fixture 类型、自引用参数名和 async thunk，不改变数据 oracle，最终 10/13 类型运行均实际退出 0。

## 实际限制

小包由原 writer 生成，但语义 verifier 和闭库/owner 证明为受控宿主；不能宣称本轮重新打开真实全局库证明健康，也不能证明运行中 Electron/Chromium session 已静默。本轮没有真实大型包群、物理断电、Windows、原生迁移/系统目录选择器或真实模型验收。531 正式用例继续 not-run，原生正常路径历史证据不能替代本轮失效 guard 的独立验证。
