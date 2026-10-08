# 新增供应商配置适配独立代码审核

- 日期：2026-10-07
- 审核者：独立子代理 `/root/ui_revision_review`，不是本批适配作者。
- 状态：**限定代码审核通过。PA43-01～04 均已闭合。**
- 范围：`desktop/main/model-configuration.ts`、`desktop/main/model-provider-adapters.ts`、`desktop/shared/model-catalog.ts`，相关四个配置测试文件及本批官方接口依据。没有运行 Electron、操作主代理浏览器或修改实现。

## 结论边界

本记录只审核新增目录/单模型测试 adapter 的代码与受控 HTTP 行为。阿里当前预设旧 host 的真实目录可用性、未适配型号、静态目录的账号权限、供应商实际生成/收费、安装包与双平台桌面验收仍未完成。39 的限定通过及历史原型截图不作为上述事项的通过证据；本轮不标记正式顶层验收用例通过。

## 发现与复审

### PA43-01 · P2 · 腾讯目录忽略 HTTP200 的显式业务错误（已修复）

首审 `discoverTencent` 只检查 `data` 和分页标记。注入 `{error:{message:假Key}, data:[有效在线型号]}` 时仍返回成功目录；`code` 错误和 `success:false` 同样缺少检查，可能把失败响应中携带的旧数据呈现为有效完整目录。独立测试实际调用配置服务与网关，预期 HTTP_ERROR，实际 ok=true，得到 RED。

修复后目录解析前执行共同业务错误检查，返回固定脱敏错误；不返回上游错误正文、Key 或旧目录。独立回归同时覆盖三个显式失败字段。

### PA43-02 · P2 · 最小图像测试未按型号选择最低已核实尺寸（已修复）

Google 首审统一发送 1K：`gemini-3.1-flash-image` 官方支持更小的 512，Interactions 枚举值为 `512`；`gemini-2.5-flash-image` 仅核实了固定输出规格，通用枚举不能证明该型号支持显式尺寸覆盖。修复采用前者 512、后者省略未核实的 `image_size`，其他已核实最低为1K的型号保持1K，并显式1:1。2.5 的修正是保守使用已核实默认规格，不能表述为实测证明旧参数必然报错。[Google 图像指南](https://ai.google.dev/gemini-api/docs/image-generation)、[Interactions 字段](https://ai.google.dev/api/interactions-api)。

进一步定向核验发现 Wan2.7 标准/Pro 的自定义文生图最低面积为768²、Hy3.5 的宽高下限为256；首审均使用更大的示例尺寸。独立请求断言 RED 后改为768²/256²，保留 n=1、禁组图、禁额外思考/工具等已有控制。尺寸合法性来自官方文档；本审核没有真实生成，也不声称所有尺寸变小都必然改变供应商收费档位。[Wan2.7](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)、[Hy3.5](https://intl.cloud.tencent.com/zh/document/product/1300/83708)。

### PA43-03 · P2 · Qwen3 忽略实际图像计量字段（已修复）

Qwen3.0/Pro 官方计量字段为 `usage.output_image_count`，首审通用路径只检查 `image_count`。单一图片URL配合 output_image_count=0、2、字符串1或负数时仍返回成功与 imagesGenerated=1。独立两型号受控回归实际复现此矛盾响应被接受。[Qwen 图像响应规范](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)。

修复阿里路径核验 `image_count` 与 `output_image_count` 两种已核实计量字段；供应商提供其中任一字段时须严格为整数1，若两者共存须同时一致。未提供计量字段时，imagesGenerated=1 来自已校验的一图响应结构，不代表供应商返回了计费计数；token计量只保留实际数值。合法数值1也独立复跑。

### PA43-04 · P2 · 阿里文本探针未限制思考与回复总输出（已修复）

首审阿里兼容文本探针仍发 `max_tokens:256`。官方说明它只限制最终回复，思考可能继续使用模型默认最大预算；推荐 `max_completion_tokens` 限制完整输出。新增 `qwen3.8-max`/`deepseek-r1` 实际请求断言总预算256、没有猜测思考开关，得到 RED。[阿里深度思考输出预算](https://help.aliyun.com/zh/model-studio/deep-thinking)。

这只证明请求侧边界；最终回复内容、真实 token 账单与所有型号支持情况仍需正式场景验证。不用第二次付费请求自动回退参数。

修复阿里TEXT请求采用 `max_completion_tokens:256`，省略旧 `max_tokens`，没有添加猜测思考开关、没有自动付费重试。两个型号请求回归及最终合跑均通过。

## 已独立核对的实现边界

- 预设协议/类别/端点严格匹配后，Google明确映射同源 native `/v1beta`、阿里明确映射同源 `/api/v1`；腾讯国内TEXT与国际IMAGE不跨站复用Key。错误协议或腾讯错误类别端点在HTTP前拒绝，不猜测新/未知型号的生成路径。
- 阿里分页校验页号、稳定total、总数量、重复ID与非空中间页；超界明确失败，不返回截断的完整目录。类别按真实输出模态核对；IMAGE排除八个官方明确仅图像编辑的确切ID，未来名称不按前缀推断。字节20TEXT/6IMAGE为公开表快照，账号完整性始终false、权限unknown。
- 图像路径按供应商/确切型号选择，提交task_id不作为生成成功。异步轮询绑定校验过的ID及固定路径，遇到失败、未知状态、ID不符、轮询上限或总deadline停止。Vidu官方最终响应可省略task_id；可选回显存在时必须匹配。Wand官方请求没有 n 字段，不添加猜测字段，最终结果严格一图；真实数量/收费仍未验收。[Wand](https://intl.cloud.tencent.com/zh/document/product/1300/83859)、[Vidu](https://intl.cloud.tencent.com/zh/document/product/1300/83709)。
- 所有请求继续经过实际 ModelGateway：每次HTTP及重定向前核验saved lease，异步取Key后再核验；只允许已授权同origin/路径的有限307/308，不跨host。没有供应商业务失败、429或超时后的付费重提。轮询GET是同一次已提交任务；本地取消不能保证远端任务停算或免收费。
- 独立模拟已保存授权在阿里poll body读取中撤销，观察 AUTHORIZATION_REVOKED、实际signal aborted、reader取消、POST与poll各1次且无下一请求；总deadline截断永不结束的poll body并释放原reader。腾讯错误owner取消不影响目标，正确owner取消后不poll、无自动重提，新操作可再次测试。
- 数值用量仅接受有界非负安全整数；公有结果不含生成文本/图片地址、原始响应、statusText或Key。业务/网络错误固定脱敏，敏感目录字符串被既有服务守卫拒绝。没有仓库写方法，discover/test不能提交草稿、轮换密钥或改变智能体默认。

## 独立测试与版本证据

作者初始冻结：`docs/evidence/model-configuration/24-frozen-manifest.json`，三份实现和三份测试，58项fixture GREEN。它证明作者当时版本，不替代下面的独立新增回归。

新增 `tests/unit/model-configuration-review.test.ts` 使用 Node24.18.0、实际 ModelConfigurationService/ModelGateway、公开假Key与注入HTTP；保存授权场景的仓库读取为受控替身，流使用实际 ReadableStream。

- `25-independent-review-red.tap`：9项，6通过/3失败（腾讯业务错误、Google两个尺寸分支）。首次编写时的defaultState夹具错误已在保存此有效RED前修正，不计作产品失败。
- `27-independent-budget-usage-red.tap`：11项，9通过/2失败（Wan/Hy最低尺寸、Qwen3计量）。前批已修。
- `29-independent-text-budget-red.tap`：12项，11通过/1失败（阿里总输出预算）。前述尺寸/计量已修。
- `36-independent-green.tap`：最终独立合跑四文件，**70/70通过，0失败/取消/跳过，退出码0**；构成为原配置28、新供应商29、旧独立取消1、本审核新增12，不与39的旧44项或作者重复日志相加。
- `37-independent-typecheck-output.txt`：最终全项目 `tsc --noEmit --incremental false --pretty false` 退出码0，无诊断；机器可读核验记录见 `38-independent-summary.json`。作者定向tsc与本审核全项目检查来源分开。
- 最终七个源码/测试文件 SHA-256 已独立逐一匹配 `35-final-frozen-manifest.json`（聚合标识 `a602d4597cf27aa519eccedea5c3dc77068de38b5e9d6dca6ab9b1462cbe7b07`）；初始24及修复中间版本仍保留。作者各轮日志与独立日志不能累计重复用例形成总验收数量。

本批已实现链路复审未发现剩余阻断代码缺陷；该结论不消除下面的未完成能力及真实验收缺口。

## 仍需完成/验收

阿里北京官方 Models 文档要求 Workspace专属host；批准预设沿用旧dashscope同源地址，其 `/api/v1/models` 没有真实Key或官方可用证据，404明确失败且没有公共快照fallback。不能把分页mock成功称为当前预设已完成完整目录。可灵两个/Vidu六个阿里文生图最小调用尚未实现；未知未来型号亦明确 UNSUPPORTED_TEST，不发送猜测请求。[阿里 Models](https://help.aliyun.com/zh/model-studio/list-models)。

字节公开快照不能列出账号接入点、自定义型号或证明推理Key权限。Google/阿里/腾讯/字节真实账号、生成结果下载及资产管理、真实费用与跨区域行为未测；本审核没有真实paid调用、原生safeStorage、系统窗口交互、Windows或安装包验收。
