import { asSchema, type ModelMessage, type ToolSet } from "ai"
import { effectiveBudget, estimateTokens } from "./context-budget"
import { ContextBudgetError, compactSuccessfulToolOutput } from "./context-protection"
import { WRITE_TOOL_NAMES } from "./tool-names"

/** 只压缩明确成功的领域产物；未知、错误和交互输出保留原始结果。 */
export function compactCompletedMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.map(message => message.role !== "tool" ? message : { ...message, content: message.content.map(part => {
    // 读工具是模型此刻所需的事实原文，不能在模型看到之前就改成引用。
    if (part.type !== "tool-result" || part.output.type !== "json" || !WRITE_TOOL_NAMES.has(part.toolName)) return part
    const value = part.output.value
    if (!value || typeof value !== "object" || Array.isArray(value) || !("ok" in value) || value.ok !== true) return part
    return { ...part, output: { type: "json" as const, value: compactSuccessfulToolOutput(value) as typeof value } }
  }) })
}

export async function estimateToolTokens(tools: ToolSet) {
  const schemas = await Promise.all(Object.entries(tools).map(async ([name, tool]) => ({ name, description: tool.description, parameters: await asSchema(tool.inputSchema).jsonSchema })))
  return estimateTokens(JSON.stringify(schemas))
}
export function estimateModelPrompt(system: string, messages: ModelMessage[], toolTokens = 0) {
  return estimateTokens(system) + estimateTokens(JSON.stringify(messages)) + messages.length * 8 + toolTokens
}
/** 每个模型步骤再次检查工具回读增长；超限停止，绝不静默删消息。 */
export function assertPromptFits(system: string, messages: ModelMessage[], toolTokens: number, contextWindow: number, calibration = 1) {
  const estimate = estimateModelPrompt(system, messages, toolTokens)
  if (Math.ceil(estimate * calibration) > effectiveBudget(contextWindow)) throw new ContextBudgetError()
  return estimate
}
