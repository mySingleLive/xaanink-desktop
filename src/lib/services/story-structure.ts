import { randomUUID } from "node:crypto"
import type { Chapter, Prisma, Volume } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { ownedStory, readStoryArtifacts, storyJson, type StoryScope } from "./story-artifacts"
import { commitChapterRevisionInTransaction, lockContentOperation, requestHash, snapshotChapter } from "./content-commit"
import { STORY_ENTITY_KINDS, readStoryEntityArchive, removeStoryEntityArchive, restoreStoryEntityArchive, type StoryEntityArchive } from "./story-entity-archive"

type StructureSnapshot = {
  novelId: string; key: string; title: string
  volumes: Volume[]; chapters: Chapter[]
  entities?: StoryEntityArchive
}
const ARCHIVE_TYPE = "StoryStructureArchive"

async function structureState(scope: StoryScope, key: string, db: Prisma.TransactionClient = prisma) {
  await ownedStory(scope, db)
  const [kind, id] = key.split(":")
  if (id && STORY_ENTITY_KINDS.includes(kind as StoryEntityArchive["kind"])) {
    const entities = await readStoryEntityArchive(db, scope.novelId, key)
    const data: StructureSnapshot = { novelId: scope.novelId, key, title: entities.title, entities, volumes: [], chapters: [] }
    return { data, hash: requestHash(data), kind, id }
  }
  if (!["volume", "chapter-outline", "chapter-content"].includes(kind) || !id) throw new ContentError("STORY_STRUCTURE_INVALID", "请指定当前作品中的创作产物", 400)
  const volume = kind === "volume" ? await db.volume.findFirst({ where: { id, novelId: scope.novelId } }) : null
  const chapter = kind.startsWith("chapter-") ? await db.chapter.findFirst({ where: { id, volume: { novelId: scope.novelId } } }) : null
  if (!volume && !chapter) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "内容不存在或不属于本作品", 404)
  const data: StructureSnapshot = {
    novelId: scope.novelId, key, title: (volume ?? chapter)!.title,
    volumes: volume ? [volume] : [], chapters: chapter ? [chapter] : volume ? await db.chapter.findMany({ where: { volumeId: id }, orderBy: { id: "asc" } }) : [],
  }
  return { data, hash: requestHash(data), kind, id }
}

export async function prepareStoryRemoval(scope: StoryScope, key: string) {
  const { data, hash, kind } = await structureState(scope, key)
  const words = data.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  const range = data.entities ? `涉及${data.entities.keys.length}项创作资料（含子级），关联图片、触点与引用一并保留。` : `涉及${data.chapters.length}章、${words}字。`
  return { title: data.title, key, hash, summary: `是否${kind === "chapter-content" ? "清空正文" : "移除"}「${data.title}」？${range}${kind === "chapter-content" ? "保留章节与细纲。" : ""}完整内容会保存到回收记录，可随时在聊天中恢复；关联来源会提示重新核对。` }
}

/** 只从作者的版本绑定问答调用；快照、删除与幂等回执同一事务。 */
export async function removeStoryStructure(scope: StoryScope, input: { key: string; hash: string; operationId: string }, tx: Prisma.TransactionClient) {
  await ownedStory(scope, tx)
  await lockContentOperation(tx, scope.userId, input.operationId)
  const prior = await tx.contentMutation.findUnique({ where: { userId_operationId: { userId: scope.userId, operationId: input.operationId } } })
  if (prior) return prior.result
  await tx.$queryRaw`SELECT id FROM "Novel" WHERE id = ${scope.novelId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM "Volume" WHERE "novelId" = ${scope.novelId} ORDER BY id FOR UPDATE`
  await tx.$queryRaw`SELECT c.id FROM "Chapter" c JOIN "Volume" v ON c."volumeId" = v.id WHERE v."novelId" = ${scope.novelId} ORDER BY c.id FOR UPDATE OF c`
  if (STORY_ENTITY_KINDS.includes(input.key.split(":")[0] as StoryEntityArchive["kind"])) await tx.$executeRaw`LOCK TABLE "World", "Setting", "Theme", "Character", "CharacterImage", "Item", "Scene", "Foreshadow", "ForeshadowTouch", "ForeshadowReference", "Trope", "AttributeDefinition" IN SHARE ROW EXCLUSIVE MODE`
  const { data, hash, kind, id } = await structureState(scope, input.key, tx)
  if (hash !== input.hash) throw new ContentError("VERSION_CONFLICT", "确认期间内容已变化，请重新查看移除范围", 409)
  const graph = await readStoryArtifacts(scope, tx)
  const deleted = new Set(graph.artifacts.filter(a => a.key === input.key || data.entities?.keys.includes(a.key) || data.chapters.some(c => c.id === a.id)).map(a => a.key))
  if (kind === "chapter-content") deleted.clear()
  for (const edge of graph.edges.filter(e => deleted.has(e.sourceKey) || deleted.has(e.targetKey))) {
    const source = graph.artifacts.find(a => a.key === edge.sourceKey), target = graph.artifacts.find(a => a.key === edge.targetKey)
    if (!source || !target) continue
    await tx.storyArtifactLink.upsert({ where: { novelId_sourceKey_targetKey: { novelId: scope.novelId, sourceKey: source.key, targetKey: target.key } }, create: { novelId: scope.novelId, sourceKey: source.key, targetKey: target.key, sourceHash: source.hash, targetHash: target.hash, reason: edge.reason }, update: {} })
  }
  const archive = await tx.contentVersion.create({ data: { targetType: ARCHIVE_TYPE, targetId: `${scope.novelId}:${randomUUID()}`, version: 1, snapshot: storyJson(data), reason: `作者移除：${data.title}` } })
  for (const chapter of data.chapters) await snapshotChapter(tx, chapter, "聊天移除前稿件")
  if (data.entities) await removeStoryEntityArchive(tx, data.entities)
  else if (kind === "chapter-content") {
    await commitChapterRevisionInTransaction(tx, { ...scope, chapterId: id, expectedVersion: data.chapters[0].version, operationId: `${input.operationId}:clear`, source: "manual", reason: "作者在聊天中清空正文", changes: { content: "" } })
  } else if (kind === "chapter-outline") await tx.chapter.delete({ where: { id } })
  else await tx.volume.delete({ where: { id } })
  const result = { archiveId: archive.id, key: input.key, title: data.title }
  await tx.contentMutation.create({ data: { userId: scope.userId, novelId: scope.novelId, targetType: ARCHIVE_TYPE, targetId: archive.id, operationId: input.operationId, requestHash: requestHash(input), beforeHash: hash, afterHash: requestHash(result), result } })
  return result
}

export async function listStoryRemovals(scope: StoryScope) {
  await ownedStory(scope)
  const rows = await prisma.contentVersion.findMany({ where: { targetType: ARCHIVE_TYPE, targetId: { startsWith: `${scope.novelId}:` } }, orderBy: { createdAt: "desc" }, take: 100 })
  const restored = await prisma.contentMutation.findMany({ where: { userId: scope.userId, novelId: scope.novelId, targetType: "StoryStructureRestore" }, select: { targetId: true } })
  return rows.map(row => { const data = row.snapshot as unknown as StructureSnapshot; return { id: row.id, key: data.key, title: data.title, createdAt: row.createdAt, restored: restored.some(r => r.targetId === row.id) } })
}

// 快照由服务端生成；只恢复本模块白名单表，保留 ID，避免故事来源断链。
// 故事板退役前的旧归档（snapshot 含 boards/nodes/cards 字段）不再提供恢复入口。
function restoreRow<T extends { createdAt: Date; updatedAt: Date }>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null).map(([key, value]) => [key, key === "createdAt" || key === "updatedAt" ? new Date(value instanceof Date ? value.getTime() : String(value)) : value])) as T
}
export async function restoreStoryStructure(scope: StoryScope, archiveId: string, operationId: string, placement?: { index?: number; volumeId?: string }) {
  return prisma.$transaction(async tx => {
    await ownedStory(scope, tx); await lockContentOperation(tx, scope.userId, operationId)
    await tx.$queryRaw`SELECT id FROM "Novel" WHERE id = ${scope.novelId} FOR UPDATE`
    const prior = await tx.contentMutation.findFirst({ where: { userId: scope.userId, novelId: scope.novelId, targetType: "StoryStructureRestore", targetId: archiveId } })
    if (prior) return prior.result
    const archive = await tx.contentVersion.findFirst({ where: { id: archiveId, targetType: ARCHIVE_TYPE, targetId: { startsWith: `${scope.novelId}:` } } })
    if (!archive) throw new ContentError("ARCHIVE_NOT_FOUND", "回收记录不存在或无权访问", 404)
    const archiveHash = requestHash(archive.snapshot)
    const data = archive.snapshot as unknown as StructureSnapshot
    if (data.novelId !== scope.novelId) throw new ContentError("ARCHIVE_NOT_FOUND", "回收记录不属于本作品", 404)
    const kind = data.key.split(":")[0]
    if (placement?.index !== undefined && (!Number.isInteger(placement.index) || placement.index < 1 || placement.index > 2_000_000_000)) throw new ContentError("RESTORE_POSITION_INVALID", "恢复位置须为有效正整数", 400)
    if (placement && Object.keys(placement).length) {
      if (kind !== "volume" && kind !== "chapter-outline") throw new ContentError("RESTORE_POSITION_INVALID", "只有卷和整章恢复可以调整位置", 400)
      if (kind === "volume") {
        if (placement.volumeId) throw new ContentError("RESTORE_POSITION_INVALID", "恢复卷不能指定所属卷", 400)
        if (placement.index !== undefined) data.volumes[0].index = placement.index
      } else {
        if (placement.volumeId) {
          if (!await tx.volume.findFirst({ where: { id: placement.volumeId, novelId: scope.novelId } })) throw new ContentError("RESTORE_POSITION_INVALID", "目标卷不存在或不属于本书", 404)
          data.chapters[0].volumeId = placement.volumeId
        }
        if (placement.index !== undefined) data.chapters[0].index = placement.index
      }
    }
    if (data.entities) await restoreStoryEntityArchive(tx, scope.novelId, data.entities)
    else if (kind === "chapter-content") {
      const saved = data.chapters[0], current = await tx.chapter.findFirst({ where: { id: saved.id, volume: { novelId: scope.novelId } } })
      if (!current || current.content.trim()) throw new ContentError("RESTORE_CONFLICT", "章节已不存在或已有新正文，请先核对；恢复不能覆盖新稿", 409)
      await commitChapterRevisionInTransaction(tx, { ...scope, chapterId: current.id, expectedVersion: current.version, operationId: `${operationId}:content`, source: "manual", reason: "聊天恢复被清空的正文", changes: { content: saved.content } })
    } else {
      for (const volume of data.volumes) {
        const conflicts = await tx.volume.findFirst({ where: { novelId: scope.novelId, OR: [{ id: volume.id }, { index: volume.index }] } })
        if (conflicts) throw new ContentError("RESTORE_CONFLICT", "原卷位置已有新内容，请先调整位置再恢复", 409)
        await tx.volume.create({ data: restoreRow(volume) })
      }
      for (const chapter of data.chapters) {
        const parent = await tx.volume.findFirst({ where: { id: chapter.volumeId, novelId: scope.novelId } })
        const conflicts = await tx.chapter.findFirst({ where: { OR: [{ id: chapter.id }, { volumeId: chapter.volumeId, index: chapter.index }] } })
        if (!parent || conflicts) throw new ContentError("RESTORE_CONFLICT", "原卷不存在或章节位置已有新内容，不能覆盖恢复", 409)
        await tx.chapter.create({ data: restoreRow(chapter) })
      }
    }
    const result = { archiveId, key: data.key, title: data.title, restored: true, ...(placement ? { placement } : {}) }
    await tx.contentMutation.create({ data: { userId: scope.userId, novelId: scope.novelId, targetType: "StoryStructureRestore", targetId: archiveId, operationId, requestHash: requestHash({ archiveId, placement }), beforeHash: archiveHash, afterHash: requestHash(result), result } })
    return result
  }, { timeout: 30000 })
}
