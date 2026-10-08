# Renderer 保存协调与恢复草稿独立代码审核

- 日期：2026-10-07。
- 审核者：独立子代理 `/root/ui_revision_review`，不是本批产品实现作者。
- 结论：**限定范围通过（PASS）**。已发现问题修复后，独立执行10个相关 Node 文件68/68通过、全项目类型检查退出0。没有未关闭的本批阻断项。主进程日志、恢复、IPC和原生关闭握手由后续51另审；本结论不代表它们通过，也不抵扣正式 DESK-W11/W12 或完整桌面验收。
- 范围：`save-coordinator.ts`、`draft-sources.ts`、原 `use-autosave.tsx` 的桌面生命周期分支、`AutosaveController.snapshot`、`chat-session.ts` 的 schema 导出与可选 queued action。新增9项独立行为测试；没有修改作者源码/4份测试，没有运行 Electron。

## 发现与修复

| 发现 | 原行为与后果 | 来源、修复及独立验证 |
| --- | --- | --- |
| SAVE50-REVIEW01 · P2 | `flushStable` 先同步发布 saving，再登记 flight。状态监听者再次调用 flushAll 启动两个持久写，违反共享并发保存契约。 | 本审核实际 RED 得到2次 writer 调用；先登记共享 promise，再由微任务启动 pipeline。同步重入的两个等待者现在仅触发一次写入、收到同一 revision。 |
| SAVE50-REVIEW02/03 · P1 | 定期 checkpoint 调用关闭 flush；paused/failed 自动保存拒绝后不写日志，最需要崩溃恢复的输入仅留在内存。 | 主代理集成检查首先提出，本审核默认799/800ms独立 RED 复现。拆出纯 `checkpointDrafts`，完整捕获 pending/failed/inFlight/latest，不调用业务 save/retry/resume/confirm。失败原 operationId 和后续新输入分别保留，save计数不增加。 |
| SAVE50-REVIEW07 · P1 | 已确认日志后同步 saved 监听者追加新输入，flushAll 仍返回旧快照并允许关闭，新输入未保存。 | 作者自检提出，本审核保存实际6通过1失败 RED。acknowledge 在通知前捕获代数/内容，通知后再检查；出现新输入继续原保存与日志确认。独立证明 A/B 两次原保存均完成、最终确认是 B 且 dirty=false。 |
| SAVE50-REVIEW08 · P1 | paused输入尚未到800ms时尝试关闭，flushAll 清掉 checkpoint timer 后直接失败；暂停 flush 没有通知，留在窗口也不会再写恢复草稿。 | 本审核实际7通过1失败 RED。关闭 flush 失败后重新排一次纯恢复 checkpoint；checkpoint 自身失败不自排。独立证明关闭仍拒绝、后续草稿日志写入、业务保存仍0次。 |

REVIEW04没有声称修前已经观察到共享错误确认：首次 RED 先失败于没有 checkpoint 写入；修复后它继续证明在途纯 checkpoint 的 ACK 不能满足并发 paused close。REVIEW05/06/09为守卫验证，首次完整执行为 GREEN，没有虚构这些探针的 RED。

## 复核到的行为

关闭 `flushAll` 和恢复 `checkpointDrafts` 有各自的共享 flight，共用串行 journal 写队列。写入前及回执后核验当前 writer、代数和完整内容；来源只实现 read、不发订阅通知时也推进变化代数。不能在旧 checkpoint 等待期间并行写新的关闭快照，最终关闭不能使用旧 pending revision。移除已确认的卸载 controller 会推进下一 payload 的 revision，避免同一主进程 CAS revision 对应不同内容。

桌面 hook 卸载仅解除该 owner；dirty/failed/paused controller 及原 save 闭包仍可读取/重试。未编辑过的 clean controller 可释放，带最新输入的 clean controller 需要 durable ACK 才可释放。StrictMode重新登记保留仍未确认的控制器身份。Web卸载继续 dispose 停止定时保存，没有注册桌面协调器；原 Web 串行保存、失败 operationId、后续输入、只读失焦与暂停边界均通过回归。

显式重试才重发失败原 operationId，再处理后续输入；纯 checkpoint 不自动处理冲突、不推进候选稿、不批准/定稿或发送请求。取消只结束该调用者等待，共享保存及另一个等待者继续。writer失败或缺失不确认关闭，错误消息固定且不透传任意路径或原始异常；原输入和可读快照仍保留。checkpoint写失败不会按800ms反复自动重试，显式 checkpoint 重试可成功，paused dirty仍保留。

snapshot用 structuredClone 与实时状态分离，没有闭包和订阅回调。不可读 source 只记录固定 issue，保留曾读到的 detached cached 数据供导出，但任何含 issue 的部分快照都不能覆盖原完整 journal。控制器不可读时 issue可能使用控制器UUID，后续主进程schema须允许该诊断身份并坚持不写不完整快照；本批不宣称已经验证主进程实现。

## 来源与 Web 复用

| 来源 | 实际捕获内容 | 验证到的边界 |
| --- | --- | --- |
| staged | 原 batches/chips、phase、真实版本基线和 operationId | 使用真实 apiSend → 原暂存拦截 → controller → 协调器的受控集成，editing正文进入 journal 回执，零网络 PATCH、没有 chip/审批发送、当前稿不变。合成 autosave saved 本身不证明 durable。 |
| scene | 原 drafts/imageDrafts/imageRequests/submissions/commitErrors | 源码仅读取数据并订阅原 store；请求/提交是恢复元数据，没有调用图像生成、执行提交或回放它们。具体资产持久化/恢复待后续验收。 |
| chat | 当前 accountId 的 active entry 和原 version1已保存草稿 | 只读取 `chatSessionKey(accountId)`，不枚举 sessionStorage或任意缓存；当前和旧未发送草稿、模型显式空/模式意图保留，非法记录原文不改。 |

queued message 的可选 action 复用原 `chatActionSchema`；旧无 action 的 version1记录兼容，审核/改进目标意图经过真实 schema 后保留，不执行排队动作。普通控制器裸 value/UUID不足以认定作品归属，不能凭恢复快照自动重放业务写。恢复应使用可信业务来源和作者明确确认。

## 独立证据

以下文件位于 `docs/evidence/implementation-08/`：

- `50-independent-concurrency-checkpoint-red-4.tap`：4项全部实际失败；较早3项日志保留，数量不累加。
- `50-independent-ack-reentry-red.tap`：6通过1失败；`50-independent-failed-close-checkpoint-red.tap`：7通过1失败。后续修复均保留原行为断言。
- `50-independent-review-fixes-green.tap`：9/9独立探针通过，0跳过/取消，退出0。
- `50-final-related-independent-green.tap`：10文件**68/68通过，0跳过/取消，退出0**，包含27作者新行为、4项移植 Web 回归、28项既有相关回归及9项独立探针。作者此前57/66和其他阶段的通过数量不累加。
- `50-final-independent-typecheck.txt`：完整项目 `tsc --noEmit --incremental false --pretty false` **退出0**。
- 最终受审文件与运行证据指纹见 `50-independent-summary.json`；原 v1/v2冻结清单是修复前历史，不能混用。

Node mock timers证明默认800ms调度和失败后的单次检查点；React hook函数体用受控生命周期替身执行，writer为受控ACK，不证明真实React挂载时序、主进程fsync、数据库恢复或实际窗口退出。共享源数据采用隔离store/内存sessionStorage，未接真实作品、付费模型或真实数据库。

## 交给后续主进程接线的要求

必须先读取/核对旧 journal与会话，再安装恢复来源和 writer，避免首次自动checkpoint覆盖尚未恢复的记录。writer必须在原子持久化成功后才 resolve，提供有界IO、窗口/目录代数撤销、单调CAS、schema/size验证和不可读记录保护。无限不settle的writer不由renderer假装成功；AbortSignal只取消等待。

本次不审核 main/preload/IPC/DesktopApp，未验证日志恢复、tabs/layout恢复源、关闭失败对话框/导出/任务停止确认、macOS Dock重开或Windows退出。恢复来源不得默默批准候选稿、补默认模型、重放未知结果的业务请求或重发排队消息。这些要求及真实崩溃/重启、两平台原生验收必须在后续实现与正式用例中独立证明。
