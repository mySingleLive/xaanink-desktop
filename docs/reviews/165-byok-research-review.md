# BYOK 调研独立审核

日期：2026-10-09（Asia/Shanghai）。审核对象：`docs/reviews/164-byok-research.md`。结论：**通过调研阶段审核**。初审发现的三项问题已补充并完成复审，可进入技术方案阶段；本审核不构成真实接口验收通过。

## 审核方法与范围

独立阅读调研文档及其明确引用的 `desktop/shared/model-catalog.ts`、`desktop/main/model-configuration.ts`、`src/lib/ai/provider.ts`；核对官方公开模型目录和调用文档。未读取、复制、保存或使用用户 API Key，未执行任何认证请求。调研中的真实初检结果属于主代理执行证据，本次只审核其证明范围，未独立复测。

官方页无法由网页工具提取时，通过无认证 HTTPS 获取官方 Markdown；未保存页面原文。已核对 OpenAI、DeepSeek、智谱、月之暗面、MiniMax、火山方舟，以及其余六家供应商的主要目录结论。

## 初审发现与复审处置

### R1 / P1：补录 Responses 专属模型的非流式与长请求约束

位置：调研 OpenAI 行及实施建议。GPT-5.5 Pro 官方页明确不支持流式输出，并说明请求可能耗时数分钟，建议使用 background mode。初稿只要求根据型号自动选 Chat 或 Responses；仅调整路径仍不足以证明该模型可以用于实际写作流程。[官方型号页](https://developers.openai.com/api/docs/models/gpt-5.5-pro)

本地 `src/lib/ai/provider.ts` 当前统一为 OpenAI 创建 `.chat()` 模型，`desktop/main/model-configuration.ts` 的短测则使用 `stream: false`。短测成功不能验证实际生成所使用的流式路径。复审确认新增“独立审核补充”明确记录非流式、长耗时和真实 Chat 消费者适配，**R1 已关闭**。下一阶段公开能力表与方案需落实流式支持、非流式生成、取消/超时策略；其他 Pro 型号也须按各自官网页核对，不能由同系列名字推定。

### R2 / P2：Google 2.5 目录遗漏历史账户访问限制

位置：调研 Google 行。Google 当前模型总览分别在 Gemini 2.5 Flash、Flash-Lite、Pro 下说明：访问限定于过去活跃使用这些型号的用户，型号尚未退役；新项目应使用当前推荐型号。复审确认其余六家表后已补录此权限限制，继续区分官网存在、Key 列出和 Key 实际有权限，**R2 已关闭**。[官方模型总览](https://ai.google.dev/gemini-api/docs/models)

无 Google Key 的本轮可完成官方目录与限制记录，不能据此宣称任意新 Key 可调用 2.5。

### R3 / P2：MiniMax 402 证据须明确到已测试型号与套餐

位置：调研 MiniMax 行、真实初检及未解项。初稿证据仅涉及 M3、M2.7 的生成失败。MiniMax 官方订阅接入文档明确为订阅 Key 推荐 `MiniMax-M3.1-Flash-Preview`，OpenAI 兼容地址为 `https://api.minimax.cn/v1`；接口文档也明确 Preview 暂时通过 M Plan 和 MiniMax Code 提供。[订阅接入文档](https://platform.minimax.cn/docs/token-plan/other-tools)、[OpenAI 兼容接口](https://platform.minimax.cn/docs/api-reference/text-openai-api)

复审确认主代理已补测该精确 Preview 型号，新增记录为 HTTP 402、脱敏错误类别 balance；证明范围明确为三个已测组合失败，其他型号仍未逐项验证。文档没有推广为全供应商不可用，也没有将失败/未执行计为通过，**R3 已关闭**。普通 API 与订阅权限仍需在下一阶段目录、测试证据中分别记录。

## 已确认的正确边界

- 用户补充范围得到落实：六家先真实逐型号验证，其余六家完善官网目录，自定义配置后验收。
- OpenAI 官网目录确有对应文本基线及图片类别；Snapshots 应用精确 ID，不能用前缀或日期猜测能力。GPT-5.5 Pro 需 Responses 的结论成立。
- DeepSeek 官方当前 ID 为 `deepseek-flash`、`deepseek-v4-pro`，旧 Flash 名可继续作为别名；认证 401 不能转换为目录可用或模型可用。[官方模型与定价](https://api-docs.deepseek.com/quick_start/pricing/)
- 本地预设确实将智谱指向 `api.z.ai`、MiniMax 指向 `api.minimax.io`；本轮中国站预设修正及保留旧记录的建议合理。MiniMax 中国站地址和 Preview/M2.x 思考限制由官网直接支持。
- 月之暗面官方 OpenAPI 与四个文本 ID 相符；视觉输入能力不能等同于文生图能力。[官方 OpenAPI](https://platform.kimi.com/docs/openapi.json)
- 火山目录和退役公告均需参与分类；模型表区分文本生成和图像生成，最新 Seedream Pro/Flash 可文生图。[官方模型表](https://docs.volcengine.com/docs/ark/model-list?lang=en)
- Anthropic、Google、xAI、Xiaomi 目录结论与官网相符；Xiaomi 目录中的 ASR/TTS 应排除。阿里北京查询接口确要求业务空间域名且分页；腾讯目录状态含 `online`、`pre-offline`。[阿里查询模型列表](https://help.aliyun.com/zh/model-studio/list-models)、[腾讯 TokenHub API](https://cloud.tencent.com/document/product/1823/130078)
- 文档明确区分认证、目录读取、单型号生成和全目录验收。401、402、429、未执行均未被计为真实通过，符合用户要求与仓库验收边界。

## 后续验收限制

最新调研记录中，DeepSeek 新凭据已完成目录读取与两个官方文本型号的有效输出；旧环境变量仍为失败凭据，主代理仅在内存中使用更新凭据。MiniMax 三个已测组合仍为 402，其他模型仍待完整验证。这些记录作为主代理真实初检证据接受，其证明范围未扩大；审核代理未独立认证复测。

下一阶段方案与测试用例须追踪 R1—R3 的约束，并继续逐型号保留脱敏成功、失败、未执行记录。必须等待全部所需用例与真实目标系统验证完成，才能形成最终验收结论。
