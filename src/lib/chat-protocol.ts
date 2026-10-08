import { z } from "zod"
import { storyTaskNavigationSchema, storySelectionSchema } from "./story-task"
import { chatActionSchema } from "./chat-parts"
import { stagedBatchPayloadSchema } from "./staged-save"
import { workflowApprovalSchema } from "./story-workflow"
import { planningAdjustmentSchema } from "./planning-adjustment"

export const CHAT_HEARTBEAT_MS = 15_000
export const CHAT_LEASE_MS = 60_000
export const CHAT_STALE_MS = 45_000
export const CHAT_SLOW_MS = 90_000
/** 租约过期后的宽限窗口：执行方条件写可重新获租，无本机执行器存活证明时，轮询方过宽限才回收 */
export const RECLAIM_GRACE_MS = 10_000
export const chatRequestSchema = z.object({
  action: chatActionSchema.optional(),
  storySelection: storySelectionSchema.optional(),
  clientRequestId: z.string().min(8).max(140),
  conversationId: z.string().optional(), novelId: z.string().optional(),
  message: z.string().trim().min(1).max(4000).optional(),
  retryOfTurnId: z.string().optional(), resume: z.boolean().default(false),
  mode: z.enum(["standard", "plan"]).default("standard"),
  modelId: z.string().nullable().optional(), thinkingEffort: z.string().nullable().optional(),
  interaction: z.object({ turnId: z.string(), id: z.string(), revision: z.number().int().positive(), action: z.enum(["answer", "approve"]) }).optional(),
  /** 三阶段保存：随消息上行的面板暂存修改批次（阶段三唯一落库入口） */
  stagedChanges: z.array(stagedBatchPayloadSchema).max(8).optional(),
}).refine(input => input.message || input.retryOfTurnId || (input.stagedChanges?.length ?? 0) > 0, { message: "消息不能为空" })
export type ChatRequestInput = z.infer<typeof chatRequestSchema>

export const contentApprovalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("remove"), key: z.string().min(3).max(160), hash: z.string().length(64) }),
  z.object({ kind: z.literal("candidate"), chapterId: z.string(), candidateId: z.string(), expectedVersion: z.number().int().positive(), candidateHash: z.string().length(64) }),
  z.object({ kind: z.literal("finalize"), chapterId: z.string(), expectedVersion: z.number().int().positive(), expectedHash: z.string().length(64), checklistHash: z.string().length(64) }),
])

export const pendingQuestionSchema = z.object({
  planningAdjustment: planningAdjustmentSchema.optional(),
  storyNavigation: storyTaskNavigationSchema.optional(),
  storyApproval: workflowApprovalSchema.optional(),
  contentApproval: contentApprovalSchema.optional(),
  questions: z.array(z.object({ question: z.string().min(1).max(500), options: z.array(z.string().min(1).max(200)).min(1).max(5) })).min(1).max(4),
  markerStyle: z.enum(["letters", "numbers", "stems"]).default("letters"),
  costEstimate: z.discriminatedUnion("kind", [z.object({ kind: z.literal("chapterContent"), wordCount: z.number().int().positive().optional() }), z.object({ kind: z.literal("characterImages"), count: z.number().int().positive() }), z.object({ kind: z.literal("outlineRebuild") })]).optional(),
  /** 抽卡后的选稿问答：同轮成功抽卡的定位信息（服务端附加，仅单问题）；面板据此注入换一批选项 */
  drawRedraw: z.object({ drawId: z.string().min(1), chapterId: z.string().min(1), chapterTitle: z.string().min(1) }).optional(),
}).refine(value => value.storyNavigation?.schemaVersion === 2 || value.questions.every(question => question.options.length >= 2), { message: "普通问题至少需要两个选项" })
export interface ChatInteraction {
  kind: "question" | "planApproval"
  id: string
  revision: number
  payload: unknown
  state: "pending" | "answered" | "skipped" | "approved"
  responseTurnId?: string
  responseMessageId?: string
  responseHash?: string
}
export function connectionFeedback(lastEventAt: number, lastProgressAt: number, now: number) {
  return now - lastEventAt >= CHAT_STALE_MS ? "stale" : now - lastProgressAt >= CHAT_SLOW_MS ? "slow" : "connected"
}
