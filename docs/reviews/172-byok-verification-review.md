# BYOK 最终证据独立审核

日期：2026-10-09。审核171、164/168的最终范围补充、两份台账的byokEnhancement、四批真实报告、coverage、完整/聚焦回归、类型检查、构建及三组原生证据。只写本文，未读取或使用真实凭据、未运行供应商接口；没有再次执行完整测试或把证据审阅冒充本代理重新执行。

**结论：证据准确性审核通过。** 用户最终明确允许HTTP429、Cyber及火山未开通型号本轮跳过；调整范围内必需正负例通过，所有候选均可用仍为false。本文生成后的最后凭据扫描由主代理执行，最终扫描门槛以`docs/evidence/byok/secret-scan.json`为准，不将pending扫描标为通过。未声明新安装包或Windows验收通过。

## 发现与关闭

1. 171原B22写三批，实际四批；已修正为10个不同供应商/类别目录组合、累计20条目录记录。
2. 原汇总49通过阶段包含Preview预期拒绝；已明确拆为48个内置正例阶段及1个本地预期拒绝。拒绝不算型号可用。
3. 原生记录原先早于最后dist，不能证明最后构建；已在当前dist顺序重跑三组，8/11/10条全部通过。独立检查三个compiledArtifacts的SHA-256与当前文件一致，mtime为08:22:04 UTC；最新BYOK记录08:37:35、模型设置结束08:38:35、桌面基线结束08:39:17，均晚于产物。
4. B09的providers拼写、最终回归等待的陈旧文案已修正。火山最终用户范围增补后，原始失败报告保持false，覆盖汇总仅改变本轮豁免状态；没有改HTTP、code或ok。

## 独立重算

| 原始批次 | 记录 | ok:true | ok:false | 模式 |
| --- | ---: | ---: | ---: | --- |
| real-20261009073953178.json | 311 | 62 | 249 | full，六家内置后自定义 |
| real-20261009081628545.json | 27 | 7 | 20 | scoped，明确11个ID |
| real-20261009082049291.json | 48 | 2 | 46 | scoped，火山23个失败型号 |
| real-20261009082731452.json | 54 | 8 | 46 | scoped，新Key火山完整26个型号 |

四批均credentialPersistence:false、automaticPaidRetries:0、passed:false；成功记录包含目录与负例，不能当成成功型号数。后续scope批次没有custom记录。首批内置最后生产阶段完成07:47:21.589 UTC，首个custom记录07:47:22.363，顺序成立。

独立以四批逐行构建provider/kind/modelId/phase的历史与latest索引，并与当前各provider/kind最新目录比较：**143个当前候选无缺失/重复，285个内置阶段的evidence、ok、status、code、at全部匹配实际最新原报告**。available:true只表示目录可选择，不能当作生成成功。公开OpenAI证据与生产能力JSON完全一致，共101个页面；当前64文本/10图片。首批保留的4个后续排除ID为两个搜索alias、o3-pro及其快照，历史失败未改写。

| 当前内置阶段 | 数量 | 证明范围 |
| --- | ---: | --- |
| 正例成功 | 48 | 包含2个仅配置成功的智谱文本；不能全部提升为双阶段型号成功 |
| Preview预期拒绝 | 1 | 普通Key订阅限制，本地零付费拒绝 |
| 直接HTTP429本轮跳过 | 180 | ok:false、原HTTP/code保留 |
| 同型号配置429、SDK HTTP200额度失败 | 8 | QUOTA_EXCEEDED/ok:false保留，按该型号429豁免；未改成HTTP429 |
| Cyber授权跳过 | 2 | 真实404失败保留 |
| 火山账户不可用、本轮授权跳过 | 46 | 23型号，真实失败保留；不是46个型号 |

自定义另有8阶段：2个Anthropic正例成功、2个401/404预期拒绝成功、4个HTTP429跳过。调整范围必需内置49阶段及自定义4阶段均ok:true；53项含3项负例，不等于53项正例或53个可用型号。

实际内置双阶段成功为23个型号：DeepSeek2、智谱5（4文本/1图像）、Kimi4、MiniMax9（8文本/1图像）、火山3图片。智谱glm-4.7-flash、glm-4.6v-flash只有配置成功、SDK429，不加入上述23个。B24五个独立图片型号全部有decoded:true、合法JPEG、正尺寸：cogview-3-flash与image-01为1024²；Seedream5.0原版与Lite为2048²、Flash为1024²。

最新火山配置23失败为17个PERMISSION_DENIED及6个MODEL_UNAVAILABLE；对应生产20文本/3图片也失败。没有把全部失败都称ModelNotOpen。`ark-scope-diagnostic.json`只有固定HTTP/code及布尔值，无账户ID、Key或原始错误；它证明该次诊断的两个响应同账户比较为true，不是所有23型号已开通的证明。[官方错误码](https://docs.volcengine.com/docs/ark/error-codes?lang=en)支持ModelNotOpen为账户模型服务未开通的解释。

## B01—B29文件映射核对

U文件位于`tests/unit/`、I文件位于`tests/integration/`，以下均为真实存在的`.test.ts`文件。U/I的相关场景在`full-tests.txt`有通过记录；R以四批原报告及coverage逐项判定，N以最后构建三组原生JSON判定。此表核对证据范围，不以单一启动冒烟代替各业务用例。

| 用例 | 具体证据文件 | 核对结果 |
| --- | --- | --- |
| B01 | U byok-catalog、model-settings；native.json/native-models.json | 中国预设、12目录选项、仅Key/单选/手动保存，U/N通过 |
| B02 | U byok-catalog；official-openai.json；170 | canonical、精确快照、OTHER/未知分类通过 |
| B03 | U byok-catalog；desktop/shared/openai-lifecycle.json；最新真实目录 | 到期/未来及defaultSnapshot关联通过 |
| B04 | U byok-catalog；首批DeepSeek原报告 | 无模态精确两ID，U/R通过 |
| B05 | U byok-catalog、model-configuration；首批智谱目录 | 目录U/R通过；生成逐项见B23/24 |
| B06 | U byok-catalog；I byok-sdk；首批及有限复测 | 订阅选择/保存类别授权与五档通过；Preview不算可用 |
| B07 | U byok-catalog、model-configuration-providers；火山目录 | 26当前型号/过滤/冲突契约通过，目录认证不等于开通 |
| B08 | U model-configuration；首批Kimi原报告 | 四ID、context_length/effort、双阶段通过 |
| B09 | U model-configuration、model-configuration-providers、model-configuration-review；164/165/170 | 其余六家官网/契约通过，不宣称真实生成 |
| B10 | U byok-catalog、model-configuration-review；四批实际失败 | 固定脱敏分类通过，HTTP200错误仍失败 |
| B11 | U byok-catalog、model-configuration、model-configuration-providers、model-configuration-review | 页数/字节/重复/冲突/游标边界通过 |
| B12 | U byok-catalog、model-configuration、model-authorization、model-repository | 精确旧地址与保存授权范围通过 |
| B13 | U byok-catalog、model-configuration-providers；I byok-sdk | 路由/总预算/Cyber参数契约通过，不代替权限 |
| B14 | U byok-catalog、model-configuration-providers、model-configuration-review | 官方effort/截断失败/单次请求通过 |
| B15 | U model-configuration-providers、model-configuration-review、image-provider-generation、image-generation、image-resource | 最小单图与安全下载契约通过 |
| B16 | U model-configuration、model-configuration-cancellation、model-configuration-review；scripts/verify-byok.ts | 主动授权、不自动保存、usage/证据白名单通过 |
| B17 | U byok-catalog、model-configuration、model-configuration-cancellation、model-configuration-review、model-authorization | 取消/撤销/晚Key/上限通过 |
| B18 | I byok-sdk、local-model-generation | 实际SDK非流式/Chat/工具/usage契约通过 |
| B19 | I byok-sdk | 等待及队列消费窗口取消，通过 |
| B20 | I byok-sdk；U model-service、model-authorization | model.assert与撤销保护，通过 |
| B21 | U model-settings；native.json/native-models.json | warnings/切换/取消/人工safeStorage保存，通过 |
| B22 | 四批原报告catalog记录 | 10目录组合、累计20记录HTTP200，通过 |
| B23 | 四批configuration/sdk记录及coverage | 保留正例/真实失败；429/Cyber/火山授权豁免，调整范围通过 |
| B24 | 四批configuration/image-decode记录及coverage | 5型号实际解码双过；其他本轮豁免，未伪报成功 |
| B25 | 首批Preview400；有限复测expected-rejection；U byok-catalog | 真实拒绝保留；修复后本地负例通过 |
| B26 | 首批custom记录与生产阶段时间 | Anthropic双过；OpenAI429跳过；内置先于自定义 |
| B27 | 首批custom 401/404；U model-configuration、model-authorization；native-models.json | R负例与U/N边界通过 |
| B28 | full-tests.txt/typecheck.txt/build.txt；native.json/native-models.json/native-baseline.json；verification.json | 1647/0失败/0跳过；类型/构建及当前产物8+11+10通过 |
| B29 | I byok-runner；scripts/verify-byok.ts；两台账byokEnhancement；secret-scan.json | CLI边界、历史/latest/范围证据通过；最后扫描以主代理最终记录为准 |

两份台账byokEnhancement独立deepEqual一致，29个BYOK-Bxx编号齐全，implementation/tests/evidence引用均存在。`allAcceptancePassedWithinAdjustedScope:true`与`allModelsUsable:false`必须同时保留；原始四批passed:false不改。完整1647项不与此前1643项或聚焦/独立124项相加，原生29为8+11+10。离线harness加载2次、正式网络拒绝事件0、六种TCP拒绝及Unix允许均有证据，不以fixture loopback服务推断正式产品增加HTTP监听。

**证据审核无剩余阻断。** 按用户最终调整范围完成验收；所有候选可用、安装包和Windows仍不在通过声明中。最终凭据扫描须在本文保存后完成，再由主代理更新扫描及审核台账状态并总结。
