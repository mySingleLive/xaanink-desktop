import type { Prisma, Scene } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError, requireVersion } from "@/lib/content-errors"
import { createSceneSchema, sceneFieldsSchema, type SceneInput, type ScenePatch } from "@/lib/scene-schema"
import { factionEntries } from "@/lib/faction-identity"
import { planningSchema } from "@/lib/planning/domain"
import { contentHash, lockContentOperation, requestHash } from "./content-commit"
export type { SceneInput, ScenePatch }
export interface SceneScope { novelId: string; userId: string }
export interface SceneSaveOptions extends SceneScope { expectedVersion: number; operationId: string; restoreSnapshotId?: string }
type DB = Prisma.TransactionClient
export async function lockSceneTree(tx: DB, novelId: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scene-tree:${novelId}`}, 0))` }
export async function ownedSceneBook(tx: DB, scope: SceneScope) {
  const novel = await tx.novel.findFirst({ where: { id: scope.novelId, userId: scope.userId, status: { not: "DELETED" } } })
  if (!novel) throw new ContentError("TARGET_NOT_FOUND", "作品不存在或无权访问", 404)
  return novel
}
export async function ownedScene(tx: DB, scope: SceneScope, id: string) {
  await ownedSceneBook(tx, scope)
  const row = await tx.scene.findFirst({where: {id, novelId: scope.novelId}})
  if (!row) throw new ContentError("TARGET_NOT_FOUND", "场景不存在或无权访问", 404)
  return row
}
export async function listScenes(novelId: string) { return prisma.scene.findMany({where: {novelId}, orderBy: [{createdAt: "asc"}, {id: "asc"}]}) }
export async function getScene(id: string) { return prisma.scene.findUnique({where: {id}}) }
export async function sceneFactions(novelId: string, db: Pick<DB, "setting" | "world"> = prisma) {
  const [settings, worlds] = await Promise.all([db.setting.findMany({where: {novelId, type: "FACTION"}, orderBy: {createdAt: "asc"}}), db.world.findMany({where: {novelId}})])
  const path = (id: string | null) => { const names: string[] = []; const seen = new Set<string>(); while (id && !seen.has(id)) {seen.add(id); const world = worlds.find(w => w.id === id); if (!world) break; names.unshift(world.name); id = world.parentId}; return names.join(" / ") }
  return settings.flatMap(setting => factionEntries(setting.content).filter(f => typeof f.id === "string").map(f => ({settingId: setting.id, worldId: setting.worldId, id: f.id!, name: String(f.name ?? ""), description: String(f.description ?? ""), path: [path(setting.worldId), setting.name].filter(Boolean).join(" / ")})))
}
async function validatePatch(tx: DB, novelId: string, id: string | null, data: ScenePatch, before?: Scene) {
  const parentId = data.parentId === undefined ? before?.parentId ?? null : data.parentId
  const seen = new Set(id ? [id] : []); let cursor = parentId
  while (cursor) { if (seen.has(cursor)) throw new ContentError("SCENE_CYCLE", "场景不能移到自身或子场景下", 400); seen.add(cursor); const parent = await tx.scene.findFirst({where: {id: cursor, novelId}}); if (!parent) throw new ContentError("INVALID_SCENE_PARENT", "上级场景不存在或不属于当前作品", 400); cursor = parent.parentId }
  const name = data.name ?? before?.name
  if (!before || name !== before.name || parentId !== before.parentId) {
    if (await tx.scene.findFirst({where: {novelId, parentId, name, ...(id ? {id: {not: id}} : {})}})) throw new ContentError("SCENE_NAME_CONFLICT", "同一上级下已存在同名场景")
  }
  if ((!before && (data.factionId || data.factionSettingId)) || (data.factionId !== undefined && data.factionId !== before?.factionId) || (data.factionSettingId !== undefined && data.factionSettingId !== before?.factionSettingId)) {
    const factionId = data.factionId === undefined ? before?.factionId : data.factionId
    const settingId = data.factionSettingId === undefined ? before?.factionSettingId : data.factionSettingId
    if (!factionId && !settingId) return {...data, factionId: null, factionSettingId: null, factionNameSnapshot: null}
    const setting = settingId ? await tx.setting.findFirst({where: {id: settingId, novelId, type: "FACTION"}}) : null
    const faction = setting && factionEntries(setting.content).find(f => f.id === factionId)
    if (!faction) throw new ContentError("INVALID_FACTION", "所属势力已失效，请重新选择", 400)
    return {...data, factionNameSnapshot: String(faction.name ?? "")}
  }
  return data
}
/** Snapshots compare business data; image selection has its own revision counter. */
function sceneBusiness(row: Scene) { const {exteriorImageUrl, interiorImageUrl, exteriorImageRevision, interiorImageRevision, updatedAt, createdAt, ...business} = row; void exteriorImageUrl; void interiorImageUrl; void exteriorImageRevision; void interiorImageRevision; void updatedAt; void createdAt; return business }
export async function snapshotScene(tx: DB, row: Scene, reason: string) {
  const old = await tx.contentVersion.findFirst({where: {targetType: "Scene", targetId: row.id, version: row.version}})
  if (old) { if (requestHash(sceneBusiness(old.snapshot as unknown as Scene)) !== requestHash(sceneBusiness(row))) throw new ContentError("SNAPSHOT_CONFLICT", "场景历史与当前修订不一致"); return old }
  return tx.contentVersion.create({data: {targetType: "Scene", targetId: row.id, version: row.version, snapshot: JSON.parse(JSON.stringify(row)), reason}})
}
export async function writeSceneRevision(tx: DB, before: Scene, data: ScenePatch, reason = "场景更新", restoredImages?: {exteriorImageUrl: string | null; interiorImageUrl: string | null}) {
  const checked = await validatePatch(tx, before.novelId, before.id, data, before)
  await snapshotScene(tx, before, "修改前场景")
  const saved = await tx.scene.update({where: {id: before.id, version: before.version}, data: {...checked, ...(restoredImages ? {...restoredImages, exteriorImageRevision: {increment: 1}, interiorImageRevision: {increment: 1}} : {}), attributes: checked.attributes as Prisma.InputJsonValue | undefined, version: {increment: 1}}})
  const snapshot = await snapshotScene(tx, saved, reason)
  return {saved, snapshot}
}
export async function createScene(novelId: string, raw: SceneInput, scope: {userId: string; reuse?: boolean}) {
  const data = createSceneSchema.parse(raw)
  return prisma.$transaction(async tx => {
    await ownedSceneBook(tx, {...scope, novelId}); await lockSceneTree(tx, novelId)
    if (scope.reuse) { const matches = await tx.scene.findMany({where: {novelId, parentId: data.parentId ?? null, name: data.name}}); if (matches.length > 1) throw new ContentError("SCENE_AMBIGUOUS", "同级存在多个同名场景，请明确场景 ID"); if (matches[0]) return matches[0] }
    const checked = await validatePatch(tx, novelId, null, data)
    const saved = await tx.scene.create({data: {...checked, novelId, name: data.name, attributes: data.attributes as Prisma.InputJsonValue | undefined}})
    await snapshotScene(tx, saved, "场景创建"); return saved
  }, {timeout: 15000})
}
export async function updateScene(id: string, raw: ScenePatch, options: SceneSaveOptions) {
  requireVersion(options.expectedVersion); if (!options.operationId) throw new ContentError("PRECONDITION_REQUIRED", "缺少场景保存编号", 428)
  const data = sceneFieldsSchema.parse(raw)
  return prisma.$transaction(async tx => {
    await ownedSceneBook(tx, options); await lockSceneTree(tx, options.novelId); await lockContentOperation(tx, options.userId, options.operationId)
    const hash = requestHash({id, data, options}); const key = {userId_operationId: {userId: options.userId, operationId: options.operationId}}
    const prior = await tx.contentMutation.findUnique({where: key})
    if (prior) { if (prior.requestHash !== hash || prior.targetId !== id || prior.novelId !== options.novelId) throw new ContentError("OPERATION_CONFLICT", "此编号已用于不同场景操作"); const receipt = prior.result as {snapshotId: string}; const snapshot = await tx.contentVersion.findUniqueOrThrow({where: {id: receipt.snapshotId}}); const row = snapshot.snapshot as unknown as Scene; return {...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt)} }
    await tx.$queryRaw`SELECT id FROM "Scene" WHERE id = ${id} FOR UPDATE`
    const before = await ownedScene(tx, options, id)
    if (before.version !== options.expectedVersion) throw new ContentError("VERSION_CONFLICT", "场景已有新修订，草稿已保留，请重新比较")
    let restoredImages: {exteriorImageUrl: string | null; interiorImageUrl: string | null} | undefined
    if (options.restoreSnapshotId) {
      const history = await tx.contentVersion.findFirst({where: {id: options.restoreSnapshotId, targetId: id, targetType: "Scene"}})
      if (!history) throw new ContentError("TARGET_NOT_FOUND", "场景历史不存在", 404)
      const source = history.snapshot as unknown as Scene
      restoredImages = {exteriorImageUrl: source.exteriorImageUrl ?? null, interiorImageUrl: source.interiorImageUrl ?? null}
      for (const kind of ["exterior", "interior"] as const) {const url = restoredImages[`${kind}ImageUrl`]; if (url && !await tx.sceneImage.findFirst({where: {sceneId: id, kind, url}})) throw new ContentError("INVALID_SCENE_IMAGE", "历史图片不属于此场景与类型", 400)}
    }
    const {saved, snapshot} = await writeSceneRevision(tx, before, data, options.restoreSnapshotId ? "恢复场景历史" : "场景更新", restoredImages)
    await tx.contentMutation.create({data: {userId: options.userId, novelId: saved.novelId, targetType: "SCENE", targetId: id, operationId: options.operationId, requestHash: hash, beforeVersion: before.version, afterVersion: saved.version, beforeHash: contentHash(before.description), afterHash: contentHash(saved.description), result: {snapshotId: snapshot.id, version: saved.version, updatedAt: saved.updatedAt.toISOString(), operationId: options.operationId}}})
    return saved
  }, {timeout: 15000})
}
export async function sceneDeleteSources(tx: DB, novelId: string, id: string) {
  const [children, labs, cards, planning, links] = await Promise.all([
    tx.scene.findMany({where: {novelId, parentId: id}, select: {id: true, name: true}}),
    tx.scenarioLab.findMany({where: {novelId, sceneIds: {has: id}}, select: {id: true, title: true}}),
    tx.scenarioCard.findMany({where: {sceneIds: {has: id}}}),
    tx.planningDocument.findUnique({where: {novelId}}),
    tx.storyArtifactLink.findMany({where: {novelId, OR: [{sourceKey: `scene:${id}`}, {targetKey: `scene:${id}`}]}}),
  ])
  const ownedLabs = new Set((await tx.scenarioLab.findMany({where: {novelId}, select: {id: true}})).map(l => l.id))
  const sources = [...children.map(row => ({kind: "scene", id: row.id, name: row.name})), ...labs.map(row => ({kind: "scenario", id: row.id, name: row.title})), ...cards.filter(c => ownedLabs.has(c.labId)).map(c => ({kind: "scenario-card", id: c.id, name: c.text.slice(0, 60)})), ...links.map(l => ({kind: "artifact-link", id: l.id, name: `${l.sourceKey} → ${l.targetKey}`}))]
  if (planning) { const data = planningSchema.parse(planning.data); for (const event of data.events) if (event.materialRefs.some(r => r.kind === "scene" && r.id === id)) sources.push({kind: "event", id: event.id, name: event.title}); for (const card of data.cards) for (const telling of card.tellings) if (telling.materialRefs.some(r => r.kind === "scene" && r.id === id)) sources.push({kind: "telling", id: telling.id, name: `${card.title} / ${telling.narrator}`}) }
  return sources
}
export async function deleteScene(id: string, options: SceneSaveOptions) {
  requireVersion(options.expectedVersion); if (!options.operationId) throw new ContentError("PRECONDITION_REQUIRED", "缺少删除编号", 428)
  return prisma.$transaction(async tx => {
    await ownedSceneBook(tx, options); await lockSceneTree(tx, options.novelId); await lockContentOperation(tx, options.userId, options.operationId)
    const hash = requestHash({id, options, action: "delete"}); const key = {userId_operationId: {userId: options.userId, operationId: options.operationId}}; const prior = await tx.contentMutation.findUnique({where: key})
    if (prior) {if (prior.requestHash !== hash) throw new ContentError("OPERATION_CONFLICT", "此编号已用于不同操作"); return {ok: true}}
    const row = await ownedScene(tx, options, id)
    if (row.version !== options.expectedVersion) throw new ContentError("VERSION_CONFLICT", "场景已有新修订，请重新确认删除")
    const sources = await sceneDeleteSources(tx, options.novelId, id)
    if (sources.length) throw new ContentError("SCENE_REFERENCED", `无法删除：${sources.map(s => `${s.kind}「${s.name}」(${s.id})`).join("；")}`)
    await snapshotScene(tx, row, "删除前场景"); await tx.scene.delete({where: {id}})
    await tx.contentMutation.create({data: {userId: options.userId, novelId: options.novelId, targetType: "SCENE", targetId: id, operationId: options.operationId, requestHash: hash, beforeVersion: row.version, beforeHash: contentHash(row.description), afterHash: "", result: {ok: true}}}); return {ok: true}
  }, {timeout: 15000})
}
export async function restoreScene(id: string, snapshotId: string, options: SceneSaveOptions) {
  await ownedScene(prisma, options, id)
  const snapshot = await prisma.contentVersion.findFirst({where: {id: snapshotId, targetType: "Scene", targetId: id}})
  if (!snapshot) throw new ContentError("TARGET_NOT_FOUND", "场景历史不存在", 404)
  const row = snapshot.snapshot as unknown as Scene
  // Images are restored only through their authenticated, matching-kind history selector.
  for (const kind of ["exterior", "interior"] as const) { const url = row[`${kind}ImageUrl`]; if (url && !await prisma.sceneImage.findFirst({where: {sceneId: id, kind, url}})) throw new ContentError("INVALID_SCENE_IMAGE", "历史图片不属于此场景", 400) }
  const keys = ["name", "parentId", "description", "coordinates", "attributes", "backstory", "entryMethod", "exteriorDescription", "interiorDescription", "factionSettingId", "factionId"] as const
  return updateScene(id, Object.fromEntries(keys.map(k => [k, row[k]])) as ScenePatch, {...options, restoreSnapshotId: snapshotId})
}
