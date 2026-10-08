"use client"

import { sceneLeaveGuard } from "./scene-ui"
import { toast } from "sonner"
import type { SceneImageKind } from "@/lib/scene-schema"
import { create } from "zustand"
import {
  BookOpen,
  ChartNoAxesGantt,
  Bot,
  Brain,
  FileText,
  Flag,
  FlaskConical,
  Globe,
  Heart,
  History,
  Image as ImageIcon,
  Landmark,
  Layers,
  Lightbulb,
  ListTree,
  Map,
  MapPin,
  Mountain,
  Package,
  PenLine,
  RefreshCw,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react"

import type { SettingType } from "@/generated/prisma/enums"

/** 角色图像类型（头像/立绘） */
export type CharacterImageKind = "avatar" | "portrait"

/** 右侧内容区支持的 tab 类型 */
export const TAB_TYPES = [
  "story-workflow",
  "story-review",
  "story-activity",
  "novel",
  "novel-cover",
  "theme",
  "world",
  "setting",
  "attributes",
  "characters",
  "character",
  "character-image",
  "items",
  "item",
  "item-image",
  "scenes",
  "scene",
  "scene-image",
  "trope",
  "worldline",
  "narrative",
  "outline",
  "chapter-outline",
  "chapter-content",
  "chapter-candidate",
  "cascade",
  "subagent",
  "scenario",
  "foreshadow",
] as const
export type TabType = (typeof TAB_TYPES)[number]

export interface Tab {
  /** 唯一 id，如 `world:{worldId}`、`setting:STYLE:{novelId}`、`theme:{novelId}` */
  id: string
  type: TabType
  novelId: string
  /** 具体内容记录 id（世界 id、角色 id、物品 id、场景 id、章节 id 等），设定类 tab 为空 */
  refId?: string
  /** type 为 setting 时的设定分类 */
  settingType?: SettingType
  /** type 为 character-image 时的图像类型（头像/立绘） */
  sceneImageKind?: SceneImageKind
  imageKind?: CharacterImageKind
  /** type 为 chapter-candidate 时的所属章节 id（候选 REST 嵌套在章节路径下，面板取数需要） */
  chapterId?: string
  title: string
}

/** 统一构造 tab id，保证「已存在则激活」的判断一致 */
export function buildTabId(
  type: TabType,
  novelId: string,
  options?: { settingType?: SettingType; refId?: string; imageKind?: CharacterImageKind; sceneImageKind?: SceneImageKind }
): string {
  if (type === "setting") return `setting:${options?.settingType}:${novelId}`
  if (type === "world") return `world:${options?.refId ?? novelId}`
  if (type === "character") return `character:${options?.refId ?? novelId}`
  if (type === "character-image") {
    return `character-image:${options?.imageKind ?? "avatar"}:${options?.refId ?? novelId}`
  }
  if (type === "item") return `item:${options?.refId ?? novelId}`
  if (type === "item-image") return `item-image:${options?.refId ?? novelId}`
  if (type === "scene-image") return `scene-image:${options?.sceneImageKind ?? "exterior"}:${options?.refId ?? novelId}`
  if (type === "scene") return `scene:${options?.refId ?? novelId}`
  if (type === "chapter-outline") return `chapter-outline:${options?.refId ?? novelId}`
  if (type === "chapter-content") return `chapter-content:${options?.refId ?? novelId}`
  if (type === "chapter-candidate") return `chapter-candidate:${options?.refId ?? novelId}`
  if (type === "subagent") return `subagent:${options?.refId ?? novelId}`
  if (type === "story-review") return `story-review:${novelId}:${options?.refId ?? ""}`
  if (type === "scenario") return `scenario:${options?.refId ?? novelId}`
  if (type === "foreshadow") return `foreshadow:${novelId}`
  return `${type}:${novelId}`
}

const SETTING_TYPE_ICONS: Record<SettingType, LucideIcon> = {
  LEVEL_SYSTEM: Layers,
  POWER_SYSTEM: Zap,
  CONCEPT: Brain,
  GOLD_FINGER: Sparkles,
  STYLE: PenLine,
  MAP: Map,
  FACTION: Flag,
  SOCIETY: Landmark,
  CULTURE: ScrollText,
  GEOGRAPHY: Mountain,
  WORLD_HISTORY: History,
}

/** 根据 tab 类型解析展示图标（树节点与 tab 条共用） */
export function getTabIcon(tab: Pick<Tab, "type" | "settingType">): LucideIcon {
  switch (tab.type) {
    case "story-workflow":
    case "story-review":
      return ListTree
    case "story-activity":
      return PenLine
    case "novel":
      return BookOpen
    case "novel-cover":
      return ImageIcon
    case "theme":
      return Lightbulb
    case "world":
      return Globe
    case "setting":
      return tab.settingType ? SETTING_TYPE_ICONS[tab.settingType] : Layers
    case "attributes":
      return SlidersHorizontal
    case "characters":
    case "character":
      return Users
    case "character-image":
      return ImageIcon
    case "items":
    case "item":
      return Package
    case "scene-image":
    case "item-image":
      return ImageIcon
    case "scenes":
    case "scene":
      return MapPin
    case "trope":
      return Heart
    case "worldline": return ChartNoAxesGantt
    case "narrative": return ListTree
    case "outline":
    case "chapter-outline":
      return ListTree
    case "chapter-content":
      return FileText
    case "chapter-candidate":
      return Layers
    case "cascade":
      return RefreshCw
    case "subagent":
      return Bot
    case "scenario":
      return FlaskConical
    case "foreshadow":
      return Flag
  }
}

export interface PanelFocus {
  tabId: string
  settingId: string
  concept?: string
  foreshadowId?: string
  touchId?: string
  referenceId?: string
  targetType?: import("@/lib/foreshadow-reference").ReferenceTargetType
  targetId?: string
  view?: "trunk" | "timeline" | "prose"
}

interface TabsState {
  tabs: Tab[]
  activeTabId: string | null
  /** 打开/激活 tab 的单调计数：重复点击已激活 tab 时 activeTabId 不变，
      靠它让布局层感知「用户又点了一次」，从而重新展开已隐藏的内容区 */
  activationNonce: number
  /** 跨面板聚焦请求：打开 tab 后让目标面板选中指定设定（对话实体芯片/改动卡片用），被消费前一直保留；concept 为设定内的子概念名（滚动定位并高亮） */
  panelFocus: PanelFocus | null
  /** 面板内的子视图状态（如角色面板的子 Tab），按 tab.id 记忆：
      三阶段撤销/落库会经 revertNonce 重挂载整个面板，存这里则不丢 */
  subTabs: Record<string, string>
  setSubTab: (tabId: string, subTab: string) => void
  /** 打开 tab：已存在则激活，否则追加到末尾并激活 */
  openTab: (tab: Tab) => void
  /** 关闭 tab：若关闭的是激活 tab，则激活相邻（优先左侧）tab */
  closeTab: (id: string) => void
  activateTab: (id: string) => void
  /** Desktop history waits for the existing draft guard; stale/cancelled moves do not activate. */
  activateTabForNavigation: (id: string, signal: AbortSignal) => Promise<boolean>
  /** 删除小说时关闭其所有 tab */
  closeAllTabsOfNovel: (novelId: string) => void
  /** 删除世界时关闭其 world tab */
  closeWorldTab: (worldId: string) => void
  closeSceneTabs: (novelId: string, sceneId: string) => void
  /** 小说重命名后同步小说概览 tab 标题 */
  renameNovelTab: (novelId: string, title: string) => void
  /** 世界重命名后同步 world tab 标题 */
  renameWorldTab: (worldId: string, title: string) => void
  /** 情景试验场重命名后同步 scenario tab 标题 */
  renameScenarioTab: (scenarioId: string, title: string) => void
  /** 请求某个 tab 的面板选中指定设定；concept 为设定内的子概念名（可选） */
  requestPanelFocus: (tabId: string, settingId: string, concept?: string, foreshadowId?: string, reference?: Pick<PanelFocus, "touchId" | "referenceId" | "targetType" | "targetId" | "view">) => void
  /** 面板消费聚焦请求：tabId 匹配则返回聚焦目标并清除，否则返回 null */
  consumePanelFocus: (tabId: string) => Omit<PanelFocus, "tabId"> | null
}

function afterSceneLeave(action: () => void, destination?: string) {
  const active = useTabsStore.getState().activeTabId
  const guard = active !== destination ? sceneLeaveGuard(active) : undefined
  if (guard) void guard().then(action).catch(error => toast.error(error instanceof Error ? error.message : "草稿尚未保存，请重试或明确放弃"))
  else action()
}
function activation(state: TabsState, id: string) {
  return state.tabs.some(tab => tab.id === id) ? { activeTabId: id, activationNonce: state.activationNonce + 1 } : state
}
export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  activationNonce: 0,
  panelFocus: null,
  subTabs: {},

  setSubTab: (tabId, subTab) =>
    set((state) => ({ subTabs: { ...state.subTabs, [tabId]: subTab } })),

  openTab: (tab) =>
    afterSceneLeave(() => set((state) => {
      if (state.tabs.some((t) => t.id === tab.id)) {
        return { activeTabId: tab.id, activationNonce: state.activationNonce + 1 }
      }
      return {
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        activationNonce: state.activationNonce + 1,
      }
    }), tab.id),

  closeTab: (id) =>
    afterSceneLeave(() => set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id)
      if (index === -1) return state
      const tabs = state.tabs.filter((t) => t.id !== id)
      let activeTabId = state.activeTabId
      if (activeTabId === id) {
        activeTabId = tabs[index - 1]?.id ?? tabs[index]?.id ?? null
      }
      const subTabs = { ...state.subTabs }
      delete subTabs[id]
      return { tabs, activeTabId, subTabs }
    }), id !== get().activeTabId ? get().activeTabId ?? undefined : undefined),

  activateTab: (id) =>
    afterSceneLeave(() => set(state => activation(state, id)), id),

  activateTabForNavigation: async (id, signal) => {
    const before = get(), target = before.tabs.find(tab => tab.id === id)
    if (signal.aborted || !target) return false
    if (before.activeTabId === id) { set(state => activation(state, id)); return true }
    const guard = sceneLeaveGuard(before.activeTabId)
    if (guard) await guard()
    const current = get()
    if (signal.aborted || current.activeTabId !== before.activeTabId || current.activationNonce !== before.activationNonce || current.tabs.find(tab => tab.id === id) !== target) return false
    set(state => activation(state, id))
    return true
  },

  closeAllTabsOfNovel: (novelId) =>
    set((state) => {
      const removed = new Set(state.tabs.filter((t) => t.novelId === novelId).map((t) => t.id))
      const tabs = state.tabs.filter((t) => t.novelId !== novelId)
      const activeTabId =
        state.activeTabId && tabs.some((t) => t.id === state.activeTabId)
          ? state.activeTabId
          : (tabs[tabs.length - 1]?.id ?? null)
      const subTabs = Object.fromEntries(
        Object.entries(state.subTabs).filter(([id]) => !removed.has(id))
      )
      return { tabs, activeTabId, subTabs }
    }),

  closeSceneTabs: (novelId, sceneId) => set(state => {
    const removed = new Set(state.tabs.filter(t => t.novelId === novelId && t.refId === sceneId && (t.type === "scene" || t.type === "scene-image")).map(t => t.id))
    const tabs = state.tabs.filter(t => !removed.has(t.id))
    return {tabs, activeTabId: state.activeTabId && removed.has(state.activeTabId) ? tabs.at(-1)?.id ?? null : state.activeTabId, subTabs: Object.fromEntries(Object.entries(state.subTabs).filter(([key]) => !removed.has(key)))}
  }),

  renameNovelTab: (novelId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.type === "novel" && t.novelId === novelId ? { ...t, title } : t
      ),
    })),

  closeWorldTab: (worldId) =>
    set((state) => {
      const tabId = `world:${worldId}`
      if (!state.tabs.some((t) => t.id === tabId)) return state
      const index = state.tabs.findIndex((t) => t.id === tabId)
      const tabs = state.tabs.filter((t) => t.id !== tabId)
      let activeTabId = state.activeTabId
      if (activeTabId === tabId) {
        activeTabId = tabs[index - 1]?.id ?? tabs[index]?.id ?? null
      }
      return { tabs, activeTabId }
    }),

  renameWorldTab: (worldId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.type === "world" && t.id === `world:${worldId}` ? { ...t, title } : t
      ),
    })),

  renameScenarioTab: (scenarioId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.type === "scenario" && t.id === `scenario:${scenarioId}` ? { ...t, title } : t
      ),
    })),

  requestPanelFocus: (tabId, settingId, concept, foreshadowId, reference) => set({ panelFocus: { tabId, settingId, concept, foreshadowId, ...reference } }),

  consumePanelFocus: (tabId) => {
    const focus = get().panelFocus
    if (!focus || focus.tabId !== tabId) return null
    set({ panelFocus: null })
    return focus
  },
}))
