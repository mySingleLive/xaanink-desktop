import { renderSceneDetails, renderSceneDirectory, renderSceneContext, selectedSceneIds } from "@/lib/scene-context"
import { sceneFactions } from "@/lib/services/scene"
import { planningSchema } from "@/lib/planning/domain"
import { chapterMaterials } from "@/lib/story-materials"
import { arcStagesAtChapter } from "@/lib/arc-stage"
import type {
  Chapter,
  Character,
  CharacterRoleType,
  Scene,
  Setting,
  Theme,
  Trope,
  TropeKind,
  World,
} from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { normalizeAliases } from "@/lib/aliases"
import { debutIndex, normalizeArcStages, renderArcStages } from "@/lib/arc-stage"
import { renderBigFive } from "@/lib/big-five"
import { renderBeliefs } from "@/lib/beliefs"
import { renderMotivations } from "@/lib/motivation"
import { normalizePersonalityTags } from "@/lib/personality-tags"
import { NOVEL_SETTING_TYPES, SETTING_TYPE_LABELS, WORLD_SETTING_TYPES } from "@/lib/setting-types"
import {
  dialogueMarkLabel,
  innerDialogueMarkLabel,
  normalizeContent,
  type StyleContent,
} from "@/components/content/setting-content"

/** 伏笔 digest 懒加载：context.ts 被客户端共享（setting-content 链路），服务层模块仅服务端可达 */
async function loadForeshadowDigest(novelId: string): Promise<string> {
  const { buildForeshadowDigest } = await import("@/lib/services/foreshadow")
  return buildForeshadowDigest(novelId)
}

const ROLE_TYPE_LABELS: Record<CharacterRoleType, string> = {
  PROTAGONIST: "主角",
  SUPPORTING: "配角",
  ANTAGONIST: "反派",
}

const TROPE_KIND_LABELS: Record<TropeKind, string> = {
  SATISFACTION: "爽点",
  TEAR: "泪点",
}

/** 衔接优先保留前章结尾，不能把开头状态误当作下一章的起点。 */
const PREV_CHAPTER_ENDING_LENGTH = 1500

function renderPreviousChapterEnding(chapter: Pick<Chapter, "index" | "title" | "content"> | null): string {
  if (!chapter) return "（无，本章为开篇）"
  const content = chapter.content?.trim()
  if (!content) return `（前一章为第 ${chapter.index} 章《${chapter.title}》，尚无正文）`
  return `（接第 ${chapter.index} 章《${chapter.title}》；以下为结尾原文${content.length > PREV_CHAPTER_ENDING_LENGTH ? "，此前内容省略" : ""}。人物状态、物件持有人与位置以结尾为准。）\n${content.slice(-PREV_CHAPTER_ENDING_LENGTH)}`
}

function renderJson(value: unknown): string {
  if (value === null || value === undefined) return "（无）"
  if (typeof value === "string") return value || "（无）"
  return JSON.stringify(value, null, 2)
}

function renderTheme(theme: Theme): string {
  const tags = theme.tags.length > 0 ? theme.tags.join("、") : "（无）"
  return [
    `【主题】`,
    `- 书名：${theme.title}`,
    `- 简介：${theme.synopsis}`,
    `- 频道：${theme.channel}　题材：${theme.genre}　篇幅：${theme.length || "未指定"}`,
    `- 标签：${tags}`,
    ...(theme.authorPosition ? ["- 作者已确定上述定位，upsertTheme 会保留频道、题材、篇幅、标签；若建议调整，请作者在主题面板修改并保存。"] : []),
    `- 核心卖点：${theme.sellingPoints}`,
    `- 目标受众：${theme.targetAudience}`,
    `- 参考案例：${theme.referenceCases}`,
  ].join("\n")
}

/** 小说级设定（金手指/文风，worldId 为空）按分类渲染 */
function renderNovelSettings(settings: Setting[]): string[] {
  const sections: string[] = []
  for (const type of NOVEL_SETTING_TYPES) {
    const group = settings.filter((s) => s.type === type && s.worldId === null)
    if (group.length === 0) continue
    const blocks = group.map(
      (s) => `### ${s.name}\n${type === "STYLE" ? renderStyleContent(s.content) : renderJson(s.content)}`
    )
    sections.push(`【${SETTING_TYPE_LABELS[type]}】\n${blocks.join("\n\n")}`)
  }
  return sections
}

/** 文风设定渲染：符号选项展开为具体包裹形式，写手/评审据此执行 */
function renderStyleContent(raw: unknown): string {
  const c = normalizeContent("STYLE", raw) as StyleContent
  return [
    `- 行文风格：${c.style || "（无）"}`,
    `- 参考案例：${c.referenceCases || "（无）"}`,
    `- 对话符号：${dialogueMarkLabel(c.dialogueMark)}（正文中的角色对话一律用该符号包裹）`,
    `- 心理对话符号：${innerDialogueMarkLabel(c.innerDialogueMark)}（角色的内心独白/心理活动按此符号包裹；为「无符号」时直接行文、不加包裹）`,
  ].join("\n")
}

/** 世界树 + 各世界下的设定：世界按层级路径展示，子地图标注上级地图 */
function renderWorlds(worlds: World[], settings: Setting[]): string[] {
  const childrenOf = (parentId: string | null) => worlds.filter((w) => w.parentId === parentId)
  const sections: string[] = []

  const visit = (world: World, parentPath: string) => {
    const path = parentPath ? `${parentPath} / ${world.name}` : world.name
    const own = settings.filter((s) => s.worldId === world.id)
    const parts: string[] = [`【世界观 · ${path}】`]
    if (world.description) {
      parts.push(`世界介绍：${world.description}`)
    }
    for (const type of WORLD_SETTING_TYPES) {
      if (type === "MAP") continue
      const group = own.filter((s) => s.type === type)
      for (const s of group) {
        parts.push(`### ${SETTING_TYPE_LABELS[type]} · ${s.name}\n${renderJson(s.content)}`)
      }
    }
    const maps = own.filter((s) => s.type === "MAP")
    const mapNameOf = (id: string | null) => maps.find((m) => m.id === id)?.name ?? "未知"
    for (const m of maps) {
      const suffix = m.parentId ? `（上级地图：${mapNameOf(m.parentId)}）` : ""
      parts.push(`### ${SETTING_TYPE_LABELS.MAP} · ${m.name}${suffix}\n${renderJson(m.content)}`)
    }
    sections.push(parts.join("\n\n"))
    for (const child of childrenOf(world.id)) {
      visit(child, path)
    }
  }

  for (const root of childrenOf(null)) {
    visit(root, "")
  }
  return sections
}

/** 自定义属性 definitionId → 名称的映射（由调用方按小说一次查询传入；无映射时属性不渲染） */
export type AttributeNameMap = Map<string, string>

/** 人物关系 Json → 可读一行：「目标：描述；目标2：描述2」（无描述只列目标；空 → 空串） */
function renderRelationships(raw: unknown): string {
  if (!Array.isArray(raw)) return ""
  const parts: string[] = []
  for (const x of raw) {
    if (!x || typeof x !== "object") continue
    const { target, description } = x as Record<string, unknown>
    if (typeof target !== "string" || !target.trim()) continue
    const desc =
      typeof description === "string" && description.trim() ? `：${description.trim()}` : ""
    parts.push(`${target.trim()}${desc}`)
  }
  return parts.join("；")
}

/** 自定义属性值 Json → 「名称 值 · 名称2 值2」（定义已删除或值为空的跳过；无映射 → 空串） */
function renderEntityAttributes(raw: unknown, attrNames?: AttributeNameMap): string {
  if (!Array.isArray(raw) || !attrNames) return ""
  const parts: string[] = []
  for (const x of raw) {
    if (!x || typeof x !== "object") continue
    const { definitionId, value } = x as Record<string, unknown>
    if (typeof definitionId !== "string" || typeof value !== "string" || !value.trim()) continue
    const name = attrNames.get(definitionId)
    if (!name) continue
    parts.push(`${name} ${value.trim()}`)
  }
  return parts.join(" · ")
}

/** 示例对话进上下文的最大长度（台词一致性锚点，过长截断） */
const SAMPLE_DIALOGUE_RENDER_MAX = 300

/**
 * 角色渲染的唯一权威实现（chat.system 每轮上下文 / chapter.generate / 评审 / cascade 共用）。
 * 按六大板块组织：身份 → 外在 → 心理 → 能力 → 弧线 → 关系；空字段跳过不渲染。
 * 也供情景试验场 actor agent 作角色档案（scenario-ai.ts）。
 */
export function renderCharacter(c: Character, attrNames?: AttributeNameMap): string {
  const identity = [c.gender, c.occupation || "未知职业", c.age || "年龄未知"]
    .filter(Boolean)
    .join("，")
  const aliases = normalizeAliases(c.aliases)
  const personalityTags = normalizePersonalityTags(c.personalityTags)
  const lines: string[] = [`### ${c.name}（${identity}）`]
  const push = (label: string, value: string) => {
    if (value.trim()) lines.push(`- ${label}：${value.trim()}`)
  }
  // 身份
  if (aliases.length > 0) lines.push(`- 别名：${aliases.join("、")}`)
  push("简介", c.bio)
  push("人物描述", c.personality)
  // 外在
  push("外貌", c.appearance)
  const physique = [
    c.height.trim() && `身高 ${c.height.trim()}`,
    c.weight.trim() && `体重 ${c.weight.trim()}`,
    c.build.trim(),
    c.faceShape.trim() && `脸型${c.faceShape.trim()}`,
  ].filter((x): x is string => typeof x === "string" && x.length > 0)
  if (physique.length > 0) lines.push(`- 身形：${physique.join(" · ")}`)
  push("穿衣风格", c.clothing)
  push("品味偏好", c.tastes)
  push("行为习惯", c.habits)
  push("口头禅", c.catchphrase)
  push("对话风格", c.dialogueStyle)
  push("示例对话", c.sampleDialogue.slice(0, SAMPLE_DIALOGUE_RENDER_MAX))
  // 心理
  if (personalityTags.length > 0) lines.push(`- 性格：${personalityTags.join("、")}`)
  const bigFive = renderBigFive(c.bigFive)
  if (bigFive) lines.push(`- 性格五维：${bigFive}`)
  const motivations = renderMotivations(c.motivations)
  if (motivations) lines.push(`- 核心动机：${motivations}`)
  push("核心欲望", c.desires)
  push("核心恐惧", c.fears)
  const beliefs = renderBeliefs(c.beliefs)
  if (beliefs) lines.push(`- 观念：${beliefs}`)
  // 能力
  push("能力", c.abilities)
  const attributes = renderEntityAttributes(c.attributes, attrNames)
  if (attributes) lines.push(`- 属性：${attributes}`)
  // 弧线：有阶段卡片链时以卡片为准（出场前经历由出场卡之前的卡片合成；
  // 无出场卡且旧 backstory 非空时回退旧字段），空链完全回退旧两字段
  const stages = normalizeArcStages(c.arcStages)
  if (stages.length > 0) {
    const rendered = renderArcStages(stages, { attrNames })
    if (rendered.backstory) lines.push(`- 出场前经历：\n${rendered.backstory}`)
    else if (debutIndex(stages) < 0) push("出场前经历", c.backstory)
    lines.push(`- 成长弧线（按时间先后）：\n${rendered.arc}`)
  } else {
    push("出场前经历", c.backstory)
    push("成长弧线", c.growthArc)
  }
  // 关系
  const relationships = renderRelationships(c.relationships)
  if (relationships) lines.push(`- 人物关系：${relationships}`)
  return lines.join("\n")
}

function renderCharacters(characters: Character[], attrNames?: AttributeNameMap): string[] {
  const sections: string[] = []
  for (const roleType of Object.keys(ROLE_TYPE_LABELS) as CharacterRoleType[]) {
    const group = characters.filter((c) => c.roleType === roleType)
    if (group.length === 0) continue
    sections.push(
      `【角色·${ROLE_TYPE_LABELS[roleType]}】\n${group.map((c) => renderCharacter(c, attrNames)).join("\n\n")}`
    )
  }
  return sections
}

/**
 * 场景渲染（情景试验场 scenario-ai.ts 专用——场景此前不进任何文本 AI 上下文）。
 * 只渲染名称/描述/坐标三列；attributes 自定义属性暂无文本消费方，不渲染。
 */
export function renderScene(s: Scene): string { return renderSceneDetails(s) }

/** 查小说的角色自定义属性定义，建 definitionId → 名称映射（供 renderCharacter 渲染属性行） */
export async function loadCharacterAttributeNames(novelId: string): Promise<AttributeNameMap> {  const defs = await prisma.attributeDefinition.findMany({
    where: { novelId, targets: { has: "CHARACTER" } },
    select: { id: true, name: true },
  })
  return new Map(defs.map((d) => [d.id, d.name]))
}

function renderTropes(tropes: Trope[]): string | null {
  if (tropes.length === 0) return null
  const lines = tropes.map(
    (t) =>
      `- 【${TROPE_KIND_LABELS[t.kind]}·${t.category}】${t.content}（参考：${t.referenceCase}）`
  )
  return `【爽点与泪点】\n${lines.join("\n")}`
}

/**
 * 组装小说的创作上下文（中文 Markdown，标题分节）：
 * 【主题】→ 世界树与各世界设定 → 小说级设定（金手指/文风）→【角色】→【爽点与泪点】。
 * 供大纲生成、正文生成、AI 评审等场景复用。
 */
export async function buildNovelContext(novelId: string, task = ""): Promise<string> {
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: {
      theme: true,
      scenes: {orderBy: {createdAt: "asc"}},
      worlds: { orderBy: { createdAt: "asc" } },
      settings: { orderBy: [{ type: "asc" }, { name: "asc" }] },
      characters: { orderBy: [{ roleType: "asc" }, { name: "asc" }] },
      tropes: { where: { selected: true }, orderBy: [{ kind: "asc" }, { category: "asc" }] },
    },
  })
  if (!novel) {
    throw new Error("小说不存在")
  }

  const attrNames = await loadCharacterAttributeNames(novelId)
  const sections: string[] = [`# 《${novel.title}》创作上下文`]
  if (novel.theme) {
    sections.push(renderTheme(novel.theme))
  }
  sections.push(...renderWorlds(novel.worlds, novel.settings))
  sections.push(...renderNovelSettings(novel.settings))
  sections.push(renderSceneDirectory(novel.scenes))
  const factions = await sceneFactions(novelId)
  sections.push(...selectedSceneIds(novel.scenes, task, novelId).map(id => renderSceneContext(novel.scenes, id, factions)))
  sections.push(...renderCharacters(novel.characters, attrNames))
  const tropesSection = renderTropes(novel.tropes)
  if (tropesSection) {
    sections.push(tropesSection)
  }
  return sections.join("\n\n")
}

/** 按提示词模板变量拆分的分节上下文（outline.generate / review.* 等模板使用） */
export interface NovelPromptSections {
  theme: string
  settings: string
  characters: string
  tropes: string
  /** 文风设定（Setting type=STYLE）的内容 */
  style: string
  /** 伏笔一览（Foreshadow digest；无伏笔时为占位文案） */
  foreshadows: string
}

/**
 * 组装按变量拆分的分节上下文：theme / settings / characters / tropes / style。
 * 与 buildNovelContext 同源，但保留各节边界，供 outline.generate、review.outline、
 * review.chapter 等按变量渲染的提示词模板使用。
 */
export async function buildNovelSections(novelId: string, chapterId?: string, focus?: { worldIds: string[]; settingIds: string[] }, task = ""): Promise<NovelPromptSections> {
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: {
      theme: true,
      scenes: {orderBy: {createdAt: "asc"}},
      worlds: { orderBy: { createdAt: "asc" } },
      settings: { orderBy: [{ type: "asc" }, { name: "asc" }] },
      characters: { orderBy: [{ roleType: "asc" }, { name: "asc" }] },
      tropes: { where: { selected: true }, orderBy: [{ kind: "asc" }, { category: "asc" }] },
    },
  })
  if (!novel) {
    throw new Error("小说不存在")
  }

  const styleSetting = novel.settings.find((s) => s.type === "STYLE")
  let characters = novel.characters
  if (chapterId) {
    const volumes = await prisma.volume.findMany({ where: { novelId }, orderBy: { index: "asc" }, include: { chapters: { orderBy: { index: "asc" }, select: { id: true } } } })
    const ids = volumes.flatMap(v => v.chapters.map(c => c.id))
    characters = characters.map(character => {
      const all = normalizeArcStages(character.arcStages)
      if (!all.length) return character
      const active = arcStagesAtChapter(all, ids, chapterId)
      const changes = Object.fromEntries(active.flatMap(stage => stage.changes.map(change => [change.field, change.value])))
      const bio = typeof changes.bio === "string" ? changes.bio : character.bio
      return { ...character, ...changes, arcStages: JSON.parse(JSON.stringify(active)), growthArc: "", bio: bio + "\n弧线仅含本章已生效阶段；未定位的后续变化不能当作当前状态。" }
    })
  }
  const attrNames = await loadCharacterAttributeNames(novelId)
  const foreshadows = focus ? "（伏笔由本章披露简报提供）" : await loadForeshadowDigest(novelId)
  const focusedSettings = focus ? novel.settings.filter(s => s.type === "STYLE" || focus.settingIds.includes(s.id)) : novel.settings
  const settingSections = [
    ...renderWorlds(focus ? novel.worlds.filter(w => focus.worldIds.includes(w.id)) : novel.worlds, focusedSettings),
    ...renderNovelSettings(focusedSettings),
  ]
  settingSections.push(renderSceneDirectory(novel.scenes))
  const sceneIds = selectedSceneIds(novel.scenes, task, novelId)
  if (chapterId) {
    const document = await prisma.planningDocument.findUnique({where: {novelId}})
    const ids = document ? chapterMaterials(planningSchema.parse(document.data), chapterId).refs.filter(ref => ref.kind === "scene").map(ref => ref.id) : []
    const chapter = await prisma.chapter.findFirst({where: {id: chapterId, volume: {novelId}}, select: {outline: true}})
    ids.push(...selectedSceneIds(novel.scenes, chapter?.outline ?? "", novelId))
    sceneIds.push(...ids)
  }
  if (sceneIds.length) {
    const factions = await sceneFactions(novelId)
    settingSections.push(...[...new Set(sceneIds)].map(id => renderSceneContext(novel.scenes, id, factions)))
  }
  return {
    theme: novel.theme ? renderTheme(novel.theme) : "（暂无主题）",
    settings: settingSections.join("\n\n") || "（暂无设定）",
    characters: renderCharacters(characters, attrNames).join("\n\n") || "（暂无角色）",
    tropes: renderTropes(novel.tropes) ?? "（未选择爽点/泪点）",
    style: styleSetting ? renderJson(styleSetting.content) : "（暂无文风设定）",
    foreshadows,
  }
}

/**
 * 章节级上下文（chapter.generate 模板使用）：
 * chapterOutline = 所属卷大纲 + 本章大纲；previousSummary = 前一章结尾原文。
 * 叙事线章节投影（逐卡标题/视角/意图/披露）由 chapter.ts 经 chapterProjection 注入。
 */
export async function buildChapterSections(
  novelId: string,
  chapterId: string
): Promise<{ chapterOutline: string; previousSummary: string }> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { volume: true },
  })
  if (!chapter || chapter.volume.novelId !== novelId) {
    throw new Error("章节不存在")
  }

  const prevChapter = await findPrevChapter(
    novelId,
    chapter.volumeId,
    chapter.volume.index,
    chapter.index
  )

  return {
    chapterOutline: [
      `第 ${chapter.volume.index} 卷《${chapter.volume.title}》`,
      `卷简介：${chapter.volume.summary}`,
      ``,
      `第 ${chapter.index} 章《${chapter.title}》`,
      chapter.outline,
    ].join("\n"),
    previousSummary: renderPreviousChapterEnding(prevChapter),
  }
}

/**
 * 在小说上下文基础上，追加本章写作所需的章节级上下文：
 * 【本章所属卷大纲】→【本章大纲】→【前一章结尾原文】。
 */
export async function buildChapterContext(
  novelId: string,
  chapterId: string
): Promise<string> {
  const [novelContext, chapter] = await Promise.all([
    buildNovelContext(novelId),
    prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { volume: true },
    }),
  ])
  if (!chapter || chapter.volume.novelId !== novelId) {
    throw new Error("章节不存在")
  }

  const prevChapter = await findPrevChapter(
    chapter.volume.novelId,
    chapter.volumeId,
    chapter.volume.index,
    chapter.index
  )

  const sections = [
    novelContext,
    `【本章所属卷大纲】\n第 ${chapter.volume.index} 卷《${chapter.volume.title}》\n${chapter.volume.summary}`,
    `【本章大纲】\n第 ${chapter.index} 章《${chapter.title}》\n${chapter.outline}`,
    `【前一章结尾原文】\n${renderPreviousChapterEnding(prevChapter)}`,
  ]
  return sections.join("\n\n")
}

/** 前一章：同卷 index-1 优先；否则上一卷的最后一章 */
async function findPrevChapter(
  novelId: string,
  volumeId: string,
  volumeIndex: number,
  chapterIndex: number
) {
  const sameVolume = await prisma.chapter.findFirst({
    where: { volumeId, index: { lt: chapterIndex } },
    orderBy: { index: "desc" },
  })
  if (sameVolume) return sameVolume

  const prevVolume = await prisma.volume.findFirst({
    where: { novelId, index: { lt: volumeIndex } },
    orderBy: { index: "desc" },
  })
  if (!prevVolume) return null

  return prisma.chapter.findFirst({
    where: { volumeId: prevVolume.id },
    orderBy: { index: "desc" },
  })
}
