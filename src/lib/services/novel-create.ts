import { z } from "zod"
import { getDatabaseContext } from "@desktop/service/context"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { emptyPlanning } from "@/lib/planning/domain"
import { lockContentOperation, requestHash } from "./content-commit"
import { novelPositionSchema } from "@/lib/creation-wizard/position"

export const novelCreationSchema = z.object({
  title: z.string().trim().min(1, "书名不能为空").max(100, "书名最长 100 字"),
  /** 一句话故事核心（脑洞延迟建档）：存为初始主题简介；不参与幂等指纹 */
  premise: z.string().trim().min(1).max(500).optional(),
  requestId: z.string().min(8).max(140),
  position: novelPositionSchema.optional(),
})
export interface NovelCreationReceipt { id: string; title: string; status: string; currentStage: string; createdAt: string; updatedAt: string }
export async function createNovelOnce(userId: string, input: unknown,assertCreation?:()=>void): Promise<NovelCreationReceipt> {
  assertCreation?.()
  if (!getDatabaseContext().allowNovelCreation) throw new ContentError("DIRECTORY_REQUIRED", "请先选择本地作品目录", 428)
  if (!input || typeof input !== "object" || !("requestId" in input)) throw new ContentError("PRECONDITION_REQUIRED", "缺少建书请求编号，草稿已保留，请刷新后重试", 428)
  const parsed = novelCreationSchema.safeParse(input)
  if (!parsed.success) throw new ContentError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "参数不合法", 400)
  const { title, premise, requestId, position } = parsed.data
  const hash = requestHash({ title, ...(position ? { position } : {}) })
  return prisma.$transaction(async tx => {
    assertCreation?.()
    await lockContentOperation(tx, userId, `novel-create:${requestId}`)
    assertCreation?.()
    const previous = await tx.novelCreationRequest.findUnique({ where: { userId_requestId: { userId, requestId } } })
    assertCreation?.()
    if (previous) {
      if (previous.requestHash !== hash) throw new ContentError("REQUEST_CONFLICT", "此建书请求的书名或作品定位已变化，请核对原请求；草稿已保留")
      const owned = await tx.novel.findFirst({ where: { id: previous.novelId, userId, status: { not: "DELETED" } }, select: { id: true } })
      assertCreation?.()
      if (!owned) throw new ContentError("NOVEL_UNAVAILABLE", "此请求创建的作品已删除，请重新创建", 410)
      return previous.result as unknown as NovelCreationReceipt
    }
    const novel = await tx.novel.create({ data: { userId, title, currentStage: "THEME", theme: { create: { title, synopsis: premise ?? "", referenceCases: "", channel: "", genre: "", tags: [], sellingPoints: "", targetAudience: "", ...(position ? { ...position, authorPosition: position } : {}) } } },
      select: { id: true, title: true, status: true, currentStage: true, createdAt: true, updatedAt: true } })
    assertCreation?.()
    // 新书自始接入规划投影：空 PlanningDocument 同事务写入（version=1）
    await tx.planningDocument.create({ data: { novelId: novel.id, version: 1, data: JSON.parse(JSON.stringify(emptyPlanning())) } })
    assertCreation?.()
    const result = { ...novel, createdAt: novel.createdAt.toISOString(), updatedAt: novel.updatedAt.toISOString() }
    await tx.novelCreationRequest.create({ data: { userId, requestId, requestHash: hash, novelId: novel.id, result } })
    assertCreation?.()
    return result
  })
}
