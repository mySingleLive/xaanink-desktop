import { renderSceneDirectory, renderSceneContext, selectedSceneIds } from "@/lib/scene-context"
import { listScenes, sceneFactions } from "@/lib/services/scene"
import { prisma } from "@/lib/db"
import { worldDisplayName } from "@/lib/world-schema"
import { buildNovelContext, renderCharacter, loadCharacterAttributeNames } from "./context"
import { readChapterBoundaries } from "@/lib/services/chapter-boundaries"

/** 仅明确目标启用。目录含身份与版本，未装载字段必须通过领域工具读取后才能修改。 */
export async function buildTaskNovelContext(novelId: string, task: string, targetId?: string) {
  const [novel, chapters, settings, characters, worlds] = await Promise.all([
    prisma.novel.findUniqueOrThrow({ where: { id: novelId }, include: { theme: true, tropes: { where: { selected: true } } } }),
    prisma.chapter.findMany({ where: { volume: { novelId } }, select: { id: true, title: true, index: true, version: true, outline: true }, orderBy: [{ volume: { index: "asc" } }, { index: "asc" }] }),
    prisma.setting.findMany({ where: { novelId }, orderBy: { createdAt: "asc" } }),
    prisma.character.findMany({ where: { novelId }, orderBy: { createdAt: "asc" } }),
    prisma.world.findMany({ where: { novelId }, orderBy: { createdAt: "asc" } }),
  ])
  const scenes = await listScenes(novelId)
  const sceneTargets = selectedSceneIds(scenes, task, novelId, targetId)
  const chapterTargets = chapters.filter(chapter => chapter.id === targetId || (chapter.title.length >= 2 && task.includes(chapter.title)))
  const charTargets = characters.filter(character => character.id === targetId || (character.name.length >= 2 && task.includes(character.name)))
  const worldTargets = worlds.filter(world => world.id === targetId || (world.name?.length >= 2 && task.includes(world.name)))
  const settingTargets = settings.filter(setting => setting.id === targetId || (setting.name.length >= 2 && task.includes(setting.name)))
  if (!chapterTargets.length && !charTargets.length && !worldTargets.length && !settingTargets.length && !sceneTargets.length) return buildNovelContext(novelId, task)
  const parts = [`# 《${novel.title}》本轮创作上下文`, "以下目录未展开的原文可用领域工具读取；禁止凭目录推断细节或覆盖正文。",
    `【主题】${JSON.stringify(novel.theme)}`,
    `【作者选定的爽点与泪点】${JSON.stringify(novel.tropes)}`,
    `【全局设定】${JSON.stringify(settings.filter(setting => setting.worldId === null))}`,
    `【章节目录】${JSON.stringify(chapters.map(c => ({ id: c.id, title: c.title, index: c.index, version: c.version })))}`,
    `【角色目录】${JSON.stringify(characters.map(c => ({ id: c.id, name: c.name, roleType: c.roleType, updatedAt: c.updatedAt })))}`,
    `【世界目录】${JSON.stringify(worlds.map(w => ({ id: w.id, name: worldDisplayName(w.name), parentId: w.parentId, updatedAt: w.updatedAt })))}`,
    `【设定目录】${JSON.stringify(settings.map(s => ({ id: s.id, name: s.name, worldId: s.worldId, type: s.type, version: s.version })))}`,
  ]
  parts.push(renderSceneDirectory(scenes))
  const factions = await sceneFactions(novelId)
  for (const id of sceneTargets) parts.push(renderSceneContext(scenes, id, factions))
  const attrNames = await loadCharacterAttributeNames(novelId)
  for (const chapter of chapterTargets) {
    parts.push(`【本章大纲 ${chapter.id} v${chapter.version}】\n${chapter.outline}`)
    const boundaries = await readChapterBoundaries({ userId: novel.userId, novelId, chapterId: chapter.id }, { chapterTask: true })
    parts.push(`【相邻章边界与来源】${JSON.stringify(boundaries)}`)
    // 章内明确出现的角色与设定按完整字段装载，其他目录保留可读入口。
    for (const c of characters) if (c.name.length >= 2 && chapter.outline.includes(c.name) && !charTargets.some(row => row.id === c.id)) charTargets.push(c)
    for (const setting of settings) if (setting.name.length >= 2 && chapter.outline.includes(setting.name) && !settingTargets.some(row => row.id === setting.id)) settingTargets.push(setting)
  }
  for (const character of charTargets) parts.push(renderCharacter(character, attrNames))
  for (const world of worldTargets) parts.push(`【世界 ${world.id}】${world.description}`)
  for (const setting of settings) if (settingTargets.some(row => row.id === setting.id) || worldTargets.some(world => world.id === setting.worldId)) parts.push(`【设定 ${setting.id} v${setting.version}】${setting.name}\n${JSON.stringify(setting.content)}`)
  return parts.join("\n\n")
}
