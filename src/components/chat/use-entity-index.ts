"use client"
import { sceneFactionLabel, type SceneFaction } from "@/lib/scene-context"
import { useSceneFactions } from "@/components/content/scene/use-scenes"

/**
 * 小说实体索引：聚合角色/世界/设定/属性/物品/场景列表，
 * 构建对话消息「实体芯片」的匹配表（具体名称 + 类目词）与按条件解析器。
 * 查询 key 与各面板共用，写工具成功后由 invalidateNovelQueries 自动刷新。
 */
import { sceneForest } from "@/lib/scene-tree"
import { useMemo } from "react"
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query"

import type { SettingType } from "@/generated/prisma/enums"
import { SETTING_TYPE_LABELS } from "@/lib/setting-types"
import { specificEntityName, validEntityName } from "@/lib/entity-name"
import { normalizeTags } from "@/lib/item-tags"
import { apiGet } from "@/components/content/api"
import { itemLevelLabel, normalizeItemLevels } from "@/components/content/item-levels"
import { CHARACTER_ROLE_LABELS } from "@/components/content/labels"
import { extractSettingConcepts } from "@/components/content/setting-content"
import type { SettingItem } from "@/components/content/SettingPanel"
import { normalizeAliases } from "@/components/content/types"
import type {
  AttributeDefinitionRecord,
  CharacterRecord,
  ItemRecord,
  NovelDetail,
  SceneRecord,
  WorldRecord,
} from "@/components/content/types"

import type { EntityRef } from "./entity-refs"

export interface EntityIndex {
  /** 小说标题（封面卡等需要书名的展示用） */
  novelTitle: string | null
  /** 行内芯片匹配正则（无可匹配项时为 null） */
  regex: RegExp | null
  /** 命中文本 → 实体引用 */
  resolve: (text: string) => EntityRef | undefined
  sceneIdentity: (novelId: string, sceneId: string) => EntityRef | undefined
  resolveTyped: (group: string, name: string) => EntityRef | undefined
  /** 改动卡片用的按条件解析器 */
  characterById: (id: string) => EntityRef | undefined
  characterByName: (name: string) => EntityRef | undefined
  worldByName: (name: string) => EntityRef | undefined
  worldById: (id: string) => EntityRef | undefined
  settingByKey: (type: SettingType, name: string, worldName?: string, worldId?: string) => EntityRef | undefined
  itemById: (id: string) => EntityRef | undefined
  itemByName: (name: string) => EntityRef | undefined
  sceneById: (id: string) => EntityRef | undefined
  sceneByName: (name: string) => EntityRef | undefined
  chapterById: (id: string) => EntityRef | undefined
  /** 章节的展示名「第 N 章 · 标题」（评审卡/稿件卡等卡片头部用） */
  chapterLabelById: (id: string) => string | undefined
  /** hover 卡数据（§4.5 实体芯片 popover）：角色/物品/场景的名、身份、简介、头像；物品另带别名/等级/标签 */
  hoverInfo: (kind: "character" | "item" | "scene", id: string) => EntityHoverInfo | undefined
}

/** hover 卡数据：名 + 身份一行 + 简介首句 + 头像（无图为 null，卡片回退类型图标）；别名/等级/标签仅物品返回 */
export interface EntityHoverInfo {
  name: string
  role: string
  blurb: string | null
  avatarUrl: string | null
  /** 物品别名（角色/场景不返回） */
  aliases?: string[]
  /** 物品等级展示标签（itemLevelLabel 序列；角色/场景不返回） */
  levels?: string[]
  /** 物品标签（角色/场景不返回） */
  tags?: string[]
}

const EMPTY_INDEX: EntityIndex = {
  novelTitle: null,
  regex: null,
  resolve: () => undefined,
  resolveTyped: () => undefined,
  sceneIdentity: () => undefined,
  characterById: () => undefined,
  characterByName: () => undefined,
  worldByName: () => undefined,
  worldById: () => undefined,
  settingByKey: () => undefined,
  itemById: () => undefined,
  itemByName: () => undefined,
  sceneById: () => undefined,
  sceneByName: () => undefined,
  chapterById: () => undefined,
  chapterLabelById: () => undefined,
  hoverInfo: () => undefined,
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 简介首句：剥 markdown 强调/标题记号后取首个句读前的内容，上限 80 字（hover 卡只给「一句话身份」） */
export function firstSentence(text: string | null | undefined): string | null {
  const t = (text ?? "")
    .trim()
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
  if (!t) return null
  const m = t.match(/^[^\n。！？!?…]{1,80}/)
  return m ? m[0].trim() || null : null
}

interface IndexData {
  novelTitle: string
  characters: { id: string; name: string }[]
  /** 角色完整记录（hover 卡的头像/身份/简介；与 CharactersPanel 共享 query 缓存） */
  charactersFull: CharacterRecord[]
  worlds: WorldRecord[]
  settings: { id: string; type: SettingType; name: string; worldId: string | null }[]
  /** 世界级设定完整记录（含 content），用于提取二级/子孙概念名 */
  worldSettings: SettingItem[]
  volumes: NovelDetail["volumes"]
  attributes: AttributeDefinitionRecord[]
  items: ItemRecord[]
  factions: SceneFaction[]
  scenes: SceneRecord[]
}


function buildEntityIndex(data: IndexData): EntityIndex {
  const { novelTitle, characters, charactersFull, worlds, settings, worldSettings, volumes, attributes, items, scenes, factions } = data

  const characterRefs: Extract<EntityRef, { kind: "character" }>[] = characters.map((c) => ({
    kind: "character",
    id: c.id,
    name: c.name,
  }))
  const worldRefs: Extract<EntityRef, { kind: "world" }>[] = worlds.filter(w => validEntityName(w.name)).map((w) => ({
    kind: "world",
    id: w.id,
    name: w.name,
  }))
  const settingRefs: Extract<EntityRef, { kind: "setting" }>[] = settings.map((s) => ({
    kind: "setting",
    id: s.id,
    name: s.name,
    settingType: s.type,
    worldId: s.worldId,
    worldName: worlds.find((w) => w.id === s.worldId)?.name,
  }))
  const itemRefs: Extract<EntityRef, { kind: "item" }>[] = items.map((i) => ({
    kind: "item",
    id: i.id,
    name: i.name,
  }))
  const sceneRefs: Extract<EntityRef, { kind: "scene" }>[] = scenes.map((s) => ({
    kind: "scene",
    id: s.id,
    name: s.name,
  }))
  const chapterRefs: Extract<EntityRef, { kind: "chapter" }>[] = volumes.flatMap((v) =>
    v.chapters.map((c) => ({ kind: "chapter" as const, id: c.id, name: c.title }))
  )

  // 匹配表：插入顺序即优先级（具体名称在前，类目词在后）；同名先到先得
  const matchers = new Map<string, EntityRef>()
  const ambiguousNames = new Set<string>()
  const add = (text: string, ref: EntityRef) => {
    if (!specificEntityName(text)) return
    const t = text.trim()
    if (ambiguousNames.has(t)) return
    const old = matchers.get(t)
    if (old && JSON.stringify(old) !== JSON.stringify(ref)) { matchers.delete(t); ambiguousNames.add(t); return }
    matchers.set(t, ref)
  }

  // 角色本名 + 别名/外号都建匹配项（≥2 字规则由 add 统一兜底），指向同一个 character 引用
  for (const ref of characterRefs) {
    add(ref.name, ref)
    const full = charactersFull.find((c) => c.id === ref.id)
    for (const alias of normalizeAliases(full?.aliases)) add(alias, ref)
  }
  for (const ref of worldRefs) add(ref.name, ref)
  for (const ref of settingRefs) add(ref.name, ref)
  for (const d of attributes) add(d.name, { kind: "attributes" })
  // 物品本名 + 别名都建匹配项（与角色同口径：重名由 add 的歧义剔除兜底），指向同一个 item 引用
  for (const ref of itemRefs) {
    add(ref.name, ref)
    const full = items.find((i) => i.id === ref.id)
    for (const alias of normalizeAliases(full?.aliases)) add(alias, ref)
  }
  for (const ref of sceneRefs) add(ref.name, ref)
  // 卷标题 → 大纲面板；章节标题 → 章节正文面板
  for (const v of volumes) add(v.title, { kind: "outline" })
  for (const v of volumes) {
    for (const c of v.chapters) add(c.title, { kind: "chapter", id: c.id, name: c.title })
  }

  // 设定的二级/子孙概念名（等级/术语/势力/纯文本表格要素）→ 所属设定，面板内滚动定位并高亮
  for (const s of worldSettings) {
    const base: Extract<EntityRef, { kind: "setting" }> = {
      kind: "setting",
      id: s.id,
      name: s.name,
      settingType: s.type,
      worldId: s.worldId,
      worldName: worlds.find((w) => w.id === s.worldId)?.name,
    }
    for (const concept of extractSettingConcepts(s.type, s.content)) {
      add(concept, { ...base, concept })
    }
  }


  const texts = [...matchers.keys()].sort((a, b) => b.length - a.length)
  const regex = texts.length > 0 ? new RegExp(texts.map(text => /^[\w-]+$/.test(text) ? `(?<![\\w])${escapeRegExp(text)}(?![\\w])` : escapeRegExp(text)).join("|"), "g") : null

  const unique = <T,>(items: T[]) => items.length === 1 ? items[0] : undefined
  const findByName = (refs: EntityRef[], name: string) => unique([...new Map(refs.filter(r => "name" in r && r.name === name && validEntityName(name)).map(r => [JSON.stringify(r), r])).values()])

  return {
    novelTitle,
    regex,
    resolve: (text) => matchers.get(text),
    sceneIdentity: (novelId, sceneId) => {const row = scenes.find(s => s.id === sceneId && s.novelId === novelId); return row ? {kind: "scene", id: row.id, name: row.name} : undefined},
    resolveTyped: (group, name) => {
      const chapterLabel = name.match(/^第\s*(\d+)\s*章\s*·\s*(.+)$/)
      if (group === "正文" || group === "大纲") {
        const found = unique(volumes.flatMap(v => v.chapters).filter(c => chapterLabel ? c.index === Number(chapterLabel[1]) && c.title === chapterLabel[2] : c.title === name))
        if (found) return { kind: "chapter", id: found.id, name: found.title, view: group === "大纲" ? "outline" : "content" }
        if (group === "大纲" && unique(volumes.filter(v => v.title === name))) return { kind: "outline" }
        return undefined
      }
      if (group === "角色") return findByName(characterRefs, name)
      if (group === "场景") return findByName(sceneRefs, name)
      if (group === "物品") return findByName(itemRefs, name)
      if (group === "世界观" || group === "世界") return findByName(worldRefs, name)
      if (group.startsWith("设定·")) return findByName(settingRefs.filter(r => SETTING_TYPE_LABELS[r.settingType] === group.slice(3)), name)
      return group ? undefined : matchers.get(name)
    },
    characterById: (id) => characterRefs.find((r) => r.id === id),
    characterByName: (name) => findByName(characterRefs, name),
    worldByName: (name) => findByName(worldRefs, name),
    worldById: (id) => worldRefs.find(r => r.id === id),
    settingByKey: (type, name, worldName, worldId) => {
      if (worldId) {
        return settingRefs.find(
          (r) => r.settingType === type && r.name === name && r.worldId === worldId
        )
      }
      if (worldName) {
        const world = unique(worlds.filter(w => w.name === worldName))
        if (!world) return undefined
        return settingRefs.find(
          (r) => r.settingType === type && r.name === name && r.worldId === world.id
        )
      }
      return settingRefs.find(
        (r) => r.settingType === type && r.name === name && r.worldId === null
      )
    },
    itemById: (id) => itemRefs.find((r) => r.id === id),
    itemByName: (name) => findByName(itemRefs, name),
    sceneById: (id) => sceneRefs.find((r) => r.id === id),
    sceneByName: (name) => findByName(sceneRefs, name),
    chapterById: (id) => chapterRefs.find((r) => r.id === id),
    chapterLabelById: (id) => {
      for (const v of volumes) {
        const c = v.chapters.find((ch) => ch.id === id)
        if (c) return `第 ${c.index} 章 · ${c.title}`
      }
      return undefined
    },
    hoverInfo: (kind, id) => {
      if (kind === "character") {
        const c = charactersFull.find((x) => x.id === id)
        if (!c) return undefined
        const roleLabel = CHARACTER_ROLE_LABELS[c.roleType] ?? "角色"
        return {
          name: c.name,
          role: c.occupation ? `${roleLabel} · ${c.occupation}` : roleLabel,
          blurb: firstSentence(c.bio || c.personality || c.appearance),
          avatarUrl: c.avatarUrl,
        }
      }
      if (kind === "item") {
        const it = items.find((x) => x.id === id)
        if (!it) return undefined
        return {
          name: it.name,
          role: "物品",
          blurb: firstSentence(it.description),
          avatarUrl: it.iconUrl,
          aliases: normalizeAliases(it.aliases),
          levels: normalizeItemLevels(it.levels).map(itemLevelLabel),
          tags: normalizeTags(it.tags),
        }
      }
      const s = scenes.find((x) => x.id === id)
      if (!s) return undefined
      return { name: s.name, role: sceneForest(scenes).path(s.id) + ` · ${sceneFactionLabel(s, factions)}`, blurb: firstSentence(s.description), avatarUrl: null }
    },
  }
}

/** useQueries 的 combine：扁平化各世界设定列表；模块级定义保证结果引用稳定（structural sharing） */
function combineWorldSettings(results: UseQueryResult<{ settings: SettingItem[] }>[]) {
  return results.flatMap((r) => r.data?.settings ?? [])
}

/** 聚合小说的实体列表，构建消息实体芯片索引；novelId 为空时返回空索引 */
export function useNovelEntityIndex(novelId: string | null): EntityIndex {
  const {data: factionData} = useSceneFactions(novelId)
  const { data: detail } = useQuery({
    queryKey: ["novels", novelId],
    queryFn: () => apiGet<{ novel: NovelDetail }>(`/api/novels/${novelId}`, "加载小说详情失败"),
    enabled: !!novelId,
  })
  const { data: worldsData } = useQuery({
    queryKey: ["worlds", novelId],
    queryFn: () => apiGet<{ worlds: WorldRecord[] }>(`/api/novels/${novelId}/worlds`, "加载世界失败"),
    enabled: !!novelId,
  })
  const { data: attributesData } = useQuery({
    queryKey: ["attributes", novelId],
    queryFn: () =>
      apiGet<{ definitions: AttributeDefinitionRecord[] }>(
        `/api/novels/${novelId}/attributes`,
        "加载属性定义失败"
      ),
    enabled: !!novelId,
  })
  const { data: itemsData } = useQuery({
    queryKey: ["items", novelId],
    queryFn: () => apiGet<{ items: ItemRecord[] }>(`/api/novels/${novelId}/items`, "加载物品失败"),
    enabled: !!novelId,
  })
  const { data: scenesData } = useQuery({
    queryKey: ["scenes", novelId],
    queryFn: () => apiGet<{ scenes: SceneRecord[] }>(`/api/novels/${novelId}/scenes`, "加载场景失败"),
    enabled: !!novelId,
  })
  // 角色完整记录（hover 卡头像/简介）：与 CharactersPanel 共享 query key，命中缓存零额外请求
  const { data: charactersFullData } = useQuery({
    queryKey: ["characters", novelId],
    queryFn: () =>
      apiGet<{ characters: CharacterRecord[] }>(
        `/api/novels/${novelId}/characters`,
        "加载角色失败"
      ),
    enabled: !!novelId,
  })
  // 各世界的完整设定（含 content）：提取二级/子孙概念名；key 与 WorldPanel 共享，写工具后自动刷新
  const worldIds = (worldsData?.worlds ?? []).map((w) => w.id)
  const worldSettings = useQueries({
    queries: worldIds.map((id) => ({
      queryKey: ["settings", "world", id],
      queryFn: () =>
        apiGet<{ settings: SettingItem[] }>(
          `/api/novels/${novelId}/settings?worldId=${id}`,
          "加载设定失败"
        ),
      enabled: !!novelId,
    })),
    combine: combineWorldSettings,
  })

  return useMemo(() => {
    if (!novelId || !detail?.novel) return EMPTY_INDEX
    return buildEntityIndex({
      novelTitle: detail.novel.title,
      characters: detail.novel.characters,
      charactersFull: charactersFullData?.characters ?? [],
      worlds: worldsData?.worlds ?? [],
      settings: detail.novel.settings,
      worldSettings,
      volumes: detail.novel.volumes,
      attributes: attributesData?.definitions ?? [],
      items: itemsData?.items ?? [],
      factions: factionData?.factions ?? [],
      scenes: scenesData?.scenes ?? [],
    })
  }, [novelId, detail, worldsData, worldSettings, attributesData, itemsData, scenesData, charactersFullData, factionData])
}
