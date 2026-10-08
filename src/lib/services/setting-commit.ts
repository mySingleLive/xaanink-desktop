import type { Prisma, Setting } from "@/generated/prisma/client"
import { factionEntries, normalizeFactionIdentity } from "@/lib/faction-identity"
import { prisma } from "@/lib/db"
import { ContentError, requireVersion } from "@/lib/content-errors"
import { contentHash, lockContentOperation, requestHash } from "./content-commit"
import { settingText } from "./target-text"
function fieldHash(content: Prisma.JsonValue) { try { return contentHash(settingText(content)) } catch { return requestHash(content) } }

export interface SettingSaveOptions { userId: string; expectedVersion: number; operationId: string; restoreSnapshotId?: string }
/** 结构化和纯文本设定都使用整数版本保护；评论 additionally 校验字段 hash/updatedAt。 */
export async function commitSettingRevision(id: string, data: { name?: string; content?: Prisma.InputJsonValue; parentId?: string | null }, options?: SettingSaveOptions) {
  requireVersion(options?.expectedVersion)
  if (!options?.operationId) throw new ContentError("PRECONDITION_REQUIRED", "缺少设定保存编号，请保留草稿并刷新", 428)
  return prisma.$transaction(async tx => {
    const owner = await tx.setting.findFirst({ where: { id, novel: { userId: options.userId, status: { not: "DELETED" } } } })
    if (!owner) throw new ContentError("TARGET_NOT_FOUND", "设定不存在或无权访问", 404)
    // 同一作品的地图移动先串行化，防止并发互挂构成环；内容修订仍受版本保护。
    if (data.parentId !== undefined) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`map-tree:${owner.novelId}`}, 0))`
    await lockContentOperation(tx, options.userId, options.operationId)
    const key = { userId_operationId: { userId: options.userId, operationId: options.operationId } }
    const hash = requestHash({ id, data, options })
    const prior = await tx.contentMutation.findUnique({ where: key })
    if (prior) {
      if (prior.requestHash !== hash) throw new ContentError("OPERATION_CONFLICT", "设定保存编号已用于不同请求")
      const receipt = prior.result as { snapshotId: string }
      const snapshot = await tx.contentVersion.findUniqueOrThrow({ where: { id: receipt.snapshotId } })
      const row = snapshot.snapshot as unknown as Setting
      return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) }
    }
    await tx.$queryRaw`SELECT id FROM "Setting" WHERE id = ${id} FOR UPDATE`
    const before = await tx.setting.findUniqueOrThrow({ where: { id } })
    if (before.version !== options.expectedVersion) throw new ContentError("VERSION_CONFLICT", "设定已有新修订，草稿已保留，请重新比较")
    if (data.parentId !== undefined) {
      if (before.type !== "MAP") throw new ContentError("INVALID_MAP_PARENT", "只有地图可以调整上级", 400)
      const visited = new Set([id])
      let parentId = data.parentId
      while (parentId) {
        if (visited.has(parentId)) throw new ContentError("MAP_CYCLE", "地图不能挂到自身或子地图下", 400)
        visited.add(parentId)
        const parent = await tx.setting.findFirst({ where: { id: parentId, novelId: before.novelId, worldId: before.worldId, type: "MAP" } })
        if (!parent) throw new ContentError("INVALID_MAP_PARENT", "上级地图必须属于同一作品和世界", 400)
        parentId = parent.parentId
      }
    }
    const old = await tx.contentVersion.findFirst({ where: { targetType: "Setting", targetId: id, version: before.version } })
    if (old && requestHash((old.snapshot as Record<string, unknown>)?.content) !== requestHash(before.content)) throw new ContentError("SNAPSHOT_CONFLICT", "设定历史与当前修订不一致")
    if (!old) await tx.contentVersion.create({ data: { targetType: "Setting", targetId: id, version: before.version, snapshot: JSON.parse(JSON.stringify(before)), reason: "修改前设定" } })
    const historical = options.restoreSnapshotId && before.type === "FACTION" ? (await tx.contentVersion.findMany({where: {targetType: "Setting", targetId: id, version: {lte: before.version}}})).flatMap(row => factionEntries((row.snapshot as {content?: unknown}).content)) : undefined
    if (options.restoreSnapshotId && !await tx.contentVersion.findFirst({where: {id: options.restoreSnapshotId, targetType: "Setting", targetId: id}})) throw new ContentError("TARGET_NOT_FOUND", "设定历史不存在", 404)
    const checked = before.type === "FACTION" && data.content !== undefined ? {...data, content: normalizeFactionIdentity(data.content, before.content, historical) as Prisma.InputJsonValue} : data
    const saved = await tx.setting.update({ where: { id, version: options.expectedVersion }, data: { ...checked, version: { increment: 1 } } })
    const snapshot = await tx.contentVersion.create({ data: { targetType: "Setting", targetId: id, version: saved.version, snapshot: JSON.parse(JSON.stringify(saved)), reason: "设定更新" } })
    await tx.contentMutation.create({ data: { userId: options.userId, novelId: saved.novelId, targetType: "SETTING", targetId: id, operationId: options.operationId, requestHash: hash, beforeVersion: before.version, afterVersion: saved.version, beforeHash: fieldHash(before.content), afterHash: fieldHash(saved.content), result: { snapshotId: snapshot.id, version: saved.version, updatedAt: saved.updatedAt.toISOString(), operationId: options.operationId } } })
    return saved
  }, { timeout: 15000 })
}

/** Restoration creates a revision; legacy faction entries use explicit historical identity mapping. */
export async function restoreSettingRevision(id: string, snapshotId: string, options: SettingSaveOptions) {
  const row = await prisma.contentVersion.findFirst({where: {id: snapshotId, targetType: "Setting", targetId: id}})
  if (!row) throw new ContentError("TARGET_NOT_FOUND", "设定历史不存在", 404)
  const snapshot = row.snapshot as {name: string; content: Prisma.InputJsonValue}
  return commitSettingRevision(id, {name: snapshot.name, content: snapshot.content}, {...options, restoreSnapshotId: snapshotId})
}
