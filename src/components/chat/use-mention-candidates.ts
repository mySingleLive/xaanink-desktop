"use client"
import { sceneFactionLabel } from "@/lib/scene-context"

/**
 * @ 提及候选：把小说下可被引用的资源（角色/物品/世界观/设定/大纲/正文）
 * 整理为分组列表，供 ChatPanel 的 @ 自动补全弹窗展示与过滤。
 * 查询 key 与各面板/实体索引共用缓存，不产生额外请求。
 *
 * 每个候选携带结构化身份（kind/id/groupLabel），insertText 为类型化序列
 * `@[组标签/展示名]`（如 `@[正文/第1章 · 雨夜来客]`）——composer 芯片与
 * 发送文本共用它，同名资源靠组标签区分（大纲第N章 vs 正文第N章）。
 */
import { sceneForest } from "@/lib/scene-tree"
import { sceneMention } from "@/lib/scene-context"
import { useScenes, useSceneFactions } from "@/components/content/scene/use-scenes"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import type { SettingType } from "@/generated/prisma/enums"
import { SETTING_TYPE_LABELS } from "@/lib/setting-types"
import { validWorldName } from "@/lib/world-schema"
import { worldForest } from "@/lib/world-tree"
import { apiGet } from "@/components/content/api"
import {
  CHARACTER_ROLE_LABELS,
  CHAPTER_STATUS_LABELS,
} from "@/components/content/labels"
import type {
  CharacterRecord,
  ItemRecord,
  NovelDetail,
  WorldRecord,
} from "@/components/content/types"

export type MentionKind = "character" | "item" | "scene" | "world" | "setting" | "outline" | "content"

export interface MentionItem {
  /** 列表内唯一 key */
  key: string
  /** 资源类别（芯片图标/语义） */
  kind: MentionKind
  /** 资源 id */
  id: string
  /** 弹窗展示名（章节带「第N章 ·」前缀便于定位） */
  name: string
  /** 右侧补充说明（类型/归属/状态等） */
  detail?: string
  /** 类型组标签：角色 / 物品 / 世界观 / 设定·类型 / 大纲 / 正文 */
  groupLabel: string
  /** 类型化序列 `@[组标签/展示名]`：composer 芯片的 data-insert 与发送文本 */
  insertText: string
  /** 角色头像 / 物品图标（无图或其他类别为 null） */
  avatarUrl?: string | null
  /** 设定类型（MAP 用地图图标） */
  settingType?: SettingType
}

export interface MentionGroup {
  key: string
  label: string
  items: MentionItem[]
}

/** 序列化安全性：名称中的方括号/换行会破坏 `@[…]` 语法，替换为空格 */
function sanitizeName(name: string): string {
  return name.replace(/[[\]\n]/g, " ").trim()
}

function typedInsert(groupLabel: string, displayName: string): string {
  return `@[${groupLabel}/${displayName}]`
}

/** 世界列表（扁平 parentId）按树序展开：先根后子，DFS */
function flattenWorldTree(worlds: WorldRecord[]): WorldRecord[] {
  const { children: byParent } = worldForest(worlds)
  const ordered: WorldRecord[] = []
  const walk = (parentId: string | null) => {
    for (const w of byParent.get(parentId) ?? []) {
      ordered.push(w)
      walk(w.id)
    }
  }
  walk(null)
  return ordered
}

/** 聚合小说的可引用资源分组；novelId 为空或详情未就绪时返回空数组 */
export function useMentionCandidates(novelId: string | null): MentionGroup[] {
  const {data: factionData} = useSceneFactions(novelId)
  const sceneQuery = useScenes(novelId ?? "")
  const { data: detail } = useQuery({
    queryKey: ["novels", novelId],
    queryFn: () => apiGet<{ novel: NovelDetail }>(`/api/novels/${novelId}`, "加载小说详情失败"),
    enabled: !!novelId,
  })
  const { data: worldsData } = useQuery({
    queryKey: ["worlds", novelId],
    queryFn: () =>
      apiGet<{ worlds: WorldRecord[] }>(`/api/novels/${novelId}/worlds`, "加载世界失败"),
    enabled: !!novelId,
  })
  // 角色全量记录（头像用于 composer 芯片；与角色面板共用缓存）
  const { data: charactersData } = useQuery({
    queryKey: ["characters", novelId],
    queryFn: () =>
      apiGet<{ characters: CharacterRecord[] }>(
        `/api/novels/${novelId}/characters`,
        "加载角色失败"
      ),
    enabled: !!novelId,
  })
  // 物品列表（图标用于 composer 芯片；与 ItemsPanel/实体索引共用 ["items", novelId] 缓存）
  const { data: itemsData } = useQuery({
    queryKey: ["items", novelId],
    queryFn: () =>
      apiGet<{ items: ItemRecord[] }>(`/api/novels/${novelId}/items`, "加载物品失败"),
    enabled: !!novelId,
  })

  return useMemo(() => {
    if (!novelId || !detail?.novel) return []
    const novel = detail.novel
    const worlds = worldsData?.worlds ?? []
    const avatarOf = new Map(
      (charactersData?.characters ?? []).map((c) => [c.id, c.avatarUrl] as const)
    )
    const worldNameOf = (id: string | null) => worlds.find((w) => w.id === id)?.name
    const settingNameOf = (id: string | null) =>
      novel.settings.find((s) => s.id === id)?.name

    const groups: MentionGroup[] = []
    const sceneTree = sceneForest(sceneQuery.rows)
    if (sceneQuery.rows.length) groups.push({key: "scene", label: "场景", items: sceneTree.ordered.map(scene => ({key: `scene:${scene.id}`, kind: "scene", id: scene.id, name: scene.name, detail: `${sceneTree.path(scene.id)} · ${sceneFactionLabel(scene, factionData?.factions ?? [])}`, groupLabel: "场景", insertText: sceneMention(scene, novelId)}))})

    if (novel.characters.length > 0) {
      groups.push({
        key: "character",
        label: "角色",
        items: novel.characters.map((c) => {
          const name = sanitizeName(c.name)
          return {
            key: `character:${c.id}`,
            kind: "character" as const,
            id: c.id,
            name,
            detail: CHARACTER_ROLE_LABELS[c.roleType],
            groupLabel: "角色",
            insertText: typedInsert("角色", name),
            avatarUrl: avatarOf.get(c.id) ?? null,
          }
        }),
      })
    }

    const items = itemsData?.items ?? []
    if (items.length > 0) {
      groups.push({
        key: "item",
        label: "物品",
        items: items.map((i) => {
          const name = sanitizeName(i.name)
          return {
            key: `item:${i.id}`,
            kind: "item" as const,
            id: i.id,
            name,
            groupLabel: "物品",
            insertText: typedInsert("物品", name),
            avatarUrl: i.iconUrl ?? null,
          }
        }),
      })
    }

    if (worlds.length > 0) {
      groups.push({
        key: "world",
        label: "世界观",
        items: flattenWorldTree(worlds).filter(w => validWorldName(w.name)).map((w) => {
          const name = sanitizeName(w.name)
          return {
            key: `world:${w.id}`,
            kind: "world" as const,
            id: w.id,
            name,
            detail: w.parentId ? `属于 ${worldNameOf(w.parentId) ?? "上级世界"}` : undefined,
            groupLabel: "世界观",
            insertText: typedInsert("世界观", name),
          }
        }),
      })
    }

    if (novel.settings.length > 0) {
      groups.push({
        key: "setting",
        label: "设定",
        items: novel.settings.map((s) => {
          const name = sanitizeName(s.name)
          const groupLabel = `设定·${SETTING_TYPE_LABELS[s.type]}`
          return {
            key: `setting:${s.id}`,
            kind: "setting" as const,
            id: s.id,
            name,
            detail: [
              SETTING_TYPE_LABELS[s.type],
              worldNameOf(s.worldId),
              s.parentId ? settingNameOf(s.parentId) : undefined,
            ]
              .filter(Boolean)
              .join(" · "),
            groupLabel,
            insertText: typedInsert(groupLabel, name),
            settingType: s.type,
          }
        }),
      })
    }

    const outlineItems: MentionItem[] = []
    const contentItems: MentionItem[] = []
    for (const v of novel.volumes) {
      const volumeName = sanitizeName(v.title)
      outlineItems.push({
        key: `volume:${v.id}`,
        kind: "outline",
        id: v.id,
        name: volumeName,
        detail: "卷大纲",
        groupLabel: "大纲",
        insertText: typedInsert("大纲", volumeName),
      })
      for (const c of v.chapters) {
        const display = `第${c.index}章 · ${sanitizeName(c.title)}`
        outlineItems.push({
          key: `chapter-outline:${c.id}`,
          kind: "outline",
          id: c.id,
          name: display,
          detail: "章大纲",
          groupLabel: "大纲",
          insertText: typedInsert("大纲", display),
        })
        contentItems.push({
          key: `chapter-content:${c.id}`,
          kind: "content",
          id: c.id,
          name: display,
          detail: `${CHAPTER_STATUS_LABELS[c.status]} · ${c.wordCount}字`,
          groupLabel: "正文",
          insertText: typedInsert("正文", display),
        })
      }
    }
    if (outlineItems.length > 0) {
      groups.push({ key: "outline", label: "大纲", items: outlineItems })
    }
    if (contentItems.length > 0) {
      groups.push({ key: "content", label: "正文", items: contentItems })
    }

    return groups
  }, [novelId, detail, worldsData, charactersData, itemsData, sceneQuery.rows, factionData])
}
