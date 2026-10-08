import type { SceneImageKind } from "@/lib/scene-schema"
import { SceneImagePanel } from "./scene/SceneImagePanel"
import type { ComponentType } from "react"

import type { SettingType } from "@/generated/prisma/enums"
import type { CharacterImageKind, Tab, TabType } from "@/stores/tabs"

import { AttributesPanel } from "./AttributesPanel"
import { CandidatePanel } from "./CandidatePanel"
import { CascadePanel } from "./CascadePanel"
import { ChapterContentPanel } from "./ChapterContentPanel"
import { WorldlinePanel, NarrativePanel, OutlineProjectionPanel } from "./planning/PlanningWorkspace"
import { CharacterImagePanel } from "./CharacterImagePanel"
import { CharacterPanel } from "./CharacterPanel"
import { CharactersPanel } from "./CharactersPanel"
import { ItemImagePanel } from "./ItemImagePanel"
import { ItemPanel } from "./ItemPanel"
import { ItemsPanel } from "./ItemsPanel"
import { ForeshadowPanel } from "./ForeshadowPanel"
import { NovelCoverPanel } from "./NovelCoverPanel"
import { NovelOverview } from "./NovelOverview"
import { ScenePanel } from "./ScenePanel"
import { ScenesPanel } from "./ScenesPanel"
import { ScenarioPanel } from "./scenario/ScenarioPanel"
import { SettingPanel } from "./SettingPanel"
import { SubAgentPanel } from "./SubAgentPanel"
import { ThemePanel } from "./ThemePanel"
import { TropePanel } from "./TropePanel"
import { WorldPanel } from "./WorldPanel"
import { StoryActivityPanel, StoryWorkflowPanel } from "./StoryWorkflowPanel"
import { StoryReviewPanel } from "./StoryReviewPanel"

/**
 * 内容面板统一 props 接口。
 * - novelId：当前小说 id（所有面板都有）
 * - refId：具体内容记录 id（world → 世界 id；character → 角色 id；item → 物品 id；scene → 场景 id；chapter-* → 章节 id）
 * - settingType：type 为 setting 时的设定分类
 * - imageKind：type 为 character-image 时的图像类型（头像/立绘）
 * - chapterId：type 为 chapter-candidate 时候选所属章节 id（候选 REST 嵌套在章节路径下）
 */
export interface ContentPanelProps {
  novelId: string
  refId?: string
  settingType?: SettingType
  sceneImageKind?: SceneImageKind
  imageKind?: CharacterImageKind
  chapterId?: string
}

/** tab 类型 → 内容组件 注册表 */
export const contentRegistry: Record<TabType, ComponentType<ContentPanelProps>> = {
  "story-workflow": StoryWorkflowPanel,
  "story-review": StoryReviewPanel,
  "story-activity": StoryActivityPanel,
  novel: NovelOverview,
  "novel-cover": NovelCoverPanel,
  theme: ThemePanel,
  world: WorldPanel,
  setting: SettingPanel,
  attributes: AttributesPanel,
  characters: CharactersPanel,
  character: CharacterPanel,
  "character-image": CharacterImagePanel,
  items: ItemsPanel,
  item: ItemPanel,
  "item-image": ItemImagePanel,
  scenes: ScenesPanel,
  scene: ScenePanel,
  "scene-image": SceneImagePanel,
  trope: TropePanel,
  worldline: WorldlinePanel,
  narrative: NarrativePanel,
  outline: OutlineProjectionPanel,
  "chapter-outline": OutlineProjectionPanel,
  "chapter-content": ChapterContentPanel,
  "chapter-candidate": CandidatePanel,
  cascade: CascadePanel,
  subagent: SubAgentPanel,
  scenario: ScenarioPanel,
  foreshadow: ForeshadowPanel,
}

export function renderTabContent(tab: Tab) {
  const Panel = contentRegistry[tab.type]
  // 已下线面板（如旧故事板 tab）的兜底空态；tabs 为内存态，刷新即清。
  if (!Panel) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">该面板已下线</div>
  return (
    <Panel
      novelId={tab.novelId}
      refId={tab.refId}
      settingType={tab.settingType}
      imageKind={tab.imageKind}
      sceneImageKind={tab.sceneImageKind}
      chapterId={tab.chapterId}
    />
  )
}
