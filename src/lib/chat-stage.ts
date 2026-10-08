/** 仅映射已收到的服务端阶段，不根据静默时长猜测模型已开始。 */
export function chatStageLabel(stage: string) {
  return ({ queued: "排队等待运行", preparing: "正在准备上下文", waiting_model: "正在等待模型", retrying: "正在准备重试", thinking: "正在思考", responding: "正在回复", executing_tool: "正在执行工具" } as Record<string, string>)[stage] ?? "正在处理"
}
