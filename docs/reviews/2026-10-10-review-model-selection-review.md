# 已配置审核模型但任务仍未选择：独立诊断与审核

日期：2026-10-10（Asia/Shanghai）。审核范围为任务默认快照、主进程模型解析、保留的聊天接受/审核调用及相关专项用例。本报告没有读取用户配置、真实作品或 Key，没有启动用户 Electron，没有访问外部供应商，也没有修改产品源码。此前 Tabs 与作品加载修复保持不动。

## 独立诊断

截图表明设置已经选择默认审核模型，而弹窗报告当前任务审核模型未选择；截图本身不能证明该任务创建时间或实际持久快照内容。源码可重现与之完全一致的路径：

1. `src/components/desktop/AgentSettings.tsx` 保存 `settings.agent.reviewModelId`，选项没有使用本地作品库中的历史 AIModel。`desktop/main/model-service.ts` 的 `defaults()` 从同一已提交 revision 捕获五个默认值。
2. `src/lib/services/chat-turn.ts:138` 仅为新会话捕获当前默认；已有会话的后续回合在 `182–184` 从会话原快照派生，失败重试则沿原回合快照。`scopeFor()` 在 `34` 将原回合快照安装到执行上下文。没有历史快照的 legacy 会话由 `desktop/shared/task-defaults.ts:35` 生成审核/图像均为空的快照。
3. `src/lib/ai/provider.ts:33–34` 的审核解析优先使用 `execution.taskDefaults`，`ignoreChatSession:true` 仅绕过已解析文本 SDK 模型，并不会绕过任务快照。随后将 `modelIdForRole(defaults, "review")` 作为显式 id 传到主进程。
4. `desktop/main/model-service.ts:34–35` 的 `undefined` 代表使用当前默认，`null` 代表明确未选择；已有任务的审核空值作为显式 null 到达，因而忽略设置中的审核默认并报告 `MODEL_NOT_SELECTED`。
5. `ModelRequiredDialog.tsx` 告诉用户“在任务中选择，或为新任务配置默认模型”，但现有聊天 `ModelPicker`、请求协议与 chat store 只暴露文本/思考选择。审核空快照没有可操作的任务级补齐入口。

只读合成探针使用真实 `freezeTaskDefaults`、`modelIdForRole`、`ModelService` 和 `ModelGateway`，repository 与 Key 为人工夹具。先捕获审核为空的快照，再提交非空审核默认，分别解析当前默认与原空快照。实际输出：`currentDefaultSelected=true`、`historicalReviewUnselected=true`、`historicalResult=MODEL_NOT_SELECTED`、`sends=0`，命令退出 0。首次沙箱下 tsx 的 esbuild 子进程 `spawn EPERM`；授权提权后的同一无网络探针成功，不把前次失败记为通过。

这证明源码存在快照阻断路径，不能在未检查任务状态时把它冒称为用户真实任务已确认的根因。

## 修复边界

保留主进程 `undefined`/`null` 的区分、当前模型启用/类别/凭据/授权版本验证和平台零后备。不能在 provider 或 ModelService 对任意 null 无条件回退，也不能任选首个文本模型。

`docs/reviews/24-ui-implementation-boundary-review.md` 的既有批准约束要求已有显式空/失效不 fallback；`DEFAULT-09/10/11` 及客户端 `chat-defaults.test.ts` 验证旧会话文本选择、原任务重试与历史快照不被当前配置覆盖。因此最小方案必须明确区分“补齐当前用户重新提交任务尚未选的审核角色”与“修改已经执行/付费/有副作用的历史任务”。优先提供明确的任务级应用当前审核默认动作，或在新的用户提交边界仅捕获缺失辅助角色的新快照并保存来源；非空历史角色、旧失败回合重试、已保存计划和执行中的角色保持冻结。方案需要由主代理明确业务语义后复审。

## 建议专项用例

- 已有会话在审核未配置时创建；之后保存默认审核模型；作者按修复方案重新提交或明确应用默认后，实际审核调用使用该已确认模型，并保留原历史记录。
- legacy 会话无快照的同一场景；文本显式 null 仍失败，不能因补齐审核角色而偷偷修复文本选择。
- 原审核角色为非空 A 后设置改 B；历史/重试仍使用 A，新任务语义按方案执行，删除/停用/错类别/缺 Key 不补位。
- 没有任何审核默认或明确取消配置时，保持准确阻断、草稿不丢、零网络、不自动发送。
- 用固定两模型与受控 SDK transport 验证实际 review 模型 id 和用量记录，不能只断言快照 JSON。
- 当前执行中更改默认、取消或迟到设置确认时，不改变已受理尝试的选择；同 clientRequestId 重放不创建或重选任务。
- UI 的修复入口与错误提示一致，设置保存失败/仍在保存不会显示已生效成功；截图与渲染验证只使用隔离人工数据。

## 阶段状态

独立诊断完成。技术方案审核、测试用例审核和实现 code review 尚未开始；本报告不声明修复或验收通过。

## 补充：用户确认发生于执行或重试计划任务

用户随后确认触发点是“执行或重试计划任务”。继续只读核对后，不能把计划卡误认为已有专用计划执行端点：

- `src/components/chat/SopPlanCard.tsx:119` 的卡片只查询/展示/折叠；`ActivePlanBar` 只定位卡片。`desktop/handlers/chat/conversations/[id]/sop-plan/route.ts` 只有 GET，返回 active/recent，没有计划模型修改或执行 POST。
- 真正“批准此版并执行”来自 `ChatPanel.tsx:1832`，进入 `use-agent-chat.ts:755` 普通 `send()`，附 `interaction.action:"approve"`；失败后的“重试本轮”仍进入普通聊天的 retryOfTurnId 流程。`chat-turn.ts:221–225` 在消费计划批准交互时，以当次 `turnDefaults` 创建 SopPlan；原会话审核空值此时可能继续进入新计划。
- `src/lib/sop/plan.ts:85–86` 在创建计划时确实保存 `defaultsSnapshot`；`83` 的更新分支仅更新题目/任务项，保留原默认快照。但所有现有执行代码中没有读取该计划快照来绑定模型的路径：`createAgentTools` 调用各节点 runner，runner 调用通用 provider；最终仍处于当前 chat turn 的 ChatExecutionScope。
- `src/lib/chat-execution.ts:41–42` 安装聊天快照到通用任务 AsyncLocalStorage。通用 provider 又优先读取 `currentChatExecution().taskDefaults`（`provider.ts:33`），因此仅在节点外层 `runWithTaskDefaults(planSnapshot, ...)` 仍不能覆盖父 chat 的角色选择；image 入口有相同优先级。计划选择、节点记录与实际 model.resolve 参数可能不同源。

因此至少有两个明确产品缺口：计划模型的持久选择缺少操作入口；计划快照没有执行绑定。只修提示、GET 投影或在 ModelService 为空时默认回退，都不会补齐完整行为。

最小明确修复建议围绕审核角色收敛：提供当前计划的显式审核模型选择（默认审核模型可作为可确认选择），由本地受权服务在会话锁/执行空闲检查下持久保存；计划节点执行应读同一已验证计划记录，将该快照安装为明确的当前任务上下文，同时保留聊天 epoch、取消、写入和 effect guards。provider 对审核应消费当前被安装的任务上下文，而不是再次用父 chat 快照遮盖它。正在执行/有活跃尝试时禁止改计划选择，已受理执行和旧 run/用量不重写。删除/停用/缺 Key 的已选计划模型继续准确阻断，不能补位。

需要主代理方案明确：计划批准是否捕获当前默认形成新计划，计划重试如何以新选择产生新的受理执行快照并保留旧 turn/run 记录，以及普通非计划聊天保持原语义的方式。不得把“没有计划专用执行端点”写成已经实现或测试了该端点。

追加专项用例：建立父 chat 审核为空、子 plan 审核为 A、全局默认为 B 的冲突夹具；实际审核必须发送 A，节点/子代理/用量快照都记录 A。仅验证计划 JSON 返回 A 不够。另验证未绑定普通聊天保持 null 阻断、并行两计划上下文互不污染、取消/迟到更改/执行中修改被拒绝。

第二个实际合成探针调用真实 `runInChatExecution(chat)` → `runWithTaskDefaults(plan)` → `getModelForUser(role:"review")`；数据库 context 仅为空人工夹具、transport 只记录 resolve 入参并抛安全错误，未建立数据库、未构造网络 transport。结果 `installedPlanScopeReviewSelected=true`、`actualRequestedNull=true`、`code=MODEL_NOT_SELECTED`、`sends=0`，退出 0。证明通用 task scope 已安装非空审核选择时，provider 仍会被父聊天空快照遮盖。

## 技术方案独立审核

审核对象：`2026-10-10-review-model-selection-plan.md`（包含可信 worker 调用身份、最新有效 Attempt 与自动网络 Attempt 的补充版本）。结论：**本次模型选择修复方案通过，可以进入用例审核。** 这批准实现方向，不等同于已实现或测试通过。

方案采用实际既有聊天/SOP 执行路径，没有虚构计划专用执行 API。作者在弹窗明确确认具体审核模型 ID，保存 Conversation 的显式审核选择；新的手动受理 Attempt 保存补齐后的五项快照，原 Turn、Plan、旧 Attempt 与已完成节点不重写。已有非空审核选择仍不能补位，文本、思考、模式与图像保持冻结，配置改变本身零发送。这样没有改变 ModelService 的显式 null 语义，也不用更改 provider 的通用优先级。

首次复审识别的风险已经写入技术补充，实施 code review 将据此验收：

| 风险 | 必须实现的闭合条件 |
| --- | --- |
| 后台/旧会话的错误提示关联错任务 | worker 从真实 `currentChatExecution` 附 keyless conversation/turn/attempt 身份，主进程严格校验后发 Notice；无身份不提供应用入口。UI 固定该目标且切换后失效，服务 PATCH 仍在锁内核验最新身份与无活跃尝试 |
| 二次重试回读 Turn 空值 | 手动重试基线优先最新有效 Attempt 快照；非空 A 保持 A，不能仅检查原 Turn 的 null |
| 网络整轮重跑丢选择 | `nextChatAttempt()` 是第二个创建入口，新网络尝试必须复制前一已受理快照，绝不重新读 Conversation 或全局默认 |
| 迁移漏新增字段 | `conversation-bundle.ts` 当前是 `row_to_json` 整行与安装 schema 列表，不存在固定字段白名单；新 schema 下的正常捕获/复制须用实际两库专项证明新字段保留 |

旧迁移 journal 中冻结 bundle 的新增 nullable 列兼容必须据实界定：现有 `copyConversationBundle` 对 installed columns 与 frozen columns 完全比较，缺列会安全拒绝；verify/cleanup 也比较完整 row digest。本次若不扩改恢复策略，应测试并报告“旧冻结 bundle 被准确拒绝、原数据及 journal 保留”，不能把它写成自动兼容恢复。普通旧数据库按本次 ADD COLUMN 升级后重新捕获 bundle 的兼容是另一个可验证场景。任何自动恢复兼容方案都必须白名单这两列且保留原 journal/receipt 的摘要授权，不能忽略任意列差异。

技术方案通过先于后续测试用例审核；实现和 code review 仍未执行。

## 测试用例独立审核

前置为上述技术方案已通过。审核对象：`2026-10-10-review-model-selection-tests.md` 的 RMS-01 至 RMS-11 补充版本，以及尚未执行的 `tests/integration/review-model-selection.test.ts` 初始 TDD 稿。结论：**测试方案通过，可按方案先 RED 后 GREEN。** 这只批准用例设计，不把尚未完成/执行的覆盖标为通过。

测试方案已覆盖真实 SDK 选择与本地用量/子任务快照、旧记录不重写、客户端请求重放、legacy 文本 null、已选/失效/授权门禁、原尝试身份、运行中拒绝、弹窗单飞/迟到/零发送，以及新的手动与请求内网络尝试的冻结连续性。迁移场景明确同版本两库整行保留新字段、旧库新增 nullable 列不回填、旧冻结 bundle 准确拒绝并保留原数据，不承诺旧 journal 自动恢复。

初始 TDD 稿仍在补充实现授权失败、两库转移和 UI 来源/迟到场景。已反馈两处夹具纠正：可信数据库 context 属性是 `database` 而非 `prisma`；legacy nullable Json 清空使用 Prisma 的显式 `DbNull`/`JsonNull`，不能靠 `null as never` 冒充类型。此类夹具错误不作为有效的业务 RED 证据。

独立 code review 与实际测试执行尚未完成。

## 实现 code review 与独立专项复验

审核范围为新 `model-task` 身份/选择 schema、共享 IPC 和 task-defaults、service models、main ModelService/guidance、新 schema/migration、chat-turn 的两种 Attempt 创建、conversation PATCH、ModelRequiredDialog/ReviewModelSelection，以及本次专项用例；其它既有 Tabs、作品加载和工作区外观改动没有改写。

实现沿实际既有聊天/SOP 路径生效：`scopeFor` 优先解析 Attempt 快照；手动 retry 基线优先上一有效 Attempt；只有审核为空且 Conversation 保存过作者明确选择时补齐；`nextChatAttempt` 从前次受理快照复制。新增两个 nullable 列不回填设置。PATCH 采用 selection 意图，只验证受权模型并在会话锁内核对 owned/latest/noactive/未选；主进程默认解析、Key 和每次发送的授权检查没有放宽。invoke 仅从真实 ChatExecution 附严格 keyless 身份，renderer 没有提供此身份给模型 resolver 的入口。provider 的审核角色仍从此次受理执行快照解析，SOP 子任务继承相同 scope。

首次源码 review 识别 UI 默认变化竞态：PATCH 提交 A 期间 bootstrap 默认改 B，旧 JSX 会显示 B 并随后宣称已应用，实际保存 A。已反馈作者，修正为点击时保存 submitted id/name，pending 和 success 均展示“本次审核模型”及冻结名称。独立浏览器探针实际结果：`submittedModel=review-A`、`defaultNow=review-B`、`pendingShowsSubmittedA=true`、`successShowsSubmittedA=true`、`successClaimsB=false`、`errors=[]`，退出 0。探针首次等待 B 的超时已加载修正后的源，另一次变量遮蔽错误属于 harness，均不是有效业务 RED，不计通过。

独立执行命令：Node 24.19.0 + `--import tsx --test --test-concurrency=1 tests/unit/model-guidance.test.ts tests/integration/review-model-selection.test.ts tests/browser/review-model-selection.test.ts`；`XAANINK_TEST_CHROMIUM` 为本机 Chrome。结果 **17/17 通过，0 fail/cancelled/skipped/todo，退出 0**。其中真实浏览器只渲染本次真实 React 组件、全网络拦截；数据库/SDK/授权测试采用隔离 PGlite 与人工模型 transport，真实供应商发送为零。

复验涵盖实际 SDK 审核 A、用量与子任务相同快照、历史 Turn/Attempt/Plan 不变、幂等重放、第二次手动/网络 Attempt 保留 A、真正空快照 legacy 文本仍阻断、非空审核不替换、错身份/活跃执行/不存在/停用/错类别/缺 Key 拒绝、外部不确定 effects 仍要求对账，以及弹窗单飞/无来源/无默认/终态刷新/切换迟到和模型名称冻结。作者其它 green 没有叠加到该独立 17 的数量。

结论：**本次产品实现 code review 通过，未发现尚未关闭的阻断性产品缺陷。** 最终验收还须由主代理完成 scoped 构建、隔离 Windows Electron 和 RMS-11 旧数据升级/旧 bundle 保护的完整证据。此前旧 bundle 测试的 `systemConfig.key contains 'old-frozen-journal'` 不能匹配摘要化 marker key，已要求改为前后完整数据对比；普通旧数据库升级需实际先建旧 schema/记录，再应用本次迁移，不能用空库迁全量代替。此处不把待补验收记为通过，不声明真实供应商、用户原任务或全量回归已经验证。

## 定向复核收尾

作者补齐 RMS-11 与副作用分支后，独立 reviewer 只读重新检查实际测试源，不重复前述整个专项组：先加载去掉本次 migration 的旧 schema，写入真实 Conversation/ChatTurn/ChatAttempt，再应用当前 migration 并验证新增字段均为 null；随后执行真实第二库拷贝并核对显式审核选择及 Attempt 快照。旧冻结 bundle 以确切 `CONVERSATION_SCHEMA_MISMATCH` 拒绝，前后完整源 graph 和目标 SystemConfig 整表相等，已替换无效的 unhashed key 子串断言。RMS-05 同时检验 unknown external effects 必须先对账、已提交写入必须 resume，补齐模型不会绕过原门禁。

这些新增源码断言闭合此前实现 review 的验收补证项。作者报告最新本文件 8/8、浏览器 6/6 与 scoped 相关组/构建通过；该报告没有追加为独立 reviewer 的 17/17 数量。当前产品 code review 结论保持通过。

真实 Windows Electron 验证仍在主代理执行。初次 `target-01/windows-electron.json` 为失败（定位合成会话超时，前两项检查通过、pageerror 为 0），属于保留的验证失败证据，不能标为原生通过。最终原生结果、源码/产物指纹和准确范围由主代理在 verification 文档另行记录。本 reviewer 没有运行用户原数据或调用真实供应商。

## 最后 UI 状态与 Windows 证据定向审核

对 `ModelRequiredDialog.tsx` 和 `ReviewModelSelection.tsx` 的最后标题修订作定向审核：子组件只有 PATCH 成功且 `owns()` 仍确认组件存活及当前会话匹配时才调用 `onApplied()`；父组件按 `noticeKey` 保存成功状态，当前提示转为“审核模型已应用”和“新的审核模型选择已经保存。”。失败分支不会触发成功标题，切换会话后的迟到响应不会宣布成功，pending/success 仍展示点击时冻结的提交模型名称。`tests/browser/review-model-selection.test.ts` 追加成功 heading 与旧“当前任务没有可用模型”消失的断言，作者报告最后六项浏览器专项全部通过；本 reviewer 没有把作者复验叠加到此前独立 17/17，也没有重复整个专项组。

已只读核验最终 `docs/evidence/review-model-selection/target-03/windows-electron.json`：状态 passed、8 条检查记录（包括 2 张截图）、errors 为空；16 项产品源文件/迁移/验证脚本/dist 指纹全部与当前文件 SHA-256 匹配，两张 PNG 的 SHA-256 也与证据匹配。独立目视 `review-selection-applied.png`，标题和说明为保存成功状态，明确要求手动重新执行，旧无模型标题已经消失。最终证据闭合原生 bridge/PATCH、数据库保存、正常退出冷启动和新手动 Attempt 快照的本次验收范围；此前 target-01 失败和修订前 target-02 仍保留，不替换最终源验证。

该原生验证由主代理运行，采用隔离人工数据、真实 Windows Electron 44.6.0、受控注入的合成调用身份；actual invocation identity 与真实 SDK 审核模型选择由此前 scoped 测试独立覆盖。证据显示供应商请求为 0、没有启动 HTTP listener、不访问实际用户数据；不宣称真实 DeepSeek 请求、用户原任务成功、实体 OS 点击、安装包/macOS 或全量回归已验证。

**最后 UI 定向 review 通过，产品 code review 保持通过。本审核范围没有尚未关闭的阻断项。** 主代理负责汇总 scoped 构建、相关测试及最终验收结果。
