import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import type { Prisma } from "@/generated/prisma/client"
import type { OutlineCollection, OutlineDeletionPreview, OutlineDeletionReceipt, OutlineExportKind } from "@/lib/outline-collection"
import type { NovelExportMetadata } from "@/lib/manuscript-export"
import { lockContentOperation, requestHash, snapshotChapter, type CommitTransaction } from "./content-commit"

export async function getNovelExportMetadata(novelId: string): Promise<NovelExportMetadata> {
  const novel = await prisma.novel.findUniqueOrThrow({ where: { id: novelId }, select: {
    title: true, coverUrl: true, user: { select: { name: true } }, theme: { select: { synopsis: true } },
  } })
  return { title: novel.title, coverUrl: novel.coverUrl, author: novel.user.name, synopsis: novel.theme?.synopsis ?? "" }
}

export async function getOutlineCollection(novelId: string, kind: OutlineExportKind, volumeId?: string): Promise<OutlineCollection> {
  const metadata = await getNovelExportMetadata(novelId)
  const volumes = await prisma.volume.findMany({
    where: { novelId, ...(volumeId && { id: volumeId }) }, orderBy: { index: "asc" },
    select: { id: true, index: true, title: true, summary: kind === "outline", chapters: {
      orderBy: { index: "asc" }, select: { id: true, index: true, title: true, content: kind === "content", outline: kind === "outline" },
    } },
  })
  if (volumeId && !volumes.length) throw new ContentError("TARGET_NOT_FOUND", "卷不存在", 404)
  return { novelId, ...metadata, kind, volumeId, volumes: volumes.map(volume => ({
    id: volume.id, index: volume.index, title: volume.title, summary: volume.summary ?? "",
    chapters: volume.chapters.map(chapter => ({ id: chapter.id, index: chapter.index, title: chapter.title, text: (kind === "content" ? chapter.content : chapter.outline) ?? "" })),
  })) }
}

async function deletionState(db: CommitTransaction, novelId: string, volumeId?: string) {
  const volumes = await db.volume.findMany({
    where: { novelId, ...(volumeId && { id: volumeId }) }, orderBy: { id: "asc" },
    include: { chapters: { orderBy: { id: "asc" }, select: { id: true, version: true, updatedAt: true, wordCount: true, status: true } } },
  })
  if (volumeId && !volumes.length) throw new ContentError("TARGET_NOT_FOUND", "卷不存在", 404)
  const chapters = volumes.flatMap(volume => volume.chapters)
  const preview: OutlineDeletionPreview = {
    revision: requestHash({ novelId, volumeId, volumes: JSON.parse(JSON.stringify(volumes)) }), volumeCount: volumes.length,
    chapterCount: chapters.length, wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    finalizedCount: chapters.filter(chapter => chapter.status === "FINAL").length, chapterIds: chapters.map(chapter => chapter.id),
  }
  return { volumes, preview }
}

export async function getOutlineDeletionPreview(novelId: string, volumeId?: string) {
  return (await deletionState(prisma, novelId, volumeId)).preview
}

/** Auth is checked by the route. Scope, locks, snapshots and receipt share one transaction. */
export async function deleteOutlineVolumes(input: { novelId: string; userId: string; volumeId?: string; expectedRevision: string; operationId: string }): Promise<OutlineDeletionReceipt> {
  return prisma.$transaction(async tx => {
    await lockContentOperation(tx, input.userId, input.operationId)
    const hash = requestHash(input)
    const prior = await tx.contentMutation.findUnique({ where: { userId_operationId: { userId: input.userId, operationId: input.operationId } } })
    if (prior) {
      if (prior.requestHash !== hash) throw new ContentError("OPERATION_CONFLICT", "此操作编号已用于不同操作")
      return prior.result as unknown as OutlineDeletionReceipt
    }
    // Parent locks also block concurrent FK inserts (new volumes/chapters).
    await tx.$queryRaw`SELECT id FROM "Novel" WHERE id = ${input.novelId} FOR UPDATE`
    if(await tx.planningDocument.findUnique({where:{novelId:input.novelId}})) throw new ContentError("OUTLINE_PROJECTION_READONLY", "请在叙事线中调整卷章，正文不会随规划删除",409)
    if (input.volumeId) {
      await tx.$queryRaw`SELECT id FROM "Volume" WHERE "novelId" = ${input.novelId} AND id = ${input.volumeId} FOR UPDATE`
      await tx.$queryRaw`SELECT c.id FROM "Chapter" c JOIN "Volume" v ON c."volumeId" = v.id WHERE v."novelId" = ${input.novelId} AND v.id = ${input.volumeId} ORDER BY c.id FOR UPDATE OF c`
    } else {
      await tx.$queryRaw`SELECT id FROM "Volume" WHERE "novelId" = ${input.novelId} ORDER BY id FOR UPDATE`
      await tx.$queryRaw`SELECT c.id FROM "Chapter" c JOIN "Volume" v ON c."volumeId" = v.id WHERE v."novelId" = ${input.novelId} ORDER BY c.id FOR UPDATE OF c`
    }
    const { volumes, preview } = await deletionState(tx, input.novelId, input.volumeId)
    if (preview.revision !== input.expectedRevision) throw new ContentError("VERSION_CONFLICT", "卷章已有变化，请重新打开删除窗口核对后再操作")
    const chapters = await tx.chapter.findMany({ where: { id: { in: preview.chapterIds } } })
    for (const chapter of chapters) await snapshotChapter(tx, chapter, "删除卷章前稿件")
    for (const source of volumes) {
      const { id, novelId, index, title, summary, createdAt, updatedAt } = source
      const volume = { id, novelId, index, title, summary, createdAt, updatedAt }
      const last = await tx.contentVersion.aggregate({ where: { targetType: "Volume", targetId: volume.id }, _max: { version: true } })
      await tx.contentVersion.create({ data: { targetType: "Volume", targetId: volume.id, version: (last._max.version ?? 0) + 1, snapshot: JSON.parse(JSON.stringify(volume)), reason: "删除卷章前大纲" } })
    }
    const receipt: OutlineDeletionReceipt = { operationId: input.operationId, volumeIds: volumes.map(volume => volume.id), chapterIds: preview.chapterIds }
    await tx.volume.deleteMany({ where: { novelId: input.novelId, id: { in: receipt.volumeIds } } })
    await tx.contentMutation.create({ data: {
      userId: input.userId, novelId: input.novelId, targetType: "OUTLINE_STRUCTURE", targetId: input.volumeId ?? input.novelId,
      operationId: input.operationId, requestHash: hash, beforeHash: preview.revision, afterHash: requestHash(receipt), result: receipt as unknown as Prisma.InputJsonValue,
    } })
    return receipt
  }, { timeout: 30_000 })
}
