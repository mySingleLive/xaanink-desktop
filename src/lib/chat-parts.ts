import { z } from "zod"
import { storyTaskActionSchema } from "./story-task"
import { SCORE_TARGET_TYPES } from "./score-types"
import { planningAdjustmentSchema } from "./planning-adjustment"
const base = { id: z.string(), seq: z.number().int().nonnegative() }
export const planProposalSchema = z.object({
  title: z.string().trim().min(1).max(100), entryIntent: z.string().trim().min(1).max(500), replaceGoal: z.boolean().default(false),
  items: z.array(z.object({ label: z.string().trim().min(1).max(200), nodeId: z.enum(["theme", "world", "character", "setting", "outline", "content", "novel", "manual"]), targetId: z.string().optional() })).min(1).max(30),
})
/** 正文改进对话框的抽卡载荷（仅 CHAPTER_CONTENT 合法，validateChatAction 复核）：数量为 1~5，字数为成对上下限，items 为勾选的改进项全量 */
export const improveDrawItemSchema = z.object({
  id: z.string().min(1).max(120),
  group: z.enum(["dimension", "report", "ai-comment", "user-comment", "custom"]),
  label: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(500),
  aspect: z.string().trim().min(1).max(50).optional(),
})
export const improveDrawSchema = z.object({
  count: z.number().int().min(1).max(5),
  wordMin: z.number().int().positive(),
  wordBudget: z.number().int().positive(),
  items: z.array(improveDrawItemSchema).min(1).max(50),
})
export const chatActionSchema = z.discriminatedUnion("kind", [
  storyTaskActionSchema,
  z.object({ kind: z.literal("review"), targetType: z.enum(SCORE_TARGET_TYPES), targetId: z.string().min(1) }),
  z.object({ kind: z.literal("improve"), targetType: z.enum(["CHAPTER_CONTENT", "CHAPTER_OUTLINE", "VOLUME_OUTLINE"]), targetId: z.string().min(1), draw: improveDrawSchema.optional() }),
  z.object({ kind: z.literal("question"), planningAdjustment: planningAdjustmentSchema.optional() }),
  z.object({ kind: z.literal("finalize"), targetType: z.literal("CHAPTER_CONTENT"), targetId: z.string().min(1), expectedVersion: z.number().int().positive(), expectedHash: z.string().length(64), checklistHash: z.string().length(64) }),
])
export type ChatAction = z.infer<typeof chatActionSchema>
export type PlanProposal = z.infer<typeof planProposalSchema>
/** 有效交互立即结束；入参错误最多允许模型修正一次。completeStoryTask 返回 autoProceed（单选项免弹面板）时不停轮：模型须按指令继续执行该任务。 */
export function stopForInteraction(steps: readonly { toolCalls: readonly { toolName: string }[]; toolResults: readonly { toolName: string; output: unknown }[] }[]) {
  const names = new Set(["askUserQuestion", "proposePlan", "requestStoryApproval", "requestContentApproval", "requestStoryRemoval", "completeStoryTask"])
  return steps.flatMap(step => step.toolCalls).filter(call => call.toolName === "askUserQuestion" || call.toolName === "proposePlan").length >= 2 || steps.at(-1)?.toolResults.some(result => names.has(result.toolName) && !!result.output && typeof result.output === "object" && "ok" in result.output && result.output.ok === true && !("alreadyApproved" in result.output && result.output.alreadyApproved === true) && !("autoProceed" in result.output)) === true
}

/** 同参数连续失败三次即停止空转；读工具不能掩盖尚未修正的失败。 */
export function hasRepeatedToolFailure(calls: readonly { toolName: string; input: unknown; output: unknown }[]) {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value
  const counts = new Map<string, number>()
  for (const call of calls) {
    if (!call.output || typeof call.output !== "object" || !("ok" in call.output)) continue
    const key = `${call.toolName}:${JSON.stringify(stable(call.input))}`
    if (call.output.ok === false) counts.set(key, (counts.get(key) ?? 0) + 1)
    else counts.delete(key)
  }
  return [...counts.values()].some(count => count >= 3)
}

/** 服务端终态与前端失败行使用同一个操作对象标识，参数修正不改变对象。 */
export function toolOperationKey(call: { toolName: string; input: unknown }) {
  const input = call.input && typeof call.input === "object" ? call.input as Record<string, unknown> : {}
  const keys = ["key", "targetId", "chapterId", "characterId", "worldId", "settingId", "itemId", "sceneId", "sourceKey", "targetKey", "id", "name", "title"]
  const identity = keys.filter(key => input[key] !== undefined).map(key => [key, input[key]])
  return `${call.toolName}:${JSON.stringify(identity)}`
}

/** 同一对象同一操作修正成功后，早先失败不再让整轮呈现失败；其他对象失败仍保留。 */
export function unresolvedToolFailures(calls: readonly { toolName: string; input: unknown; output: unknown }[]) {
  const latest = new Map<string, { code: string; message: string }>()
  for (const call of calls) {
    if (!call.output || typeof call.output !== "object" || !("ok" in call.output)) continue
    const key = toolOperationKey(call)
    if (call.output.ok !== false) { latest.delete(key); continue }
    const output = call.output as { code?: unknown; message?: unknown }
    latest.set(key, {
      code: typeof output.code === "string" ? output.code : "TOOL_FAILED",
      message: typeof output.message === "string" ? output.message : "部分操作未完成，请查看失败的工具",
    })
  }
  return [...latest.values()]
}

export function hasUnresolvedToolFailures(calls: readonly { toolName: string; input: unknown; output: unknown }[]) {
  return unresolvedToolFailures(calls).length > 0
}

/** 模型连接持续无响应后停止本轮自动续跑；任务总时长不作为失败条件。 */
export function hasModelResponseTimeout(calls: readonly { toolName: string; input: unknown; output: unknown }[]) {
  return unresolvedToolFailures(calls).some(error => error.code === "MODEL_RESPONSE_TIMEOUT")
}

const schema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("text"), text: z.string() }),
  z.object({ ...base, type: z.literal("tool"), toolCallId: z.string() }),
  z.object({ ...base, type: z.literal("status"), status: z.string().optional(), stage: z.string().optional(), error: z.string().optional(), errorCode: z.string().optional(), endedAt: z.string().optional(), startedAt: z.string().optional() }),
  z.object({ ...base, type: z.literal("planRef"), planId: z.string(), title: z.string().optional() }),
  z.object({ ...base, type: z.literal("artifact"), toolCallId: z.string() }),
  z.object({ ...base, type: z.literal("question"), revision: z.number().int().positive(), payload: z.unknown() }),
  z.object({ ...base, type: z.literal("plan"), revision: z.number().int().positive(), payload: planProposalSchema }),
])
export type ChatPart = z.infer<typeof schema>
/** 空/非法旧字段不伪造交错；content/toolCalls 兼容读取。 */
export function parseChatParts(raw: unknown): ChatPart[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const parsed = raw.map(part => schema.safeParse(part)).flatMap(result => result.success ? [result.data] : [])
  const seen = new Set<string>()
  return parsed.filter(part => { if (seen.has(part.id)) return false; seen.add(part.id); return true }).sort((a, b) => a.seq - b.seq)
}
/** 即时状态不经过字符动画；文本一帧一次，flush 用于工具/终态边界。 */
export class FramePublisher<T> {
  private pending: T | undefined
  private frame: number | undefined
  constructor(private publish: (value: T) => void, private schedule: (run: () => void) => number, private cancel: (id: number) => void) {}
  push(value: T, urgent = false) {
    this.pending = value
    if (urgent) return this.flush()
    if (this.frame === undefined) this.frame = this.schedule(() => { this.frame = undefined; this.flush() })
  }
  flush() { if (this.frame !== undefined) this.cancel(this.frame); this.frame = undefined; const value = this.pending; this.pending = undefined; if (value !== undefined) this.publish(value) }
  dispose() { if (this.frame !== undefined) this.cancel(this.frame); this.frame = undefined; this.pending = undefined }
}
