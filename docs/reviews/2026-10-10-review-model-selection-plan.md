# 已配置审核模型但计划执行仍未选择：技术方案

2026-10-10。用户确认触发为执行或重试计划任务。只修复本次模型选择链路，不做全量回归，不读取真实模型 Key、作品或调用真实供应商。

## 原因与产品行为

计划执行通过真实聊天请求和 SOP 工具完成；计划卡与 sop-plan API 目前仅负责展示。已有聊天回合保存的审核角色为空，provider 把它作为显式 null 交给主进程，因此新保存的默认审核模型不会生效。错误弹窗没有任务审核选择入口，反复打开设置不能修复原任务。不能把主进程的 null 改为全局 fallback，也不能自动换用已有失效模型。

在现有模型错误弹窗中，当当前对话的任务缺少审核模型且已配置默认审核模型时，显示该模型名称和“应用到当前任务”按钮。用户明确点击后保存具体模型 ID，提示手动重新执行；不会自动重发、重新生成或重做计划步骤。默认未配置时继续提供设置入口。当前任务已有非空审核选择时，保持原授权错误，不补位。

## 实现

- 为 Conversation 添加 nullable reviewModelId，表示作者明确补齐的审核选择；旧记录 null，绝不从设置自动回填。
- 为 ChatAttempt 添加 nullable defaultsSnapshot。新尝试保存实际受理快照；scopeFor 优先使用尝试快照，历史没有该字段的尝试仍读原回合快照。ChatTurn、SopPlan、SubAgentRun 与已完成尝试历史不重写。
- 保留原回合审核为空时，作者通过弹窗确认的 Conversation.reviewModelId 可用于后续新回合和新的手动重试尝试。原回合非空审核 ID 始终优先；文本、模式、思考与图像选择仍完全冻结。设置修改本身不影响旧任务。
- 扩展已有 conversations/[id] PATCH，新增严格的 review-selection 操作，携带具体 modelId、预期 turnId/attemptId。先主进程 resolveLocalModel(review, id, selection)，随后会话锁内核对所有权、最新任务/尝试和无活跃执行，且最新有效尝试审核为空，原子保存。拒绝过期任务、运行中、跨会话、非空角色和失效模型；该 PATCH 零生成调用。
- 弹窗异步读取当前对话的最新任务，以 captured conversationId + turnId + attemptId 固定目标；切换/关闭后不应用迟到返回。请求 single-flight，保存失败保留入口及安全文案。界面不把未保存/保存中的设置当成成功。
- 实际执行仍安装 scopeFor 返回的尝试快照；SOP 子任务运行、审核实际 HTTP 和用量记录与该快照一致。本次不另造计划执行 API。

技术复审补充：worker 的真实 model.resolve 调用附带 currentChatExecution 中 keyless conversationId/turnId/attemptId；主进程仅把经过严格 schema 的身份附加到错误事件，不更改模型授权。弹窗只允许事件固定目标与当前会话一致的补齐；没有身份的独立调用仅打开设置。重试基线优先最新 Attempt.defaultsSnapshot，自动重试也复制它，确保补齐 A 后不再回读原 Turn.null。会话迁移的字段白名单、拷贝比较与旧 journal 缺字段兼容须覆盖新增字段并专项验证。

## 验证阶段

技术方案独立审核 → 专项用例独立审核 → 先红后绿实现 → code review → 相关模型默认/授权/聊天重试测试、构建和隔离 Windows Electron。真实供应商不发送；受控 transport 只证明实际 SDK/本地授权链，不能声称真实 DeepSeek 服务验证。
