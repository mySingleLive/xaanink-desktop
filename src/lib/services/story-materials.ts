import { renderSceneContext, sceneHasText } from "@/lib/scene-context"
import type { Prisma } from "@/generated/prisma/client"
import { sceneFactions } from "./scene"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { chapterMaterials, assessChapterMaterialReferences, materialHasContent, planningMaterialRefs, unlinkedPlants, isCompleteDraw, MATERIAL_LABELS, MATERIAL_ROLE_LABELS, type MaterialRef, type StoryMaterial } from "@/lib/story-materials"
import { normalizeAliases } from "@/lib/aliases"
import { planningSchema, type PlanningData } from "@/lib/planning/domain"
import type { ChapterScope } from "./chapter-history"

type DB = Pick<Prisma.TransactionClient, "setting" | "world" | "item" | "scene" | "foreshadow">
export async function loadStoryMaterials(db: DB, novelId: string, refs?: MaterialRef[], options: { includeItemSceneCatalog?: boolean } = {}): Promise<StoryMaterial[]> {
  const where = (kind: MaterialRef["kind"]) => ({ novelId, ...(refs && !(options.includeItemSceneCatalog && (kind === "item" || kind === "scene")) ? { id: { in: [...new Set(refs.filter(r => r.kind === kind).map(r => r.id))] } } : {}) })
  const [settings, items, scenes, foreshadows] = await Promise.all([
    db.setting.findMany({ where: where("setting"), select: { id: true, name: true, type: true, worldId: true, content: true } }),
    db.item.findMany({ where: where("item"), select: { id: true, name: true, aliases: true, description: true, appearance: true, acquisition: true, effects: true } }),
    db.scene.findMany({ where: {novelId}, orderBy: {createdAt: "asc"} }),
    db.foreshadow.findMany({ where: where("foreshadow"), select: { id: true, title: true, content: true, status: true } }),
  ])
  const factions = await sceneFactions(novelId, db as Parameters<typeof sceneFactions>[1])
  return [
    ...settings.map(s => ({ kind: "setting" as const, id: s.id, title: s.name, type: s.type, worldId: s.worldId, content: s.content })),
    ...items.map(i => ({ kind: "item" as const, id: i.id, title: i.name, aliases: normalizeAliases(i.aliases), content: { description: i.description, appearance: i.appearance, acquisition: i.acquisition, effects: i.effects } })),
    ...scenes.filter(s => !refs || options.includeItemSceneCatalog || refs.some(ref => ref.kind === "scene" && ref.id === s.id)).map(s => ({ kind: "scene" as const, id: s.id, title: s.name, content: sceneHasText(s) ? renderSceneContext(scenes, s.id, factions) : "" })),
    ...foreshadows.map(f => ({ kind: "foreshadow" as const, id: f.id, title: f.title, content: f.content, status: f.status })),
  ]
}
function invalidMaterials(refs: MaterialRef[], materials: StoryMaterial[]) {
  const byKey = new Map(materials.map(m => [`${m.kind}:${m.id}`, m]))
  return [...new Map(refs.map(r => [`${r.kind}:${r.id}`, r])).values()].filter(r => {
    const m = byKey.get(`${r.kind}:${r.id}`)
    return !m || !materialHasContent(m) || m.status === "DROPPED"
  })
}
export async function validatePlanningMaterials(db: DB, novelId: string, data: PlanningData) {
  const refs = planningMaterialRefs(data)
  if (!refs.length) return
  const invalid = invalidMaterials(refs, await loadStoryMaterials(db, novelId, refs))
  if (invalid.length) throw new ContentError("PLANNING_MATERIAL", `关联${MATERIAL_LABELS[invalid[0].kind]}不存在、不属于本书、内容为空或已废弃；先创建/补齐档案再关联`, 400)
}

export type PreparationIssue = { code: "STYLE_MISSING" | "WORLD_MISSING" | "MATERIAL_INVALID" | "MATERIAL_REFERENCE_MISSING" | "FORESHADOW_UNLINKED" | "OPENING_FORESHADOW_MISSING"; message: string; cardId?: string; cardTitle?: string }
export type PreparationSummary = {
  materials: number; plants: number; checked: true; items: number; scenes: number
  referenceCheck: "known-names"; missingMaterialReferences: ReturnType<typeof assessChapterMaterialReferences>["missing"]
  invalidMaterialMentions: ReturnType<typeof assessChapterMaterialReferences>["invalid"]; notices: string[]
}
export async function assessChapterMaterials(scope: ChapterScope, data: PlanningData, content: string) {
  const focus = chapterMaterials(data, scope.chapterId)
  const [styles, worlds, materials, first, draws] = await Promise.all([
    prisma.setting.findMany({ where: { novelId: scope.novelId, type: "STYLE", worldId: null } }),
    prisma.world.findMany({ where: { novelId: scope.novelId } }),
    loadStoryMaterials(prisma, scope.novelId, focus.refs, { includeItemSceneCatalog: true }),
    prisma.chapter.findFirst({ where: { volume: { novelId: scope.novelId } }, orderBy: [{ volume: { index: "asc" } }, { index: "asc" }, { id: "asc" }], select: { id: true } }),
    !content.trim() ? prisma.contentCandidate.findMany({ where: { userId: scope.userId, novelId: scope.novelId, chapterId: scope.chapterId, drawId: { not: null } }, select: { drawId: true, content: true, status: true, checks: true } }) : Promise.resolve([]),
  ])
  const issues: PreparationIssue[] = []
  if (!styles.some(s => materialHasContent({ kind: "setting", id: s.id, title: s.name, content: s.content, type: s.type }))) issues.push({ code: "STYLE_MISSING", message: "尚无可用文风；用 upsertSetting(type=STYLE) 简短补充 style 或 referenceCases" })
  const worldIds = [...new Set(focus.events.map(e => data.worlds.find(w => w.id === e.line)?.worldId))]
  const worldReady = (id: string | null | undefined): boolean => {
    const seen = new Set<string>()
    while (id && !seen.has(id)) {
      seen.add(id)
      const world = worlds.find(w => w.id === id)
      if (!world) return false
      if (world.description.trim()) return true
      id = world.parentId
    }
    return false
  }
  if (!worldIds.length || worldIds.some(id => !worldReady(id))) issues.push({ code: "WORLD_MISSING", message: "本章世界事件缺少关联世界或世界介绍；先创建/补齐 World.description，再将世界线 worldId 关联该世界" })
  for (const ref of invalidMaterials(focus.refs, materials)) issues.push({ code: "MATERIAL_INVALID", message: `本章关联${MATERIAL_LABELS[ref.kind]}已删除、跨书、内容为空或已废弃，先补齐资料并修订本章引用` })
  const references = assessChapterMaterialReferences(data, scope.chapterId, materials, content)
  for (const gap of references.invalid) issues.push({ code: "MATERIAL_INVALID", cardId: gap.cardId, cardTitle: gap.cardTitle,
    message: `本章明确提及${MATERIAL_LABELS[gap.kind]}「${gap.title}」（${gap.id}），但其档案内容为空且尚未关联；先补齐已有档案，再经 proposeNovelPlanning 关联实际使用的事件/讲述，不能将空壳资料视为完备` })
  for (const gap of references.missing) issues.push({ code: "MATERIAL_REFERENCE_MISSING", cardId: gap.cardId, cardTitle: gap.cardTitle,
    message: `本章${gap.cardTitle ? `「${gap.cardTitle}」` : "已保存正文"}明确提及${MATERIAL_LABELS[gap.kind]}「${gap.title}」（${gap.id}，名称/别名「${gap.matchedName}」），但该讲述及其引用事件未关联此档案。先用 ${gap.kind === "item" ? "listItems" : "listScenes"} 核对已有资料，必要时补齐；经 proposeNovelPlanning 为实际使用的事件/讲述补 materialRefs(kind=${gap.kind}, id=${gap.id}, role=use, note=本次用途)，作者采用后复检，不盲目关联全书资料` })
  for (const broken of unlinkedPlants(data, scope.chapterId)) issues.push({ code: "FORESHADOW_UNLINKED", cardId: broken.cardId, cardTitle: broken.cardTitle, message: `「${broken.cardTitle}」的首次埋入伏笔未关联同一讲述引用的世界事件` })
  const plants = focus.tellingRefs.filter(r => r.kind === "foreshadow" && r.role === "plant")
  if (first?.id === scope.chapterId && !content.trim() && !draws.some(isCompleteDraw) && !plants.length) issues.push({ code: "OPENING_FORESHADOW_MISSING", message: "首章首次抽卡前需至少一条伏笔：先 createForeshadow，再在本章引用的世界事件和实际叙事讲述中关联同一伏笔的 plant 与可见线索；后续提及/回收可暂不规划" })
  const notices = references.unreferencedKinds.map(kind => `本书有${MATERIAL_LABELS[kind]}档案，但本章该类引用为0；已存名称/别名检查不能证明语义完备，核对本章是否实际使用，只关联必要资料，无关资料不必关联`)
  if (references.ambiguousNames.length) notices.push(`这些名称/别名对应多个档案，需核对实际实体，不自动关联全部：${references.ambiguousNames.join("、")}`)
  const summary: PreparationSummary = { materials: new Set(focus.refs.map(r => `${r.kind}:${r.id}`)).size, plants: plants.length, checked: true,
    ...references.references, referenceCheck: "known-names", missingMaterialReferences: references.missing, invalidMaterialMentions: references.invalid, notices }
  return { issues, summary }
}

/** 生成专用：只给本章可见伏笔线索，旧作真实触点只给摘要；禁止全书档案真相旁路。 */
export async function buildChapterMaterialContext(novelId: string, chapterId: string) {
  const row = await prisma.planningDocument.findUnique({ where: { novelId } })
  const data = row ? planningSchema.parse(row.data) : null
  const focus = data ? chapterMaterials(data, chapterId) : null
  const refs = focus?.tellingRefs ?? []
  const [materials, touches, worlds] = await Promise.all([
    loadStoryMaterials(prisma, novelId, focus?.refs ?? refs),
    prisma.foreshadowTouch.findMany({ where: { chapterId, foreshadow: { novelId } }, select: { kind: true, summary: true } }),
    prisma.world.findMany({ where: { novelId }, select: { id: true, parentId: true } }),
  ])
  const worldIds = new Set(focus?.events.flatMap(e => data?.worlds.find(w => w.id === e.line)?.worldId ?? []) ?? [])
  for (const material of materials) if (material.worldId) worldIds.add(material.worldId)
  for (const id of worldIds) {
    let parent = worlds.find(w => w.id === id)?.parentId
    while (parent && !worldIds.has(parent)) { worldIds.add(parent); parent = worlds.find(w => w.id === parent)?.parentId }
  }
  const section = materials.filter(m => m.kind === "item" || m.kind === "scene").map(m => `【${MATERIAL_LABELS[m.kind]}：${m.title}】\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n\n")
  const foreshadows = refs.filter(r => r.kind === "foreshadow").map(r => `【${MATERIAL_ROLE_LABELS[r.role]}：${materials.find(m => m.kind === r.kind && m.id === r.id)?.title ?? "本章线索"}】${r.note}`)
  return { section, foreshadows: [...foreshadows, ...touches.filter(t => t.summary.trim()).map(t => `本章已记录${t.kind}触点：${t.summary}`)].join("\n") || "（本章未安排伏笔提及/回收；不自行增加或揭晓）", worldIds: [...worldIds], settingIds: materials.filter(m => m.kind === "setting").map(m => m.id) }
}
