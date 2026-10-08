import { lockTextTarget } from "./target-text"
import type { CommentAuthorType, CommentStatus, TextComment, Prisma } from "@/generated/prisma/client"
import { anchorContext, resolveWriteAnchor } from "@/lib/comment-anchor"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { contentHash } from "./content-commit"
import { commitTargetText, settingText, type TextBaseline } from "./target-text"
export { prepareCommentChange as applyCommentRewrite, commitCommentChange as applyCommentRewriteAndCommit, handleCommentChange as handleCommentById } from "./comment-change"

/** 锚点定位失败：quote 在目标原文中找不到 */
export class CommentAnchorNotFoundError extends Error {
  constructor(message = "没能在原文中找到这段文字") {
    super(message)
    this.name = "CommentAnchorNotFoundError"
  }
}

/** 评论目标不存在、不属于该小说或不支持评论（如 JSON 型设定） */
export class CommentTargetNotFoundError extends Error {
  constructor(message = "评论目标不存在") {
    super(message)
    this.name = "CommentTargetNotFoundError"
  }
}

/** 评论不存在或不属于该小说 */
export class CommentNotFoundError extends Error {
  constructor(message = "评论不存在") {
    super(message)
    this.name = "CommentNotFoundError"
  }
}

/**
 * 行内评论 DTO（与前端 src/components/comments/types.ts 的契约一致，
 * createdAt/updatedAt 序列化为 ISO 字符串）。
 */
export interface TextCommentDTO {
  id: string
  novelId: string
  targetType: string
  targetId: string
  parentId: string | null
  quote: string | null
  prefix: string | null
  suffix: string | null
  startOffset: number | null
  endOffset: number | null
  authorType: CommentAuthorType
  authorId: string | null
  authorName: string
  content: string
  status: CommentStatus
  reviewId: string | null
  createdAt: string
  updatedAt: string
}

export interface TextCommentThread extends TextCommentDTO {
  replies: TextCommentDTO[]
}

function toDTO(comment: TextComment): TextCommentDTO {
  return {
    ...comment,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  }
}

/**
 * 按 targetType 取出被评论的原文文本，并校验归属（novelId）：
 * CHAPTER_OUTLINE 章大纲 / CHAPTER_CONTENT 章正文 / WORLD 世界观介绍 / SETTING 纯文本设定 / CANDIDATE_CONTENT 候选稿正文。
 * 查不到抛 CommentTargetNotFoundError；JSON 结构型设定不支持评论。
 */
export async function resolveTargetText(
  novelId: string,
  targetType: string,
  targetId: string,
  client: Prisma.TransactionClient = prisma
): Promise<string> {
  if (targetType === "CHAPTER_OUTLINE" || targetType === "CHAPTER_CONTENT") {
    const chapter = await client.chapter.findUnique({
      where: { id: targetId },
      include: { volume: true },
    })
    if (!chapter || chapter.volume.novelId !== novelId) {
      throw new CommentTargetNotFoundError("章节不存在")
    }
    return targetType === "CHAPTER_OUTLINE" ? chapter.outline : chapter.content
  }

  if (targetType === "WORLD") {
    const world = await client.world.findUnique({ where: { id: targetId } })
    if (!world || world.novelId !== novelId) {
      throw new CommentTargetNotFoundError("世界不存在")
    }
    return world.description
  }

  if (targetType === "SCENE") {
    const scene = await client.scene.findFirst({where: {id: targetId, novelId}})
    if (!scene) throw new CommentTargetNotFoundError("场景不存在")
    return scene.description
  }
  if (targetType === "SETTING") {
    const setting = await client.setting.findUnique({ where: { id: targetId } })
    if (!setting || setting.novelId !== novelId) {
      throw new CommentTargetNotFoundError("设定不存在")
    }
    return settingText(setting.content)
  }

  if (targetType === "CANDIDATE_CONTENT") {
    const candidate = await client.contentCandidate.findFirst({ where: { id: targetId, novelId } })
    if (!candidate) {
      throw new CommentTargetNotFoundError("候选稿不存在")
    }
    return candidate.content
  }

  throw new CommentTargetNotFoundError("不支持的评论目标类型")
}

/** 旧无版本调用失败关闭，所有目标统一有历史和 CAS。 */
export async function writeTargetText(novelId: string, targetType: string, targetId: string, text: string, options?: { userId: string; operationId: string; baseline: TextBaseline }) {
  if (!options) throw new ContentError("PRECONDITION_REQUIRED", "缺少文本提交基线，请重新读取", 428)
  return commitTargetText({ ...options, novelId, targetType, targetId, text, reason: "文本更新" })
}

/** 按 id 取单条评论（路由做归属/权限校验用） */
export async function getComment(id: string): Promise<TextCommentDTO | null> {
  const comment = await prisma.textComment.findUnique({ where: { id } })
  return comment ? toDTO(comment) : null
}

/**
 * 某目标下的评论线程列表：顶层按 startOffset 升序（无锚点 null 排后），
 * 回复挂在所属顶层下按 createdAt 升序。
 */
export async function listThreads(
  targetType: string,
  targetId: string
): Promise<TextCommentThread[]> {
  const comments = await prisma.textComment.findMany({
    where: { targetType, targetId },
    orderBy: { createdAt: "asc" },
  })

  const tops = comments
    .filter((c) => c.parentId === null)
    .sort(
      (a, b) => (a.startOffset ?? Number.MAX_SAFE_INTEGER) - (b.startOffset ?? Number.MAX_SAFE_INTEGER)
    )

  return tops.map((top) => ({
    ...toDTO(top),
    replies: comments.filter((c) => c.parentId === top.id).map(toDTO),
  }))
}

export interface CreateCommentInput {
  novelId: string
  targetType: string
  targetId: string
  /** 从原文照抄的锚点文本；缺省 = 无锚点整体评论（评审视图「添加评论」可不发锚点） */
  quote?: string
  anchorHash?: string
  /** Markdown 评论正文 */
  content: string
  authorType: CommentAuthorType
  authorId?: string | null
  /** 快照：用户昵称 / "AI 评审员" */
  authorName: string
  /** 来源评审（AI 评审自动挂载时） */
  reviewId?: string | null
  /** 调用方已知的锚点偏移（slice 校验一致才采用，否则按 quote 重定位） */
  startOffset?: number
  endOffset?: number
}

/**
 * 创建顶层评论：有 quote 时定位锚点（调用方偏移校验通过则直接采用，否则 locateQuote
 * 重定位），落库 quote + 前后文（各 32 字）+ 偏移，定位失败抛 CommentAnchorNotFoundError；
 * 无 quote 时落无锚点整体评论（锚点字段全 null，列表按 startOffset 升序时排最后）。
 */
export async function createComment(input: CreateCommentInput): Promise<TextCommentDTO> {
  return prisma.$transaction(async tx => {
  await lockTextTarget(tx, { ...input, userId: input.authorId ?? "" })
  let anchor: { start: number; end: number } | null = null
  let prefix: string | null = null
  let suffix: string | null = null
  let anchorHash: string | null = null
  if (input.quote) {
    const text = await resolveTargetText(input.novelId, input.targetType, input.targetId, tx)
    anchorHash = contentHash(text)
    if (input.anchorHash && input.anchorHash !== anchorHash) throw new ContentError("COMMENT_SELECTION_STALE", "原文已改动，评论草稿已保留，请重新选区", 409)
    const located = resolveWriteAnchor(text, {
      quote: input.quote,
      startOffset: input.startOffset ?? null,
      endOffset: input.endOffset ?? null,
    }, !!input.anchorHash)
    if (!("start" in located)) {
      throw new CommentAnchorNotFoundError()
    }
    anchor = located
    const ctx = anchorContext(text, anchor.start, anchor.end)
    prefix = ctx.prefix
    suffix = ctx.suffix
  } else {
    // 无锚点整体评论也要校验目标存在与归属（resolveTargetText 的校验逻辑）
    await resolveTargetText(input.novelId, input.targetType, input.targetId, tx)
  }

  const comment = await tx.textComment.create({
    data: {
      novelId: input.novelId,
      targetType: input.targetType,
      targetId: input.targetId,
      quote: input.quote ?? null,
      anchorHash,
      prefix,
      suffix,
      startOffset: anchor?.start ?? null,
      endOffset: anchor?.end ?? null,
      authorType: input.authorType,
      authorId: input.authorId ?? null,
      authorName: input.authorName,
      content: input.content,
      reviewId: input.reviewId ?? null,
    },
  })
  return toDTO(comment)
  })
}

export interface ReplyCommentInput {
  novelId: string
  parentId: string
  content: string
  authorType: CommentAuthorType
  authorId?: string | null
  authorName: string
}

/** 回复顶层评论：父评论必须存在、属于该小说且为顶层（不允许回复的回复） */
async function lockCommentThread(tx: Prisma.TransactionClient, id: string) {
  const initial = await tx.textComment.findUnique({ where: { id } })
  if (!initial) throw new CommentNotFoundError()
  if (initial.targetType === "CHAPTER_CONTENT") await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${initial.targetId} FOR UPDATE`
  if (initial.targetType === "CANDIDATE_CONTENT") await tx.$queryRaw`SELECT id FROM "ContentCandidate" WHERE id = ${initial.targetId} FOR UPDATE`
  const rootId = initial.parentId ?? initial.id
  await tx.$queryRaw`SELECT id FROM "TextComment" WHERE id = ${rootId} FOR UPDATE`
  const current = await tx.textComment.findUnique({ where: { id } })
  if (!current) throw new CommentNotFoundError()
  return current
}

export async function replyToComment(input: ReplyCommentInput): Promise<TextCommentDTO> {
  return prisma.$transaction(async tx => {
    const parent = await lockCommentThread(tx, input.parentId)
    if (parent.novelId !== input.novelId || parent.parentId !== null) throw new CommentNotFoundError()
    const reply = await tx.textComment.create({ data: {
      novelId: parent.novelId, targetType: parent.targetType, targetId: parent.targetId,
      parentId: parent.id, content: input.content, authorType: input.authorType,
      authorId: input.authorId ?? null, authorName: input.authorName,
    } })
    await tx.textComment.update({ where: { id: parent.id }, data: { updatedAt: new Date() } })
    return toDTO(reply)
  })
}

export async function setCommentStatus(id: string, status: CommentStatus): Promise<TextCommentDTO> {
  if (status === "APPLIED") throw new ContentError("COMMIT_PROOF_REQUIRED", "已修改只能由成功的文本提交设置", 409)
  return prisma.$transaction(async tx => {
    const before = await lockCommentThread(tx, id)
    const comment = await tx.textComment.update({ where: { id }, data: { status } })
    if (before.parentId) await tx.textComment.update({ where: { id: before.parentId }, data: { updatedAt: new Date() } })
    return toDTO(comment)
  })
}

export async function updateCommentContent(id: string, content: string): Promise<TextCommentDTO> {
  return prisma.$transaction(async tx => {
    const before = await lockCommentThread(tx, id)
    const comment = await tx.textComment.update({ where: { id }, data: { content } })
    if (before.parentId) await tx.textComment.update({ where: { id: before.parentId }, data: { updatedAt: new Date() } })
    return toDTO(comment)
  })
}

/** 删除评论；顶层评论连同其回复一起删（事务） */
export async function deleteComment(id: string): Promise<void> {
  await prisma.$transaction(async tx => {
    const comment = await lockCommentThread(tx, id)
    await tx.textComment.deleteMany({ where: { parentId: id } })
    await tx.textComment.delete({ where: { id } })
    if (comment.parentId) await tx.textComment.update({ where: { id: comment.parentId }, data: { updatedAt: new Date() } })
  })
}
