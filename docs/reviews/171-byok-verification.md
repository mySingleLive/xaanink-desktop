# BYOK 验证记录

日期：2026-10-09。前置产物按序完成：164/165 调研及审核、166/167 方案及审核、168/169 用例及审核、实现及 170 code review（所有代码阻断已关闭）。164/166/168 的实际接口反馈补充也由同一独立子代理在 170 复核通过。

当前状态：按用户最终调整范围验收通过。完整回归1647项全部通过；原始全候选真实批次的失败与豁免仍逐项保留。火山在用户确认已开通后，23个待验证型号重测仍失败；用户随后提供新Key，完整26个型号重测仍有23个失败。用户明确允许 HTTP429 本轮跳过，并单独允许 Cyber 本轮跳过；这些型号均不标为可用成功。用户最终明确“跳过没开通的模型，只测开通的”，火山其余23个保留实际失败并本轮跳过；最终验收只针对调整后必需范围。

## 已执行的环境与命令

真实系统为 macOS arm64；Node 24.19.0（bundled runtime），Electron 44.6.0。项目要求 Node24，未使用默认 Node20 的运行结果作为验收。测试使用隔离根目录，原生临时目录使用 canonical `/private/var/...` 路径；未修改真实用户数据。工具环境无 CodeGraph CLI/MCP，已按用户授权尝试初始化但不可用；没有虚构索引结果。

- 完整 unit/integration：`node --import tsx --test --test-concurrency=1 tests/unit/*.test.ts tests/integration/*.test.ts`，最终1647项全部通过，0失败、0取消、0跳过，exit0（551156ms）；持久化脱敏记录 `docs/evidence/byok/full-tests.txt`。此前1643项不重复累计。
- `npm run typecheck` exit0；`npm run build`（Prisma/UI/desktop）exit0。记录 `docs/evidence/byok/typecheck.txt`、`docs/evidence/byok/build.txt`。
- 最后增量聚焦 4 文件 34 项全部通过：`byok-catalog`、`byok-sdk`、`byok-runner`、`model-configuration-review`；保存 Key 正例/负例与撤销回归包含其中。170 独立执行 11 文件 124 项全部通过，未使用真实接口。
- `node scripts/smoke-byok.mjs`：最终构建真实主进程/服务/Electron 设置 8 条通过；网络守卫在真实入口之前安装，主/worker 加载2次，正式外部 HTTP/TCP/监听尝试0；TCP六种参数 preflight 拒绝、真实 Unix socket 允许。证据 `docs/evidence/byok/native.json`。
- `node scripts/smoke-models.mjs`：最终构建真实设置 11 条通过；手动保存、草稿取消、自定义协议、假 Key safeStorage 加密与公共快照不含 Key。只有隔离测试主动启动 loopback fixture，正式产品不增加监听服务。证据 `docs/evidence/byok/native-models.json`。
- `node scripts/smoke-electron.mjs`：真实桌面基础 10 条通过，含菜单/主题持久化/沙箱/快捷键录制与焦点。原 F8 与真实 Monaco 默认命令冲突，F18 不被 Playwright 支持，最终使用目录未绑定且驱动支持的 Ctrl+Alt+Shift+F8；原行为断言未弱化。证据 `docs/evidence/byok/native-baseline.json`。
- 凭据扫描覆盖 desktop/src/scripts/tests/所有 reviews/本轮 evidence/两份台账，172保存后最终共1367文件，匹配0；实际 runner 报告写入前也检查不得包含内存凭据。不保存 Key/原始响应/生成正文/真实图片。

上述原生结果仅覆盖本文声明的开发构建范围；未执行新安装包或 Windows 原生验收，不将其写为通过。

## 真实批次与范围

| 批次 | 范围与结果 | 证据 |
| --- | --- | --- |
| 首批完整 | 6供应商、10类别目录，然后逐型号配置/生产SDK或图片解码，最后自定义；311记录，62成功、249失败，exit1 | `docs/evidence/byok/real-20261009073953178.json` |
| 修复后有限复测 | OpenAI8个原HTTP200错误型号、Cyber、MiniMax Preview负例、火山1文本；27记录，7成功、20失败，exit1 | `docs/evidence/byok/real-20261009081628545.json` |
| 用户确认火山开通后 | 20文本+3图片，每型号两阶段；48记录（含2目录），2目录成功、46生成阶段失败，exit1 | `docs/evidence/byok/real-20261009082049291.json` |
| 新火山Key完整复测 | 20文本+6图片，54记录；2目录及3图片双阶段共8成功、46失败，exit1 | `docs/evidence/byok/real-20261009082731452.json` |

首批内置结束时间早于首个自定义请求，后续 scoped 重测不重复自定义。每阶段无自动付费重试；修复或用户明确账户状态变化后才进行有记录的有限重测。原始脱敏批次不改写，公开覆盖汇总另外生成。

OpenAI 当前目录为64文本/10图片（首批68文本，后续排除已到期搜索别名与未在 Key 目录列出的 Deprecated o3-pro 两ID）。这4个不再作为新配置选项，保留首批404，不以删除失败记录制造通过；官方来源与日期见164/170。8个 SDK HTTP200并非成功，SSE 内的 `credit_balance_exhausted` 已正确归类额度不足，同型号配置阶段均 HTTP429。其型号按用户429豁免不作本轮可用成功，原SDK错误仍保留为实际失败。Cyber 在支持参数修复后仍404，用户单独授权本轮跳过。

## 六家实际结果

| 供应商 | 目录/型号覆盖 | 实际结果与限制 |
| --- | --- | --- |
| OpenAI | 当前64文本/10图像，两个目录HTTP200 | 全部生成正例当前受429/相关额度不足影响；Cyber404单独跳过。未证明可用成功，不凭目录200宣称调用可用。 |
| DeepSeek | 2文本、目录HTTP200 | 两型号配置+生产SDK均真实通过（4阶段）；使用用户最后提供凭据，仅内存，未修改原系统变量。 |
| 智谱 | 24文本/3图片、两个目录HTTP200 | 4文本双阶段通过；另2文本仅配置通过，SDK429。CogView3Flash配置+图片解码通过；其余阶段429本轮跳过。不能写6文本全部通过。 |
| 月之暗面 | 4文本、目录HTTP200 | 四型号配置+生产SDK均真实通过（8阶段）。 |
| MiniMax | 8常规文本、1订阅Preview、1图片，两个目录HTTP200 | 常规8文本+image01均双阶段通过（18阶段）。Preview先真实接口400拒绝，修复后配置本地 MODEL_UNAVAILABLE 预期拒绝通过，零付费请求；不计为可用模型。 |
| 火山方舟 | 20文本/6图片、两个目录HTTP200 | 3图片配置+真实生成解码通过（6阶段）。20文本+其余3图片在确认开通并更换Key后重测仍失败：配置端17个 ModelNotOpen/权限拒绝，6个不存在或无访问权。用户最终仅验收已开通型号，其余23个本轮跳过；不宣称可用。 |

其余 Anthropic/Google/xAI/Xiaomi/阿里/腾讯按用户范围完成官网目录/接口契约，未提供 Key，不宣称逐型号真实调用通过。

自定义：DeepSeek 官方 Anthropic Messages 地址配置+实际SDK成功；OpenAI 文本和图片双阶段429，本轮按授权跳过。固定无效 OpenAI Key 的401、有效Key不存在型号的404两项真实负例成功，输出固定脱敏错误。其他取消/范围/HTTP安全边界由实际代码契约与原生场景覆盖，不冒充供应商真实取消证明。

## 逐用例覆盖

U/I=受控接口与真实SDK契约，不等于实际供应商调用；N=真实Electron；R=真实供应商。每个编号均已执行对应场景，实际失败及明确范围豁免单独列出。

| 用例 | 执行证据 | 当前结果 |
| --- | --- | --- |
| B01 | byok-catalog/model-settings；native.json + native-models.json | U/N通过，12预设、仅Key、手动保存、单选、无默认模型 |
| B02 | byok-catalog；OpenAI能力JSON；170 | 通过：canonical优先、精确快照、OTHER与未知分类 |
| B03 | byok-catalog；公开生命周期JSON；最新真实目录 | 通过：UTC到期/未来/defaultSnapshot，已到期别名排除 |
| B04 | byok-catalog；DeepSeek首批实测 | U/R通过：两个当前ID，无模态补齐 |
| B05 | byok-catalog/model-configuration；智谱目录 | U及R目录通过，生成结果另见B23/24 |
| B06 | byok-catalog/byok-sdk；MiniMax首批/有限重测 | U/I通过，保存订阅正例/普通拒绝与五档一致；真实Preview拒绝 |
| B07 | byok-catalog/model-configuration-providers；Ark目录 | U及R目录通过，冲突先于过滤，不调用管理面 |
| B08 | byok-catalog/model-configuration；Kimi实测 | U/R通过，四ID与capacity/effort |
| B09 | model-configuration/providers/review及公开能力表；164/165/170 | 官网/U通过，其他六家无真实Key范围 |
| B10 | byok-catalog/model-configuration-review；实际失败报告 | U通过；401/403/402/429/404及200业务错误脱敏分类正确 |
| B11 | model-configuration/providers/review；byok-catalog | U通过：分页、冲突、去重、大小/数量/游标边界 |
| B12 | byok-catalog/model-configuration/model-authorization/model-repository | U通过：精确旧域名、范围变化、非自定义地址拒绝 |
| B13 | byok-catalog/providers；byok-sdk | U/I通过：自动路由与预算，Cyber参数，零自动重试 |
| B14 | byok-catalog/model-configuration/providers/review | U通过：总预算/effort/截断失败，不把部分文本报成功 |
| B15 | model-configuration-providers/review/image-provider-generation/image-generation/image-resource | U通过：最小单图参数及安全下载；R见B24 |
| B16 | model-configuration/model-configuration-cancellation/model-configuration-review及真实runner | U通过，未主动授权零请求，发现/测试不保存，usage白名单 |
| B17 | model-configuration-cancellation/review、byok-catalog、authorization | U通过：等待/流/晚Key/撤销/取消/上限，无晚发或回显 |
| B18 | byok-sdk/local-model-generation | I通过：实际SDK Responses非流式、Chat/工具/usage与Cyber |
| B19 | byok-sdk，非流式与外层guard | I通过：等待及消费前取消，无文本/工具晚输出 |
| B20 | byok-sdk/model-service/model-authorization | I/U通过：model.assert与禁用/删除/轮换，无重新生成 |
| B21 | model-settings；native-models.json/native.json | U/N通过：说明、单选、切换、取消、手动加密保存 |
| B22 | 四批真实报告10个不同供应商/类别目录组合（累计20条目录记录） | R通过，认证HTTP200；目录不代表生成可用 |
| B23 | 首批+有限复测+Ark重测逐型号 sdk/configuration | R部分通过；429相关型号/Cyber授权跳过，Ark20文本实际失败，按只测已开通型号豁免 |
| B24 | 逐型号configuration/image-decode，合法图像字节实际sharp解码 | R已通过5个图片型号（智谱1/MiniMax1/Ark3）；OpenAI及智谱其余429跳过，Ark其余3实际失败，本轮豁免 |
| B25 | 首批MiniMax Preview400及修复后expected-rejection | R拒绝已确认，U/配置拒绝通过，不算可用成功 |
| B26 | 首批custom晚于全部builtin | Anthropic R通过；OpenAI文本/图片429授权跳过 |
| B27 | 首批custom真实401/404；配置/网关及原生自定义用例 | R负例及U/N边界通过 |
| B28 | 最终完整1647项unit/integration；typecheck/build；三组原生8/11/10当前最终产物复验 | 1647项、类型/构建/N全部通过 |
| B29 | byok-runner实际CLI；runner白名单/扫描；台账及172 | CLI、最终扫描、台账与172证据审核全部通过 |

B24通过的图片为 `cogview-3-flash`、`image-01`、`doubao-seedream-5-0-260128`、`doubao-seedream-5-0-flash-260915`、`doubao-seedream-5-0-lite-260128`，共5个，不把配置与生产两阶段重复计为型号数。

## 汇总与当前账户条件

`docs/evidence/byok/coverage.json` 逐项保留当前143个候选（含1个订阅禁选候选）、配置/SDK或图片解码阶段、真实HTTP/code、证据批次及本轮豁免状态；完整报告原样保留。当前285个内置型号阶段为48正例阶段成功及1个Preview预期拒绝成功、180直接HTTP429跳过、8同型号HTTP429后的SDK额度失败、2 Cyber授权跳过、46火山账户访问失败并按用户授权本轮跳过。8个HTTP200的额度失败没有改成HTTP429或成功；同型号正例按其已收到429的用户豁免排除本轮可用证明。自定义8阶段：4成功、4 HTTP429跳过。目录成功单独计数，不混入型号生成阶段。

额外内存诊断（白名单布尔值/HTTP/code证据为 `docs/evidence/byok/ark-scope-diagnostic.json`）对同一个当前火山文本型号分别使用环境旧Key与用户新Key：均官方404/ModelNotOpen、错误提及请求型号；只在内存比较账号字段，确认同一账户，未输出/保存账户ID或原始错误。新Key认证目录与三个图片调用成功，故不是把401误诊为模型协议问题。按[官方错误码](https://docs.volcengine.com/docs/ark/error-codes?lang=zh)，ModelNotOpen 表示该账户对应模型服务未开通。须检查开通管理中的 Inference 服务/审批是否对该账户生效；不凭用户操作完成或目录200推断调用权限已生效。用户最终选择只测已开通型号，余23个按账户不可用本轮跳过。

两份现有台账仅追加 `byokEnhancement`，原用户 UI 修改及其它业务状态保留。编号使用 BYOK-Bxx 前缀以避免与全仓原需求 Bxx 混淆。最终全量/类型/构建/原生已通过；B23/B24的火山23个型号保留实际失败，按最终用户范围豁免；当前产物三组原生复验及172独立证据审核已通过，最终Key扫描也已通过；调整范围验收通过，绝不声明所有候选可用。172负责独立核对覆盖、数字、证据和这一边界。

当前最终构建原生复验：完整回归最后一次刷新dist后，依次重跑smoke-byok（8）、smoke-models（11）、smoke-electron（10），全部exit0。最新native文件时间均晚于最终dist，compiledArtifacts hash/mtime见verification.json；此前native记录不作为最后构建证明。

收尾门槛：172独立证据审核无剩余阻断；其保存后执行最终扫描，1367文件/0匹配/exit0，结果见secret-scan.json。两份台账审核状态已更新passed。调整后必需53个真实内置/自定义阶段（含3负例）均通过；23个内置型号双阶段成功（18文本/5图片）。HTTP429、Cyber及火山未开通型号按用户明确授权跳过，绝不计为可用成功。按最终调整范围完成本轮验收。
