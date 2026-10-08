# 59 · 应用数据根迁移核心独立代码审核

日期：2026-10-08。审核者：product_revision_review，未编写被审实现。阶段：TDD 后独立 code review；此记录不提升 531 顶层正式用例状态。

## 范围与当前结论

定向审核 `desktop/core/data-root.ts`、`desktop/core/root-ownership.ts`，对照作者 `data-root-contract.md`、技术方案§5 与已有 34 个作者用例。独立测试仅新增 `tests/unit/data-root-review.test.ts`，所有数据位于各用例独有的临时真实文件系统目录，未改实现或作者测试。

最终结论：**限定 PASS**。冻结 v2 的四个有实际行为 RED 的阻断项均已关闭；审核者独立重跑 59/59 与全量 typecheck 通过，并验证受审四份文件和四份依赖的 SHA 与冻结清单匹配。可以进入主进程接线；没有剩余本批阻断项。本结论不覆盖主进程/UI/真实引擎关闭或完整桌面验收。

## 实际发现

|编号|严重程度|问题与实际结果|期望及修复要求|证据/状态|
|---|---|---|---|---|
|DR59-01（另含用例04）|P1|迁移取消已经 `rolled-back`，随后 bootstrap 指针丢失；resolve 仍给无关空 default 返回 `needs-initialize`，adopt 也可重建首个指针。原自定义根稿件仍在，却可能打开另一套空数据。|任何历史迁移 journal 都是已存在数据的证据，无指针时要求显式定位/恢复，不能根据 rolled-back 状态自动初始化另一根。|`review59-01-pointer-lease-red.tap` 第1项、`review59-02-cleanup-adopt-red.tap` 第2项；v2 独立01/04通过，已关闭。|
|DR59-02|P2|migrate/recover 的 finally 先清 busy，再 await lease.release。release 尚被 gate 挂起时第二次迁移可真实完成，越过整体互斥边界。|busy 覆盖整个异步 release，成功/拒绝都在最外 finally 释放；恢复路径同样处理。|`review59-01-pointer-lease-red.tap` 第2项；v2 独立02/14/15通过，含拒绝后可重试，已关闭。|
|DR59-03（另含用例05）|P1|指针已切换，cleanup 的一次 assertNew 之后目标 drafts 消失；代码仍删旧最后有效 drafts，并返回 complete。RED 的实际 FS结果是 old=null、replacement=null、complete。|每个旧源 unlink 之前检查当前新指针、closed lease 及对应新副本的身份/sha/size；变化或缺失保留旧对应文件并报告 cleanup-pending。不能仅 hook 后加一次全校验，file-cleaned 间下一项也可能变化。|`review59-03-last-copy-red.tap`；v2 独立03/05通过，replacement ENOENT不被误当源文件已清理，已关闭。|
|DR59-13|P1|修复03新增了较长的目标副本最终 hash。旧源 sha 完成后，这个 guard 期间原 drafts 同 inode 被 writeFile 更新；最后只核 inode，最新旧稿仍被删除且 complete。|冻结旧源内容校验时的文件 revision（size/mtime/ctime），最终 guard 后 unlink 前再次确认旧源 revision/identity。外部改写必须保持旧稿与 cleanup-pending。|`review59-06-late-source-red.tap`，actual retained=null/complete；v2 独立13验证原inode的最新旧稿保持，已关闭。|

以上失效与改写均使用真实临时文件和真实 read/write/rename/unlink，没有将 assertClosed 的可注入 gate 当作真实 Electron/数据库关闭证明。RootMigrationCrash 仅是确定性“进程退出阶段”标记，不是 OS 断电模拟。

## 独立行为用例与已检查的边界

DR59-01/04 为指针丢失后的 resolve/adopt；02/14/15 为迁移/恢复释放生命周期与 release 拒绝后的权威指针；03/05/13 为逐文件清理的新副本缺失/改写及旧源同 inode 改写。

其余独立验证：

- 06：连续两次真实目录迁移，原 opaque 设置/草稿/engine/session 字节一致，保持 root UUID、递增 revision、携带旧恢复记录且新增独立记录；旧未知文件不移动。
- 07：坏 JSON、指针 symlink 与 hardlink 均拒绝且不创建新 default；外部目标字节保留。
- 08：目录选择身份已替换时，在 quiesce 之前拒绝；所有原字节与指针保持。
- 09：预先 abort 不拿租约、不写 journal、不写目标目录。
- 10：提升途中 crash，目标未知文件严格保留；两次 recover 都 rollback-pending，旧指针权威。
- 11：pointer-written 后、committed journal 前 crash，recover 只用新指针，保留旧未知文件，不回退旧库。
- 12：database 祖先目录被换为 symlink 时，不能读取/移动链接外文件。

`review59-04-additional-boundaries.tap` 为独立05–12的8项通过，`review59-05-first-fixes-attempt.tap` 为当时独立12项通过；随后新增13真实失败，不把旧 GREEN 合计当最终通过。`review59-07-recovery-release.tap` 为独立14/15两项通过。

## 最终复验与实际限制

审核者实际执行：

```sh
node --import tsx --test --test-reporter=tap tests/unit/data-root.test.ts tests/unit/data-root-review.test.ts tests/unit/versioned-store.test.ts tests/unit/directory-authority.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

使用仓库 Node24 运行时。`review59-08-final-green.tap`：作者34 + 独立15 + 既有10 = **59/59**，fail/cancelled/skipped/todo均0，exit0。`review59-09-typecheck.txt`：全项目 exit0，无诊断。未重复全站构建或完整业务测试。

冻结 v2：`data-root-frozen.json`，受审源码/作者测试/独立测试四份，aggregate `ebd8872b83f479382eb64a8ead2342f10303e11c674c0d5374bd728ccea465bf`。独立 `review59-final-manifest.json` 核对这四份及四份依赖共8个文件SHA，保留报告与最后测试日志SHA；v1及全部RED不覆盖。VersionedStore 新增配置文件流程 beforeCommit 守卫属于后续61范围；本审核只运行原持久化回归，不替代该新接线的独立审核。

此审核确认的是受限核心与真实隔离 FS 操作。main 必须在稳定 bootstrap app 实例锁下，消费原生选择签发的目录身份；先停止任务、flush 实际 ACK、关闭 worker/PGlite/sessionData 再兑现 lease，启动应在打开任何数据根数据库前 recover→resolve。trusted ownedFiles 不能来自 renderer 或整个根的盲目递归扫描。现 allowlist 的日志/备份扩展要随对应实现新增，不能把未迁移的功能默认为支持。

本机使用 macOS 文件系统。Windows 分支明确跳过目录 fsync；没有实际验证 Windows file ID、原子替换、断电耐久性、网络/同步卷或真实关闭数据库。没有运行/重建 Electron、系统目录选择、UI 确认取消、真实用户验收或原生图片测试；这些仍由后续集成与正式桌面验收覆盖。
