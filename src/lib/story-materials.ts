import type { SettingType } from "@/generated/prisma/enums"
import { normalizeContent, type StyleContent } from "@/components/content/setting-content"
import { cardChapter, findEvent, readingCards, worldEvents, type PlanningData } from "./planning/domain"
import { normalizeAliases } from "./aliases"

import { type MaterialRef } from "./material-reference"
export { materialRefSchema, MATERIAL_LABELS, MATERIAL_ROLE_LABELS, type MaterialRef } from "./material-reference"
export type StoryMaterial = { kind: MaterialRef["kind"]; id: string; title: string; content: unknown; aliases?: string[]; type?: SettingType; worldId?: string | null; status?: string }
const nonempty = (value: unknown): boolean => typeof value === "string" ? !!value.trim() : Array.isArray(value) ? value.some(nonempty) : !!value && typeof value === "object" ? Object.values(value).some(nonempty) : false
const recordOf = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const rowsOf = (value: unknown) => Array.isArray(value) ? value.map(recordOf) : []
function levelsHaveContent(value: unknown): boolean {
  return rowsOf(value).some(level => nonempty([level.description, level.condition, rowsOf(level.abilities).map(a => a.description)]) || levelsHaveContent(level.children))
}

/** 只看业务正文，不把名称、ID、默认符号/作用域或 JSON 包装当内容。 */
export function materialHasContent(material: StoryMaterial): boolean {
  if (material.kind === "item") {
    const item = recordOf(material.content)
    return nonempty([item.description, item.appearance, item.acquisition, rowsOf(item.effects).map(e => e.description)])
  }
  if (material.kind !== "setting") return typeof material.content === "string" && !!material.content.trim()
  if (!material.type) return false
  const content = normalizeContent(material.type, material.content)
  if (material.type === "STYLE") {
    const style = content as StyleContent
    return nonempty([style.style, style.referenceCases])
  }
  const record = content as unknown as Record<string, unknown>
  if (material.type === "LEVEL_SYSTEM") return nonempty([record.description, record.rules]) || levelsHaveContent(record.levels) || rowsOf(record.pathways).some(p => nonempty(p.description) || levelsHaveContent(p.levels))
  if (material.type === "CONCEPT") return nonempty(rowsOf(record.concepts).map(c => c.explanation))
  if (material.type === "FACTION") return nonempty(rowsOf(record.factions).map(f => [f.description, f.relations]))
  if (material.type === "GOLD_FINGER") return nonempty([record.trigger, record.ability, record.limitation])
  return nonempty(record.text)
}

export function planningMaterialRefs(data: PlanningData): MaterialRef[] {
  return [...data.worlds.flatMap(w => worldEvents(data, w.id).flatMap(e => e.materialRefs)), ...data.cards.flatMap(c => c.tellings.flatMap(t => t.materialRefs))]
}
export function chapterMaterials(data: PlanningData, chapterId: string) {
  const chapter = data.chapters.find(ch => ch.id === chapterId)
  const cards = chapter ? readingCards(data, chapter.line).filter(c => cardChapter(data, c) === chapterId) : []
  const events = [...new Map(cards.flatMap(c => c.tellings.flatMap(t => t.refs.map(r => findEvent(data, r.line, r.event)).filter(e => !!e))).map(e => [`${e.line}/${e.id}`, e])).values()]
  const tellingRefs = cards.flatMap(c => c.tellings.flatMap(t => t.materialRefs))
  return { cards, events, tellingRefs, refs: [...tellingRefs, ...events.flatMap(e => e.materialRefs)] }
}

type ReferencedMaterialKind = "item" | "scene"
export type MissingMaterialReference = {
  kind: ReferencedMaterialKind; id: string; title: string; matchedName: string
  source: "telling" | "card-title" | "content"; cardId?: string; cardTitle?: string; tellingId?: string
}
const matchingText = (text: string) => text.normalize("NFKC").toLowerCase()

/** 只匹配已存名称/别名；长名称优先，同名多档案交给核对，不强制把全部同名档案关联。 */
function mentionedMaterials(text: string, materials: StoryMaterial[]) {
  const normalized = matchingText(text)
  const occurrences = materials.flatMap(material => [...new Set([material.title.trim(), ...normalizeAliases(material.aliases)])].flatMap(name => {
    const token = matchingText(name)
    if ([...token].length < 2) return []
    const found: { material: StoryMaterial; name: string; start: number; end: number }[] = []
    let start = normalized.indexOf(token)
    while (start !== -1) {
      const end = start + token.length
      // 英文名称不能命中另一个词的一部分；中文名称不要求空格边界。
      if (!(/[a-z0-9]/.test(token[0]) && /[a-z0-9_]/.test(normalized[start - 1] ?? "")) &&
          !(/[a-z0-9]/.test(token[token.length - 1]) && /[a-z0-9_]/.test(normalized[end] ?? ""))) found.push({ material, name, start, end })
      start = normalized.indexOf(token, start + 1)
    }
    return found
  }))
  const longest = occurrences.filter(hit => !occurrences.some(other => other.start <= hit.start && other.end >= hit.end && other.end - other.start > hit.end - hit.start))
  const ambiguous = longest.filter(hit => longest.some(other => other.start === hit.start && other.end === hit.end && `${other.material.kind}:${other.material.id}` !== `${hit.material.kind}:${hit.material.id}`))
  return {
    matches: longest.filter(hit => !ambiguous.includes(hit)),
    ambiguousNames: [...new Set(ambiguous.map(hit => hit.name))],
  }
}

/** 确定性漏关联检查，不等同语义完备评审；只看本章实际讲述与当前正文，绝不扫描隐藏事实。 */
export function assessChapterMaterialReferences(data: PlanningData, chapterId: string, materials: StoryMaterial[], content = "") {
  const focus = chapterMaterials(data, chapterId)
  const candidates = materials.filter(m => (m.kind === "item" || m.kind === "scene") && m.status !== "DROPPED")
  const catalog = candidates.filter(materialHasContent)
  const missing: MissingMaterialReference[] = []
  const invalid: MissingMaterialReference[] = []
  const ambiguousNames = new Set<string>()
  const inspect = (texts: string[], refs: MaterialRef[], location: Omit<MissingMaterialReference, "kind" | "id" | "title" | "matchedName">) => {
    for (const text of texts) {
      const mentioned = mentionedMaterials(text, candidates)
      for (const name of mentioned.ambiguousNames) ambiguousNames.add(name)
      for (const { material, name } of mentioned.matches) {
        if (refs.some(ref => ref.kind === material.kind && ref.id === material.id)) continue
        const gaps = materialHasContent(material) ? missing : invalid
        if (gaps.some(gap => gap.kind === material.kind && gap.id === material.id && gap.source === location.source && gap.cardId === location.cardId && gap.tellingId === location.tellingId)) continue
        gaps.push({ kind: material.kind as ReferencedMaterialKind, id: material.id, title: material.title, matchedName: name, ...location })
      }
    }
  }
  for (const card of focus.cards) {
    const cardRefs: MaterialRef[] = []
    for (const telling of card.tellings) {
      // 普通资料可由本讲述或它真正引用的事件提供，其他视角/卡片的关联不能掩盖缺项。
      const refs = [...telling.materialRefs, ...telling.refs.flatMap(ref => findEvent(data, ref.line, ref.event)?.materialRefs ?? [])]
      cardRefs.push(...refs)
      inspect([telling.intent, ...telling.beats.map(beat => beat.summary), ...telling.refs.map(ref => ref.reveal)], refs,
        { source: "telling", cardId: card.id, cardTitle: card.title, tellingId: telling.id })
    }
    inspect([card.title], cardRefs, { source: "card-title", cardId: card.id, cardTitle: card.title })
  }
  if (content.trim()) inspect([content], focus.refs, { source: "content" })
  const count = (kind: ReferencedMaterialKind) => new Set(focus.refs.filter(ref => ref.kind === kind).map(ref => ref.id)).size
  const references = { items: count("item"), scenes: count("scene") }
  const unreferencedKinds = (["item", "scene"] as const).filter(kind => !count(kind) && catalog.some(m => m.kind === kind && materialHasContent(m)))
  return { missing, invalid, references, unreferencedKinds, ambiguousNames: [...ambiguousNames] }
}

/** 一个讲述的每条首埋都必须在它引用的世界事件中存在同一伏笔。 */
export function unlinkedPlants(data: PlanningData, chapterId?: string) {
  const cards = chapterId ? chapterMaterials(data, chapterId).cards : data.cards
  const missing = cards.flatMap(card => card.tellings.flatMap(telling => telling.materialRefs.filter(ref => ref.role === "plant" && !telling.refs.some(r => findEvent(data, r.line, r.event)?.materialRefs.some(source => source.kind === "foreshadow" && source.id === ref.id && source.role === "plant"))).map(ref => ({ cardId: card.id, cardTitle: card.title, ref }))))
  // 世界线可先于叙事线独立搭建；进入目标章时才检查客观首埋也已落实为实际讲述。
  if (chapterId) for (const event of chapterMaterials(data, chapterId).events) {
    const tellings = cards.flatMap(card => card.tellings.map(telling => ({ card, telling }))).filter(({ telling }) => telling.refs.some(r => r.line === event.line && r.event === event.id))
    for (const ref of event.materialRefs.filter(r => r.kind === "foreshadow" && r.role === "plant")) {
      const alreadyPlanted = tellings.some(({ card }) => {
        const reading = readingCards(data, card.line)
        return reading.slice(0, reading.findIndex(c => c.id === card.id)).some(prior => prior.tellings.some(t => t.materialRefs.some(r => r.kind === "foreshadow" && r.id === ref.id && r.role === "plant") && t.refs.some(r => r.line === event.line && r.event === event.id)))
      })
      if (!alreadyPlanted && !tellings.some(({ telling }) => telling.materialRefs.some(r => r.kind === "foreshadow" && r.id === ref.id && r.role === "plant"))) {
        const card = tellings[0].card
        missing.push({ cardId: card.id, cardTitle: card.title, ref })
      }
    }
  }
  return missing
}

/** 撤回/丢弃不抹去已完整抽卡的历史；中断、未知结束和坏 checks 不算成功。 */
export function isCompleteDraw(candidate: { drawId: string | null; content: string; status: string; checks: unknown }) {
  return !!candidate.drawId?.trim() && !!candidate.content.trim() && ["ready", "needs_review", "accepted", "discarded", "withdrawn"].includes(candidate.status) && Array.isArray(candidate.checks) && candidate.checks.every(check => check && typeof check === "object" && typeof check.code === "string" && typeof check.hard === "boolean" && !check.hard && !["EMPTY", "INCOMPLETE", "UNKNOWN_FINISH"].includes(check.code))
}
