# 81：作品恢复交接接线独立审核

结论：本轮新增交接机制与接线 **限定 PASS**。未发现新的生产代码阻断项。审核者新增 11 项独立行为用例并实际执行相关 76/76，fail/skip/cancel 均为 0；全量 `tsc --noEmit` exit0、空诊断。未改作者生产源、作者断言、main/shared IPC/DesktopApp 或冻结清单。

此结论涵盖确认后关闭交接、尾部重试、启动旧稿隔离 ACK、备份列表/取消/pending 交互及严格应用根清单，不等于完整 App、531 正式用例、Windows 或物理系统对话框验收。

## 冻结范围及方法

受审清单为 `work-restore-handoff-frozen.json`：13 接线源码、5 作者测试、4 旧 harness 更新、14 只读依赖及 17 证据，共 53 份记录。初审与最终均逐份 SHA256 匹配；按生成器指定的 sources/tests/harnessUpdates/dependencies/evidence 顺序拼接 `path:sha256\n`，包括末尾 LF，独立重算 aggregate 精确匹配 `ee0621382e18cf7ac771434ffee1fe2a18afc52eab77331eceb71dc212377bb1`。最终证据为 `review81-13-final-manifest.json`。

核心 74/75/76/78 已分段审核，本轮不重新实现或替代其证明。main 中模板/image 等邻接功能仅作上下文，不扩大到其业务审核。CodeGraph 工具不可用，采用定向源码和 TypeScript AST；主流程测试提取当前真实 main IPC 回调、关闭服务与 DesktopApp 启动 effect 执行，未用同义实现替代被审代码。

审核者的 main/state machine/BusinessGate、DraftJournal/DraftBarrier、SaveCoordinator/DraftSession 和隔离文件系统均为实际模块。原生确认、worker 返回/关闭、renderer flush 传输与恢复数据投影使用受控 gate；这不证明真实 Electron session 或 PGlite 已关闭。React 列表测试使用实际 React19、原 Button/BaseUI 与 Chromium，bridge 为隔离受控接口。

## 源码结论

- `WorkRestoreHandoff.start` 在异步准备前占有单飞；准备及确认之后复核 owner；确认取消、失效 owner 和 barrier 前的关闭失败只取消隔离候选。main 在同一同步入口绑定当前 window/draftSession 并占有 `workRestore`，恢复与迁移不能同时开始。
- `CloseCoordinator` 只有 stop/flush/closeData 成功才执行 `afterClose`。同一 close 的尾部失败重试保持 `dataClosed`，新 close 则由 `closedHandoffPending` 识别进入过 barrier 的交接；两种路径均跳过旧 renderer flush。main release 在 `requiresRestart` 时保持 gate/model 暂停并发出 pending，不能返回旧工作台。
- main 的 afterClose 串联已审 Commit：barrier → activate → settle → reclose，ready 后才 `app.relaunch`。真实文件 rename 后目录 fsync 失败没有被当作可重新启用；begin 重试重新确认持久性，settle 重试复用已知 outcome，activate 只执行一次。
- main bootstrap 将现有 barrier token 绑定当前草稿会话；DesktopApp 在设置原值为 true 时仍对本次隔离传 `restoreSession=false`，等待实际 DraftSession.initialize 完成后才发布 bootstrap。归档和清缓存后的两次 checkpoint、精确 journal receipt 的 ACK 是同一顺序链，关闭必须等待该维护链。
- ACK 回调持续检查当前 owner/session/ready/token；最终磁盘写入前 owner 变化或旧 journal generation 均拒绝清标志。ACK 丢失不发布可编辑状态或成功提示；后续关闭可以持有新的 saved journal 回执，但保护标志仍在，不等同恢复 ACK。
- 本地备份列表保留真实标题、时间和大小；恢复只提交 semantic UUID，pending 文案不冒称成功/取消，键盘重复激活单飞。`restore-draft-barrier.json` 是严格受管文件；类似名称的作者文件仍保留。

## 新增独立用例

| ID | 操作与可观察断言 |
| --- | --- |
| WR81-01 | main prepare gate 在途，第二次恢复和迁移均拒绝；替换草稿 owner 后只取消一个候选，无确认启用/flush/barrier |
| WR81-02 | 真实 main stop 阶段拒绝，后续 flush/关库/activate/barrier 均不发生；旧 journal 输入保留，恢复业务仅发生在安全取消后 |
| WR81-03 | barrier 已 rename 后真实目录 sync hook 拒绝；保持 closed/pending、不 activate；重试确认 fsync 后一次 activate/一次旧 flush |
| WR81-04 | settle 已 rename 为 activated 后目录 sync 拒绝；不 relaunch、不 reopen；重试只续 settle/reclose，不重复 activate/旧 flush |
| WR81-05 | 最后 barrier 写入 guard 撤销当前 main owner；ACK 拒绝，原 token 保留，新 session 不被旧回执清理 |
| WR81-06 | journal 已推进后提交旧合法 digest/revision；拒绝并保留 barrier；精确新 receipt 可清一次，重复 ACK 拒绝 |
| WR81-07 | 实际闭源 inventory 收集精确 active barrier，类似名称不进入 allowlist，未知文件字节不变 |
| WR81-08 | 实际 DesktopApp effect + DraftSession/SaveCoordinator + main journal IPC：第一稿含归档及原缓存，第二稿清缓存仍保归档；ACK 前不发布 bootstrap，关闭不提前 reply；pending outcome 不显示恢复成功 |
| WR81-09 | 丢失启动 ACK：无可编辑 bootstrap/成功提示，归档保留、barrier 不清；再次关闭可获准确 saved journal 回执但仍不冒称 ACK 完成 |
| WR81-U01 | 实际 React pending 回执显示交接未完成，保留原备份条目和准确 UUID，既不显示取消也不显示成功 |
| WR81-U02 | 实际键盘 Enter 重复激活只发一请求；取消后保留所选作品/备份，显式重试失败仍保留列表 |

独立测试为 `tests/unit/work-restore-handoff-review.test.ts`（9 项）和 `tests/browser/work-restore-panel-review.test.ts`（2 项）；最终 SHA 单列于 `review81-13-final-manifest.json`，不修改作者冻结。

## 实际验证与失败归属

- `review81-12-final-unit-related.tap`：14 文件 67/67，exit0。
- `review81-09-final-react-related.tap`：4 文件 9/9，exit0，包含新增 2 项、作者列表 3 项及既有备份按钮/设置 4 项。
- 共 76/76：原作者相关 61 项、新增独立 11 项、另补既有 B55-01…04 的 4 项启动/关闭守卫。前一相关 75 计数因未含 B55-07；最终显式包含，不将文件选择差异说成作者 harness 变化。
- `review81-11-final-typecheck.txt`：实际全量 exit0、0 字节诊断。

没有生产行为 RED。保留的 `review81-02` 首轮为我的 migrate 夹具漏注入 z（6 PASS/1 FAIL）；`review81-04` 为等待真实 FS close reply 时只等两轮 setImmediate（8 PASS/1 FAIL）；`review81-07` 为我的 StoreOptions 故障 hook 未标 async 的三个类型错误。这些都修正夹具/类型，不改生产逻辑，不伪称产品缺陷已被修复。最终用明确回执 gate 和 5 秒测试上限等待实际异步完成。

## 原生开发证据及后续边界

主代理提供 `native-work-restore.json`、`native-work-restore-run-01.txt`、list/retained PNG。本审核仅只读核对并记录 hash，没有执行其 Electron 流程。提供的记录称 macOS arm64 实际 App/worker/PGlite、退出重启及旧稿保留的 4 组开发检查通过；确认结果受控、上传使用 setInputFiles，不能称物理 OS 选择/确认、Windows 或正式 531 验收。此证据与本审核独立测试分开归属。

主代理自查的两项旧稿呈现问题仍待后续 UI 修订：结构化内部记录直接显示 JSON；本次强制隔离沿用 RESTORE_DISABLED 的「已关闭自动恢复」理由，与用户原设置 true 不符。本轮新增交接机制通过不表示这两项显示修订已完成；不据此将整份恢复预览/完整产品验收提升为通过。原模型/正文审批、用户数据和正式用例状态均未改动。
