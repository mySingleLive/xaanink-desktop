# BYOK 实现独立代码审核

日期：2026-10-09。对照166技术方案与168测试用例；仅审核本轮指定的BYOK生产代码、测试与验收脚本。未使用真实凭据，未运行真实接口runner；未评审或修改独立UI变更。

最终结论：**通过**。初审发现的8项问题已反馈、修复并独立复测关闭；当前指定范围无剩余阻断。可进入完整测试与真实接口验收，本结论不代替该阶段通过。

## 初审已证问题（已全部关闭）

1. **P1：工具兼容包装后仍能消费撤销前排队的输出。** `provider.ts` 将 `authorizedNonStreamingModel` 放在 `toolCompatibleModel` 内层。工具文本转换在finish时一次排队多个文本/工具事件，这些事件的后续读取不再经过内层guard。独立受控复现：真实OpenAI SDK非流式fixture只发一次请求，外接 `toolCompatibleModel(..., true)`；读到text-start后令授权断言拒绝，下一次read仍返回text-delta。应在最外层工具包装之后再加highWaterMark:0的Abort/授权读取保护，覆盖工具队列中的文本与tool-call。现有B19/B20仅检查裸非流式包装，未覆盖这一生产组合。
2. **P1：跨官网页重复ID覆盖canonical能力。** `provider-capabilities.ts` 无条件Map.set。公开JSON中Daybreak Blue/Red的Snapshots同时包含 `gpt-5.6-sol` / `gpt-5.6-cyber`，覆盖各自专属页数据；Sol被误标弃用、丢失effort且改变wire，两个仍在当前专属页的canonical型号因此被官网候选合并跳过。应优先精确 `model === id` 的canonical来源，并对跨页冲突明确处理，不能依靠遍历顺序。依据：[Sol专属页](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、[Daybreak别名页](https://developers.openai.com/api/docs/models/gpt-daybreak-blue-latest)。
3. **P1：自托管模型被推荐到OpenAI官方托管端点。** `gpt-oss-120b` / `gpt-oss-20b` 为TEXT且非deprecated，即使Key目录未列出仍合并到 `api.openai.com` 的可选候选。OpenAI官方明确它们通过自托管/第三方运行，不由OpenAI API提供。应保留公开来源并标明非官方托管，排除内置官方端点的新选择，允许显式自定义配置。依据：[OpenAI开放权重说明](https://help.openai.com/en/articles/11870455-openai-open-weight-models)。
4. **P2：特殊端点/用途的精确分类不完整。** `gpt-3.5-turbo-instruct` 从父页继承Chat/TEXT，但独立页明确仅legacy Completions；`computer-use-preview`及快照仍是TEXT，与166排除设备控制的规则冲突。实时目录若返回这些ID，仍进入通用文本选择器。应按精确ID分类为不适用的OTHER并添加回归。依据：[Instruct独立页](https://developers.openai.com/api/docs/models/gpt-3.5-turbo-instruct)。
5. **P2：MiniMax官方思考/容量能力漏录导致两阶段策略不同。** Preview只有testEffort，缺少官方五档与默认max；普通型号也缺官网明确上下文。订阅Key选择Preview时保存thinkingLevels为空，生产SDK阶段不能选择low，而配置短测发送low。应补Preview档位/默认、明确容量和实际SDK映射，并断言请求参数；其他型号不猜effort。依据：[MiniMax官方OpenAI接口](https://platform.minimax.cn/docs/api-reference/text-openai-api)。
6. **P2：Xiaomi两个已知语音型号误报未知。** 官网Models示例还明确 `mimo-v2.5-tts-voiceclone` / `mimo-v2.5-tts-voicedesign`，目前未列OTHER，导致完整已知官方目录产生unknown提示。应补精确OTHER，不以名称前缀猜未来型号。依据：[Xiaomi官方Models](https://mimo.mi.com/docs/en-US/api/model/list-models)。
7. **P2：Ark同ID模态冲突未拒绝。** 新目录适配只比较分类后投影的CatalogEntry；第二条冲突模态可能在比较前被excluded过滤。独立fixture两条相同 `doubao-seed-2-1-pro-260915`，分别声明text和image输出，仍返回ok:true且文本listed-unverified。应在分类过滤前校验同ID的有效模态/task_type/token_limits一致；冲突失败，真实相同重复可去重。
8. **P2：中国站目录来源数组含undefined。** `discoverCatalog`末段以原provider查 `sources[provider]`，但智谱/MiniMax实际常量键分别为zaiText/minimaxText。结果数组含undefined，JSON证据变null；应明确映射并断言每个来源是合法字符串。

## 独立验证

执行Node24.18.0下的 `node --import tsx --test`，范围为 `byok-catalog`、`byok-sdk`、`model-settings`、`model-configuration`、`model-configuration-providers`、`model-configuration-review`、`model-configuration-cancellation`：**98项通过，0失败/跳过**。这证明现有受控测试通过，不能覆盖上述独立复现或代替六家逐型号真实调用。

修复后扩大相关回归至以下9个具体文件，独立执行：

```sh
/Users/dt_flys/.nvm/versions/node/v24.18.0/bin/node --import tsx --test \
  tests/unit/byok-catalog.test.ts tests/integration/byok-sdk.test.ts \
  tests/unit/model-settings.test.ts tests/unit/model-provider-alias.test.ts \
  tests/unit/configuration-transfer-review.test.ts tests/unit/model-configuration.test.ts \
  tests/unit/model-configuration-providers.test.ts tests/unit/model-configuration-review.test.ts \
  tests/unit/model-configuration-cancellation.test.ts
```

结果：**112项通过，0失败、0取消、0跳过**。另独立运行Node24.18.0的 `node node_modules/typescript/bin/tsc --noEmit`，exit0通过。

| 问题 | 已核对的修复与关闭证据 |
| --- | --- |
| 1 | 非流式网络模拟与输出授权分开；provider在工具包装外层应用authorizeModelOutput。SDK回归精确覆盖工具文本转换排队之后cancel/rotate/disable/delete，后续read拒绝，网络只一次。 |
| 2 | 精确canonical页优先于其他页别名；Sol/Cyber恢复本身来源与非deprecated状态；Sol档位保留。受控目录检查两个候选存在。 |
| 3、4 | gpt-oss、legacy Instruct、computer-use及精确快照标记OTHER，保留官网说明；受控实时目录返回这些ID也不进入通用选择器。 |
| 5 | 补MiniMax官网明确容量；Preview五档/default max同时用于目录、thinkingEffortOptionsFor/isValidThinkingEffort和OpenAI SDK reasoningEffort；配置与实际SDK低档请求断言通过，M3/M2仍无猜测档位。 |
| 6 | 两个Xiaomi已知语音精确ID为OTHER；保留未来未知ID的保守行为。 |
| 7 | Ark在类别过滤前比较排序/去重后的模态、task_type及容量签名；三类冲突失败，相同重复去重。 |
| 8 | 智谱/MiniMax文本/图片来源显式映射；新增所有来源为https字符串的断言通过。 |

已检查配置服务认证后合并、固定错误脱敏、精确站点白名单、取消/撤销与不保存设计；实际SDK Responses及Anthropic路径、图片生产解码路径；runner串行双阶段、内置批次先于自定义、明确full/scoped/catalog-only模式、空范围和空可用目录保护。真实逐型号及原生完整验收由主代理在审核关闭后执行，不在本文预填通过。

证据界限：smoke-byok覆盖内置字段、Key草稿/供应商切换及不保存；其renderer的page.request监听不能单独证明所有主进程联网或HTTP监听行为。171须使用既有smoke-electron与明确离线启动/主进程无监听检查覆盖B28，不把这一个冒烟当成完整离线验收。

## Runner启动修复补充审核

首次启动在项目CommonJS下遇到top-level await编译错误，发生于输入凭据/调用接口之前。脚本现包入async main，顶层catch只输出固定脱敏失败消息；报告不通过时设置exitCode=1。独立通过Node24.18.0实际CLI检查空scope、畸形JSON、partial scope，均启动到credential-input-ready后exit1，stderr仅固定消息；没有真实凭据或真实接口请求，校验在环境读取/HTTP前结束。

补充发现与关闭：**P2，stdin EOF原先exit0，已修复。** 独立CLI在credential-input-ready后直接关闭stdin时，原readline.question保持未settle，Node自然退出exit0且没有固定失败消息。主代理已改为明确单行读取及close拒绝；独立再次检查上述三种输入及无输入EOF，共4项均exit1、固定脱敏消息一致，HTTP入口设禁止调用且路径未进入接口阶段。未提供真实凭据、未写测试报告或凭据文件。

**启动修复补充审核通过**：CommonJS实际启动成功，顶层错误不会输出原异常/输入；不通过报告设置非零退出码，输入EOF也明确失败。真实供应商结果仍由后续验收记录。

## 离线验收harness补充审核

新增harness在加载实际 `dist/main/index.cjs` 前安装Node HTTP/fetch与TCP守卫，并通过Worker execArgv的require将守卫传到服务线程；Electron net与defaultSession的HTTP请求也拦截。临时目录仅写守卫/入口脚本和固定事件记录，不含真实凭据。原生结果尚由主代理执行，本代理只审核脚本；`node --check scripts/smoke-byok.mjs`已通过。

补充发现与关闭：**P2，数字字符串TCP端口原可绕过，已修复。** 原守卫将任意string首参数当成Unix socket；独立只做Node24参数归一化，`net._normalizeArgs(['443','example.invalid'])`得到port/host选项而非path，因此此形式的connect/listen曾可绕过拒绝。主代理已按真实归一化后的options.path判断Unix路径，并在原生harness前增加六种TCP参数拒绝、Unix路径允许的preflight；preflight记录与正式验收记录分开，失败立即停止。

独立从当前脚本提取相同guard模板，在VM中以假的fs/底层socket/fetch执行（仅参数归一化使用真实Node实现）：connect/listen各数字、数字字符串、options共6种均拒绝且记录；2种Unix路径转发；2种HTTP/HTTPS fetch拒绝，本地data资源fetch允许。无实际网络调用或文件写入。再次 `node --check`通过。

**离线harness脚本补充审核通过**。Node HTTP/TCP守卫先于实际主入口，Worker显式require传递，Electron拦截先于主入口注册的whenReady启动回调；证据要求至少主/服务两次guard加载、零正式网络拒绝事件。正式Electron执行结果由主代理记录，本文不把脚本审核/VM契约检查冒充原生通过。放行本地资源fetch/Unix IPC符合离线运行目标。

另独立运行新增 `tests/integration/byok-runner.test.ts`：1项测试内EOF/畸形JSON/partial scope/重复scope四分支均通过，0失败/跳过；未输入真实凭据、未进入供应商请求阶段。

## 真实验收后增量补充审核

仅审核主代理指定的六类增量，未使用真实 Key 或发起供应商请求。当前增量结论：**通过**，下述两项已修复并独立复测关闭。

1. **P2：保存的 MiniMax 订阅配置被前置判断误拒绝（已关闭）。** 原 `testConnection` 在任何请求前依据 `op.subscription` 拒绝订阅型号。输入空 Key 复用保存配置时，`prepareAuthorization` 只建立 savedLease，而订阅类别要等首次 HTTP 的 keyFor 才确定，判断时仍为 undefined。独立受控复现：当前 enabled/authRevision=1 的 Preview 保存记录、主进程返回公开 sk-cp fixture、空 Key 草稿，结果 MODEL_UNAVAILABLE，Key 读取0次、HTTP0次。现提取 authorizedKey，在当前保存租约与操作有效性检查前后读取类别，再判断订阅权限；HTTP继续通过同一受保护读取。独立回归确认保存订阅 Key 只请求一次、保存普通 Key 零HTTP拒绝；读取期间删除/禁用/轮换均返回授权撤销，晚到 Key 不发请求或回显。新增禁用夹具最初未递增版本，被网关正确拒绝；已按真实授权变更规范递增版本后再次通过，未削弱断言。
2. **P2：目录模式忽略精确型号范围仍报告通过（已关闭）。** 原同时使用 `--catalog-only --models=does-not-exist` 时，目录模式在 matchedModels 记录前 continue，最终也跳过未匹配覆盖校验。独立将当时实际 runner 转换为 CJS 在 VM 执行，目录/报告写入替换为内存实现、真实 fetch 禁止：输出 requestedModelIds 包含不存在 ID、passed:true、exit0。现于请求前明确拒绝该互斥组合。实际 CLI 回归使用六个有效范围的公开 fixture 输入，exit1、固定脱敏错误、无case/complete成功证据；没有调用目录接口或生成报告。

其他增量已核对：MR45-06 保留原断言并恢复非空无映射 effort 的明确拒绝；credit_balance_exhausted 与 404 ModelNotOpen 分别映射额度不足/权限拒绝，输出固定错误；普通 MiniMax Key 的 Preview 为本地权限拒绝，未当作生成成功。已抽查7个关键 OpenAI ID 在生命周期合并之后仍保留 canonical 来源与 wire，Search alias 关联其已到期默认快照，gpt-4o 仅关联当前默认快照；153个公告日期均为有效日期。抽查公告日期与[官方 Deprecations](https://developers.openai.com/api/docs/deprecations)一致。

Cyber 的配置测试及实际 SDK 请求显式发送 `access_programs.cyber=daybreak_red`，保持原安全 fetch 链；实际 SDK 回归已通过。[官方 Daybreak 指南](https://developers.openai.com/api/docs/guides/daybreak)支持此显式选择，并说明 Red 型号省略时默认选择 Red，组织/项目访问仍须获批；[型号页](https://developers.openai.com/api/docs/models/gpt-5.6-cyber)明确独立批准与开通要求。参数注入不代表权限已获批准。

独立受控执行 `--providers=openai --models=gpt-4.1-mini`：配置1次、SDK1次、自定义0次，mode scoped；未匹配 ID 则 coverage/MODEL_NOT_IN_CATALOG、exit1且无生成。两次均使用实际 runner 控制流、内存目录/配置/SDK与报告替身，真实网络0次、证据文件写入0次，不能充当真实型号可用证据。

独立运行 Node24.18.0 的 byok-catalog/byok-sdk/byok-runner/model-defaults-review 四个测试文件：**27项通过，0失败/跳过**；`tsc --noEmit` exit0。主代理报告的此前全量1643项与原生8/11项属于验收阶段证据，本文未重填为本代理独立执行结果，增量修订后仍需按171记录最终验证。

两项修复后独立扩大至上述最初9文件并加入 byok-runner/model-defaults-review，共11个具体测试文件：**124项通过，0失败、0取消、0跳过**。再次独立 `tsc --noEmit` exit0，smoke-byok脚本语法检查通过。

已独立阅读164/166/168的本次尾部补充，与实现和受控用例一致：生命周期来源与默认快照精确关联、Cyber参数为官方支持的显式选择、保存订阅类别读取受授权保护、型号与目录模式互斥、明确范围重测保留历史记录。按主代理转述的用户调整，HTTP429保持实际失败并标本轮跳过，不能算可用成功；火山未开通正例仍待开通后验证，不能由404或代码审核替代。对应文档补充审核通过；正式真实接口/原生结果与剩余账户条件由171记录。

**真实验收后增量审核关闭，无剩余代码阻断。** 可以继续最终全量测试、构建及已授权范围真实复测；本结论不声明未开通或跳过的型号已经可用。
