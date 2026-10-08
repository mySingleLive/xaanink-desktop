# 69 · 已提交新根合法保存后的待清理恢复独立审核

日期：2026-10-08。审核者：ui_revision_review。主代理在第65轮冻结完成后提出单独复核，不改变65的12个新独立用例、72项通过和历史文件指纹。

## 范围与最终结论

本轮仅审核 `DataRootManager.recover` 的已提交 cleanup-pending 分支与清理校验的关系，新增 `tests/unit/data-root-active-pending-review.test.ts` 两个顶层独立真实 FS 用例，第二项含四种权威身份损坏分支。所有数据在专用临时根，不操作 Electron 或真实作品。

最终结论：**限定 PASS**。DR69-01 的实际 RED 已修复，审核者独立重跑两项新用例、60项相关核心回归与全量类型检查通过。合法保存不再被旧迁移快照阻断，损坏的指针/根身份/标记仍然硬拒绝。本轮无剩余阻断，未提升正式桌面验收状态。

## 真实 RED 与要求

DR69-01（P1），`review69-active-root-red.tap`：1项，0通过/1失败，exit1。

测试使用实际 `stateSchema/defaultState` 与 `VersionedStore` 的原子保存，不是任意写入一段假设置：

1. 旧根创建有效设置 revision1，迁移到新根。
2. cleanup 时，旧根通过同一持久化类保存新的笔名；逐文件保护保留该旧 state，迁移返回 cleanup-pending，新指针已成为权威。
3. 新根正常读取设置，通过 VersionedStore 保存玄墨主题，revision递增，原子替换成功。
4. 构造新的 manager，模拟下次进程启动前的 recover。实际在 `assertNew` 全量旧散列/身份检查处抛 NEW_ROOT_VERIFY_FAILED，尚未能返回新根结果。

独立断言要求：两次冷恢复均保持已提交的新指针与 rootId、新根合法保存的完整字节/版本以及旧待清理的完整字节；不回退、合并或重新初始化设置，仍以 cleanup-pending 报告未完成旧清理。

原失败记录及当时源码指纹 `review69-red-source-manifest.json` 保留。主代理执行的 `root-active-pending-author-green.tap` 是作者复跑，不替代本审核者的复验。

## 修复与独立安全复验

已提交 recover 先调用 validatePointer，确认新根目录 identity 和 marker UUID/ready 状态。assertNew 的旧文件快照仅决定是否仍有资格清理旧副本；只捕获明确的 NEW_ROOT_VERIFY_FAILED，其余错误继续拒绝。该分支再次核指针与 marker、同步 bootstrap，并持久记录 cleanup-pending/NEW_ROOT_CHANGED；不获取旧根清理 lease、不删除任何新旧数据。日志持久化后再核指针与 marker，不能用早期检查遮盖异步变化。旧文件快照仍用于实际 cleanup，未放宽旧源删除条件。

DR69-01 原场景复验通过：两个新的 manager 均返回 cleanup-pending 和 NEW_ROOT_CHANGED；设置 revision2/玄墨与旧根待处理笔名字节保持，rootId 与新指针不变。

DR69-02 在同样的合法新根更新后分别注入：

- 指针损坏 JSON，recover 拒绝 METADATA_UNSAFE。
- 指针 rootId 被改为另一有效 UUID，recover 拒绝 POINTER_CHANGED。
- 新根 marker UUID 不匹配，recover 拒绝 ROOT_UNAVAILABLE。
- 新根被 rename，再原路径 mkdir 且放入同 UUID/ready marker 和相同新 state，recover 仍因目录 inode 不匹配拒绝 ROOT_UNAVAILABLE。

四分支也验证 resolve 拒绝，没有生成备用 default、修复/改写指针或日志，也没有删掉旧待处理设置或新设置。新根合法运行会更新 SHA、inode、数据库和 session 字节，迁移快照不能成为终身准入条件；权威目录/marker检查则继续有效。此处允许返回权威根不是宣称其每个业务文件内容都可信：后续原 store/数据库仍应校验各自格式、版本与可启动性，不能以此结果自动重建坏业务数据。

## 最终实际执行

Node v24.18.0：

```sh
node --import tsx --test --test-reporter=tap tests/unit/data-root-active-pending-review.test.ts
node --import tsx --test --test-reporter=tap --test-name-pattern '^(?!DR65-03)' tests/unit/data-root.test.ts tests/unit/data-root-review.test.ts tests/unit/data-root-directories-review.test.ts tests/unit/data-root-active-pending-review.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
```

`review69-active-root-green.tap`：新独立2/2，exit0。相关命令最终实际 `review69-related-green.tap` 为 **60/60**、fail/cancelled/skipped/todo均0，exit0；包括34原作者、15第59轮、9第65轮核心和本轮2项。上面的负向匹配参数没有排除 DR65-03（文件级匹配使子用例仍运行），记录以日志为准：真实 PGlite 两次迁移/冷重开也实际重跑并通过，不将其遗漏或称为未执行。

`review69-final-typecheck.txt`：全项目 tsc exit0、空诊断。最终文件指纹与范围记录于 `review69-independent-summary.json`；当前 data-root.ts 属69的新版本，第65轮历史快照不重写。

## 验证边界

测试 host 的 closed lease 为受控替身，旧根变化是明确故障注入；它证明已提交恢复的逻辑结果，不能证明真实应用后台任务全部退出。没有运行 main/worker启动接线、系统目录选择、设置迁移界面、迁移后继续运行真实数据库再留下待清理日志的场景、Windows/断电或完整验收；531正式用例仍 not-run。已有真实 PGlite迁移回归不外推为上述持续使用场景的数据库验收。
