# 74 · 作品备份核心独立代码审核

日期：2026-10-08。审核者：ui_revision_review。主代理实现，审核者只写独立测试、审核和证据；未运行Electron或主代理原生窗口。

## 最终结论与范围

**限定 PASS**。四处独立真实FS RED已修复，最终9项新独立检查、11项作者相关回归合计20/20通过，全量tsc exit0、空诊断。本范围无剩余阻断。531条正式用例仍 not-run。

范围：`desktop/core/work-backups.ts` 的封包/安全读取/留存，`desktop/shared/workspace.ts`，WorkspaceAssets新增快照与mutation lease，`captureWorkBackup`真实PGlite导出锁，Workspaces按catalog解析作品/备份接线，以及`backup-archive.ts`的gzip/tar预检。Workspaces/资产的整文件SHA只识别版本，不重新批准所有既有连接池/锁恢复/图片业务。恢复候选与切换、备份调度和UI/main IPC、导入授权、原生验收不在本轮范围。

初审独立核验 `work-backup-core-frozen-v2.json` 的10份源码/测试及12份作者证据全部匹配，aggregate `e46b024e81b89353c202dab2c5d0cabea0a4367456e129b74537e200b7ea0194`。该v2是四项RED之前的历史版本；最终作者v3的12份源码/测试、26份证据已逐份独立核对匹配，作者aggregate也按其明确算法独立重算匹配：排除aggregate字段后使用Python默认json.dumps(sort_keys=True)的UTF-8 SHA256，结果 `c01deb8c3e8e2d8616b525a7b41d1174d5ef11fff88cdd6a4c3aae74613ac052`。最终受审源码/独立测试/记录SHA见 `review74-independent-summary.json`，不能把v2 hash当成修复后的版本。

## 实际 RED 与修复

| 编号 | 实际操作与旧结果 | 修复后核验 |
| --- | --- | --- |
| WB74-01 | 新包beforeVerify阶段，将之前list已识别的旧包rename移开，再以相同字节写入原路径的新inode。retention=1删除外部替换文件。 | 内部已验证旧清单保留device/inode；公共list不输出内部身份。候选当前身份必须与原清单相同，相同字节新inode仍保留并列入retainedFiles。 |
| WB74-02 | 新包完成verify后，beforePrune将它写成损坏字节。create仍删除最后一份可读旧包并成功返回。 | 每次删旧前重核本次新包身份及封包SHA；失效保留旧包。结束还要确认新包可读，坏新包不能成功ACK。 |
| WB74-05 | beforeVerify保留新包inode，修改等长作品标题并重算自洽footer。create ACK不同于捕获快照的内容并清旧包。 | 写入时保存sealedHash，首次verify同时检查预期整包SHA。文件自身的自洽hash及inode不能代替写入内容证明。 |
| WB74-06 | prune重验新包期间，真实rename旧包、以同字节新inode重建。旧hash检查在await verifyNew之前，之后直接unlink仍删外部inode。 | 新包异步验证之后，再guard并紧邻unlink检查旧路径为原普通单链接、device/inode及size/mtime/ctime不变。新inode保留。 |

真实失败记录：`review74-retention-red.tap` 4项/2PASS/2FAIL、exit1；`review74-new-content-red.tap` 定向05 1项/1FAIL、exit1；`review74-final-prune-race-red.tap` 定向06 1项/1FAIL、exit1。前两份hook只控制真实FS修改时机；06包裹真实fs.open并同步Node builtin导出，只在新包验证期间交错rename/write，仍执行真实读取/hash/lstat/unlink，finally恢复方法。没有假写删除结果或删除路径。

前三项修复后7/7的中间记录保留为`review74-before-final-prune-green.tap`；第四项修复后的19/19记录保留为`review74-before-damaged-engine-delta.tap`。后者早于最后Workspaces冷读delta，不用它证明该delta。上述RED没有夹具错误，不以作者GREEN替代独立复验。

## 新独立行为检查

两个新文件、9个顶层用例：

- `tests/unit/work-backups-review.test.ts` 6项。上述四项文件替换/损坏/写入确认/最终删除攻击；另验证首个await前封存调用方buffer、work和engine，之后修改输入不改变队列中的包；重新计算自洽footer后，wrong work/backup ID与重复migration仍被拒绝，不列为可读备份。
- `tests/integration/work-backup-snapshot-review.test.ts` 3项。真实PGlite、真实WorkspaceAssets和FS；01在实际事务更新后暂停、发起备份、再回滚，另一个实际PGlite加载经过预检的dump后读取回滚前提交值，附件原字节保留。02仅在实际dump入口暂停，并发事务和removeCreated不能进入/完成；释放后备份为导出前值、原引擎为导出后值，包保留附件而当前文件确被删除。03真实Workspaces创建/备份/关闭，再将当前database替换为保留证据的普通文件，冷初始化后list/read已有包成功且不改文件；新capture、错误manifest与unknown work仍拒绝。

主代理自查的两项变化单独归因：metadata同长度变更穿过原分段hash（`backup-10-metadata-red.tap`），现footer覆盖header与全部payload；冷读已有包依赖当前作品数据库（`backup-18-damaged-work-red.tap`），现兼容版本从正常app inbox引擎取得，不打开损坏的当前作品。这两项不是本审核者发现。前者纳入原6项作者回归，后者扩展原Workspaces集成；独立03进一步检查损坏普通文件不会被打开/覆盖与身份门控保持。

## 源码与持久边界判断

封包schema/version、backup/work UUID、ready manifest、引擎版本及重复条目严格校验。整体footer覆盖header和payload，各database/attachment还按清单长度与hash校验；文件读取有512MiB上限、exact-size/extra-byte检查、O_NOFOLLOW、单链接及读前后身份/时间校验。当前root/backup目录绑定身份，目录替换拒绝；未知/损坏包不列为正常备份，也不因留存数删除。新文件独占创建、文件sync及目录sync之后才验证并清旧，失败保留原包/失败现场，retainedFiles记录不能删除的旧包。首个await前复制调用方输入，避免队列等待时更改封存数据。Windows目录sync代码边界存在，本轮无Windows实机持久化证明。

capture定向核对安装的PGlite 0.5.8源码：dumpDataDir自身不取query/transaction mutex，当前实现从assets lease进入transaction→query mutex，sync/export期间不调用根query。附件变更不在其内部执行SQL；现有图片业务先落文件再开启事务，避免反向等待。本轮真实引擎rollback和导出期间并发等待已证明有限一致性，没有模拟断电/WAL损坏或宣称所有活跃业务组合已经原生验收。

backup-archive与安装tinytar源定向核对：prefix实际为131字节，之后为atime/ctime。预检限制512MiB展开体积、普通file/directory、路径/重复/父子冲突、PG_VERSION、尾部与padding；拒绝links/PAX/GNU prefix等不支持条目。实际引擎gzip经预检后重新加载由独立01/02证明。只通过安全预检不意味着数据库结构、当前migration兼容或恢复候选激活已通过，后续仍需候选验证。

## 最终执行与限制

审核者使用Node v24.18.0执行：

```sh
node --import tsx --test --test-reporter=tap tests/unit/work-backups-review.test.ts tests/integration/work-backup-snapshot-review.test.ts tests/unit/work-backups.test.ts tests/integration/work-backup-snapshot.test.ts tests/integration/workspaces-backup.test.ts tests/unit/backup-archive.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
```

`review74-final-related.tap`：20/20、exit0，fail/cancelled/skipped/todo均0，包含9新独立+6作者封包+2作者snapshot+1作者Workspaces+2作者archive。`review74-final-typecheck.txt`：exit0、空诊断。只最终日志证明损坏engine delta之后的源码；保留的较早typecheck、2项snapshot单独日志是中间记录，不累加成新覆盖。

所有测试均使用隔离临时目录，无真实用户数据或系统剪贴板，没有Electron/OS chooser/原生菜单/Windows/真实provider或备份调度与恢复UI验收，没有把备份包加载到实际作者作品或自动恢复/审批任何AI请求。受控暂停只是控制实际FS/引擎的交错；不能称为实际应用关闭quiescence或断电恢复。正式531条用例未更改状态，本轮限定PASS不等于产品整体完成。
