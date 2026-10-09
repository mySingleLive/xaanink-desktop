# BYOK 测试用例与执行映射

日期：2026-10-09。前置：164/165调研通过、166/167方案通过。本文经独立审核后进入 TDD；测试未执行时不填写通过。

## 方法与证据边界

U=单元/受控接口契约，I=真实 SDK 集成，N=真实 Electron UI（隔离数据、假 Key），R=授权官网真实接口（真实 Key 仅内存）。U/I 的受控响应不计为真实供应商通过，N 不计为逐型号调用。真实批次串行、每型号配置短测与生产SDK两个阶段各一次、无自动付费重试。新错误修复后允许明确记录的重测；失败/未执行仍逐项保留。非提供 Key 的六家仅官网/契约核对。

| ID | 层级 | 前置/操作与明确预期 | 执行入口/证据 |
| --- | --- | --- | --- |
| B01 | U/N | 12家文本/允许的文生图预设；智谱/MiniMax中国站默认；内置界面仅Key和单选型号，无协议/地址字段；新配置无Key不可发现；编辑已有同范围有效授权可留空复用，无默认模型 | byok回归、model-settings、原生smoke-models |
| B02 | U | OpenAI官网精确alias/dated Snapshots分类，返回来源/容量/effort；未公开未来/微调ID不按前缀猜；OTHER不误放文本/图像 | byok回归、官方公开能力JSON |
| B03 | U | OpenAI shutdown_date已过排除，未来下线/Deprecated仍带限制；未列出官网候选为unknown，实时列出为listed-unverified，不等于verified | byok回归 |
| B04 | U | DeepSeek两个精确当前ID无模态字段也归文本；未知ID无字段仍unknown；旧退役别名不作为新推荐 | byok回归 |
| B05 | U | 智谱认证GET后合并完整文本/视觉输出文本/三图片官方ID；5.3Flash/FlashX、5Turbo、Long、旧Flash补齐；OCR/手机/音频不进入 | byok回归 |
| B06 | U | MiniMax认证GET后合并9文本/1图片；普通Key未列Preview不可选并提示订阅；sk-cp订阅候选权限未知，不假称调用成功 | byok回归 |
| B07 | U | 火山GET目录解析modalities/task_type/token_limits；仅当前官方ID推荐；历史/音频/视频/仅编辑排除、未知能力保留；不调用管理面 | byok回归、model-configuration-providers |
| B08 | U | Kimi四ID、context_length、K3官方effort/default；视觉输入仍仅文本输出 | byok回归、model-configuration |
| B09 | U | Anthropic分页/capabilities、Google分页与2.5账户限制、xAI分类接口/别名、Xiaomi5个文本且排除ASR/TTS、阿里按能力/编辑排除、腾讯完整类型/状态 | 既有model-configuration/providers/review及新增byok回归；官网来源 |
| B10 | U | 401→AUTHENTICATION_FAILED、403→PERMISSION_DENIED目录失败，无官网静态成功替代；402/官方额度码→QUOTA_EXCEEDED、429→RATE_LIMITED、404/官方不存在型号码→MODEL_UNAVAILABLE、HTTP200业务错误→相应固定码或HTTP_ERROR；服务端回显Key不泄漏 | byok回归及既有review |
| B11 | U | 单页/分页去重与冲突、循环游标、页数/模型数/响应字节边界、空/畸形JSON失败；不返回伪完整截断目录 | 既有配置安全/分页用例及byok回归 |
| B12 | U | 合法旧国际/中国域名保留；相似域名/任意路径/非自定义错误协议拒绝；保存范围变化需新Key；不跨站探测 | byok回归、既有配置/仓库/网关 |
| B13 | U | OpenAI Responses专属与GPT6.1Sol路由正确，store/backgroundfalse；普通Chat路由；字段max_output_tokens/max_completion_tokens/max_tokens按官方；固定2048、min(已知max,2048)、自定义未知1024 | byok回归、配置providers |
| B14 | U | 按官方最低effort或明确允许关闭；M2.x不关闭思考；未知模型不猜思考；finish_reason:length 或 stop_reason:max_tokens / Responses status:incomplete+reason:max_output_tokens → OUTPUT_TRUNCATED，部分文本不能通过，无第二次POST | byok回归 |
| B15 | U | 一次/一张官方图片参数；GLM/CogView3/4、MiniMax image01、OpenAI快照与Ark当前文生图；无隐式多图/下载外站带Key | 配置providers、image-generation、image-provider-protocols及byok回归 |
| B16 | U | 未authorizeCharge不发送；发现/测试不保存、仅单型号结果；usage仅非负数字，无输出/Key/原始错误 | 既有配置安全及byok回归 |
| B17 | U | 取消等待/读流、超时、owner关闭、换Key/禁用/删除撤销、忽略AbortSignal的fetch晚结果、操作上限与重复ID均不晚发送/回显 | 既有configuration-cancellation/review等 |
| B18 | I | 生产SDK GPT5.5Pro实际只1次非流式Responses，映射文本/思考/工具/finish/usage；GPT6.1Sol工具走Responses；其他Chat流式保持 | 新byok-sdk集成、既有local-model-generation |
| B19 | I/U | 非流式网络等待中取消；已读完响应尚未消费时取消；各自不得输出文本/工具，fetch仅一次 | byok-sdk集成 |
| B20 | I/U | 完成后消费前换Key/禁用/删除：model.assert拒绝旧authRevision，按需guard无文本/工具事件，不发重复生成 | byok-sdk集成、model-service授权断言 |
| B21 | U/N | warnings/权限/订阅/生命周期提示可见；单选、切Key清旧目录/测试结果、关闭取消；只点击保存才持久化，假Key加密且公共快照无Key | model-settings、原生smoke-models及BYOK补充 |
| B22 | R | 六家真实目录均认证成功；记录官网候选/实时列出/禁选订阅等状态与来源，未执行不计通过 | verify-byok runner、real-catalog证据 |
| B23 | R | 六家每个可选择文本候选实际短测+生产SDK生成有效非空文本（非流式通过实际桥接消费）；各自保存HTTP/固定code/数值usage，任何失败单独列出 | verify-byok逐型号结果 |
| B24 | R | 六家每个文生图候选的配置短测与生产图像生成两个阶段各一次、每次一张；配置短测响应格式校验，生产生成用于解码证明；生产路径下载/内联解码得到合法PNG/JPEG/WebP字节和维度；格式URL/无图片不算成功 | verify-byok逐图片结果 |
| B25 | R | MiniMax普通Key对官网订阅Preview的限制真实验证，预期拒绝且不可作为可用选项；不把拒绝计为可用模型通过 | verify-byok限定访问结果 |
| B26 | R | 内置批次结束后，自定义OpenAI文本（显式URL/ID）真实有效输出；自定义Anthropic Messages使用六家官方支持端点真实有效输出；自定义OpenAI图片生产解码成功 | verify-byok custom批次与时间顺序 |
| B27 | U/R | 自定义OpenAI对官方OpenAI端点发送固定无效测试Key，预期401/AUTHENTICATION_FAILED；有效Key请求明确不存在的 byok-model-does-not-exist，预期404/MODEL_UNAVAILABLE且固定脱敏；loopback HTTP仅显式自定义，非loopbackHTTP/越范围redirect拒绝；自定义取消/超时/不支持图片协议不保存不泄Key | 既有网关/配置用例、verify-byok必要真实负例 |
| B28 | 全量 | 所有unit/integration、typecheck、production build和相关原生冒烟通过；正常产品无HTTP监听/平台fallback/联网启动 | npm test/typecheck/build、smoke-models、smoke-electron及离线启动检查 |
| B29 | 证据 | 不存任何真实Key；隔离测试目录；runner不调用saveModel，证据白名单字段且检验不含内存凭据；台账逐条映射，用例失败/未执行可追踪 | runner边界回归、172/171验证文档及台账 |

## 执行要求

用例审核通过后，先执行新增回归得出失败证据，再修改生产。实现后独立code review，关闭问题再完整测试。B22—B25全部内置批次完成后才执行B26自定义；外部账户权限/额度/限流不能用夹具替代。B25为明确拒绝的负例，既不计为可用模型，也不删除官方限定型号记录来规避完整性。

最终171验证文档须为每个B编号填写命令、结果和具体文件；逐型号R证据保留完整候选集合、选用型号、成功/失败/未执行及失败原因。全部必需正例成功、负例得到预期拒绝、回归和真实目标系统通过后才总结通过。

独立代码审核补充回归：B02 覆盖跨页别名 canonical 优先及精确非托管/专用型号排除；B06/B13 覆盖 Preview 五档在设置选择器、导入合法性与实际 SDK 请求中的一致性；B07/B11 覆盖 Ark 在分类过滤之前的模态、任务、容量冲突，相同记录去重；B05/B06 检查官方来源均为有效 HTTPS 字符串；B19/B20 覆盖工具兼容层已排队事件在取消/轮换/禁用/删除之后不得流出。

## 实际反馈补充与验收范围

B03：官方 shutdown UTC 日期优先于缺失/陈旧实时元数据，搜索别名到期排除，未来日期提示，default Snapshot 正确关联，canonical 来源不被 alias 覆盖。B06/B17：保存订阅 Key 留空复用可测试一次；保存常规 Key 对 Preview 零请求拒绝；读取期间轮换/禁用/删除，晚到 Key 不发送请求或回显。B13/B18：Cyber 配置和实际 SDK 均显式发送官方支持的 Daybreak Red 参数；账户授权仍独立验证。B29：实际 CLI 对 EOF、畸形输入、缺失/重复供应商范围、catalog-only 与 models 互斥组合在 HTTP 前失败；指定存在型号覆盖配置与 SDK，指定不存在型号不得虚报通过。B28：离线 harness 必须检测 TCP 的端口/字符串/options 六种形式均被阻断，Unix socket 与本地页面可运行；原生基线 Ctrl+Alt+Shift+F8 保持焦点/删除/冲突检查。

B22—B27 的 HTTP429 实际结果按用户授权标为“本轮跳过”，不标真实通过；其他失败仍阻止对应正例通过。B23/B24 火山未开通型号保持待开通后真实重测；用户未授权跳过。内置首批已先于自定义执行；后续明确范围重测必须保留批次、范围和历史失败。

范围调整历史：Cyber明确本轮跳过；火山确认已开通并换Key后完整重测仍未通过，当时未有跳过授权，因此保留B23/B24失败。后续用户最终调整如下，原失败证据仍不改写。

最终用户范围：火山“跳过没开通的模型，只测开通的”。剩余23个候选保留真实失败并本轮跳过；已经成功的3个图片型号使用最新Key再次通过。按调整范围验收，不宣称全候选可用。
