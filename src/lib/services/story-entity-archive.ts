import { Prisma, type World, type Setting, type Theme, type Character, type CharacterImage, type Item, type Scene, type Foreshadow, type ForeshadowTouch, type ForeshadowReference, type Trope, type AttributeDefinition } from "@/generated/prisma/client"
import { ContentError } from "@/lib/content-errors"

export const STORY_ENTITY_KINDS = ["world", "setting", "theme", "character", "item", "scene", "foreshadow", "trope", "attribute"] as const
export interface StoryEntityArchive {
  kind: typeof STORY_ENTITY_KINDS[number]; id: string; title: string; keys: string[]
  worlds?: World[]; settings?: Setting[]; themes?: Theme[]; characters?: Character[]; images?: CharacterImage[]
  items?: Item[]; scenes?: Scene[]; foreshadows?: Foreshadow[]; touches?: ForeshadowTouch[]; references?: ForeshadowReference[]
  tropes?: Trope[]; attributes?: AttributeDefinition[]
}
function descendants<T extends { id: string; parentId: string | null }>(rows: T[], root: string) {
  const ids = new Set([root])
  for (;;) { const size = ids.size; rows.forEach(row => { if (row.parentId && ids.has(row.parentId)) ids.add(row.id) }); if (ids.size === size) return rows.filter(row => ids.has(row.id)) }
}
function parentFirst<T extends { id: string; parentId: string | null }>(rows: T[]) {
  const pending = [...rows], result: T[] = []
  while (pending.length) {
    const index = pending.findIndex(row => !pending.some(parent => parent.id === row.parentId))
    if (index < 0) throw new ContentError("RESTORE_CONFLICT", "回收记录的父子关系存在循环", 409)
    result.push(pending.splice(index, 1)[0])
  }
  return result
}
export async function readStoryEntityArchive(db: Prisma.TransactionClient, novelId: string, key: string): Promise<StoryEntityArchive> {
  const [rawKind, id] = key.split(":"), kind = rawKind as StoryEntityArchive["kind"]
  const data: StoryEntityArchive = { kind, id, title: "", keys: [key] }
  if (kind === "world") {
    const all = await db.world.findMany({ where: { novelId }, orderBy: { id: "asc" } })
    data.worlds = descendants(all, id)
    data.title = data.worlds.find(row => row.id === id)?.name ?? ""
    data.settings = await db.setting.findMany({ where: { novelId, worldId: { in: data.worlds.map(row => row.id) } }, orderBy: { id: "asc" } })
    data.keys = [...data.worlds.map(row => `world:${row.id}`), ...data.settings.map(row => `setting:${row.id}`)]
  } else if (kind === "setting") {
    data.settings = descendants(await db.setting.findMany({ where: { novelId }, orderBy: { id: "asc" } }), id)
    data.title = data.settings.find(row => row.id === id)?.name ?? ""
    data.keys = data.settings.map(row => `setting:${row.id}`)
  } else if (kind === "character") {
    data.characters = await db.character.findMany({ where: { novelId, id } }); data.title = data.characters[0]?.name ?? ""
    data.images = await db.characterImage.findMany({ where: { characterId: id, character: { novelId } }, orderBy: { id: "asc" } })
  } else if (kind === "foreshadow") {
    data.foreshadows = await db.foreshadow.findMany({ where: { novelId, id } }); data.title = data.foreshadows[0]?.title ?? ""
    data.touches = await db.foreshadowTouch.findMany({ where: { novelId, foreshadowId: id }, orderBy: { id: "asc" } })
    data.references = await db.foreshadowReference.findMany({ where: { novelId, touchId: { in: data.touches.map(row => row.id) } }, orderBy: { id: "asc" } })
  } else if (kind === "theme") {
    data.themes = await db.theme.findMany({ where: { novelId, id } }); data.title = data.themes[0]?.title ?? ""
  } else if (kind === "item") {
    data.items = await db.item.findMany({ where: { novelId, id } }); data.title = data.items[0]?.name ?? ""
  } else if (kind === "scene") {
    data.scenes = await db.scene.findMany({ where: { novelId, id } }); data.title = data.scenes[0]?.name ?? ""
  } else if (kind === "trope") {
    data.tropes = await db.trope.findMany({ where: { novelId, id } }); data.title = data.tropes[0]?.category ?? ""
  } else if (kind === "attribute") {
    data.attributes = await db.attributeDefinition.findMany({ where: { novelId, id } }); data.title = data.attributes[0]?.name ?? ""
  }
  if (!data.title) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "内容不存在或不属于本作品", 404)
  return data
}
export async function removeStoryEntityArchive(db: Prisma.TransactionClient, data: StoryEntityArchive) {
  const where = { id: data.id }
  switch (data.kind) {
    case "world": await db.world.delete({ where }); break
    case "setting": await db.setting.delete({ where }); break
    case "theme": await db.theme.delete({ where }); break
    case "character": await db.character.delete({ where }); break
    case "item": await db.item.delete({ where }); break
    case "scene": await db.scene.delete({ where }); break
    case "foreshadow": await db.foreshadow.delete({ where }); break
    case "trope": await db.trope.delete({ where }); break
    case "attribute": await db.attributeDefinition.delete({ where }); break
  }
}

function rowData(row: object, jsonFields: string[] = []) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null && jsonFields.includes(key) ? Prisma.JsonNull : value]))
}
/** 只恢复服务端快照的白名单表。外部引用按原ID保留，缺失父级和占位冲突整体回滚。 */
export async function restoreStoryEntityArchive(db: Prisma.TransactionClient, novelId: string, data: StoryEntityArchive) {
  try {
    for (const row of parentFirst(data.worlds ?? [])) {
      if (row.parentId && !await db.world.findFirst({ where: { novelId, id: row.parentId } })) throw new ContentError("RESTORE_CONFLICT", "父世界已移除，请先恢复父世界", 409)
      if (await db.world.findFirst({ where: { novelId, name: row.name, parentId: row.parentId } })) throw new ContentError("RESTORE_CONFLICT", "同一层级已有同名世界，请先整理名称再恢复", 409)
      await db.world.create({ data: rowData(row) as Prisma.WorldUncheckedCreateInput })
    }
    for (const row of parentFirst(data.settings ?? [])) {
      if (row.worldId && !await db.world.findFirst({ where: { novelId, id: row.worldId } })) throw new ContentError("RESTORE_CONFLICT", "所属世界已移除，请先恢复该世界", 409)
      if (row.parentId && !await db.setting.findFirst({ where: { novelId, id: row.parentId } })) throw new ContentError("RESTORE_CONFLICT", "父设定已移除，请先恢复父设定", 409)
      await db.setting.create({ data: rowData(row, ["content"]) as Prisma.SettingUncheckedCreateInput })
    }
    for (const row of data.themes ?? []) {
      await db.theme.create({ data: rowData(row, ["authorPosition"]) as Prisma.ThemeUncheckedCreateInput })
      // 与 upsertTheme 语义对齐：主题书名即作品显示名，恢复后同步 Novel.title（同名校守卫），
      // 避免主题旧名与作品名分叉、下次主题更新再回盖。
      await db.novel.updateMany({ where: { id: novelId, title: { not: row.title } }, data: { title: row.title } })
    }
    for (const row of data.characters ?? []) await db.character.create({ data: rowData(row, ["aliases", "personalityTags", "motivations", "beliefs", "bigFive", "relationships", "avatarCrop", "portraitCrop", "attributes", "extra"]) as Prisma.CharacterUncheckedCreateInput })
    for (const row of data.images ?? []) await db.characterImage.create({ data: rowData(row) as Prisma.CharacterImageUncheckedCreateInput })
    for (const row of data.items ?? []) await db.item.create({ data: rowData(row, ["attributes"]) as Prisma.ItemUncheckedCreateInput })
    for (const row of data.scenes ?? []) await db.scene.create({ data: rowData(row, ["attributes"]) as Prisma.SceneUncheckedCreateInput })
    for (const row of data.foreshadows ?? []) await db.foreshadow.create({ data: rowData(row) as Prisma.ForeshadowUncheckedCreateInput })
    for (const row of data.touches ?? []) await db.foreshadowTouch.create({ data: rowData(row) as Prisma.ForeshadowTouchUncheckedCreateInput })
    for (const row of data.references ?? []) await db.foreshadowReference.create({ data: rowData(row) as Prisma.ForeshadowReferenceUncheckedCreateInput })
    for (const row of data.tropes ?? []) await db.trope.create({ data: rowData(row) as Prisma.TropeUncheckedCreateInput })
    for (const row of data.attributes ?? []) await db.attributeDefinition.create({ data: rowData(row) as Prisma.AttributeDefinitionUncheckedCreateInput })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["P2002", "P2003"].includes(String(error.code))) throw new ContentError("RESTORE_CONFLICT", "原位置已有同名/同ID内容，或关联内容已移除；请先核对，恢复不会覆盖新内容", 409)
    throw error
  }
}
