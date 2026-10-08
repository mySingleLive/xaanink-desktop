import type { AIModel } from "@/generated/prisma/client"
import type { PublicModel } from "@desktop/core/settings"
import { LOCAL_AUTHOR_ID, getDatabaseContext } from "@desktop/service/context"
import { currentChatExecution, outsideChatExecution } from "@/lib/chat-execution"
import { prisma } from "@/lib/db"

type CostRates = Pick<AIModel, "inputCostPer1k" | "outputCostPer1k">

/** 按每 1k token 单价估算一次调用的成本 */
export function estimateCost(
  model: CostRates,
  promptTokens: number,
  completionTokens: number
): number {
  return (
    (promptTokens / 1000) * model.inputCostPer1k +
    (completionTokens / 1000) * model.outputCostPer1k
  )
}

export interface QuotaInfo {
  /** 注意：DB 中为 BigInt，这里转成 number 便于 JSON 序列化 */
  tokenQuota: number
  tokenUsed: number
  remaining: number
}

/** Desktop callers retain the service contract; their own API account controls usage. */
export async function checkQuota(userId: string): Promise<QuotaInfo> {
  getDatabaseContext()
  if (userId !== LOCAL_AUTHOR_ID) throw new Error("本地作者身份不匹配")
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenUsed: true } })
  return { tokenQuota: Number.MAX_SAFE_INTEGER, tokenUsed: Number(user.tokenUsed), remaining: Number.MAX_SAFE_INTEGER }
}

export interface RecordUsageInput {
  turnId?: string
  attemptId?: string
  userId: string
  novelId?: string
  modelId: string
  modelSnapshot: PublicModel
  /** 调用场景标识，如 outline.generate / chapter.generate / test.generate */
  action: string
  promptTokens: number
  completionTokens: number
}

/**
 * 记录一次调用的用量：事务内插入 UsageRecord 并累加 user.tokenUsed。
 * 返回本次成本（由模型单价计算）。
 */
export function recordUsage(input: RecordUsageInput): Promise<number> {
  const scope = currentChatExecution()
  return outsideChatExecution(() => recordActualUsage({ ...input, turnId: input.turnId ?? scope?.turnId, attemptId: input.attemptId ?? scope?.attemptId }))
}
async function recordActualUsage(input: RecordUsageInput): Promise<number> {
  const model = structuredClone(input.modelSnapshot)
  if (model.id !== input.modelId || input.userId !== LOCAL_AUTHOR_ID) throw new Error("用量记录的模型或作者不匹配")
  const priceConfigured = model.inputCostPer1k !== undefined && model.outputCostPer1k !== undefined
  const cost = priceConfigured ? estimateCost({ inputCostPer1k: model.inputCostPer1k!, outputCostPer1k: model.outputCostPer1k! }, input.promptTokens, input.completionTokens) : 0
  const total = input.promptTokens + input.completionTokens

  await prisma.$transaction(async tx => {
    // References are inert and local. Removing a configured model never deletes usage history.
    await tx.aIModel.upsert({ where: { id: model.id }, create: { id: model.id, name: model.name, provider: model.provider, modelId: model.modelId, kind: model.kind, apiKeyEncrypted: "", baseUrl: null, enabled: false, free: false, inputCostPer1k: 0, outputCostPer1k: 0 }, update: {} })
    await Promise.all([
    tx.usageRecord.create({
      data: {
        userId: input.userId,
        turnId: input.turnId,
        attemptId: input.attemptId,
        novelId: input.novelId ?? null,
        modelId: input.modelId,
        modelSnapshot: { id: model.id, name: model.name, provider: model.provider, modelId: model.modelId, kind: model.kind, authRevision: model.authRevision, priceConfigured, inputCostPer1k: model.inputCostPer1k ?? null, outputCostPer1k: model.outputCostPer1k ?? null },
        action: input.action,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        cost,
      },
    }),
    tx.user.update({
      where: { id: input.userId },
      data: { tokenUsed: { increment: total } },
    }),
  ])
  })

  return cost
}
