import { z } from "zod"
import { ContentError } from "@/lib/content-errors"
import { positionError, savedPositionSchema } from "@/lib/creation-wizard/position"
import { lockContentOperation, requestHash } from "./content-commit"
import type { Theme } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { writeContentSnapshot } from "@/lib/services/version"

export const themeInputSchema = z.object({
  title: z.string().trim().min(1, "书名不能为空").max(100),
  synopsis: z.string().max(5000), referenceCases: z.string().max(5000),
  channel: z.string().max(50), genre: z.string().max(50), length: z.string().max(50).optional(),
  // 存量标签可原样保存；新增标签与数量在已有主题的基线上校验。
  tags: z.array(z.string()).max(1000),
  sellingPoints: z.string().max(2000), targetAudience: z.string().max(2000),
})
export type ThemeInput = z.infer<typeof themeInputSchema>
type ThemeWriteOptions = { source: "author"; userId: string; expectedVersion?: number; operationId?: string }

export async function getTheme(novelId: string) {
  return prisma.theme.findUnique({ where: { novelId } })
}

/**
 * 作品改名收口（侧栏重命名 / PATCH /api/novels/[id]）：Novel.title 与 Theme.title
 * 同事务同步，两边均带同名校守卫——同名不写、不触 updatedAt，反复提交同名不产生变更。
 * 主题不存在（如已回收）时只改 Novel.title；主题恢复/下次 upsertTheme 会再对齐。
 */
export async function renameNovelTitle(novelId: string, title: string) {
  await prisma.$transaction(async (tx) => {
    await tx.novel.updateMany({ where: { id: novelId, title: { not: title } }, data: { title } })
    await tx.theme.updateMany({ where: { novelId, title: { not: title } }, data: { title } })
  })
}

/**
 * 创建或更新主题。已存在时 version+1 并写入 ContentVersion 快照（reason="主题更新"）。
 * 主题书名即作品显示名：同步 Novel.title，保证侧栏/头图与主题面板一致。
 */
export async function upsertTheme(novelId: string, input: ThemeInput, options?: ThemeWriteOptions) {
  return prisma.$transaction(async tx => {
    if (options?.operationId) await lockContentOperation(tx, options.userId, options.operationId)
    await lockContentOperation(tx, "theme", novelId)
    const novel = await tx.novel.findUnique({ where: { id: novelId } })
    if (!novel || novel.status === "DELETED" || (options && novel.userId !== options.userId)) throw new ContentError("TARGET_NOT_FOUND", "作品不存在或无权访问", 404)
    const fingerprint = requestHash({ novelId, input, options })
    if (options?.operationId) {
      const prior = await tx.contentMutation.findUnique({ where: { userId_operationId: { userId: options.userId, operationId: options.operationId } } })
      if (prior) {
        if (prior.requestHash !== fingerprint) throw new ContentError("OPERATION_CONFLICT", "此保存编号已用于不同主题请求")
        return prior.result as unknown as Theme
      }
    }
    const existing = await tx.theme.findUnique({ where: { novelId } })
    if (options?.expectedVersion !== undefined && options.expectedVersion !== (existing?.version ?? 0)) throw new ContentError("VERSION_CONFLICT", "主题已被更新，草稿已保留；请核对最新主题后重试")
    const parsed = themeInputSchema.safeParse(input)
    if (!parsed.success) throw new ContentError("INVALID_THEME", parsed.error.issues[0]?.message ?? "主题参数不合法", 400)
    const data = { ...parsed.data, length: parsed.data.length ?? existing?.length ?? "", tags: [...new Set(parsed.data.tags.map(tag => existing?.tags.includes(tag) ? tag : tag.trim()))] }
    if (!options && !existing) {
      data.channel ||= "不限"
      data.genre ||= "全部"
    }
    const author = savedPositionSchema.safeParse(existing?.authorPosition)
    if (!options && author.success) Object.assign(data, author.data)
    const error = positionError(data, existing ?? undefined)
    if (error) throw new ContentError("INVALID_POSITION", error, 400)
    const position = { channel: data.channel, genre: data.genre, length: data.length, tags: data.tags }
    const changes = { ...data, ...(options ? { authorPosition: position } : {}) }
    const theme = existing
      ? await tx.theme.update({ where: { novelId }, data: { ...changes, version: { increment: 1 } } })
      : await tx.theme.create({ data: { novelId, ...changes } })
    await tx.novel.updateMany({ where: { id: novelId, title: { not: data.title } }, data: { title: data.title } })
    if (existing) await writeContentSnapshot({ targetType: "Theme", targetId: theme.id, version: theme.version, snapshot: theme, reason: "主题更新" }, tx)
    if (options?.operationId) await tx.contentMutation.create({ data: {
      userId: options.userId, novelId, targetType: "Theme", targetId: theme.id, operationId: options.operationId,
      requestHash: fingerprint, beforeVersion: existing?.version ?? null, afterVersion: theme.version,
      beforeHash: requestHash(existing), afterHash: requestHash(theme), result: JSON.parse(JSON.stringify(theme)),
    } })
    return theme
  })
}
