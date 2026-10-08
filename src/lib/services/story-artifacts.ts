import { sceneFactionLabel } from "@/lib/scene-context"
import { sceneForest } from "@/lib/scene-tree"
import { sceneFactions, lockSceneTree } from "./scene"
import { planningSchema, worldEvents, readingCards, cardChapter } from "@/lib/planning/domain"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { ContentError } from "@/lib/content-errors"
import { requestHash } from "./content-commit"
import { storyReachable, type StoryArtifact, type StoryArtifactKind, type StoryEdge } from "@/lib/story-workflow"
import { storyCheckpointsSchema } from "@/lib/story-workflow"
import type { StoryPhase } from "@/lib/sop/graph"
import { MATERIAL_ROLE_LABELS } from "@/lib/material-reference"

export type StoryScope = { userId: string; novelId: string }
type StoryDatabase = Pick<typeof prisma, "novel" | "theme" | "world" | "setting" | "character" | "item" | "scene" | "trope" | "attributeDefinition" | "foreshadow" | "volume" | "storyArtifactLink" | "storyWorkflow" | "planningDocument">
export async function ownedStory(scope: StoryScope, db: Pick<StoryDatabase, "novel"> = prisma) {
  const novel = await db.novel.findFirst({ where: { id: scope.novelId, userId: scope.userId, status: { not: "DELETED" } } })
  if (!novel) throw new ContentError("NOVEL_NOT_FOUND", "作品不存在或无权访问", 404)
  return novel
}

/** 语义指纹不受评分、自动图像、坐标和状态提示回填影响。 */
const transient = new Set(["createdAt", "updatedAt", "version", "x", "y", "imageUrl", "imagePrompt", "imagePromptAt", "avatarUrl", "portraitUrl", "exteriorImageUrl", "interiorImageUrl", "exteriorImageRevision", "interiorImageRevision", "coverUrl", "score", "scoreReason", "notes"])
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key, item]) => !transient.has(key) && !(key === "materialRefs" && Array.isArray(item) && item.length === 0)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, semantic(item)]))
  return value
}
export function storyArtifactHash(kind: StoryArtifactKind, title: string, text: string) {
  return requestHash({ kind, title, text })
}
export async function readStoryArtifacts(scope: StoryScope, db: StoryDatabase = prisma) {
  await ownedStory(scope, db)
  const where = { novelId: scope.novelId }, orderBy = { id: "asc" as const }
  const [theme, worlds, settings, characters, items, scenes, tropes, attributes, foreshadows, volumes, links, workflow, planningRow] = await Promise.all([
    db.theme.findUnique({ where: { novelId: scope.novelId } }), db.world.findMany({ where, orderBy }), db.setting.findMany({ where, orderBy }),
    db.character.findMany({ where, orderBy }), db.item.findMany({ where, orderBy }), db.scene.findMany({ where, orderBy }),
    db.trope.findMany({ where, orderBy }), db.attributeDefinition.findMany({ where, orderBy }),
    db.foreshadow.findMany({ where, orderBy, include: { touches: { orderBy, select: { id: true, kind: true, summary: true, chapterId: true } } } }),
    db.volume.findMany({ where, orderBy: { index: "asc" }, include: { chapters: { orderBy: { index: "asc" } } } }),
    db.storyArtifactLink.findMany({ where, orderBy }),
    db.storyWorkflow.findUnique({ where: { novelId: scope.novelId }, select: { brief: true } }),
    db.planningDocument.findUnique({where:{novelId:scope.novelId}}),
  ])
  const artifacts: StoryArtifact[] = [], edges: StoryEdge[] = []
  const add = (kind: StoryArtifactKind, id: string, title: string, value: unknown, phase: StoryPhase, extra: Partial<StoryArtifact> = {}) => {
    const text = typeof value === "string" ? value : JSON.stringify(semantic(value))
    artifacts.push({ key: `${kind}:${id}`, kind, id, title, text, hash: storyArtifactHash(kind, title, text), phase, ...extra })
  }
  const edge = (sourceKey: string, targetKey: string, reason: string) => edges.push({ sourceKey, targetKey, reason })
  if (theme && (theme.synopsis.trim() || theme.genre.trim())) add("theme", theme.id, theme.title, theme, "settings")
  for (const row of worlds) { add("world", row.id, row.name, row, "settings"); if (row.parentId) edge(`world:${row.parentId}`, `world:${row.id}`, "所属世界") }
  for (const row of settings) { add("setting", row.id, row.name, row, "settings", { settingType: row.type, worldId: row.worldId, worldTitle: worlds.find(world => world.id === row.worldId)?.name }); if (row.worldId) edge(`world:${row.worldId}`, `setting:${row.id}`, "世界设定"); if (row.parentId) edge(`setting:${row.parentId}`, `setting:${row.id}`, "所属地图") }
  for (const row of characters) add("character", row.id, row.name, row, "settings")
  for (const row of items) add("item", row.id, row.name, row, "settings")
  const factions = await sceneFactions(scope.novelId, db)
  const sceneTree = sceneForest(scenes)
  for (const row of scenes) {add("scene", row.id, row.name, {...row, factionLabel: sceneFactionLabel(row, factions), path: sceneTree.path(row.id), ancestorSummary: (sceneTree.paths.get(row.id) ?? []).slice(0, -1).map(parent => ({id: parent.id, name: parent.name, description: parent.description, entryMethod: parent.entryMethod, factionSettingId: parent.factionSettingId, factionId: parent.factionId, factionLabel: sceneFactionLabel(parent, factions)}))}, "settings"); if (row.parentId) edge(`scene:${row.parentId}`, `scene:${row.id}`, "所属场景")}
  for (const row of tropes) add("trope", row.id, row.content.slice(0, 50), row, "settings")
  for (const row of attributes) add("attribute", row.id, row.name, row, "settings")
  for (const row of foreshadows) {
    add("foreshadow", row.id, row.title, { title: row.title, content: row.content, expectation: row.expectation, plannedChapter: row.plannedChapter, dropped: row.status === "DROPPED" }, "settings")
    for (const touch of row.touches) {
      if (touch.chapterId) for (const type of ["chapter-outline", "chapter-content"]) edge(`foreshadow:${row.id}`, `${type}:${touch.chapterId}`, "伏笔埋入/回收")
    }
  }
  const planning = planningRow ? planningSchema.parse(planningRow.data) : null
  if(planning){
    for(const w of planning.worlds){
      add("worldline",w.id,w.name,{...w,events:worldEvents(planning,w.id),periods:planning.periods.filter(p=>p.line===w.id)},"plot")
      if(w.worldId)edge(`world:${w.worldId}`,`worldline:${w.id}`,"世界中的历史")
      for(const e of worldEvents(planning,w.id)){ const id=`${w.id}/${e.id}`;add("world-event",id,e.title,e,"plot");edge(`worldline:${w.id}`,`world-event:${id}`,"客观历史");for(const person of e.people)edge(`character:${person}`,`world-event:${id}`,"事件角色");for(const r of e.materialRefs)edge(`${r.kind}:${r.id}`,`world-event:${id}`,`剧情资料·${MATERIAL_ROLE_LABELS[r.role]}`) }
    }
    for(const l of planning.lines){add("narrative",l.id,l.name,{line:l,cards:planning.cards.filter(c=>c.line===l.id)},"plot")}
    for(const c of planning.cards){add("narrative-card",c.id,c.title,c,"plot");edge(`narrative:${c.line}`,`narrative-card:${c.id}`,"叙事构思");if(c.parent)edge(`narrative-card:${c.parent}`,`narrative-card:${c.id}`,"逐层细化");for(const t of c.tellings){if(t.character)edge(`character:${t.character}`,`narrative-card:${c.id}`,"讲述视角");for(const r of t.refs)edge(`world-event:${r.line}/${r.event}`,`narrative-card:${c.id}`,"共享事件的有限披露")}}
    for(const l of planning.lines)for(const c of readingCards(planning,l.id))if(cardChapter(planning,c))edge(`narrative-card:${c.id}`,`chapter-outline:${cardChapter(planning,c)}`,"叙事线卷章投影")
    for (const c of planning.cards) for (const t of c.tellings) for (const r of t.materialRefs) edge(`${r.kind}:${r.id}`, `narrative-card:${c.id}`, `讲述资料·${MATERIAL_ROLE_LABELS[r.role]}`)
  }
  let chapterIndex = 0
  for (const volume of volumes) {
    add("volume", volume.id, volume.title, { title: volume.title, summary: volume.summary, index: volume.index }, "outline")
    for (const chapter of volume.chapters) {
      chapterIndex++
      add("chapter-outline", chapter.id, chapter.title, chapter.outline, "outline", { chapterIndex })
      add("chapter-content", chapter.id, chapter.title, chapter.content, "writing", { chapterIndex })
      edge(`volume:${volume.id}`, `chapter-outline:${chapter.id}`, "所属卷")
      edge(`chapter-outline:${chapter.id}`, `chapter-content:${chapter.id}`, "依据细纲写作")
      for (const style of settings.filter(s => s.type === "STYLE" && s.worldId === null)) edge(`setting:${style.id}`, `chapter-outline:${chapter.id}`, "本书文风")
    }
  }
  // 明确存储的边优先携带基线；不存在两端的边保留，作为删除后的失效提示。
  const explicit = new Map(links.map(link => [`${link.sourceKey}>${link.targetKey}`, link]))
  const merged = [...edges.filter(e => !explicit.has(`${e.sourceKey}>${e.targetKey}`)), ...links]
  return { artifacts, edges: merged, volumes, planning, contextHash: requestHash(workflow?.brief ?? "") }
}

export async function linkStoryArtifacts(scope: StoryScope, sourceKey: string, targetKey: string, reason: string, expectedSourceHash: string, expectedTargetHash: string) {
  return prisma.$transaction(async tx => {
    await lockSceneTree(tx, scope.novelId)
    const graph = await readStoryArtifacts(scope, tx as unknown as StoryDatabase)
    const source = graph.artifacts.find(a => a.key === sourceKey), target = graph.artifacts.find(a => a.key === targetKey)
    if (!source || !target || sourceKey === targetKey) throw new ContentError("STORY_LINK_INVALID", "来源与目标须为本作品不同的真实产物", 400)
    if (source.hash !== expectedSourceHash || target.hash !== expectedTargetHash) throw new ContentError("VERSION_CONFLICT", "来源或目标已变化，请重新读取后确认关联")
    const prior = graph.edges.find(e => e.sourceKey === sourceKey && e.targetKey === targetKey && e.sourceHash)
    if (prior?.sourceHash !== undefined && prior.sourceHash !== source.hash && prior.targetHash === target.hash) {
      const row = await tx.storyWorkflow.findUnique({ where: { novelId: scope.novelId } })
      const checkpoint = row && storyCheckpointsSchema.parse(row.checkpoints)[targetKey]
      if (!checkpoint?.passed || checkpoint.hash !== storyEvidenceHash(targetKey, graph)) throw new ContentError("STORY_SOURCE_UNRESOLVED", "来源已变化，但目标尚未修订。先修改目标；若确实无需修改，请独立评审当前来源与目标后再确认关联", 409)
    }
    if (storyReachable([targetKey], graph.edges).has(sourceKey)) throw new ContentError("STORY_LINK_CYCLE", "此关联会形成来源循环", 400)
    return tx.storyArtifactLink.upsert({ where: { novelId_sourceKey_targetKey: { novelId: scope.novelId, sourceKey, targetKey } },
      create: { novelId: scope.novelId, sourceKey, targetKey, reason, sourceHash: source.hash, targetHash: target.hash },
      update: { reason, sourceHash: source.hash, targetHash: target.hash } })
  }, { isolationLevel: "Serializable" })
}

export function storyEvidenceHash(key: string, graph: { artifacts: StoryArtifact[]; edges: StoryEdge[]; contextHash?: string }) {
  const sources = storyReachable([key], graph.edges, true); sources.add(key)
  // 简报中的作者决定同样进入评审提示；修改它后不能沿用旧规则下的评分与认可。
  return requestHash({ context: graph.contextHash ?? requestHash(""), artifacts: graph.artifacts.filter(a => sources.has(a.key)).map(a => [a.key, a.hash]).sort(([a], [b]) => a.localeCompare(b)) })
}

export async function storyImpact(scope: StoryScope, key: string) {
  const graph = await readStoryArtifacts(scope), source = graph.artifacts.find(a => a.key === key)
  if (!source && !graph.edges.some(e => e.sourceKey === key)) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "产物不存在或不属于本书", 404)
  const reachable = storyReachable([key], graph.edges)
  const affected = graph.artifacts.filter(a => reachable.has(a.key))
  const possible = source ? graph.artifacts.filter(a => a.key !== key && !reachable.has(a.key) && source.title.length > 1 && a.text.includes(source.title)) : []
  const compact = ({ text, ...artifact }: StoryArtifact) => ({ ...artifact, excerpt: text.slice(0, 600) })
  return { source: source ? compact(source) : { key, deleted: true }, affected: affected.map(compact), possible: possible.map(compact),
    instruction: "明确关联逐项核对并用原修改工具修订；可能关联和多种方案使用 askUserQuestion。完成修改后重评，依据新指纹确认来源关系。" }
}

export async function storySources(scope: StoryScope, key: string) {
  const graph = await readStoryArtifacts(scope)
  if (!graph.artifacts.some(a => a.key === key)) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "产物不存在或不属于本书", 404)
  const sourceKeys = storyReachable([key], graph.edges, true), targetKeys = storyReachable([key], graph.edges)
  return { sources: graph.artifacts.filter(a => sourceKeys.has(a.key)), targets: graph.artifacts.filter(a => targetKeys.has(a.key)), edges: graph.edges.filter(e => e.targetKey === key || e.sourceKey === key) }
}

export const storyJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
