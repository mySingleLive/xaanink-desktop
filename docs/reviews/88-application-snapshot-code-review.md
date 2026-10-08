# 第 88 轮：在线应用根快照桥独立审核

日期：2026-10-08。审核者：ui_revision_review；第 22 批实现作者：root。

## 范围与结论

仅审核 `desktop/service/database/application-snapshot.ts`、作者实际引擎测试及本批合同。第 17 批文件复制和收尾证明工具由本审核者实现，该依赖作者身份在此明确；本轮独立测试针对新的在线 producer 调用关系，不以本轮结论代替第 84 轮对第 17 批的独立审核。

结论：**限定范围通过，无剩余阻断项**。下列两个问题通过轻量真实 PGlite 和真实文件系统复现，交由实现作者定向修复，本审核者未修改生产源码。初始清单 2 个作者文件、6 个依赖与 6 个证据共 14 份 SHA 全部匹配；按三组记录 `path:sha256`、LF 含末尾 LF 重算聚合 `90dcad221ffe77e1085acedddd47d45c3b2cdbb027f7f6b2ab9db4b30c79f280` 一致。初始冻结作为审查基线，不冒称该版本原本通过。

## 独立发现

| 编号 | 实际行为和证据 | 修复后的保护 |
| --- | --- | --- |
| AS88-01，P2 | 同一不变在线引擎先完成一次 capture，按其公开宿主回调序列在第二次 capture 的最后一次异步所有权检查中改写候选 `state.json`。实际注入成立、原源和首候选字节保持，但函数仍返回修改前的 tree。 | 最后异步 guard 后同步检查 signal、原根和父目录身份、完整已散列树；返回前无新的宿主 await。finally 仅在候选引擎实际存在时 await close，成功闭库路径不再 await undefined。 |
| AS88-02，P2 | `before-seal` 期间在暂存父目录新增 1000 个外部文件，连同当前 UUID 候选达到 1001 项；capture 仍返回成功。 | 有界 opendirSync 检查容量，初始和 mkdir 前预留 1 项，最终返回前再次限制总数不超过 1000；未知邻项和失败副本保持原字节。 |

独立文件为 `tests/integration/application-snapshot-88-review.test.ts`。`review88-01-independent-red.tap` 首次 2 项均失败；`review88-03-independent-oracles-red.tap` 加强注入和字节不变检查后再次 2 项均失败，退出 1。后者不是缺模块、导入错误、PGlite 替身或未执行的代码猜测。最终权限检查定位依赖一次成功 capture 的公开 callback 计数，实际 PGlite 和文件系统方法未被替换；源和数据断言不以静态字符串证明。

AS88-03 首次 1/1 通过，`review88-04-cancel-first-pass.tap`：导出后取消或撤销所有权均拒绝，两个未 ready UUID 内已复制元数据保留；在线源引擎不被关闭，原数据仍可查询。此正向边界不记录为 RED。

## 独立复验

在修复源码上独立串行运行本轮 3 项、作者 2 项及原引擎快照/归档 4 项，实际 **9/9 通过**，0 跳过、0 取消、退出 0；`review88-05-related-green-attempt.tap` 保存完整结果，耗时 25.8 秒。01/02 的实际注入、外部字节保留及原源不变断言未弱化。完整 `tsc --noEmit --incremental false` 退出 0，`review88-06-typecheck.txt` 为零诊断。未与第 17 批完整原 schema 的最终串行队列启动重复大库回归。

最终 `application-snapshot-frozen-v2.json` 的 3 个源/测试文件、6 个依赖与 11 个证据共 20 份 SHA 全部匹配；按 files + dependencies + evidence 顺序的 `path:sha256`、LF 含末尾 LF 算法重算聚合 `7b0e75dc6ce39aa7112da3b94ca43764a8ad532f0acb159f1afd62522885ed26` 一致。独立核验结果在 `review88-07-final-manifest.json`，原冻结保留历史。

## 实现边界

源码复核确认导出走原引擎 transaction mutex 再 query mutex，版本查询位于锁外，使用 `syncToFs` 与 `dumpDataDir`，未读取在线原 `database` 目录的原始文件。固定元数据和 UUID PNG 在同一导出区间逐文件复制并比对前后身份、版本和散列；后续正常在线写入不会使已截取快照回溯变化。归档复用有界 tar/gzip/主版本预检，并只在新 UUID 目录实际导入，候选引擎闭库后才收尾。

此 helper 不证明原 schema 全局语义健康；模板、无作品会话、state/drafts、当前头像等须经第 17 批 mandatory verifier 校验，backup-plan/barrier 的启动兼容条件仍是宿主接线责任。未接 main、定时器、设置或暂存回收；未知和失败副本不得依靠返回 tree 当删除授权。跨进程同权限攻击不被宣称为内核 inode CAS。

本轮使用隔离临时目录和轻量实际 PGlite，不运行原完整应用 schema、Electron、系统 chooser、系统崩溃或 Windows；未将 API 替身当实际引擎，也未将本轮证据合并成正式桌面通过。全部 531 条正式用例仍为 not-run。
