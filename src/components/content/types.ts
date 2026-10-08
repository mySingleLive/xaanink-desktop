import type {
  AttributeTarget,
  AttributeValueType,
  CharacterImageKind,
  CharacterImageSource,
  CharacterRoleType,
  ChapterStatus,
  NovelStage,
  NovelStatus,
  ReviewHumanStatus,
  ReviewTargetType,
  SettingType,
} from "@/generated/prisma/enums"

import type { ItemLevelRef } from "./item-levels"

// 核心动机的类型与规整函数单一来源在 @/lib/motivation，这里转引供面板组件使用
export { normalizeMotivations } from "@/lib/motivation"
export type { MotivationEntry, MotivationLayer } from "@/lib/motivation"

// 性格标签的规整函数单一来源在 @/lib/personality-tags，这里转引供面板组件使用
export { normalizePersonalityTags } from "@/lib/personality-tags"

// 别名/外号、Big Five 五维、观念的规整函数单一来源分别在 @/lib/aliases、@/lib/big-five、@/lib/beliefs
export { normalizeAliases } from "@/lib/aliases"
export { normalizeBigFive, BIG_FIVE_DIMENSIONS, BIG_FIVE_NEUTRAL } from "@/lib/big-five"
export type { BigFive, BigFiveKey } from "@/lib/big-five"
export { normalizeBeliefs, BELIEF_KEYS } from "@/lib/beliefs"
export type { Beliefs, BeliefKey } from "@/lib/beliefs"

/** 人物关系条目（characterId 链接到已有角色，null/缺省 = 自由文本目标） */
export interface RelationshipItem {
  target: string
  description: string
  characterId?: string | null
}

/** 图像裁剪区域（相对原始图像宽高的 0-1 比例） */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** 把 DB 中的 crop Json 规整为裁剪区域，非法返回 null（=整图） */
export function normalizeCrop(raw: unknown): CropRect | null {
  if (!raw || typeof raw !== "object") return null
  const { x, y, w, h } = raw as Record<string, unknown>
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number" ||
    w <= 0 ||
    h <= 0
  ) {
    return null
  }
  return { x, y, w, h }
}

/** GET /api/novels/[id]/characters/[characterId]/images 图像版本记录 */
export interface CharacterImageRecord {
  id: string
  characterId: string
  kind: CharacterImageKind
  source: CharacterImageSource
  url: string
  prompt: string
  createdAt: string
}

/** GET /api/novels/[id]/cover/images 封面版本记录 */
export interface NovelCoverImageRecord {
  id: string
  novelId: string
  source: "AI" | "UPLOAD"
  url: string
  prompt: string | null
  createdAt: string
}

// 物品标签的规整函数单一来源在 @/lib/item-tags，这里转引供面板组件使用
export { normalizeTags } from "@/lib/item-tags"

/** 实体（角色/物品/场景）上挂载的属性值条目 */
export interface EntityAttributeItem {
  definitionId: string
  value: string
}

/** 把 DB 中的 attributes Json 规整为属性值条目数组 */
export function normalizeEntityAttributes(raw: unknown): EntityAttributeItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      definitionId: typeof x.definitionId === "string" ? x.definitionId : "",
      value: typeof x.value === "string" ? x.value : "",
    }))
    .filter((x) => x.definitionId !== "")
}

/** GET /api/novels/[id]/attributes 属性定义记录 */
export interface AttributeDefinitionRecord {
  id: string
  novelId: string
  name: string
  description: string
  targets: AttributeTarget[]
  valueType: AttributeValueType
  options: string[]
  createdAt: string
  updatedAt: string
}

/** 物品功效条目：name 可空 */
export interface ItemEffect {
  name: string
  description: string
}

/** GET /api/novels/[id]/items 列表项（也是 ItemPanel 的编辑对象） */
export interface ItemRecord {
  id: string
  novelId: string
  name: string
  description: string
  aliases: string[]
  tags: string[]
  /** 等级引用数组（单途径体系 pathway 为 null） */
  levels: ItemLevelRef[]
  appearance: string
  acquisition: string
  effects: ItemEffect[]
  iconUrl: string | null
  /** 图标裁剪区域 Json（CropRect），空为整图 */
  iconCrop: unknown
  attributes: unknown
  createdAt: string
  updatedAt: string
}

/** GET /api/novels/[id]/scenes 列表项（也是 ScenePanel 的编辑对象） */
export interface SceneRecord {
  parentId: string | null
  version: number
  backstory: string
  entryMethod: string
  exteriorDescription: string
  interiorDescription: string
  factionSettingId: string | null
  factionId: string | null
  factionNameSnapshot: string | null
  exteriorImageUrl: string | null
  interiorImageUrl: string | null
  exteriorImageRevision: number
  interiorImageRevision: number
  id: string
  novelId: string
  name: string
  description: string
  coordinates: string
  attributes: unknown
  createdAt: string
  updatedAt: string
}

/** GET /api/novels/[id]/characters 列表项（也是 CharacterPanel 的编辑对象） */
export interface CharacterRecord {
  id: string
  novelId: string
  name: string
  roleType: CharacterRoleType
  aliases: unknown
  age: string
  gender: string
  occupation: string
  bio: string
  personality: string
  personalityTags: unknown
  appearance: string
  height: string
  weight: string
  build: string
  faceShape: string
  clothing: string
  tastes: string
  habits: string
  catchphrase: string
  dialogueStyle: string
  sampleDialogue: string
  motivations: unknown
  desires: string
  fears: string
  beliefs: unknown
  bigFive: unknown
  abilities: string
  backstory: string
  growthArc: string
  /** 阶段卡片链 Json（ArcStage[]；规整用 @/lib/arc-stage 的 normalizeArcStages） */
  arcStages: unknown
  relationships: unknown
  avatarUrl: string | null
  portraitUrl: string | null
  avatarCrop: unknown
  portraitCrop: unknown
  attributes: unknown
  version: number
}

/** 把 DB 中的 relationships Json 规整为条目数组 */
export function normalizeRelationships(raw: unknown): RelationshipItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      target: typeof x.target === "string" ? x.target : "",
      description: typeof x.description === "string" ? x.description : "",
      characterId: typeof x.characterId === "string" && x.characterId ? x.characterId : null,
    }))
}

/** GET /api/novels 列表项 */
export interface NovelSummary {
  id: string
  title: string
  coverUrl: string | null
  status: NovelStatus
  currentStage: NovelStage
  createdAt: string
  updatedAt: string
}

/** 世界记录（GET /api/novels/[id]/worlds 列表项） */
export interface WorldRecord {
  id: string
  novelId: string
  parentId: string | null
  name: string
  description: string
  updatedAt: string
}

/** GET /api/novels/[id] 详情（含树所需的关联概要） */
export interface NovelDetail extends NovelSummary {
  theme: {
    id: string
    title: string
    synopsis: string
    channel: string
    genre: string
    tags: string[]
    targetAudience: string
    version: number
  } | null
  settings: {
    id: string
    type: SettingType
    name: string
    version: number
    updatedAt: string
    worldId: string | null
    parentId: string | null
  }[]
  characters: {
    id: string
    name: string
    roleType: CharacterRoleType
  }[]
  volumes: {
    id: string
    index: number
    title: string
    updatedAt: string
    chapters: {
      id: string
      index: number
      title: string
      status: ChapterStatus
      wordCount: number
    }[]
  }[]
}

/** GET /api/novels/[id]/outline 大纲树中的章节节点 */
export interface OutlineChapterNode {
  id: string
  volumeId: string
  index: number
  title: string
  outline: string
  content?: string
  wordCount: number
  status: ChapterStatus
  version: number
}

/** GET /api/novels/[id]/outline 大纲树中的卷节点 */
export interface OutlineVolumeNode {
  id: string
  novelId: string
  index: number
  title: string
  summary: string
  updatedAt: string
  chapters: OutlineChapterNode[]
}

/** GET /api/novels/[id]/chapters/[chapterId] 章节详情 */
export interface ChapterDetail extends OutlineChapterNode {
  content: string
  volume: {
    id: string
    novelId: string
    index: number
    title: string
    summary: string
  }
}

/** AI 评审意见条目（Review.aiComments 的元素结构） */
export interface ReviewCommentItem {
  aspect: string
  issue: string
  suggestion: string
  excerpt?: string
}

/** Review 记录（GET /api/novels/[id]/review 列表项） */
export interface ReviewRecord {
  id: string
  novelId: string
  targetType: ReviewTargetType
  targetId: string
  aiScore: number | null
  aiComments: unknown
  humanStatus: ReviewHumanStatus
  humanComment: string | null
  createdAt: string
}

/** 把 DB 中的 aiComments Json 规整为意见条目数组 */
export function normalizeReviewComments(raw: unknown): ReviewCommentItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      aspect: typeof x.aspect === "string" ? x.aspect : "综合",
      issue: typeof x.issue === "string" ? x.issue : "",
      suggestion: typeof x.suggestion === "string" ? x.suggestion : "",
      ...(typeof x.excerpt === "string" && x.excerpt ? { excerpt: x.excerpt } : {}),
    }))
}
