# 后台创作任务与数据库生命周期独立代码审核

审核日期：2026-10-07（Asia/Shanghai）。原范围为 `desktop/service/context.ts` 的 retainDatabaseTask、`workspaces.ts` 的 run/runWithGlobal/retainTask、`src/lib/long-task.ts`、`local-chat-cancellation.ts`、`desktop/handlers/chat/route.ts` 的结束清理，以及 detached 作品库回归。主代理随后明确授权补查 `src/lib/ai/generate.ts` 的 streamGeneration 释放时点；这里只扩展这一处生命周期，不审查新模型路由、授权协议或主进程调用链。

**最终结论：通过（本批限定范围）。** DT01、DT02 的提前释放问题已经修复，并经独立行为验证闭合。作品与全局库在排队、独立心跳、检查点及最终观测/用量写入期间保持借用；取消请求本身不解除实际任务的借用。没有剩余有证据的阻断项。

审核不修改实现。按追加授权，只新增本记录和 `tests/integration/chat-detached-heartbeat.test.ts` 两项持久回归。所有数据库、目录及模型夹具均在隔离临时环境，没有外部网络、付费模型调用或真实作者数据操作。

## 发现及闭合

| 编号/原严重程度 | 证据、影响 | 修复与独立复核 | 状态 |
| --- | --- | --- | --- |
| DT01 · P2 | route 的 heartbeatInFlight 原来只有 boolean，独立心跳不进入 io。finally 清除周期 timer 并等待 observation/io 后即 unregister/release。在飞心跳或其重试仍可继续。未修改的真实 POST 源码与真实 Workspaces/PGlite 的 gate 探针得到：SSE cancel 后，两个库 active 已为0，close 成功；恢复挂起的心跳写入后报 `PGlite is closed`。 | 持有真实 heartbeat Promise；stopping 禁止新续租/重试，追踪并清除重试 timer；结束前 allSettled 已发出的 heartbeat/checkpoint，再完成最终 observation/io 才释放。两项持久 handler 回归检查真实双库 active/close 拒绝、每次末尾写入及既存重试取消，均通过。 | 已关闭 |
| DT02 · P2（主代理报告，独立核验） | streamGeneration 原来在 result.finishReason 或 signal abort 时释放。已安装 AI SDK 的 stream-text.ts 在 resolve finishReason 后才 await onEnd/onFinish。实际 SDK+PGlite 用量事务 gate 的原 RED 显示 close 未拒绝，恢复用量写入报 `PGlite is closed`。 | 改为由 result.consumeStream() 的实际 flush/回调结算 finally 释放，移除 finishReason/abort 提前释放。独立运行原生成链的回归通过；另使用真实 SDK、真实 PGlite 和未修改的生成函数源码，验证 finishReason=stop 后、用量写入仍挂起时作者 abort，库仍保持 active=1且 close 拒绝，写入完成后才释放。 | 已关闭 |

DT01 在修复前即时发给主代理。DT02 由主代理先发现，本记录没有将其归为审核者独立初次发现。上表没有把潜在风险或其他尚未实现的 App 行为记为缺陷。

## DT01 独立复现与持久回归

旧行为探针直接读取并转译当时未修改的 `desktop/handlers/chat/route.ts`，执行真实 POST/ReadableStream/finally；控制面依赖用可控 Promise gate 模拟等待，避免网络请求。计时器 shim 保存并恢复创建 timer 时的受信 AsyncLocalStorage context，排除手动调用 timer 导致丢失 context 的干扰。Workspaces、目录 grant、两份完整上游 schema、Prisma 和 PGlite 均为真实实现。

步骤为：返回 SSE 并 cancel 跟随通道；等待执行器进入准备阶段；启动独立心跳并停在 gate；使准备阶段失败，走实际终态/finally；观察 retainers 释放并关闭数据库；最后恢复心跳中的真实写入。修复前实际输出的关键字段为：

```json
{
  "actualPOSTSource": true,
  "realWorkspaces": true,
  "detached": true,
  "timerPreservesTrustedALS": true,
  "heartbeatPendingAtRelease": true,
  "activeBeforeHeartbeatSettles": [{ "id": "inbox", "active": 0 }, { "id": "<隔离作品UUID>", "active": 0 }],
  "closeResolvedBeforeHeartbeat": true,
  "lateWriteSucceeded": false,
  "error": "Error: PGlite is closed"
}
```

作品UUID只为随机夹具标识，上例替换该值，其余为实际观察。该 JSON 是修复前独立探针记录，不冒充正式测试 runner 的 RED TAP 文件。

新增的 `chat-detached-heartbeat.test.ts` 固化行为契约，读取当前真实 handler 源码，保留真实 ALS、数据库和目录 lease，仅使用受控服务依赖，不复制一套结束清理实现：

1. SSE cancel 后继续执行；独立 heartbeat 与 serial checkpoint 在飞时拒绝 close。checkpoint 结算、真实 handler 进入 finally 后，heartbeat 未结算时不能进入最终 observation；两个库均保持 active=2。heartbeat 实际写入后进入最终全局 observation gate，close 仍拒绝；最终写入后两库 active=0、取消注册及队列均清空。分别查询到作品与全局库的末尾写入，然后 close 成功。
2. 心跳瞬时失败已调度3秒重试时结束执行，既存 timer 被清除。即使模拟其回调已经进入事件队列，stopping 仍禁止再次发出心跳。最终 observation 的 gate 期间保持两库，落库后释放。

这里的心跳/观测写入是可控 fixture 的真实数据库写入，验证执行寿命；没有把 fixture 写入称为实际 ChatAttempt 业务语义、真实供应商生成或 Electron 窗口验收。

## 借用、排队与取消边界

retainDatabaseTask 只借用当前受信 scope 中提供的生命周期能力。Workspaces 的每个 retainer 都有独立幂等 release；已关闭、失去对应 slot 或 active=0 的过期 scope 不能重新取得借用。run 的基础引用和后台 retainer 分别计数，基础请求返回不解除后台引用。

runWithGlobal 对作品任务先保留 inbox、再保留作品；作品保留失败会撤销刚取得的 inbox 引用。inbox 自身不重复借同一库。close 基于真实 active 拒绝关闭，错误路径会恢复 closing 门以便任务结束后重试。本批并不实现完整迁移 UI，但该 gate 可供后续维护流程使用。

acquireLongTask 在配置读取/队列等待之前取得数据库借用；配置错误、已取消的 signal、等待时取消都在 catch 中归还。队列 slot 与数据库 retainer 释放都幂等，重复 release 不产生负 active。nested long-task 复用外层名额，不额外占位。registerAttemptAbort 在实际执行器 finally 中注销；abortLocalAttempt/abortAllLocalAttempts 发出中断请求时不提前解锁，仍由实际执行器完成清理和最后写入。

除了持久回归，进行了两组独立探针：

- 受信内存 context 验证等待取消、非法并发限额、已取消 signal、nested 获取、取消后仍持有、重复注销；5次取得与5次实际释放对应，最终 held/active/waiting 均为0。
- 真实作品+inbox 队列探针观察两库 `2/2 → 1/1 → 0/0`：排队者取消只释放自身借用，运行者仍阻止 close；运行者重复 release 后可关闭。另保持全局库活动，用旧作品 scope 重新 retain，作品拒绝时全局临时借用被回滚，两库计数保持不变。

## SDK 最后用量写入

核对当前安装的 AI SDK 源码：`_finishReason.resolve` 早于 awaited onEnd；`consumeStream` 消耗完整流，等待其 flush/回调结算。此处依据已安装依赖的实现和实际执行证据，没有假定 SDK finishReason 等于持久化完成。

独立运行 `local-model-generation.test.ts` 中的实际 SDK+PGlite 事务 gate 场景通过。该文件其他模型/主进程路由断言属于另批审核，本记录只对 streamGeneration 的释放与末次写入作结论。已核对 `docs/evidence/implementation-02/stream-final-write-red.tap` 中提前 close 的真实失败，未覆盖或删除旧 RED。

另外独立 probe 将当前未修改的 streamGeneration 源码接到真实 AI SDK MockLanguageModelV4 与真实 inbox/PGlite，只有用量服务用 gate 隔离：onFinish 已进入时 finishReason=stop；在最终写入挂起期间 abort，active 仍为1、close 拒绝；恢复 gate 后真实写入 `usage-after-abort` 可查询、名额归零、close 成功。该 probe 验证移除 abort 提前 release 的必要性，不把本地 MockLanguageModel 称为真实供应商网络测试。

## 独立验证与状态边界

指定 Node24.19.0，分别执行：

```sh
node --import tsx --test tests/integration/workspaces.test.ts
node --import tsx --test tests/integration/chat-detached-heartbeat.test.ts
node --import tsx --test tests/integration/local-model-generation.test.ts
```

结果为9/9、2/2、1/1，均无失败/跳过/取消；共12项叶测试的运行结果，没有将业务场景中的子断言另行虚增为正式用例。窄类型检查覆盖本批 context/workspaces/long-task/local-cancellation 与两份作品/handler 测试及其传递依赖：临时配置继承 tsconfig.foundation，显式使用仓库 node_modules/@types；最终退出码0，临时配置已删除。handler 通过真实源文件转译运行，不能将其运行检查称为全量 App typecheck。

已核对 `docs/evidence/implementation-02/task-retention-red.tap`：旧 detached retainer 用例因 close 未拒绝而真实失败。当前作品回归验证保留机制；新增两项测试补上实际 handler 的 heartbeat/io/finally 边界。旧 RED 保留，不将后续修复后的 GREEN反写为旧版通过。

本批不包含原生窗口 close UI handshake、停止/等待交互、完整根迁移、主进程模型安全路由、跨平台锁恢复或真实创作操作验收。**531条正式顶层验收用例仍为 not-run；此审核不推进任何顶层用例状态，不代表完整桌面 App 已完成或通过真实用户验收。**
