import { z } from "zod"
import { SettingType } from "../../generated/prisma/enums"
import { TAB_TYPES, buildTabId, useTabsStore, type Tab } from "../../stores/tabs"
import type { DesktopSaveCoordinator } from "./save-coordinator"

const percent = z.number().min(0).max(100)
/** Data for the existing DashboardShell state and the installed Group public API. */
export const workspaceLayoutSchema = z.object({
  version: z.literal(1), narrowPane: z.enum(["chat", "content", "sidebar"]),
  contentVisible: z.boolean(), sidebarVisible: z.boolean(), chatVisible: z.boolean(),
  sizes: z.object({ sidebar: percent.optional(), chat: percent.optional(), content: percent.optional() }).strict(),
  lastContentSize: percent.nullable(), lastSidebarSize: percent.nullable(), lastChatSize: percent.nullable(),
}).strict().refine(value => value.contentVisible || value.sidebarVisible || value.chatVisible)
  .refine(value => { const sizes = Object.values(value.sizes); return !sizes.length || Math.abs(sizes.reduce((sum, size) => sum + size, 0) - 100) < .01 })
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>
export interface WorkspaceLayoutAdapter {
  read(): WorkspaceLayout
  /** Restore local visibility/last-size state, then the existing Group.setLayout. */
  apply(layout: WorkspaceLayout): void
  subscribe(changed: () => void): () => void
}
const id = z.string().min(1).max(200)
export const workspaceTabSchema: z.ZodType<Tab> = z.object({
  id, type: z.enum(TAB_TYPES), novelId: id, title: z.string().max(500), refId: id.optional(),
  settingType: z.enum(SettingType).optional(), imageKind: z.enum(["avatar", "portrait"]).optional(),
  sceneImageKind: z.enum(["exterior", "interior"]).optional(), chapterId: id.optional(),
}).strict().refine(tab => tab.id === buildTabId(tab.type, tab.novelId, tab))
  .refine(tab => tab.type !== "setting" || !!tab.settingType)
  .refine(tab => !["character", "character-image", "item", "item-image", "scene", "scene-image", "chapter-content", "chapter-outline", "chapter-candidate", "subagent", "scenario"].includes(tab.type) || !!tab.refId)
  .refine(tab => tab.type !== "chapter-candidate" || !!tab.chapterId)
export interface WorkspaceDraft { version: 1; tabs: Tab[]; activeTabId: string | null; subTabs: Record<string, string>; layout: WorkspaceLayout | null }
export class WorkspaceDraftSource {
  private adapter: WorkspaceLayoutAdapter | undefined
  private pending: WorkspaceLayout | null = null
  private last: WorkspaceLayout | null = null
  private listeners = new Set<() => void>()
  read(): WorkspaceDraft {
    const state = useTabsStore.getState()
    const layout = this.adapter ? workspaceLayoutSchema.parse(this.adapter.read()) : this.pending ?? this.last
    return structuredClone({ version: 1, tabs: state.tabs, activeTabId: state.activeTabId, subTabs: state.subTabs, layout })
  }
  restore(value: WorkspaceDraft): void {
    const tabs = value.tabs.map(tab => workspaceTabSchema.parse(tab)), ids = new Set(tabs.map(tab => tab.id))
    if (ids.size !== tabs.length || value.activeTabId !== null && !ids.has(value.activeTabId)) throw new Error("INVALID_WORKSPACE_DRAFT")
    const layout = value.layout === null ? null : workspaceLayoutSchema.parse(value.layout)
    this.pending = structuredClone(layout); this.last = structuredClone(layout)
    useTabsStore.setState({ tabs: structuredClone(tabs), activeTabId: value.activeTabId, subTabs: structuredClone(value.subTabs), panelFocus: null })
    this.applyPending(); this.changed()
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    const release = useTabsStore.subscribe(listener)
    return () => { release(); this.listeners.delete(listener) }
  }
  private changed() { for (const listener of this.listeners) listener() }
  private applyPending() {
    if (!this.adapter || !this.pending) return
    this.adapter.apply(structuredClone(this.pending)); this.last = this.pending; this.pending = null
  }
  registerLayoutAdapter(adapter: WorkspaceLayoutAdapter): () => void {
    this.adapter = adapter
    const release = adapter.subscribe(() => { if (this.adapter === adapter) { this.last = workspaceLayoutSchema.parse(adapter.read()); this.changed() } })
    this.applyPending(); this.changed()
    return () => { release(); if (this.adapter !== adapter) return; this.last = workspaceLayoutSchema.parse(adapter.read()); this.adapter = undefined; this.changed() }
  }
  get layoutPending() { return !!this.pending }
}
export const desktopWorkspaceDraftSource = new WorkspaceDraftSource()
export function registerWorkspaceLayoutAdapter(adapter: WorkspaceLayoutAdapter) { return desktopWorkspaceDraftSource.registerLayoutAdapter(adapter) }
export function installWorkspaceDraftSource(coordinator: DesktopSaveCoordinator, source = desktopWorkspaceDraftSource) { return coordinator.registerSource("workspace", source) }
