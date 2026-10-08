# 模型配置运行链独立代码审核

日期：2026-10-07（Asia/Shanghai）。审核者：独立子代理。范围：`desktop/main/model-configuration.ts`、`desktop/shared/model-catalog.ts`、主仓库与 schema 的未知容量、worker 内部预算、共享 IPC/preload/main 接线；为核对新配置进入原调用链，定向阅读 provider/thinking 适配选择与模型状态切换契约。未改实现、不跑 GUI、不调用真实供应商。

## 当前状态

**本批已实现的模型配置运行链审核通过，MC-01/02/03 均已闭合。** 独立最终执行5个相关测试文件，44/44通过、0失败/取消/跳过，退出码0。范围是源码及隔离假 HTTP/临时文件回归；全部供应商目录/图像调用、原生安全存储、GUI与双平台正式验收仍须按末节完成，不能由本结论代替。

## 已发现的实际衔接缺陷

以下保留首审发现和 RED，不代表当前已修复版本仍存在这些缺陷。

### MC-01 · P2 · 新供应商 ID 没有接入原 SDK/思考能力边界

新目录/配置用 `moonshot`、`zai`（以及 `alibaba`）作为供应商 ID；原 `src/lib/ai/provider.ts` 的 DeepSeek 兼容适配分支及 `thinking-effort.ts` 只识别 `kimi`、`zhipu`（以及 `qwen`）。把新配置按原样保存，原能力和模型构建没有识别别名。

无网络受控 RED：`tests/unit/model-provider-alias.test.ts` 用真实 localModelRecord、instantiateModel 和能力函数比较同一协议/端点/型号的新供应商身份与既有运行适配身份。moonshot/kimi 和 zai/zhipu 的 `high` 配置实际得到 `providerOptions=undefined`，原适配身份则得到 `deepseek.thinking.enabled` 与 `reasoningEffort=high`；断言失败。alibaba/qwen 当前行为相同，作为保护性 GREEN。

建议仅在原能力及 SDK 选择边界归一化这些明确别名；存储、显示、调用快照保留真实供应商 ID，作者选定的 protocol/endpoint 不变。未知供应商或未知 thinking metadata 不据名称猜测。必要回归已包含 SDK provider、能力档位/生成 options 一致以及存储/快照身份与协议/端点保留，另断言明确 Anthropic 协议仍选择 Anthropic SDK。

复审：**已闭合。** 新 `provider-family.ts` 只在原 SDK 与思考能力选择处归一化三组明确别名；record、public snapshot、显式协议和端点仍为原值。独立复跑三项通过，未调用模型。

### MC-02 · P2 · 默认模型停用/重新启用保留了旧显式思考档位

产品 170/173 段及最终原型的状态协调要求：停用或明确重新启用同 ID 时，默认模型 ID 保留，但思考回“模型默认”。当前 `ModelRepository.saveModel` 只在能力不再支持现有档位时重置；enabled 切换本身仍保留 `high`。

应主代理请求，在 `tests/unit/model-repository.test.ts` 追加两个实际文件 fixture 回归：启用的默认模型设 high 后停用；以及模拟旧版本已写入的“停用但仍 high”的隔离持久状态后明确重新启用。两条都保留 ID、正确切换 enabled，但 `high !== default` 失败。后者还检查重新启用后沿原密文得到假 Key，防止修复误删 credential。

建议在当前默认文本模型的 enabled 切换时写 `settings.agent.thinking=default`，保留模型 ID，不选择替代模型。存储标识是 default，不把它强行写为元数据的 low 等具体档位；不影响兼容模型之间的合法思考保持及删除默认后的清理。

复审：**已闭合。** `saveModel` 在当前默认文本模型的 enabled 状态变化时重置思考为 default，ID 不变；两个追加回归均通过，重新启用保留同一假 Key。仓库11项独立通过。

### MC-03 · P2 · 已返回取消的操作在忽略取消的宿主请求下永久占满名额（已闭合）

首审源码：`abort` 已清 deadline、Key、监听器和 lease，但 `active` 条目仅由 `work.finally` 删除；`execute` 的外层 `Promise.race` 已返回 CANCELLED 时，等待宿主 fetch 的 work 尚未结束。若宿主请求忽略 AbortSignal 并永久 pending，重复取消达到默认16项后，同一窗口或新窗口的新操作均永久得到 OPERATION_LIMIT，不能再次测试或刷新目录。关闭窗口的 `cancelOwner` 同样只 abort，不释放这些条目；关闭整个 service 才清 Map。

受控探针 `<temporary-path>` 独立复现16次 CANCELLED 与第17次/新 owner 的 OPERATION_LIMIT。新增正式 `tests/unit/model-configuration-cancellation.test.ts`：前16次假请求忽略 abort；每次确认取消回执及实际 HTTP signal 已 aborted；第17次宿主本可立即返回目录，却未发起。预期成功的断言实际 false，1项失败/退出码1。该情形属于注入宿主适配层边界，**不宣称原生 fetch 或真实供应商已出现不可取消 I/O**；原生 fetch 遵守 abort 时通常可自行 settle。

现有“duplicate/operation bounds remain held until ignored fetch settles”用例明确接受这项旧策略，因此原有 GREEN 不证明取消后可重试。建议让已结束的业务操作回收 active 槽位，并以 abort-aware 等待与最后授权检查阻止迟到响应、分页或重定向；对不可取消宿主 I/O 单独定义有界隔离/恢复策略，避免通过单纯无界释放来积累底层资源。修复须覆盖取消后的重试、另一 owner 可用，以及迟到 work 不能发送下一次 HTTP。

复审：**已闭合。** `abort` 同步删除匹配的 active 操作，清 timer/Key/监听器、结束临时及已保存 lease；retired 只保存 owner/operationId 与随机 token，不保存 draft/Key/Promise，容量最多 `maxOperations × 32`（默认512项）。取消的 ID 在该有界窗口内拒绝重放，超过上限仅淘汰最旧记录。迟到 work 自身 controller/lease 已不可用，即使旧 ID 后来被复用也不能恢复；finally 仅清理同一对象/同一 token，不能误清新的操作。`close` 置 closed 并清 active/retired。

独立16次取消→第17次新请求成功→释放迟到假响应且 HTTP总数仍17 的回归从 RED 转 GREEN；作者新增2槽/20次永久pending/两个 owner 的回归也独立通过。原操作重复 ID 防重放、错误 owner 隔离、timeout、Key轮换及迟到读取保护同时通过。对于故意违反 AbortSignal 契约的宿主适配层，这证明服务管理状态有界、已取消操作不挡重试且不能继续发送 HTTP；不声称 JavaScript 能强制终止该宿主自行保留的外部 I/O。生产接线是原生 `globalThis.fetch`，已发请求实际会收到 aborted signal。

## 当前已核对边界

- contextWindow schema 接受明确未知值 0 或有界的真实正值（至少1024）；仓库保存/公开状态保留 0，不补成猜测的供应商容量。主代理新增保存0/拒绝999的真实临时文件测试已独立通过。
- `localModelRecord` 对未知容量使用 16,000 的内部 prompt guard 预算；WeakMap 快照仍为0，原公开模型不被修改，已知容量照原值使用。`model-context-budget.test.ts` 独立通过；这不代表供应商真实容量为16K或供应商请求已验证。
- 保存仍走版本化 repository 的 CAS/原子提交及既有 OS 保护接口；公开配置去掉密文，safeStorage 异常仍固定脱敏。服务 discover/test 不写仓库。空 Key 只复用同 ID、enabled、provider/protocol/endpoint/kind 的确认授权；授权版本在读取 Key 前后与实际 HTTP 前核验。删除/轮换 Key 会取消已保存授权操作；独立草稿取消不撤销旧记录。
- 新 preload 仅导出明确 discover/test/cancel 方法；main handler 用可信窗口检查、UUID operationId 与 sender ID 作为 owner。关闭/renderer消失/主帧导航触发 owner 撤销。受控测试确认错误 owner 不能取消另一窗口请求，正确 owner 可及时返回取消，取消后新操作可继续执行；实际窗口行为未由本次审核运行。
- 服务严格校验 draft 类型、长度、协议、预设地址和同范围 Key，凭据仅在 main 本批临时授权内使用；错误只返回固定消息/代码与可选数字 status，不回显供应商 body、statusText、异常或 Key。目录身份、标签、思考元数据若回显 Key，输出前拒绝；不会由测试响应将生成内容返给 renderer。
- 网络按固定 timeout、页数、总条目、单响应字节数、并行操作数限界；超限不返回截断的完整目录。Google 原生 Models 分页/Header 与文字 compatibility 测试路径明确分开；Anthropic cursor、xAI 分类资源、已知/未知输出分类定向检查。未知 context 不凭名称补值；能力来源/source/checkedAt 和 permission/complete 实际填充，静态文档快照标为 unknown、不完整，不冒充 Key 权限全集。
- 单模型测试要求明确 charge authorization、使用被冻结的 modelId、短文本或同步1图；HTTP200 的业务错误/空内容/仅异步 taskId不算成功。不下载图片、不自动保存配置、不修改智能体默认值。未实现的供应商适配返回明确 UNSUPPORTED，不发猜测的付费请求；这属于未完成范围而非全部供应商通过。

## 独立测试证据

Node24.19.0：初始模型仓库9项和模型内部预算1项分别独立 GREEN，使用临时文件/公开假 Key/保护替身，不是原生 safeStorage 或供应商验收。

新增必要 RED 后，独立执行：

```text
node --import tsx --test tests/unit/model-provider-alias.test.ts tests/unit/model-repository.test.ts
```

14顶层测试：10通过/4失败、无取消/跳过，退出码1。4个失败分别为两供应商别名的思考选项缺失、默认模型停用与重新启用仍high。

复审独立执行 `model-configuration.test.ts`、`model-provider-alias.test.ts`、`model-repository.test.ts`、`model-context-budget.test.ts`：当轮36项/36通过，退出码0。使用真实仓库临时文件与假 HTTP/保护替身；供应商调用由受控 fetch 代替。配置作者随后追加适配用例，该36项是当轮证据，不冒充最新总数或完整供应商验收。

随后独立执行新增 `model-configuration-cancellation.test.ts`：首审1项/1失败，退出码1；MC-03修复后同一回归通过。最终独立执行：

```text
node --import tsx --test tests/unit/model-configuration.test.ts tests/unit/model-configuration-cancellation.test.ts tests/unit/model-provider-alias.test.ts tests/unit/model-repository.test.ts tests/unit/model-context-budget.test.ts
```

Node24.19.0，44项全部通过，0失败/取消/跳过，退出码0。其中模型配置28项、独立取消1项、别名3项、仓库11项、预算1项。包含分页/目录数量/响应字节上限、正确协议路径/鉴权头、密钥回显拒绝、固定错误、HTTP200假成功拒绝、saved scope/授权轮换、取消槽回收、未知容量、默认引用与思考协调。`docs/evidence/model-configuration/08-green.tap` 是配置作者当轮29项的证据；上述44项是本审核者随后独立跑出的结果，来源分开。

## 明确未完成或未验收的范围

- 当前阿里巴巴、腾讯、字节跳动目录 adapter 返回 UNSUPPORTED_DISCOVERY，未发送猜测的 `/models`。智谱与MiniMax返回文档型号快照，标为不完整、权限unknown；动态目录中未知输出型号亦使complete=false。因此不能宣称12家完整目录及所有 Key 的授权全集已实现/通过；仍需完成产品要求的完整官方/授权目录适配。
- Google、阿里巴巴、腾讯、字节跳动的图像最小调用尚未实现；不会猜发 OpenAI 图像请求。已实现同步图像测试只验证单模型一张的响应结构，不下载资源、不保存图、不证明实际生成全链或供应商当前权限。实际图像生成/资源下载仍在后续范围。
- Moonshot/Xiaomi目录新增了明确端点与精确 ID 的能力注释，未知名称不按前缀猜测；短文本探针的参数/请求结构已由假响应断言。本审核没有调用真实供应商、取得真实Key全集或独立重做所有官方能力事实调研。静态能力来源核验归对应供应商调研，真实供应商差异仍须执行正式场景。
- 单元mock与OS保护替身不算原生safeStorage、GUI、Windows、安装包或完整桌面验收。配置草稿与保存/取消的实际界面交互属于独立UI审核及原生场景；此审核未运行Electron，也未把38的外观冒烟证据当作39模型配置验收。

本轮未发现上述已实现链路中的剩余阻断代码缺陷；未完成的适配和真实验收继续保留，不由限定代码审核结论消除。
