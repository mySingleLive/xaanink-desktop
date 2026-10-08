import { prisma } from "@/lib/db"
import { contentHash, ownedChapter } from "./content-commit"
import type { ChapterScope } from "./chapter-history"
import { storySources } from "./story-artifacts"
import { chapterTaskSourceText } from "@/lib/chapter-task-sources"

export interface ChapterFactSource { id: string; chapterId: string; version: number; hash: string; label: string; text: string; kind: "previous" | "outline" | "next" | "story" }
/** 从数据库按卷/章顺序读取边界，保留全文出处，不以会话摘要代替已发生事实。 */
export async function readChapterBoundaries(scope: ChapterScope, options?: { chapterTask?: boolean }): Promise<ChapterFactSource[]> {
  const chapter = await ownedChapter(prisma, scope.userId, scope.novelId, scope.chapterId)
  const rows = await prisma.chapter.findMany({ where: { volume: { novelId: scope.novelId } }, orderBy: [{ volume: { index: "asc" } }, { index: "asc" }], select: { id: true } })
  const index = rows.findIndex(row => row.id === chapter.id)
  const [previous, next, linked] = await Promise.all([
    rows[index - 1] ? prisma.chapter.findUnique({ where: { id: rows[index - 1].id }, select: { id: true, title: true, index: true, version: true, content: true } }) : null,
    rows[index + 1] ? prisma.chapter.findUnique({ where: { id: rows[index + 1].id }, select: { id: true, title: true, index: true, version: true, outline: true } }) : null,
    storySources(scope, `chapter-content:${chapter.id}`),
  ])
  return [
    ...(previous ? [{ id: `${previous.id}:content`, chapterId: previous.id, version: previous.version, hash: contentHash(previous.content), label: `前章 · 第 ${previous.index} 章《${previous.title}》`, text: previous.content, kind: "previous" as const }] : []),
    { id: `${chapter.id}:outline`, chapterId: chapter.id, version: chapter.version, hash: contentHash(chapter.outline), label: `本章大纲 · 《${chapter.title}》`, text: chapter.outline, kind: "outline" as const },
    ...(next ? [{ id: `${next.id}:outline`, chapterId: next.id, version: next.version, hash: contentHash(next.outline), label: `后章边界 · 第 ${next.index} 章《${next.title}》`, text: next.outline, kind: "next" as const }] : []),
    ...linked.sources.filter(source => !["chapter-content", "chapter-outline", "volume"].includes(source.kind)).map(source => {
      const text = options?.chapterTask ? chapterTaskSourceText(source, linked.sources) : source.text
      return { id: source.key, chapterId: chapter.id, version: 0, hash: contentHash(text), label: `故事来源 · ${source.title}${text !== source.text ? "（本章相关规划；完整原文可用领域工具读取）" : ""}`, text, kind: "story" as const }
    }),
  ]
}
