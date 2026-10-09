# BYOK 官方目录与接口调研

日期：2026-10-09（Asia/Shanghai）。范围：12 家内置供应商的文本/文生图目录；按用户补充说明，真实逐模型验证先覆盖 OpenAI、DeepSeek、智谱、月之暗面、MiniMax、火山方舟，其余六家只做官网目录与适配核对。自定义配置在内置验证后执行。本文是调研结果，尚不声明验收通过。

## 现有实现与确定缺口

`desktop/shared/model-catalog.ts` 预填协议/地址，内置 UI 已隐藏这些字段；`desktop/main/model-configuration.ts` 负责内存草稿发现与单模型测试，`src/lib/ai/provider.ts` 负责真实生成 SDK。发现/测试均不保存配置，编辑模型保持手动保存。真实 Key 不得进入文件、日志、截图或测试证据。

现有智谱、MiniMax 默认国际站与本轮中国站 Key 不匹配。智谱/MiniMax/火山使用静态目录且不验证目录认证；DeepSeek 依赖并非必有的 `output_modalities`；OpenAI 精确分类漏了官网明列的版本快照，且所有文本都走 Chat Completions，Responses 专属模型会失败。模型测试统一 256 token 会把思考耗尽预算误判为接口不可用。错误没有区分余额/额度、限流、型号不支持和生成截断。官网目录、Key 可列出、逐型号生成成功必须分别记录。

## 六家官方目录与调用规则

| 供应商 | 目录与官网来源 | 端点/适配结论 |
| --- | --- | --- |
| OpenAI | [完整模型目录](https://developers.openai.com/api/docs/models/all)、各型号页的 Snapshots / Endpoints；[GET models](https://developers.openai.com/api/reference/resources/models/methods/list) | `https://api.openai.com/v1`，Bearer；目录含音频/向量/审核/已退役，不能全部放入文本选择器。按各型号官方端点自动选择 Chat 或 Responses；[GPT-5.5 Pro](https://developers.openai.com/api/docs/models/gpt-5.5-pro) 等需 Responses。图片使用 Images API。 |
| DeepSeek | [模型与定价](https://api-docs.deepseek.com/quick_start/pricing/)、[Models API](https://api-docs.deepseek.com/api/list-models/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/) | `https://api.deepseek.com`，OpenAI 兼容。当前官方文本 ID `deepseek-flash`、`deepseek-v4-pro`；旧 Flash 名为别名，chat/reasoner 已公布退役。不能因 `/models` 无模态字段过滤全部结果。 |
| 智谱 | [全部模型](https://docs.bigmodel.cn/cn/guide/start/model-overview)、[OpenAI 兼容](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)、[图像](https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image) | 中国站 `https://open.bigmodel.cn/api/paas/v4`；保留原国际站旧记录。官网文本包含 5.3/Flash/FlashX、5.2、5.1、5、5-Turbo、4.7/Flash/FlashX、4.6、4.5/Air/AirX/Flash、4-Long、4-Flash(X)-250414；视觉文本包含 5V-Turbo、4.6V/Flash、4.1V-Thinking-Flash(X)、4V-Flash。手机/OCR/音频不作为通用写作模型。图片：GLM-Image、CogView-4、CogView-3-Flash。型号精确 ID 以各自 API 页为准。 |
| 月之暗面 | [官方 OpenAPI](https://platform.kimi.com/docs/openapi.json) | `https://api.moonshot.cn/v1`；当前目录四个文本型号：`kimi-k3`、`kimi-k2.6`、`kimi-k2.7-code`、`kimi-k2.7-code-highspeed`。目录返回 `context_length` 和输入/思考标记；支持图像输入不等于文生图。 |
| MiniMax | [OpenAI 接口](https://platform.minimax.cn/docs/api-reference/text-openai-api)、[订阅接入其他工具](https://platform.minimax.cn/docs/token-plan/other-tools)、[文生图](https://platform.minimax.cn/docs/api-reference/image-generation-t2i) | 中国站 `https://api.minimax.cn/v1`，原 `api.minimaxi.com` 仍可达；国际 `api.minimax.io` Key 不通用。文本：M3.1-Flash-Preview、M3、M2.7/2.5/2.1 及各 highspeed、M2；Preview 仅 M Plan/官方应用提供，需单独确认权限。图片 `image-01`，`/image_generation`。思考 token 计入输出上限，M2.x 不能关闭思考。 |
| 火山方舟 | [官方模型表](https://docs.volcengine.com/docs/ark/model-list?lang=en)、[文本调用](https://docs.volcengine.com/docs/ark/text-generation?lang=en)、[退役公告](https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh) | `https://ark.cn-beijing.volces.com/api/v3`；Bearer API Key 的 `/models` 实际可用，返回 `modalities`、`task_type`、`token_limits`。目录还包含历史下线型号，仍需与当前官网表/退役公告校对；不能将该接口当账户接入点管理 API。文本当前表含 Seed Evolving、2.1 Pro/Lite/Turbo、2.0 Lite/Mini、Character、Translation、GLM 与 DeepSeek 托管模型。图片含 Seedream 5.0 Pro/Flash/原版、4.5、4.0。需区分 TextToImage 与仅图像编辑。 |

OpenAI 当前普通文本基线：GPT-6 Astra、6.1 Sol、6 Luna、6 Sol、5.6 Sol/Terra/Luna、5.5/Pro、5.4/Pro/Mini、5.2/Pro、5/Mini/Nano/Pro、o3/Pro、4.1/Mini、4o/Mini；逐型号页补齐精确快照。官网已标 Deprecated 的型号保留既有记录但不作为新配置推荐；实际下线按 `shutdown_date` 判断。图片包括 Image 2.5 Sunburst/Flare 和各官方快照、Image 2，以及仍可调用的旧图像模型。上下文、思考默认值与接口能力只录入官网或接口明确返回的数据。

独立审核补充：GPT-5.5 Pro 官方页明确不支持 streaming，并提示请求可能耗时数分钟；仅换 Responses 路由不足以让真实 Chat 流程可用，技术方案必须处理非流式生成到现有流式消费者的适配与超时。MiniMax 当前订阅接入页明确推荐 `MiniMax-M3.1-Flash-Preview`，M3/M2.7 的402不能代表该订阅型号失败，应先补测这个精确型号。

## 其余六家官网核对

| 供应商 | 官方来源 | 目录实现边界 |
| --- | --- | --- |
| Anthropic | [模型总览](https://platform.claude.com/docs/en/models/overview)、[Models API](https://platform.claude.com/docs/en/api/http/models) | `/v1/models` 分页，Messages 协议；当前 Fable 5.1、Opus/Sonnet/Haiku 5.5；使用 API 能力字段，不从名称猜思考档位。 |
| Google | [模型总览](https://ai.google.dev/gemini-api/docs/models)、[Models API](https://ai.google.dev/api/models) | 文本 3.8/3.7/3.6/3.5 Flash、3.5/3.1 Flash-Lite、3.1 Pro Preview、3 Flash Preview及 2.5；Nano Banana 等图片与音频/视频分开。完整分页，未知未来 ID 保留未知，不假报完整。 |
| xAI | [目录](https://docs.x.ai/developers/models)、[Models REST](https://docs.x.ai/developers/rest-api-reference/inference/models) | `/language-models`、`/image-generation-models` 按接口类别；Grok 4.7、Imagine Image 2.0 等由实时目录取得，包含别名。 |
| Xiaomi | [Models API](https://mimo.mi.com/docs/en-US/api/model/list-models) | MiMo 2.6 Flash/Pro/Pro-Ultraspeed、2.5/Pro；同目录 ASR/TTS 均排除。支持 Bearer 或 api-key；普通文本 OpenAI 兼容。 |
| 阿里巴巴 | [查询模型](https://help.aliyun.com/zh/model-studio/list-models)、[端点](https://help.aliyun.com/en/model-studio/base-url)、[图像模型](https://help.aliyun.com/zh/model-studio/image-model) | 官方目录按能力分页，官网最新北京目录需业务空间域名；现有固定默认目录不能保证适用所有空间。未提供 Key 的本轮记录此限制，不能宣称真实通过；自定义支持显式空间地址。 |
| 腾讯 | [TokenHub API](https://cloud.tencent.com/document/product/1823/130078)、[图像调用](https://intl.cloud.tencent.com/zh/document/product/1300/83708) | 实时 `/v1/models`，status online/pre-offline；按官网精确型号分类；文本与国际图像站 Key/地域不混用。当前表与本地多数已对齐。 |

Google 官方还明确 Gemini 2.5 Flash/Flash-Lite/Pro 只向过去活跃使用它们的用户开放；新 Key 可能没有权限，未退役不能推导任意 Key 可调用。

## 已执行真实初检（仅脱敏结果）

通过临时 Node 进程执行 HTTPS GET/最短 POST，直接提供的 Key 从关闭回显的标准输入进入内存；环境变量在进程内读取。未保存 Key 或原始响应。官网 Markdown 不被网页检索器支持时，以无 Key 的 HTTPS fetch 读取，未把页面导航当模型表。

| 供应商 | 本次结果 | 证明范围 |
| --- | --- | --- |
| OpenAI | GET models HTTP 200，含型号与 shutdown_date | 认证与目录可读，尚未逐模型验证 |
| DeepSeek | 前两个凭据401；用户随后更新的凭据 GET models 200，`deepseek-flash` / `deepseek-v4-pro` POST均200且有效文本 | 最新凭据与两个官方型号均可调用；环境变量仍是旧凭据，本轮仅内存使用新凭据 |
| 智谱 | 中国站 GET models 200（11 项），glm-5.3 POST 200 且有有效文本；glm-4.7-flash 429/1305 | 最新模型可调用；免费型号当前请求受限，其他型号待验证；GET目录未列全部官网型号 |
| 月之暗面 | GET models 200（4 项），kimi-k3 POST 200 且有效文本 | 目录与单项可用 |
| MiniMax | 中国站/原中国域名 GET models 200（8项）；中国站 M3、原中国域名 M2.7 POST 402；订阅页推荐的 M3.1-Flash-Preview 也402，脱敏错误归类为 balance；国际站401 | Key 属中国站；三个已测组合均失败，Preview亦失败；其他型号尚未逐项测，不能靠静态列表报成功 |
| 火山方舟 | GET models 200；抽查返回明确文本/图片模态、TextToImage 与 token_limits | 目录元数据可读，尚未逐模型验证 |

## 实施建议与未解项

公开型号能力表集中维护，区分官方目录候选、Key 实时列出、逐型号验证；保留来源与核验日期。新配置选内置供应商只填 Key/选型号，协议与请求形状自动适配；现有模型不偷偷改地址。修正中国站预设，允许明确列入白名单的原官方地址继续编辑。发现不自动产生付费生成；用户主动测试单项，验收 runner 才按本轮已授权范围逐项调用。

后续用户更新 MiniMax 常规 API 凭据：中国站 GET200，M3 POST200且有效文本，Preview POST400。旧订阅凭据的402不能套用新凭据，Preview仍需按官网订阅权限区分。DeepSeek 最新凭据已解除认证问题；后续仍完成所有不依赖 MiniMax 余额/额度的文档/实现/用例。全量测试证据要逐模型列出结果，失败/未执行不能计为通过。自定义需 OpenAI 与 Anthropic 两种协议、指定 URL/型号、真实成功/失败/取消、手动保存；不用跨供应商探测 Key 来猜协议。

后续凭据复测（2026-10-09）：新的 MiniMax 常规 API Key 已解除 M3 调用的余额问题；公开 Preview 仅 M Plan/Code，普通 API Key 拒绝该型号不证明 M3 不可用。完整逐型号验证仍待实施后执行。

代码审核补充官网约束：OpenAI 能力出现跨页别名时，精确型号自身页优先；[gpt-oss 官方说明](https://help.openai.com/en/articles/11870455-openai-open-weight-models-gpt-oss)明确开放权重模型不由 OpenAI API 托管；[Instruct](https://developers.openai.com/api/docs/models/gpt-3.5-turbo-instruct)仅旧版 Completions，computer-use 为设备控制专用，均排除内置通用文本选择。[MiniMax 接口](https://platform.minimax.cn/docs/api-reference/text-openai-api)明确 Preview 五档 low/medium/high/xhigh/max，默认 max；Preview/M3 上下文 1,000,000，M2.x 204,800，普通 M3/M2 不猜额外强度。[Xiaomi Models](https://mimo.mi.com/docs/en-US/api/model/list-models)的语音克隆/声音设计两型号也属于 OTHER。

## 逐模型验证后的官网复核与用户范围调整

OpenAI 官方 [Deprecations](https://developers.openai.com/api/docs/deprecations) 的 153 个精确 ID/UTC 日期纳入公开生命周期表；结合每型号 canonical 页的 default Snapshot，使仍在 GET 中但已关闭的搜索别名也被排除。未来下线型号保留日期提示，已 Deprecated 且未在当前 Key 目录出现的候选不新增推荐。日期与 snapshot 不按前缀推断。[Daybreak 官方帮助](https://help.openai.com/en/articles/20001259-openai-daybreak-common-issues-and-troubleshooting)说明 Cyber 需组织/项目独立获批；应用自动显式发送官方支持的 `access_programs.cyber=daybreak_red` 选择参数，目录出现与参数正确均不能代替获批。

首次完整批次中，DeepSeek、Kimi、MiniMax 常规型号全部真实通过；OpenAI 与部分智谱型号返回 HTTP 429。用户明确允许本轮跳过 HTTP 429：仅免除对应真实正例的本轮通过要求，保留实际失败及跳过状态，不算模型可用成功。MiniMax 常规 Key 的 Preview 已被真实端点拒绝，界面及配置短测提前按官方订阅限制拒绝；编辑时从当前有效保存授权识别凭据类别，读取前后检查撤销，不保存新凭据。

火山 20 个文本、3 个图片型号尚未开通；其余 3 个图片型号已实际生成并解码通过。[官方开通管理](https://docs.volcengine.com/docs/ark/activation-management?lang=zh)说明模型调用权限需账户开通。用户选择“开通后继续验证”，这些正例保持待验证，不能按 404 跳过；配置端将官方 `ModelNotOpen` 归为权限不足。管理面需要另外的 IAM 权限，本轮 inference API Key 不用于擅自修改账户开通状态。实际批次与重测证据详见 171。

最终账户条件复核：用户允许 Cyber 本轮跳过；火山确认开通后重测未通过，用户换新 Key 再测完整目录，仍只有3图片双阶段成功。额外内存诊断确认新旧 Key 对同一当前文本型号返回 ModelNotOpen，错误中的账户字段相同，仅记录比较布尔值，不保存字段。官方错误码说明它是对应账户模型服务未开通；需核对 Inference 服务/审批生效状态，不能以更换同账户Key代替服务开通。逐项数据见171，当前不宣称火山全部可用。

最终用户范围：火山“跳过没开通的模型，只测开通的”。剩余23个候选保留真实失败并本轮跳过；已经成功的3个图片型号使用最新Key再次通过。按调整范围验收，不宣称全候选可用。
