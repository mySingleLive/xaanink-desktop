import { createHash } from "node:crypto"
import type { Chapter, ChapterStatus, Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError, requireVersion } from "@/lib/content-errors"
import { checkGeneratedContent } from "@/lib/content-policy"
import { countChineseWords } from "@/lib/text"
import { planningSchema } from "@/lib/planning/domain"

export type ContentSource = "manual" | "ai" | "comment" | "restore" | "candidate" | "metadata" | "planning"
export interface ContentReceipt {
  operationId: string
  chapterId: string
  version: number
  contentHash: string
  previousWordCount: number
  wordCount: number
  deltaWordCount: number
  snapshotId: string
}
export interface ChapterRevisionInput {
  userId: string
  novelId: string
  chapterId: string
  expectedVersion: number
  expectedContentHash?: string
  operationId: string
  source: ContentSource
  reason: string
  changes: { content?: string; outline?: string; title?: string; status?: ChapterStatus }
  generation?: { finishReason?: string; targetWordCount?: number; compressionAuthorized?: boolean }
}
export interface ChapterContentInput extends Omit<ChapterRevisionInput, "changes"> { content: string }
export type CommitTransaction = Prisma.TransactionClient
export type CommitEffects = (tx: CommitTransaction, chapter: Chapter, receipt: ContentReceipt) => Promise<void>

export function contentHash(text: string) { return createHash("sha256").update(text, "utf8").digest("hex") }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
  return value
}
export function requestHash(value: unknown) { return contentHash(JSON.stringify(canonical(value))) }
/**
 * ISS-004 防回退：本轮就是作者对同一待确认问题的回答（如选「需要修改，我来说明」）时，
 * 不重复附同一张认可卡（payload 哈希一致即同一张卡）；内容真正变化后哈希改变，同一 key 作为新问题再次出现。
 */
export function isReaskingAnsweredQuestion(answered: { kind?: string; payload?: unknown } | null | undefined, question: unknown): boolean {
  return answered?.kind === "question" && requestHash(answered.payload) === requestHash(question)
}
/** 同操作跨目标竞争也按一个顺序串行；调用方须在任何业务行锁之前调用。 */
export async function lockContentOperation(tx: CommitTransaction, userId: string, operationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${operationId}`}, 0))`
}

export async function ownedChapter(tx: CommitTransaction, userId: string, novelId: string, chapterId: string) {
  const chapter = await tx.chapter.findFirst({ where: { id: chapterId, volume: { novel: { id: novelId, userId, status: { not: "DELETED" } } } } })
  if (!chapter) throw new ContentError("TARGET_NOT_FOUND", "章节不存在或无权访问", 404)
  return chapter
}

/** 现有历史保持原样；新写入的每个 Chapter 修订只有一份不可变快照。 */
export async function snapshotChapter(tx: CommitTransaction, chapter: Chapter, reason: string) {
  const existing = await tx.contentVersion.findFirst({ where: { targetType: "Chapter", targetId: chapter.id, version: chapter.version } })
  if (existing) {
    const snapshot = existing.snapshot as Record<string, unknown> | null
    if (!snapshot || snapshot.content !== chapter.content || snapshot.outline !== chapter.outline) {
      throw new ContentError("SNAPSHOT_CONFLICT", "此修订的历史记录与当前稿不一致，已保留草稿，请先核对历史")
    }
    return existing
  }
  return tx.contentVersion.create({ data: { targetType: "Chapter", targetId: chapter.id, version: chapter.version, snapshot: JSON.parse(JSON.stringify(chapter)), reason } })
}

function verifyReceipt(record: { requestHash: string; result: Prisma.JsonValue }, hash: string): ContentReceipt {
  if (record.requestHash !== hash) throw new ContentError("OPERATION_CONFLICT", "此操作编号已用于不同内容，请核对原提交")
  return record.result as unknown as ContentReceipt
}

/** 仅在拥有目标后读取回执，避免 operationId 枚举绕过权限。 */
export async function getContentReceipt(input: Pick<ChapterRevisionInput, "userId" | "novelId" | "chapterId" | "operationId">, hash?: string) {
  await ownedChapter(prisma, input.userId, input.novelId, input.chapterId)
  const record = await prisma.contentMutation.findUnique({ where: { userId_operationId: { userId: input.userId, operationId: input.operationId } } })
  if (!record) return null
  if (record.novelId !== input.novelId || record.targetId !== input.chapterId) throw new ContentError("OPERATION_CONFLICT", "操作编号与当前目标不一致")
  return hash ? verifyReceipt(record, hash) : record.result as unknown as ContentReceipt
}

/** 调用方拥有的事务扩展点；不能在 effects 中进行网络或模型调用。 */
export async function commitChapterRevisionInTransaction(tx: CommitTransaction, input: ChapterRevisionInput, effects?: CommitEffects): Promise<ContentReceipt> {
  requireVersion(input.expectedVersion)
  if (!input.operationId || input.operationId.length > 160) throw new ContentError("INVALID_OPERATION", "缺少有效操作编号", 400)
  if (input.changes.content !== undefined && input.changes.content.length > 200000) throw new ContentError("CONTENT_TOO_LONG", "正文过长", 400)
  await ownedChapter(tx, input.userId, input.novelId, input.chapterId)
  await lockContentOperation(tx, input.userId, input.operationId)
  const hash = requestHash(input)
  const key = { userId_operationId: { userId: input.userId, operationId: input.operationId } }
  const prior = await tx.contentMutation.findUnique({ where: key })
  if (prior) return verifyReceipt(prior, hash)

  // 所有修订/评论事务按相同顺序先锁章，再校验并写入，防止快照与 CAS 交错。
  await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${input.chapterId} FOR UPDATE`
  const afterLock = await tx.contentMutation.findUnique({ where: key })
  if (afterLock) return verifyReceipt(afterLock, hash)
  const before = await ownedChapter(tx, input.userId, input.novelId, input.chapterId)
  if (before.version !== input.expectedVersion) throw new ContentError("VERSION_CONFLICT", "稿件已有新修订，草稿已保留，请重新比较")
  if (input.expectedContentHash !== undefined && input.expectedContentHash !== contentHash(before.content)) throw new ContentError("CONTENT_HASH_CONFLICT", "正文与已读版本不同，请重新确认")
  const planning = await tx.planningDocument.findUnique({ where: { novelId: input.novelId } })
  const plannedChapter = planning ? planningSchema.parse(planning.data).chapters.find(ch => ch.id === input.chapterId) : null
  if (planning && input.source !== "planning" && (input.changes.outline !== undefined || input.changes.title !== undefined)) throw new ContentError("OUTLINE_PROJECTION_READONLY", "请在叙事线的卷章大纲修改标题与章纲")
  if (plannedChapter && input.changes.content !== undefined && ["ai", "candidate"].includes(input.source) && countChineseWords(input.changes.content) > plannedChapter.wordBudget) throw new ContentError("CHAPTER_BUDGET_EXCEEDED", `正文超过本章${plannedChapter.wordBudget}字上限，请修订候选稿`)
  if (plannedChapter && input.changes.content !== undefined && ["ai", "candidate"].includes(input.source) && countChineseWords(input.changes.content) < plannedChapter.wordMin) throw new ContentError("CHAPTER_BUDGET_UNDER_MIN", `正文低于本章${plannedChapter.wordMin}字下限，请补足候选稿`)
  const content = input.changes.content ?? before.content
  if (input.source === "ai") {
    const check = checkGeneratedContent({ content, previousContent: before.content, ...input.generation })
    if (check.status !== "ready") throw new ContentError("CANDIDATE_REQUIRED", "生成稿需要检查，请先保存为候选稿")
  }
  await snapshotChapter(tx, before, "修改前稿件")
  const changed = content !== before.content
  const wordCount = countChineseWords(content)
  const status = changed ? before.status === "OUTLINE" ? "OUTLINE" : "WRITTEN" : input.changes.status ?? before.status
  const updated = await tx.chapter.updateMany({ where: { id: before.id, version: input.expectedVersion }, data: { ...input.changes, content, wordCount, status, version: { increment: 1 } } })
  if (updated.count !== 1) throw new ContentError("VERSION_CONFLICT", "稿件已有新修订，草稿已保留，请重新比较")
  const chapter = await tx.chapter.findUniqueOrThrow({ where: { id: before.id } })
  const snapshot = await snapshotChapter(tx, chapter, input.reason)
  const receipt: ContentReceipt = { operationId: input.operationId, chapterId: chapter.id, version: chapter.version, contentHash: contentHash(content), previousWordCount: countChineseWords(before.content), wordCount, deltaWordCount: wordCount - countChineseWords(before.content), snapshotId: snapshot.id }
  if (effects) await effects(tx, chapter, receipt)
  const outlineOnly = input.changes.outline !== undefined && input.changes.content === undefined
  await tx.contentMutation.create({ data: { userId: input.userId, novelId: input.novelId, targetType: outlineOnly ? "CHAPTER_OUTLINE" : "CHAPTER_CONTENT", targetId: chapter.id, operationId: input.operationId, requestHash: hash, beforeVersion: before.version, afterVersion: chapter.version, beforeHash: contentHash(outlineOnly ? before.outline : before.content), afterHash: contentHash(outlineOnly ? chapter.outline : chapter.content), result: receipt as unknown as Prisma.InputJsonValue } })
  return receipt
}

export async function commitChapterRevision(input: ChapterRevisionInput, effects?: CommitEffects): Promise<ContentReceipt> {
  try {
    return await prisma.$transaction(tx => commitChapterRevisionInTransaction(tx, input, effects), { timeout: 15000 })
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const prior = await getContentReceipt(input, requestHash(input))
      if (prior) return prior
    }
    throw error
  }
}

export function commitChapterContent(input: ChapterContentInput, effects?: CommitEffects) {
  const { content, ...base } = input
  return commitChapterRevision({ ...base, changes: { content } }, effects)
}
