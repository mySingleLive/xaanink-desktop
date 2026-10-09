# BYOK 技术方案

日期：2026-10-09。前置产物：164 调研、165 独立审核通过。本方案先接受独立审核，再制定用例与 TDD 实现；不以初检代替最终验收。

## 范围与结果

完善 12 家内置供应商的官方目录。按用户补充范围，对 OpenAI、DeepSeek、智谱、月之暗面、MiniMax、火山进行逐型号真实验证，其余六家核对官方目录、分类和接口契约。内置配置只填 Key、选择型号；现有单选、手动保存和主进程 Key 授权保持不变。内置测试完成后验证自定义 OpenAI/Anthropic 文本、OpenAI 图片配置。

## 目录与公开能力数据

新增公开能力模块，记录精确型号/快照 ID、来源 URL、核验日期、类别、官方明确的容量/思考选项、Chat/Responses 端点和 streaming 支持。OpenAI 从官网各型号页提取精确 Snapshots，禁止前缀、日期或微调名猜测。仅音频、嵌入、审核、视频、OCR、设备控制及仅图像编辑不进入通用文本/文生图选择器。已下线型号排除新选项，既有保存记录仍可编辑；Deprecated 但尚未下线的型号说明生命周期限制，不能宣称永远可用。

认证成功的实时目录与官网候选合并、去重；官网有但 Key 未列出的型号保留 `permission: unknown`，实时列出为 `listed-unverified`。这两者均不等于生成通过。未知未来型号保留 `unknownCapabilityIds` 和不完整提示，官方已明确 OTHER 类型不误报未知。分页/数量/响应大小与冲突边界继续严格检查；401/403/402/429 不转换为静态成功，也不自动跨地域发送 Key。

智谱和 MiniMax 改为中国站新配置默认；只允许精确白名单的既有国际站/旧中国域名继续编辑测试，不迁移或改写用户保存配置。智谱、MiniMax 先 GET `/models` 验证认证，再合并完整官方候选；MiniMax Preview 标明订阅访问；官网明确 sk-cp 为订阅凭据，常规 Key 未实时列出的订阅限定型号展示为不可选的权限说明，不能把它当普通 API 可用型号；Key前缀仅用于官网订阅分组，实时目录与实际拒绝仍单独记录，不据前缀推断已授权。真实验收另含订阅限制的预期拒绝测试。火山改为真实 GET `/models`，结合官方当前表及返回的 `modalities`、`task_type`、`token_limits`；历史 ID 不能因返回模态就重新推荐。DeepSeek 无模态时只对官网精确两个当前 ID 补充类别。月之暗面读取 context_length 与明确 effort，视觉输入不改变输出类别。

其他六家保留已有实时分页适配，补齐公开精确目录/限制：Anthropic 能力字段；Google 2.5 历史账户限制；xAI 分类接口和别名；Xiaomi 2.5 与 ASR/TTS 排除；阿里业务空间/地域限制和文生图分类；腾讯在线/将下线状态及官方完整类别。未提供 Key 的范围只记录官网/契约验证。

## 自动请求适配与实际生成

公开能力模块同时用于配置短测和 `src/lib/ai/provider.ts`。OpenAI Responses 专属型号，以及官网明确 Chat 不支持工具的 GPT-6.1 Sol，自动使用 SDK `.responses()`；其他支持 Chat 的现有型号继续 Chat。对官网明确不支持 streaming 的模型使用 AI SDK `wrapLanguageModel` / `simulateStreamingMiddleware`：实际网络请求为非流式生成，真实输出转换为现有流式消费者事件，保留文本、思考、工具调用、finishReason、usage。在此模型之上保留现有工具兼容包装。模拟事件外层使用 highWaterMark:0 的按需读取 guard：读取前后检查 AbortSignal，并经新增主进程 model.assert 验证 snapshot.authRevision，响应已读完但尚未消费时的取消/禁用/删除/换 Key 均不得输出文本或工具事件；不重复付费。

配置短测总输出预算固定为2048，已知 maxOutputTokens 较小时裁剪为 min(maxOutputTokens,2048)，自定义未知容量默认1024；预算包括思考，不用最终答案上限冒充总限。按官方可用最低 effort 或关闭思考（仅官方明确允许时）构造请求。OpenAI Responses 使用 input/max_output_tokens/store:false/background:false；Chat 根据型号年代/文档用 max_completion_tokens 或 max_tokens。M2.x 不能关闭思考，Preview 使用受支持的 effort；Kimi/DeepSeek/GLM/Ark 不发猜测参数。响应 `length`/incomplete(max_output_tokens) 返回独立截断错误，不能因少量输出宣称成功；不自动重复付费。Pro 非流式长请求采用有界五分钟短测超时，实际工作流使用现有可配置响应超时；取消/授权撤销贯穿等待和读取。

图片保留每供应商官方最小一次/一张参数，补齐精确新型号；OpenAI 文生图支持具体图像快照，智谱增加官网 CogView-3-Flash。真实验收同时检查实际图片下载/解码或内联图片解码成功，不能只靠 URL 格式计为图片可用。

## 错误与 UI

增加余额/额度不足、限流、型号不可用、输出截断的固定脱敏错误码与中文消息；处理 HTTP 非成功和 HTTP200业务错误，不传递原始响应/错误/请求 ID/Key。已有401/403/网络/超时/取消保持区分。配置结果只返回数字 usage 与型号、时间、单型号范围。

复用真实 `ModelConfigurationDialog`：展示目录 warnings 和候选权限说明，生命周期/订阅提示由公开元数据提供；只需 Key 的内置字段继续隐藏协议/地址；选择型号仍单选、保存仍人工触发。发现/测试不写仓库，切换供应商/地址取消旧结果、清理 Key 授权。默认无模型，不添加平台回退或 HTTP 服务。

## 测试与证据

先写用例文件与失败的回归测试，再实现。单元覆盖目录精确快照、所有供应商分类/权限、旧地址、新错误、预算、取消/超时/撤销/边界。真实 SDK 集成覆盖 Responses 非流式转换、Chat 流式、文本/工具/usage 和取消。Electron 真实设置冒烟覆盖默认参数、仅 Key、单选、发现不保存、错误显示、自定义两协议和加密保存（仅假测试 Key）。全量既有 unit/integration、typecheck、build 及相应原生冒烟均执行。

新增真实验收 runner：Key 仅关闭回显的 stdin 或进程环境变量进入内存；不写配置、临时凭据、原始响应或截图。使用生产配置服务/SDK/图片解码路径与内存仓库。按供应商、型号串行执行，每型号的配置短测与生产SDK两个阶段各一次，maxRetries:0，不自动重试付费失败；先对六家所有返回候选逐项测试，保留型号、来源、类别、HTTP/固定错误码、时间、有效文本/图片布尔值、数值 usage。明确失败/未执行。内置批次结束后才进行自定义真实测试；自定义 Anthropic 使用已授权六家中官方明确支持 Messages 的端点，不借用无 Key 的 Anthropic 账户。不提供生产 fallback。

验收文档逐条映射用例编号、命令与脱敏证据，并追加 requirements-traceability/migration-map，不覆盖已有独立 UI 修改。用户已补充 MiniMax 常规 API Key 并通过 M3 初检；其余逐项结果尚待执行。不减少候选集合来制造全通过，未解除时必须保留实际失败并完成其他工作。

## 实施文件边界

生产：`desktop/shared/model-catalog.ts`、新增公开能力模块、`desktop/main/model-configuration.ts`、`desktop/main/model-provider-adapters.ts`、图片协议的必要精确 ID、`desktop/main/model-service.ts` / `desktop/service/models.ts` / worker dispatch 的只读授权断言、`src/lib/ai/provider.ts`、`src/lib/ai/thinking-effort.ts`、`src/components/desktop/ModelConfigurationDialog.tsx`。

验证：BYOK 单元/集成用例、已有相关用例修订、新真实验收 runner/必要原生冒烟、164—172阶段文档及验收台账。复用现有权限网关、Key 仓库与组件，不改 unrelated ContentTabs 等修改。

## 验收门槛

研究/方案/用例/代码各独立审核关闭问题后才进入下一阶段。所有用例覆盖执行后区分自动契约、真实目标系统和外部失败；六家纳入当前凭据可用清单的逐模型正例与自定义真实证据全部成功；已明确权限限定候选单独记录不可用/需订阅，其预期拒绝只证明权限用例，不充当模型可用成功；回归/构建通过，才能声明全部验收通过。

## 实际接口反馈后的补充方案

新增官方精确生命周期 JSON，按 UTC 日期及 canonical default Snapshot 合并，不让别名覆盖本页能力；已到期搜索别名剔除，未来日期提示，未列出的 Deprecated 候选不新增。Cyber 配置短测与生产 SDK 都显式发送官方支持的 Daybreak Red 参数，同时展示独立账户授权说明。MiniMax Preview 在发付费请求前检查当前授权凭据类别；保存 Key 复用的读取前后检查租约，轮换/禁用/删除的晚读结果不发请求。

真实验收脚本增加显式供应商/型号范围重测，scope 写入报告；不存在型号覆盖失败，目录模式与型号模式互斥，空报告不通过。历史证据不覆盖。离线原生 harness 在主进程/worker/renderer 阻断 HTTP/TCP，允许真实 Unix 服务 socket，并以规范化临时根路径启动。基础桌面脚本用现有目录未绑定的 Ctrl+Alt+Shift+F8，保持原焦点断言。

用户允许 HTTP429 本轮跳过，其实际失败和未证明可用状态仍逐项列明；火山未开通型号待账户开通后继续真实测试。最终验收门槛按此明确授权调整，其余失败不自动豁免。

最终用户范围调整：火山仅验收已开通型号，剩余23个本轮跳过并保留失败证据；其余既有HTTP429及Cyber豁免保持。最新凭据的已开通图片仍逐型号配置/生产解码验证，不用跳过替代开通型号通过。
