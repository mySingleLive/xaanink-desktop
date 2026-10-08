# 65 · 应用根文件清单与空目录迁移独立代码审核

日期：2026-10-08。审核者：ui_revision_review，未编写受审实现。所有独立用例使用隔离临时真实文件系统；未操作主代理的 Electron、系统目录选择或真实用户数据。

## 范围与最终结论

审核 `desktop/main/owned-root-files.ts` 的精确格式清单，以及 `desktop/core/data-root.ts`、`root-ownership.ts` 相对第59轮新增的 ownedDirectories、目录身份日志、提升、回滚与旧根清理。只读核对原 `workspaces.ts` 生成的升级快照文件名。主进程/worker启动、迁移请求、原生设置迁移界面与关闭握手不属于本轮。

最终结论：**限定 PASS**。三个实际行为阻断项 DR65-01/02/08 均完成修复复验。审核者独立执行最终六文件72/72、全量类型检查通过，并记录受审最终文件指纹。本轮无剩余阻断，可以进入后续接线与原生验收；不提升任何正式顶层验收用例状态。

## 实际发现与证据

|编号|级别|真实行为与要求|状态|
|---|---|---|---|
|DR65-01|P1|目录提升以递归 mkdir 的 EEXIST 作为所有权凭证。测试在文件提升后创建外部空 pg_notify，再取消；回滚删除该外部 inode。要求排他创建并登记目录身份，已有目录不可认领，替换身份不能清理。|已修复。父目录和空目录先逐层排他创建，EEXIST 拒绝，先登记全部目录再移动文件。`review65-directory-boundary-red.tap` 两项均失败；修复后 `review65-boundary-fixes-green.tap` 两项通过。|
|DR65-02|P1|新指针提交后、清理 hook 删除一个必需的目标空目录，旧 PG_VERSION 等完整旧引擎文件仍被删除；新目标缺布局，旧根也失去最后完整副本。要求每个旧文件 unlink 前验证完整目标目录布局，不能只验证对应文件的内容。|已修复。清理入口及逐文件最后守卫核完整目标目录身份；原失败断言通过，旧 PG_VERSION 与原空目录保留，结果 cleanup-pending。|
|DR65-08|P1|合法旧 schemaVersion=1 日志没有 directories 字段。部分提升后将目标 database rename，再 mkdir 新空 database；recover 的 removeOwnedParents 根据当前目录身份删掉新外部 inode。要求没有旧目录凭证时保留未知父目录并 pending，不以本次读取的 inode 代替原所有权。|已修复。`review65-legacy-parent-red.tap` 为1/1真实失败，外部目录 actual=null；最终原断言通过。无 directories 的旧日志跳过目标父目录清理，保留外部 inode 并 rollback-pending。源码同类 source 清理也跳过无凭证父目录，存在嵌套文件时明确 LEGACY_DIRECTORY_CLEANUP；该 source 分支修复经源码审核，独立 RED 实际证明的是目标回滚分支。|

01 的原 RED 注入点是 file-promoted：旧实现尚未创建该空目录，真实创建了外部 inode。修复后相同注入点的递归 mkdir 只会读到已经由应用创建的目录，不能继续当作外部目录证据。最终01将注入点移至 verified，保持“真正新增外部 inode 必须保留”的断言；原 RED 不覆盖，也不把修复后旧夹具失败描述为新的产品缺陷。

## 独立行为覆盖

独立文件 `data-root-directories-review.test.ts`、`owned-root-files-review.test.ts` 当前12个顶层用例：

- DR65-01/02/06：目标先存外部空目录、目标布局丢失、提交后旧目录被替换，验证真实 inode、内容、指针及 pending，不能误删未知目录或旧唯一有效副本。
- DR65-03：真实 PGlite 创建表与正文，明确关闭后通过实际清单迁移，直接冷开读正文；再迁移到第二个空根并再次冷开读取。没有在目标补建引擎目录。root UUID 不变、revision 递增、旧恢复记录携带、升级快照字节保留；catalogued work 即使位于 session/Local Storage 也留在原处，未知引擎文件和未知空目录保留。
- DR65-04 两分支：verified 与 pointer-written 处的确定性 RootMigrationCrash 后重新构建 manager。前者旧指针回滚，后者新指针完成清理；第二次 recover 幂等。该标记模拟阶段失去内存，不是实际 OS 断电。
- DR65-05：构造具有有效校验和、无 directories 字段的旧日志，验证提交前读取兼容、原数据不重新初始化。它只证明读取与前期回滚兼容，不证明任意旧日志迁移后的 PGlite 冷启动。
- DR65-07：目录创建但整批目录身份尚未写入日志时失去进程内存。恢复保留未登记目录、返回 rollback-pending、旧指针继续权威，多次恢复不自动认领或删除该目录。
- DR65-08：旧日志部分提升后目标父目录身份替换，缺凭证时不能删外部目录。
- INV65-01/02/03：精确 `before-upgrade-13位时间戳-UUID.tar.gz` 与 `.json`、preload 缓存和 PG 空目录列入；相似备份名、未知子树不扫描认领；受管目录 symlink 与快照 hardlink 拒绝，外部字节保留；catalogued work 的排除优先于文件/目录格式匹配。

白名单只声明应用文件路径格式，不声明未知备份的 tar 内容可信。真实 PG 与 Chromium 文件格式由可信主进程清单提供，core 的第二边界不能接 renderer 任意路径。已有 rootMarker/catalog 两必需文件、限制数量/字节、每层 managedPath/身份检查与原34+15迁移回归保留。

## 复验记录与边界

审核者使用 Node v24.18.0 实际执行：

```sh
node --import tsx --test --test-reporter=tap tests/unit/data-root.test.ts tests/unit/data-root-review.test.ts tests/unit/data-root-directories.test.ts tests/unit/owned-root-files.test.ts tests/unit/data-root-directories-review.test.ts tests/unit/owned-root-files-review.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
```

最终 `review65-fixed-final-green.tap`：作者原迁移34、第59轮独立15、本轮作者目录4和清单7、本轮新独立12，共 **72/72**；fail/cancelled/skipped/todo均0，exit0。`review65-fixed-final-typecheck.txt`：全项目 tsc exit0，空诊断。先前 `review65-final-green.tap` 为增加08前的71/71，不累计为新通过数；原始失败、首轮额外8项及前两项修复日志均保留，不用早期 GREEN 覆盖后续失败。最终文件指纹及验证范围记录于 `review65-independent-summary.json`，不包含其自身散列。

主代理只读补充证据：`native-root-startup.json` 的3组真实 macOS Electron 开发窗口检查，声明进程退出后收集1391文件/52目录，离线迁移后冷启动使用新 sessionData、原作品可见、主题只写新根且再次冷启动保持。审核者没有执行这些原生检查，不能把其计入12个独立用例；该记录先于最终旧日志保护修复，不宣称审核者验证了最终整个 Electron build。`Cache/No_Vary_Search` 被真实 Chromium 生成成目录这一主代理发现，已修白名单文件/目录分类；作者新增回归也纳入相关定向运行。

本轮独立证明是实际文件系统和已关闭真实 PGlite 的迁移行为。测试 host 的 assertClosed/release 仍是受控租约，未证明真实应用所有后台任务/sessionData 的退出隔离。stage 内部临时父目录仍沿第59轮既有路径，本轮没有新增外部替换的攻击验收，不将目标目录新凭证覆盖范围外推至此。没有系统目录选择、设置迁移进度/取消、运行中迁移、物理断电、Windows file ID/目录 fsync/重启或网络同步盘验收；未调用供应商，未变更531正式用例的 not-run 状态。代码通过也不代替这些后续集成与真实用户验收。
