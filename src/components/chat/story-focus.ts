import type { StoryArtifact } from "@/lib/story-workflow"
import type { SettingType } from "@/generated/prisma/enums"
import { buildTabId, useTabsStore, type Tab, type TabType } from "@/stores/tabs"
export { storyDraftText } from "@/lib/story-draft"

export function storyArtifactTab(novelId: string, artifact: Omit<StoryArtifact, "text">): Tab {
  const kind = artifact.kind
  if (kind === "setting" && artifact.worldId) return { id: buildTabId("world", novelId, { refId: artifact.worldId }), type: "world", novelId, refId: artifact.worldId, title: artifact.worldTitle ?? "世界观" }
  const type: TabType = kind === "world-event" ? "worldline" : kind === "narrative-card" ? "narrative" : kind === "volume" ? "outline" : kind === "attribute" ? "attributes" : kind
  const refId = artifact.id
  const options = { refId, settingType: artifact.settingType as SettingType | undefined }
  return { id: buildTabId(type, novelId, options), type, novelId, ...options, title: artifact.title }
}
export function focusStoryArtifact(novelId: string, raw: unknown) {
  if (!raw || typeof raw !== "object") return
  if ("kind" in raw && raw.kind === "story-workflow") {
    useTabsStore.getState().openTab({ id: buildTabId("story-workflow", novelId), type: "story-workflow", novelId, title: "创作进度" })
    return
  }
  if ("kind" in raw && raw.kind === "story-review" && "key" in raw && typeof raw.key === "string") {
    useTabsStore.getState().openTab({ id: buildTabId("story-review", novelId, { refId: raw.key }), type: "story-review", novelId, refId: raw.key, title: "创作评审" })
    return
  }
  const artifact = raw as Omit<StoryArtifact, "text">
  if (!artifact.key || !artifact.id || !artifact.kind || !artifact.title) return
  const tab = storyArtifactTab(novelId, artifact), store = useTabsStore.getState()
  // 同一目标的进度刷新不抢回作者手动切开的 tab。
  if (store.activeTabId !== tab.id) store.openTab(tab)
  if (["worldline","world-event","narrative","narrative-card"].includes(artifact.kind)) store.requestPanelFocus(tab.id,artifact.id)
  if (artifact.kind === "setting") store.requestPanelFocus(tab.id, artifact.id)
  if (artifact.kind === "world") store.requestPanelFocus(tab.id, "")
  if (artifact.kind === "foreshadow") store.requestPanelFocus(tab.id, "", undefined, artifact.id)
  store.closeTab(`story-activity:${novelId}`)
}
