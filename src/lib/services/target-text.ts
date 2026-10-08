import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError, requireVersion } from "@/lib/content-errors"
import { commitChapterRevisionInTransaction, contentHash, lockContentOperation, ownedChapter, requestHash, type CommitTransaction, type ContentReceipt } from "./content-commit"
import { lockSceneTree, writeSceneRevision } from "./scene"
import { lockWorldTree } from "./world-guard"

export type TextTargetType = "CHAPTER_CONTENT" | "CHAPTER_OUTLINE" | "WORLD" | "SETTING" | "SCENE" | "CANDIDATE_CONTENT"
export interface TextScope { userId: string; novelId: string; targetType: string; targetId: string }
export interface TextBaseline { version: number | null; updatedAt: string; hash: string }
export interface TextState extends TextBaseline { text: string }
export interface TextReceipt extends TextBaseline {
  operationId: string; targetType: string; targetId: string; snapshotId: string; chapterReceipt?: ContentReceipt
  metadata?: { name: string; parentId: string | null }
}
export interface TextCommitInput extends TextScope {
  operationId: string; baseline: TextBaseline; text: string; reason: string
  source?: "manual" | "comment"; name?: string; parentId?: string | null
  /** 内部适配器冻结原请求的指纹（如仅改世界名时，正文由服务端补齐）；HTTP 不接收此字段。 */
  operationFingerprint?: string
}

export function settingText(content: Prisma.JsonValue): string {
  if (typeof content === "string") return content
  if (content && !Array.isArray(content) && typeof content === "object" && typeof content.text === "string") return content.text
  throw new ContentError("UNSUPPORTED_TARGET", "该设定不是可评论的文本字段", 422)
}

export async function readTextTarget(tx: CommitTransaction, scope: TextScope): Promise<TextState> {
  const owner = await tx.novel.findFirst({ where: { id: scope.novelId, userId: scope.userId, status: { not: "DELETED" } }, select: { id: true } })
  if (!owner) throw new ContentError("TARGET_NOT_FOUND", "目标不存在或无权访问", 404)
  if (scope.targetType === "CHAPTER_CONTENT" || scope.targetType === "CHAPTER_OUTLINE") {
    const row = await ownedChapter(tx, scope.userId, scope.novelId, scope.targetId)
    const text = scope.targetType === "CHAPTER_CONTENT" ? row.content : row.outline
    return { text, version: row.version, updatedAt: row.updatedAt.toISOString(), hash: contentHash(text) }
  }
  if (scope.targetType === "WORLD") {
    const row = await tx.world.findFirst({ where: { id: scope.targetId, novelId: scope.novelId } })
    if (!row) throw new ContentError("TARGET_NOT_FOUND", "世界不存在", 404)
    return { text: row.description, version: null, updatedAt: row.updatedAt.toISOString(), hash: contentHash(row.description) }
  }
  if (scope.targetType === "SETTING") {
    const row = await tx.setting.findFirst({ where: { id: scope.targetId, novelId: scope.novelId } })
    if (!row) throw new ContentError("TARGET_NOT_FOUND", "设定不存在", 404)
    const text = settingText(row.content)
    return { text, version: row.version, updatedAt: row.updatedAt.toISOString(), hash: contentHash(text) }
  }
  if (scope.targetType === "SCENE") {
    const row = await tx.scene.findFirst({where: {id: scope.targetId, novelId: scope.novelId}})
    if (!row) throw new ContentError("TARGET_NOT_FOUND", "场景不存在", 404)
    return {text: row.description, version: row.version, updatedAt: row.updatedAt.toISOString(), hash: contentHash(row.description)}
  }
  // 候选稿：ready 后内容不可变，版本恒 null（锚点永不成孤儿，只读不提供写入）
  if (scope.targetType === "CANDIDATE_CONTENT") {
    const row = await tx.contentCandidate.findFirst({ where: { id: scope.targetId, novelId: scope.novelId } })
    if (!row) throw new ContentError("TARGET_NOT_FOUND", "候选稿不存在", 404)
    return { text: row.content, version: null, updatedAt: row.updatedAt.toISOString(), hash: contentHash(row.content) }
  }
  throw new ContentError("UNSUPPORTED_TARGET", "不支持的评论目标", 422)
}

export async function lockTextTarget(tx: CommitTransaction, scope: TextScope) {
  if (scope.targetType === "CHAPTER_CONTENT" || scope.targetType === "CHAPTER_OUTLINE") await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${scope.targetId} FOR UPDATE`
  else if (scope.targetType === "WORLD") { await lockWorldTree(tx, scope.novelId); await tx.$queryRaw`SELECT id FROM "World" WHERE id = ${scope.targetId} FOR UPDATE` }
  else if (scope.targetType === "SCENE") await tx.$queryRaw`SELECT id FROM "Scene" WHERE id = ${scope.targetId} FOR UPDATE`
  else if (scope.targetType === "SETTING") await tx.$queryRaw`SELECT id FROM "Setting" WHERE id = ${scope.targetId} FOR UPDATE`
  else if (scope.targetType === "CANDIDATE_CONTENT") await tx.$queryRaw`SELECT id FROM "ContentCandidate" WHERE id = ${scope.targetId} FOR UPDATE`
  else throw new ContentError("UNSUPPORTED_TARGET", "不支持的评论目标", 422)
}

export function assertTextBaseline(current: TextState, baseline?: TextBaseline) {
  if (!baseline || !baseline.hash || !baseline.updatedAt) throw new ContentError("PRECONDITION_REQUIRED", "缺少稿件基线，请刷新后重新比较；草稿已保留", 428)
  if (current.version !== null) requireVersion(baseline.version)
  if (current.hash !== baseline.hash || current.version !== baseline.version || current.updatedAt !== baseline.updatedAt) {
    throw new ContentError("VERSION_CONFLICT", "原文已有修改，请保留草稿并重新比较")
  }
}

export async function findTextReceipt(tx: CommitTransaction, scope: TextScope, operationId: string, hash: string) {
  const record = await tx.contentMutation.findUnique({ where: { userId_operationId: { userId: scope.userId, operationId } } })
  if (!record) return null
  if (record.novelId !== scope.novelId || record.targetId !== scope.targetId || record.targetType !== scope.targetType || record.requestHash !== hash) throw new ContentError("OPERATION_CONFLICT", "此操作编号已用于不同请求")
  return record.result as unknown as TextReceipt
}

/** 全部调用方必须在目标行锁之后，才锁评论和补丁。 */
export async function commitTargetTextInTransaction(tx: CommitTransaction, input: TextCommitInput, effects?: (tx: CommitTransaction, receipt: TextReceipt) => Promise<void>): Promise<TextReceipt> {
  if (!input.operationId || input.operationId.length > 160) throw new ContentError("INVALID_OPERATION", "缺少有效操作编号", 400)
  if (input.text.length > 200000) throw new ContentError("CONTENT_TOO_LONG", "文本过长", 400)
  if (input.targetType === "SCENE") {
    if (input.name !== undefined || input.parentId !== undefined) throw new ContentError("UNSUPPORTED_TARGET", "场景文本口仅允许修改介绍", 400)
    if (input.text.length > 5000) throw new ContentError("CONTENT_TOO_LONG", "场景介绍不能超过5000字", 400)
    await lockSceneTree(tx, input.novelId)
  }
  await readTextTarget(tx, input)
  await lockContentOperation(tx, input.userId, input.operationId)
  const hash = input.operationFingerprint ?? requestHash(input)
  const prior = await findTextReceipt(tx, input, input.operationId, hash)
  if (prior) return prior
  await lockTextTarget(tx, input)
  const before = await readTextTarget(tx, input)
  assertTextBaseline(before, input.baseline)
  let snapshotId: string
  let chapterReceipt: ContentReceipt | undefined
  if (input.targetType === "CHAPTER_CONTENT" || input.targetType === "CHAPTER_OUTLINE") {
    chapterReceipt = await commitChapterRevisionInTransaction(tx, {
      userId: input.userId, novelId: input.novelId, chapterId: input.targetId,
      expectedVersion: before.version!, operationId: input.operationId,
      source: input.source ?? "comment", reason: input.reason,
      changes: input.targetType === "CHAPTER_CONTENT" ? { content: input.text } : { outline: input.text },
    })
    snapshotId = chapterReceipt.snapshotId
  } else if (input.targetType === "SCENE") {
    const row = await tx.scene.findUniqueOrThrow({where: {id: input.targetId}})
    snapshotId = (await writeSceneRevision(tx, row, {description: input.text}, input.reason)).snapshot.id
  } else if (input.targetType === "SETTING") {
    const row = await tx.setting.findUniqueOrThrow({ where: { id: input.targetId } })
    const old = await tx.contentVersion.findFirst({ where: { targetType: "Setting", targetId: row.id, version: row.version } })
    if (old && requestHash((old.snapshot as Record<string, unknown>)?.content) !== requestHash(row.content)) throw new ContentError("SNAPSHOT_CONFLICT", "设定历史与当前修订不一致，请先核对")
    if (!old) await tx.contentVersion.create({ data: { targetType: "Setting", targetId: row.id, version: row.version, snapshot: JSON.parse(JSON.stringify(row)), reason: "修改前设定" } })
    const content = typeof row.content === "string" ? input.text : { ...(row.content as Prisma.InputJsonObject), text: input.text }
    const result = await tx.setting.updateMany({ where: { id: row.id, version: before.version!, updatedAt: new Date(before.updatedAt) }, data: { content, ...(input.name === undefined ? {} : { name: input.name }), version: { increment: 1 } } })
    if (result.count !== 1) throw new ContentError("VERSION_CONFLICT", "设定已有修改")
    const next = await tx.setting.findUniqueOrThrow({ where: { id: row.id } })
    snapshotId = (await tx.contentVersion.create({ data: { targetType: "Setting", targetId: row.id, version: next.version, snapshot: JSON.parse(JSON.stringify(next)), reason: input.reason } })).id
  } else if (input.targetType === "CANDIDATE_CONTENT") {
    // 候选稿只读：显式拦截，防止落入 WORLD else 分支误写
    throw new ContentError("TARGET_READONLY", "候选稿为只读稿，不能提交改写", 422)
  } else {
    const op = `${input.userId}:${input.operationId}`
    await tx.targetTextRevision.create({ data: { operationId: op, targetType: "WORLD", targetId: input.targetId, field: "description", side: "before", text: before.text, hash: before.hash } })
    const updated = await tx.world.updateMany({ where: { id: input.targetId, updatedAt: new Date(before.updatedAt), description: before.text }, data: { description: input.text, ...(input.name === undefined ? {} : { name: input.name }), ...(input.parentId === undefined ? {} : { parentId: input.parentId }) } })
    if (updated.count !== 1) throw new ContentError("VERSION_CONFLICT", "世界观已有修改")
    snapshotId = (await tx.targetTextRevision.create({ data: { operationId: op, targetType: "WORLD", targetId: input.targetId, field: "description", side: "after", text: input.text, hash: contentHash(input.text) } })).id
  }
  const after = await readTextTarget(tx, input)
  const receipt: TextReceipt = { operationId: input.operationId, targetType: input.targetType, targetId: input.targetId, version: after.version, updatedAt: after.updatedAt, hash: after.hash, snapshotId, ...(chapterReceipt ? { chapterReceipt } : {}) }
  if (input.targetType === "WORLD") {
    const metadata = await tx.world.findUniqueOrThrow({ where: { id: input.targetId }, select: { name: true, parentId: true } })
    receipt.metadata = metadata
  }
  if (effects) await effects(tx, receipt)
  const data = { userId: input.userId, novelId: input.novelId, targetType: input.targetType, targetId: input.targetId, operationId: input.operationId, requestHash: hash, beforeVersion: before.version, afterVersion: after.version, beforeHash: before.hash, afterHash: after.hash, result: receipt as unknown as Prisma.InputJsonValue }
  if (chapterReceipt) await tx.contentMutation.update({ where: { userId_operationId: { userId: input.userId, operationId: input.operationId } }, data })
  else await tx.contentMutation.create({ data })
  return receipt
}

export function commitTargetText(input: TextCommitInput) { return prisma.$transaction(tx => commitTargetTextInTransaction(tx, input), { timeout: 15000 }) }

/** 回放原回执读取不可变文本，不能把后来版本冒充首次提交结果。 */
export async function committedTargetText(scope: TextScope, receipt: TextReceipt) {
  await readTextTarget(prisma, scope)
  if (receipt.targetType !== scope.targetType || receipt.targetId !== scope.targetId) throw new ContentError("TARGET_NOT_FOUND", "提交记录不属于此目标", 404)
  let text: string
  if (scope.targetType === "WORLD") {
    const row = await prisma.targetTextRevision.findFirst({ where: { id: receipt.snapshotId, targetType: scope.targetType, targetId: scope.targetId } })
    if (!row) throw new ContentError("SNAPSHOT_NOT_FOUND", "文本修订不存在", 404)
    text = row.text
  } else {
    const row = await prisma.contentVersion.findFirst({ where: { id: receipt.snapshotId, targetId: scope.targetId, targetType: scope.targetType === "SCENE" ? "Scene" : scope.targetType === "SETTING" ? "Setting" : "Chapter" } })
    if (!row) throw new ContentError("SNAPSHOT_NOT_FOUND", "快照不存在", 404)
    const snapshot = row.snapshot as Record<string, Prisma.JsonValue>
    text = scope.targetType === "SCENE" ? snapshot.description as string : scope.targetType === "SETTING" ? settingText(snapshot.content) : snapshot[scope.targetType === "CHAPTER_OUTLINE" ? "outline" : "content"] as string
  }
  if (typeof text !== "string" || contentHash(text) !== receipt.hash) throw new ContentError("SNAPSHOT_CONFLICT", "提交快照损坏，已保留历史", 422)
  return text
}
