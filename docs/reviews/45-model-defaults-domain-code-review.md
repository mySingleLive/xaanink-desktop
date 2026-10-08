# 默认模型与业务任务快照独立代码审核

- 日期：2026-10-07
- 审核者：独立子代理 `/root/ui_revision_review`，不是本批业务接线作者。
- 状态：**限定代码审核通过。MD45-01～04 均已修复并独立复审；不代表业务或桌面验收完成。**
- 范围：主进程 ModelService、任务默认值契约与 AsyncLocalStorage、原文字/审核/图像解析入口、聊天接受与恢复、八类持久任务快照及两项迁移、只读模型目录。客户端选择控件由44另审；本审核没有运行 Electron、控制浏览器或修改实现。

## 发现

### MD45-01 · P2 · 成功取Key后的撤销竞态（已修复）

首审 `ModelService.resolve` 只在取Key失败的 catch 中重新检查模型。取Key成功、其 await 回执返回前，模型已轮换授权、停用或删除，仍把首读的可用模型返回给 selection/invoke。最终网关可以再阻断实际HTTP，但不能据此把已失效模型认定为可选择。

独立测试 MR45-01、MR45-02 使用受控异步仓库边界，分别改变授权版本、停用、删除后成功返回公开假Key。预期 AUTHORIZATION_REVOKED，实际未拒绝，得到行为 RED；没有实际HTTP。

修复在成功取Key后重新读取已确认状态，核对同ID启用状态与授权版本，再返回公有模型快照。独立回归全部通过；最终网关逐HTTP的既有核验仍独立存在。

### MD45-02 · P2 · 后续省略mode时回退会话创建模式（已修复）

已有会话创建于 standard，下一回合明确选择 plan，再下一回合省略mode。GET显示最近接受的plan，但 `beginChatRequest` 从 Conversation 创建快照取mode，使新回合变回standard。

MR45-04 使用实际 Workspaces/PGlite、Prisma、会话GET与 `beginChatRequest` 重现：最新接受的模式应继承，同时原会话与旧回合快照保持不变；首审得到 standard≠plan 的 RED。客户端通常发送模式不能消除服务端省略语义不一致。

修复从最新回合快照继承模式，显式新模式优先；重试仍取原回合快照。实际本地回归验证GET、新回合与历史记录一致，创建快照和旧回合没有被重写。

### MD45-03 · P2 · “模型默认”跳过已保存的默认思考属性（已修复）

首审将任务 thinking=default 转为显式 null，再构造模型时绕过 `PublicModel.defaultThinking`。固定型号元数据声明默认为low时，实际SDK请求没有reasoning_effort；直接聊天入口传null或字符串default也有相同行为。

MR45-03使用实际OpenAI SDK与受控HTTP，检查任务记录仍为default，而通用入口、显式null/default应解析成已保存low，明确high应保持high。首审实际值为 `[undefined, undefined, undefined, high]`。此契约来自正式A03用例的声明元数据；没有声称供应商所有型号的默认值都是low。

修复统一在构造调用时将null/default解析成已保存模型默认；模型默认自身为default时仍不强加档位。独立实际SDK请求得到 `[low, low, low, high]`，任务存储保持default。这个定向探针注入SDK fetch边界；main网关与用量落库另由合跑中的真实服务集成夹具覆盖，不能把注入fetch说成原生或真实供应商请求。

### MD45-04 · P2 · 旧任务不支持的显式思考档位未阻断（已修复）

保留的任务选择high，当前模型仅声明支持low。首审通用入口与按ID入口都成功构造模型，可能把不支持的high继续发送。不能静默改变历史任务档位，也不能用全局默认补位。

MR45-05通过受控模型元数据和真实provider入口断言在SDK HTTP前拒绝，首审没有拒绝而RED。修复需要明确、不可自动重试的能力阻断，并保留历史快照。

初次修复只校验型号声明列表，仍可能接受原Web转换器没有实际映射的档位。目录解析可声明Anthropic xhigh，但现有转换器仅映射low/medium/high；MR45-06复现包括该能力也不能代表调用参数已实现。此时应准确阻断，不猜测新供应商参数，也不静默按默认调用。该项属于同一能力与调用一致性边界，不是扩充供应商型号。

最终共同helper同时检查当前型号声明与现有转换器的支持表，轻评审也使用这个helper。未支持/未映射返回固定 ContentError `MODEL_THINKING_UNSUPPORTED`（428），共同异常及wire分类保持该准确code，禁止自动重试。没有降档、改写历史或发送HTTP。独立两个入口及分类回归通过；未来增加新档位映射仍需单独验证。

## 源码核对

任务契约显式挑选五个基本值及版本/时间，冻结为不可变对象；不把Key或未来设置字段写入任务。角色解析区分text/review/image，显式ID和null优先于对应冻结默认；旧无快照记录只保留已有文本ID，审核/图像保持null，不嫁接今天的全局默认。

worker入口创建请求默认快照；聊天执行按已接受回合快照覆盖任务上下文，控制面脱离聊天fence时仍保留任务默认。作者调整全局设置不会改变已捕获的任务对象。审核入口、独立读者评审、SOP judge及情景一致性检查使用review角色，不借用主会话缓存或文本默认。图像解析使用image角色；旧平台Auto/按套餐/按最新记录的替代路径已从本批统一入口移除。

两项迁移给 Conversation、ChatTurn、SubAgentRun、ContentImprovementRun、SopPlan、SopNodeRun、CascadeJob、ScenarioTurn 添加可空JSONB；已有行不以当前配置回填。创建/幂等重放/计划更新保留相应快照，级联后台分支显式继承捕获上下文。这里的档案持久化不等于所有业务可跨进程自动恢复执行。

只读文本/图像目录读取main已保存公有元数据，不调用model.resolve，不解密作品中的参考记录，也不因后台刷新弹出模型配置引导。它不证明实际供应商权限或所有能力已被真实验证。

## 独立证据

新增 `tests/unit/model-defaults-review.test.ts` 与 `tests/integration/task-defaults-review.test.ts`，不修改作者测试或产品实现。

- `docs/evidence/model-defaults-23-independent-red.tap`：初始4个顶层测试、6项计数，0通过/6失败；均为行为断言，退出码1。
- `docs/evidence/model-defaults-24-independent-thinking-red.tap`：扩充实际SDK默认档分支并添加能力阻断后，5个顶层测试、7项计数，0通过/7失败，退出码1。两个disable/delete子用例及其父测试按Node TAP统计计入，不能称7条独立产品缺陷。
- `docs/evidence/model-defaults-29-independent-fixes-green.tap`：前四项初次修复的独立合跑，新增回归7项与共同分类2项，9/9通过、退出码0。
- `docs/evidence/model-defaults-30-independent-mapping-red.tap`：新增未映射能力阻断后，6个顶层测试、8项计数，7通过/1失败、退出码1；没有沿用前一轮GREEN掩盖后续发现。
- `docs/evidence/model-defaults-33-independent-final-green.tap`：最终独立执行10文件，**39/39通过，0失败/取消/跳过、退出码0**；22个顶层测试加其子测试按Node统计。构成为本批8个原测试文件的31项计数与本审核2文件的8项计数，不累计作者重复运行、前一轮GREEN、RED或旧39/43审核数量。
- `docs/evidence/model-defaults-34-independent-typecheck.txt`：最终全项目 `tsc --noEmit --incremental false --pretty false` 退出码0，无诊断。独立测试GET返回值最初缺少可空类型收窄，已通过 `assert.ok(response)` 修正；这是测试类型修正，不作为产品RED。
- 源码/测试最终冻结记录为 `docs/evidence/model-defaults-review-freeze.json`，39文件；初始 `model-defaults-freeze.json` 的37文件保留为历史。实际命令、退出码、最终指纹及证据摘要另存 `model-defaults-35-independent-summary.json`。

上述用例使用真实本地PGlite/Prisma、原服务及SDK，网络为受控HTTP替身、Key保护为隔离替身。旧DEFAULT-07夹具原设low但未声明支持档位，新增能力守卫正确阻断后，作者将自己的夹具改成声明支持low/high的OpenAI型号；保留原快照断言，没有绕过守卫。各八类记录的创建/保留由受控业务边界验证，不声称每类已经实际生成完整结果或实现跨进程恢复。

本批已实现的默认解析与快照链路复审未发现剩余阻断缺陷；结论依赖下面的范围边界，不扩展为全部模型或业务通过。

## 验收边界

本批只能形成默认路由、受控SDK请求及本地持久快照的限定代码结论，不标记任何正式顶层测试用例通过。不把历史原型、作者GREEN或本批mock计作真实GUI/供应商验收。

各供应商实际文生图、授权资产下载、local scheme持久化、Google等native生成入口仍未完成；旧图像生成壳只接了image ID解析与main授权，不能据此宣称全部图像业务已完成。真实Key/safeStorage、原生双平台、安装包、用户任务恢复/全业务流程与客户端选择竞态均需相应独立验证。本审核未测试这些边界，也未开始后续菜单执行/Monaco命令批次。
