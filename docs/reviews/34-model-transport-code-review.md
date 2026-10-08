# 用户模型调用链独立代码审核

日期：2026-10-07（Asia/Shanghai）。审核者：独立子代理。仅新增/更新本审核记录，没有修改实现、正式测试或其他文档。

## 结论

**复审通过本批已接入的用户模型调用链：MT-01（P1）及 MT-02（P2）均已闭合，当前审核范围无剩余阻断。** 独立复跑新增分类/真实 SDK 集成回归 2/2 通过，并重跑原隔离探针，三次预期均成立。首审发现保留在下方；通过结论不包括未接入功能、全部业务/正式平台验收。

## 范围

审核 `desktop/main/model-service.ts`、`desktop/service/models.ts`、main/service 入口的模型 RPC、`src/lib/ai/provider.ts`、`src/lib/quota.ts`、`src/lib/ai/generate.ts`、聊天生成及 conversation PATCH、正文评审的显式模型适配。为核对最终 HTTP 和错误传播，定向阅读了 `model-authorization.ts`、`model-repository.ts`、`rpc.ts`、网络重试/错误分类模块及当前安装 SDK 的 `handle-fetch-error.ts`。

模型设置 UI、供应商 discover/test draft、图像与资产下载、未配置模型的 UI 引导、新会话默认配置快照、其余平台及 Auto 文案仍属后续范围；本记录没有将其认定为完成，也没有把新会话快照尚未接入另列为本轮缺陷。CodeGraph 工具不可用，使用定向源码阅读。

## 首审发现（均已闭合）

以下为修复前源码及首审观察，不代表复审后的当前行为。

### MT-01 · P1 · 聊天空模型分支解析成评审默认模型

位置：`src/lib/ai/provider.ts:42–44`；调用入口 `desktop/handlers/chat/route.ts:220`。

`getAutoModelForUser` 用 `ignoreChatSession: true` 避免复用聊天上下文，但 `resolveDefaultModelRecord` 又把该标志解释为 `role: review`。因此会话 `modelId=null` 的真实聊天分支会查 `reviewModelId`，与别名注释中的“用户配置的默认模型”及默认文本用途不符。

复现：main 仓库仅配置启用的文本模型 `fixture-text` 并将其设为 `textModelId`，保持 `reviewModelId=null`，在受信 PGlite context 调用该入口；实际抛出“请先选择用于此任务的模型”。再配置另一个文本模型 `fixture-review` 并仅设为评审默认，实际返回 `fixture-review`，而非文本默认 `fixture-text`。此探针不发送模型请求。

影响：仅完成文本默认设置的作者无法从此分支聊天；同时配置两用途时，聊天会使用作者只指定给评审的模型及其账户、价格、上下文/思考配置。这是已有分支的用途错误，独立于后续新会话快照/UI 引导工作。

建议：用途只由明确的 `role` 决定，`ignoreChatSession` 仅控制是否复用执行上下文；聊天默认入口显式指定文本用途，评审调用显式指定评审用途。保留未配置、未选择、停用或删除的明确拒绝，不让默认文本失效时自动改用评审模型。

必要回归：仅有文本默认时聊天默认解析成功；两默认不同仍选文本；文本默认未指定/失效时即使有评审模型也拒绝；正文评审仍选择评审默认且不借用聊天模型。

### MT-02 · P2 · 主进程网络错误脱敏后失去可重试类别

位置：`desktop/core/model-authorization.ts:95`，经 `desktop/service/rpc.ts:18–21` 传播到 `desktop/service/models.ts`；消费方是 `createNetworkRetryFetch`、`runWithNetworkRetry` 与 `classifyError`。

网关将真实 `TypeError('fetch failed')` / `ECONNRESET` 等连接错误统一替换成 `ModelAuthorizationError('MODEL_NETWORK_ERROR')`；RPC 仅传 message 并重建普通 `Error`。当前分类器和已安装 SDK 均未识别这个安全错误码，无法再依据原 TypeError/Node code 判定网络错误。SDK 只在特定 fetch/Node 错误上构造可重试 `APICallError`，不会替任意普通 Error 补上可重试属性。

复现：隔离假 fetch 第一次抛 `TypeError('fetch failed', { cause: ECONNRESET })`，第二次已准备成功 SSE；设置最大网络重试为 1，调用真实 SDK 的 `generateText`。运输替身按实际 RpcPeer 的语义将错误转为 `new Error(message)`。实际结果为：

```json
{"calls":1,"error":"MODEL_NETWORK_ERROR","classification":{"category":"internal","code":"STREAM_INTERRUPTED","retryScope":"none","userAction":"check_state"}}
```

预期是同一授权仍有效时重发一次并完成生成；当前根本不进入请求层或生成层重试。聊天后续某次 HTTP 连接失败也会丢失安全的请求层恢复机会。

建议：保留安全脱敏，同时建立明确的网络错误 wire code 到可重试类别的映射/重建；不要重新透传原始供应商报错、Key 或任意 cause。授权撤销、Key 缺失、端点/型号不匹配、用户取消等确定性拒绝仍必须不可重试。每次真正重发继续走现有 main 版本核验。

必要回归：经过真实 RPC 序列化后的暂时连接失败→一次重试成功；持续失败按共享预算终止；等待重试时旋转/删除/停用授权后零新增供应商请求；用户取消不重试；脱敏错误不包含 Key。请求层与一次性生成层都应覆盖，而非只断言原始 TypeError 分类。

## 已确认的实现边界

- worker 获得公开模型快照与惰性本地 AIModel 引用，SDK 使用固定无效占位 Key；main 解密并注入真实 Key。main 返回的公开配置去掉密文，模型 RPC 不向 renderer 提供直接方法入口。worker 全局 fetch 被替换为未授权则拒绝的本地入口。
- ModelService 核验所选模型存在、启用、输出类别与授权版本；POST 正文中的实际 `model` 必须等于配置型号。最终网关约束端点 origin/base path，发送前与取得响应后复核授权；重定向限同授权范围和 307/308；撤销使租约失效并中止响应，避免旧缓冲继续流出。
- `checkQuota` 不按 Web tokenQuota 阻止用户 API 调用；usage 使用调用快照，保留实际 token、配置价格及授权版本。作品/全局数据库中的 AIModel 仅作为 `enabled=false`、空 Key 的历史引用创建；移除 main 配置不删除这些用量引用。调用依赖 main 当前授权而非历史数据库行。
- conversation PATCH 对明确模型选择核验 main 的启用文本模型，不以本地历史 AIModel 作为可调用来源。正文评审显式使用 `role: review` 和独立评审默认，不从聊天上下文借用模型。

上述结论为所读代码与已有测试所支持的边界，不是全部业务功能、Electron 系统保护或两平台真实桌面验收通过的声明。

## 验证与实际限制

已阅读 `tests/unit/model-service.test.ts` 两项回归及 `tests/integration/local-model-generation.test.ts`，它们验证 Key 留在主进程、旧授权快照拒绝、取消等待响应、无平台配额拦截、用量快照/删除后历史保留等；主代理报告已通过。本轮未重复跑这批已有成功测试。

独立执行 `<temporary-path>`（Node 24.19.0）完成以上三次定向探针：仅文本默认、两用途默认、连接重置后可成功的第二次请求。使用实际 ModelRepository/ModelService/ModelGateway/provider/generateText、真实 AI SDK 与临时 PGlite 数据库；Key 为公开无账户假值，网络出口为进程内假 fetch，RPC 异常语义为与实际实现一致的普通 Error 重建。探针成功执行并观察到上述错误行为；临时数据库目录已清理，没有读取作者作品或调用真实付费模型。

首审没有启动正式 Electron、验证原生 safeStorage、执行真实 HTTP 服务或正式桌面测试；不能把隔离探针扩称为 DESK-M12/M13 的正式平台验收。

## 修复复审

| 编号 | 当前修复 | 独立验证与结论 |
| --- | --- | --- |
| MT-01 | `getAutoModelForUser` 显式指定 `role: text`；`resolveDefaultModelRecord` 只读明确 role，省略时为 text。`ignoreChatSession` 不再隐式选择评审用途；评审调用仍显式 review。 | 新增集成断言通过。原临时探针重跑：仅文本默认返回 `fixture-text`，两个用途默认不同仍返回 `fixture-text`。评审未配置的拒绝在集成测试中继续通过；main resolve 不存在跨用途补位。已闭合。 |
| MT-02 | 网络分类沿 SDK cause/errors 链识别安全字面量/错误码 `MODEL_NETWORK_ERROR`；无需恢复原始 Key、供应商诊断或 cause。`AUTHORIZATION_REVOKED` 等明确授权/选择错误优先归模型不可用、retryScope=none。 | 新增分类单测验证普通 Error 的嵌套 cause 可识别网络，授权撤销不重试；真实 SDK/PGlite 集成验证首次假 fetch 失败、第二次成功，实际 main 发送 2 次。原临时探针继续按 RpcPeer 重建普通 Error，最大重试 1 时得到 `calls=2` 和成功正文。旧授权/移除模型拒绝、历史 usage 保留仍通过。已闭合。 |

独立执行命令：Node 24.19.0，`node --import tsx --test tests/unit/model-error-classification.test.ts tests/integration/local-model-generation.test.ts`。结果：2 顶层测试通过，0 失败/取消/跳过。集成执行的内部断言还覆盖 Key 不进用量、作品惰性历史引用无 Key 且不可调用、Web tokenQuota=0 不阻止生成、评审默认未选择拒绝、旋转后的旧 SDK 模型零新增发送、删除后 usage 保留，以及流结束用量事务未完成时不能关闭数据库。

随后原 `<temporary-path>` 重跑得到：

```json
{"case":"only text default","selected":"fixture-text"}
{"case":"both defaults","selected":"fixture-text","textDefault":"fixture-text"}
{"case":"one connection reset then success","calls":2,"text":"retry succeeded"}
```

已只读核对 `docs/evidence/implementation-02/model-review-red.tap`：修复前集成测试在默认 caller 断言抛 MODEL_NOT_SELECTED，分类单测得到 internal 而非 network，2/2 失败。该红证据是主代理保存的实际输出，本子代理独立执行的是修复后的 GREEN 和原定向探针，没有将 RED 冒称为独立重新执行。

`streamGeneration` 现用 `Promise.resolve(result.consumeStream()).then(release, release)` 对接 SDK PromiseLike；本次集成中的延期 usage 提交/工作区关闭边界通过，其独立生命周期审核归 33 号记录。本次仅确认相关集成没有回归。

复审仍使用临时隔离数据库、公开无账户假 Key 和进程内假 fetch，没有调用付费模型或改正式数据。没有新增正式平台/真实 HTTP/safeStorage 验收声明。首审列出的请求层重试、共享预算持续失败与撤销时序组合仍应由正式业务/桌面用例逐项验收；本轮通过只确认当前修复及已接入安全边界，不替代那些用例的执行状态。模型 UI、discover/test draft、图像与资产、未配置引导、新会话默认快照及其余平台/Auto 文案继续留在后续范围。
