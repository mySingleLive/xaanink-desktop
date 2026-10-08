import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError, requireVersion } from "@/lib/content-errors"
import { countChineseWords } from "@/lib/text"
import { commitChapterContent, contentHash, ownedChapter } from "./content-commit"

export interface ChapterScope { userId: string; novelId: string; chapterId: string }
export function snapshotContent(snapshot: Prisma.JsonValue): string | null {
  return snapshot !== null && typeof snapshot === "object" && !Array.isArray(snapshot) && typeof snapshot.content === "string" ? snapshot.content : null
}
export function pageSize(limit?: number) { return Math.max(1, Math.min(50, Number.isFinite(limit) ? Math.floor(limit!) : 20)) }

export async function listChapterVersions(scope: ChapterScope, options: { cursor?: string; limit?: number } = {}) {
  await ownedChapter(prisma, scope.userId, scope.novelId, scope.chapterId)
  const where = { targetType: "Chapter", targetId: scope.chapterId }
  if (options.cursor && !await prisma.contentVersion.findFirst({ where: { ...where, id: options.cursor } })) throw new ContentError("INVALID_CURSOR", "历史分页位置无效", 400)
  const limit = pageSize(options.limit)
  const rows = await prisma.contentVersion.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}), take: limit + 1 })
  return { versions: rows.slice(0, limit).map(row => { const content = snapshotContent(row.snapshot); return { id: row.id, version: row.version, createdAt: row.createdAt, reason: row.reason, wordCount: content === null ? null : countChineseWords(content), restorable: content !== null } }), nextCursor: rows.length > limit ? rows[limit - 1].id : null }
}

export async function getChapterVersion(scope: ChapterScope, versionId: string) {
  await ownedChapter(prisma, scope.userId, scope.novelId, scope.chapterId)
  const row = await prisma.contentVersion.findFirst({ where: { id: versionId, targetType: "Chapter", targetId: scope.chapterId } })
  if (!row) throw new ContentError("VERSION_NOT_FOUND", "历史版本不存在", 404)
  const content = snapshotContent(row.snapshot)
  if (content === null) throw new ContentError("INVALID_SNAPSHOT", "历史快照损坏，无法恢复此版本", 422)
  return { id: row.id, version: row.version, content, contentHash: contentHash(content), wordCount: countChineseWords(content), reason: row.reason, createdAt: row.createdAt }
}

export async function restoreChapterVersion(scope: ChapterScope, versionId: string, input: { expectedVersion: number; operationId: string }) {
  requireVersion(input.expectedVersion)
  const version = await getChapterVersion(scope, versionId)
  return commitChapterContent({ ...scope, ...input, content: version.content, source: "restore", reason: `恢复正文版本 ${version.version}（${version.id}）` })
}
