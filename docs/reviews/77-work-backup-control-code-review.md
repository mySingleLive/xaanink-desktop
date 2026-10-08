# 77 · 作品备份控制与生命周期独立审核

日期：2026-10-08。审核者：ui_revision_review。主代理实现；审核者只新增独立测试、记录与证据，不修改生产代码，不运行 Electron 或操作主代理窗口。

## 结论与范围

**限定 PASS**。两处真实问题已修复。独立新增11项行为检查与16项相关回归最终27/27通过，fail/cancelled/skipped/todo均0、exit0；本轮14个入口及其传递依赖的类型检查exit0、空诊断。531条正式验收用例仍为 not-run。

范围为 WorkBackupManager、worker WorkBackupControl、strict semantic IPC/preload、主进程备份 start/configure/pause/close/reopen 接线、通用设置的立即备份及间隔/份数控件、backup-plan.json 数据根迁移归属，以及当前健康 preRestore 备份的正常保留策略 pin。main、service、DesktopApp、Workspaces 文件中相邻的图片、模板、恢复激活流程只记录指纹，不据此批准这些功能。本轮不包含恢复 UI/handoff、全局/inbox 数据库备份、全部原生退出路径、Windows 或完整桌面验收。

最终作者清单 [work-backup-control-frozen-v2.json](../evidence/implementation-13/work-backup-control-frozen-v2.json) 只读核验：9份源码/作者测试、11份接线文件、3份依赖及16份证据全部 SHA256 匹配；按其 Python 默认 `json.dumps(object excluding aggregate, sort_keys=True)` 算法重算，aggregate 为 `4ca33fa1d74fe4095728a2f688840491b69ff77f9da0472933943d87d3bb46bb`，与记录一致。旧 v1 清单及真实失败证据保留；v2 注明的 native 第二轮“pending”是冻结时事实，后来的作者烟测单独列在下文，不回写历史清单。

## 真实问题与修复

| 问题 | 发现与实际失败 | 修复及复验 |
| --- | --- | --- |
| BC77-06：晚到状态回退调度配置 | 主代理源码自查提出；审核者执行实际 main `send`/`refreshMenus` 回调与真实 Manager/磁盘计划，revision5配置5分钟后再收到revision4，timer实际回退至60000ms，独立 RED 失败。 | `send` 的菜单更新及 `workBackups.configure` 共用 confirmed revision 门槛；旧状态仍可送 renderer，由原版本门槛忽略。相同独立用例最终保持300000ms，通过。 |
| 设置下拉框值未保存 | 主代理实际 macOS Electron 首轮失败：选择间隔1/份数2，持久份数仍10；原始运行日志、JSON及截图保留。异步排队 updater 在执行时才读取 `event.target.value`，此时受控 select 已回滚。 | 两个 onChange 同步捕获数值，再交给队列。审核者增加实际完整 SettingsDialog/React/BaseUI 检查，延迟两个 updater，确认最终存储及控件均为1/2。该独立测试首次运行已在修复之后通过，不冒称它捕获了独立 RED。 |

`review77-stale-state-red.tap`是真实1 FAIL/exit1；对应 GREEN 与最终合跑均保留。原生首轮失败为 `native-work-backup-run-01.txt`、`native-work-backup-failure.json/.png`，没有用后续成功覆盖。早期 Chromium 在 sandbox 启动 SIGABRT 属测试环境失败；批准隔离浏览器启动后原断言通过，不计产品 RED。

## 独立行为验证

新增4个测试文件，共11项：

- `tests/unit/work-backup-77-review.test.ts`，7项：实际 main closeData 回调等待真实 Manager/gate 内在途备份与持久计划后才关闭 worker/arm；部分作品失败继续处理其他作品且不写成功时间；真实计划 rename 故障不发成功回执，显式重试才持久化；pause 等待启动读取，不残留 timer，重开采用新确认配置；真实封包 pin 参数先验证并复制，不受调用者后改数组影响；旧 revision 不回退配置；实际关闭根 inventory/migrate 搬迁 backup-plan 字节、未知文件留旧，再启动读取原 lastSuccess。时钟、worker-close/arm 回调及 closed-root host 边界受控，没有把这些夹具称为 OS 退出或真实数据库 quiescence。
- `tests/integration/work-backup-77-worker-review.test.ts`，1项：隔离构建实际 service worker/RPC/PGlite 和原 Workspaces，创建两作品，闭库后移走一库；自动 batch 明确失败而另一作品生成真实可读备份，成功时间不确认；完整关闭并修复源后重新启动，手动 batch 成功写实际计划；再关闭/重开采用新间隔并保留状态。真实数据库、磁盘、worker构建与跨线程调用执行；时钟受控，未调用远程模型。
- `tests/browser/work-backup-77-review.test.ts`，2项：实际 WorkBackupButton/React，部分失败显示作品错误、显式重试替换反馈；卸载旧实例后其迟到 reply 不得改变新实例 busy/结果。bridge Promise受控。
- `tests/browser/work-backup-77-settings-review.test.ts`，1项：实际 SettingsDialog/React/BaseUI 的两个 select，队列延迟确认后存储1/2且控件不回退。未使用的其他设置页组件是替身，原事件 handler 未重写；所有页面网络请求阻断。

浏览器检查使用隔离 Chromium DOM，未操作系统剪贴板、原生窗口或主代理测试实例。worker 输出位于独立临时目录，清理后不覆盖共享 build/dist。已有用例只按实际重跑计入相关回归，没有将单个顶层测试里的步骤再次累计为新增用例。

## 代码判断

Manager 的单飞由已审 Scheduler 实现；自动和手动复用同一业务 gate，部分 batch 失败保留成功作品回执但不确认整批 lastSuccess，自动错误通知与调用者手动错误处理分开。真实 `VersionedStore` 写计划完成后才发成功回执，通知监听者抛错不能推翻 durable receipt。confirmed 配置在后续 flight 生效；pause 清 timer 并等待启动/在途任务，主进程同时关闭 gate 拒绝新请求，先 drain 后关闭真实 service。Mac 创建新窗口的复用分支读取已确认设置再 start，未把关窗后的旧 timer 留在后台。

renderer 只能提交 strict `works/list/now` 语义请求，不能指定磁盘路径、引擎字节或随意 retention。可信 frame 与业务 gate 检查沿主进程实际 handler 执行，worker 等待 ready 并拒绝 closing 后的新操作。backup-plan 作为明确受管数据根文件搬迁，不将扫描到的未知文件认领为应用数据。

普通备份创建前复制并验证 pin ID，正常 prune 排除当前健康 preRestore ID，pin 不计入普通保留份数。Workspaces 只对健康 previous 引用传 pin，closed-source 副本不冒充健康封包；省略 kind 的旧健康 pointer 仍适用。实际 restore/cold reopen 相关回归包含连续三次 retention1 后仍能读取同一 preRestore 健康包。这里批准的是正常自动/手动保留策略对当前引用的保护，不承诺抵抗用户手工删包、修复损坏包或永久保护每一个历史恢复引用。

## 执行记录与证据边界

`review77-final-related.tap`：21/21、exit0，包括新增8项 core/worker 和13项相关回归。`review77-final-browser.tap`：6/6、exit0，包括新增3项实际组件检查和3项作者按钮回归。两次 fail/cancelled/skipped/todo均0，合计27/27。

`review77-final-scoped-typecheck.txt`：14个源/测试入口及传递 imports，exit0、空诊断；配置与命令记录在 `review77-typecheck-scope.json`。扩大入口后的首次检查缺少缩小 tsconfig 中的 Next CSS module 声明，日志保留为 `review77-expanded-scoped-typecheck-attempt.txt`；仅显式加入已安装 `node_modules/next/types/global.d.ts` 后通过，没有改产品声明或代码。当次独立全量检查3条诊断在相邻图像/恢复在途文件，保留 `review77-full-typecheck.txt`，不把这次称为全量通过。主代理随后提供 `restore-30-typecheck.txt` 全量 exit0，属于作者证据。

作者另执行真实 macOS Electron 开发烟测，`native-work-backup.json`/`native-work-backup-run-02.txt` 为3组 PASS/零pageerrors：实际设置1/2与立即备份，真实60615ms计时生成第二份磁盘备份，实际关窗并受控 activate 后重开继续备份且保留2份。审核者只读其JSON/日志，没有独立执行这次原生交互；不称物理Dock、OS picker、Windows 或正式验收通过，也不并入27项独立合跑数字。

`git diff --check` 对本轮范围通过。最终源/测试/证据另以 [review77-independent-summary.json](../evidence/implementation-13/review77-independent-summary.json) 记录指纹和命令。恢复主流程、旧草稿隔离屏障及全局备份留待后续独立审核，不改变正式用例状态。
