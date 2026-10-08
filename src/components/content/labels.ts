import type {
  NovelStage,
  SettingType,
  AttributeTarget,
  AttributeValueType,
  CharacterRoleType,
  ChapterStatus,
  ReviewHumanStatus,
} from "@/generated/prisma/enums"

import { NOVEL_SETTING_TYPES, WORLD_SETTING_TYPES } from "@/lib/setting-types"

import type { TabType } from "@/stores/tabs"

// 设定分类标签与作用域划分的唯一权威来源在 @/lib/setting-types（服务端/AI 共用），此处转供 UI 使用
export { SETTING_TYPE_LABELS } from "@/lib/setting-types"

/** 世界级设定分类（侧栏/世界面板「添加设定」的展示顺序） */
export const WORLD_SETTING_TYPE_ORDER: SettingType[] = [...WORLD_SETTING_TYPES]

/** 小说级设定分类（金手指/文风，侧栏固定节点） */
export const NOVEL_SETTING_TYPE_ORDER: SettingType[] = [...NOVEL_SETTING_TYPES]

/** 创作流程 11 个阶段（与 Prisma NovelStage 顺序一致） */
export const NOVEL_STAGES: { value: NovelStage; label: string }[] = [
  { value: "THEME", label: "主题" },
  { value: "SETTING", label: "核心设定" },
  { value: "STYLE", label: "文风" },
  { value: "CHARACTER", label: "角色" },
  { value: "TROPE", label: "爽点泪点" },
  { value: "MAP", label: "势力地图" },
  { value: "OUTLINE", label: "大纲" },
  { value: "OUTLINE_REVIEW", label: "大纲评审" },
  { value: "WRITING", label: "正文" },
  { value: "CHAPTER_REVIEW", label: "正文评审" },
  { value: "DONE", label: "完成" },
]

export const CHARACTER_ROLE_LABELS: Record<CharacterRoleType, string> = {
  PROTAGONIST: "主角",
  SUPPORTING: "配角",
  ANTAGONIST: "反派",
}

/** 属性定义适用对象标签 */
export const ATTRIBUTE_TARGET_LABELS: Record<AttributeTarget, string> = {
  CHARACTER: "角色",
  ITEM: "物品",
  SCENE: "场景",
}

/** 属性定义适用对象的展示顺序 */
export const ATTRIBUTE_TARGET_ORDER: AttributeTarget[] = ["CHARACTER", "ITEM", "SCENE"]

/** 属性值类型标签 */
export const ATTRIBUTE_VALUE_TYPE_LABELS: Record<AttributeValueType, string> = {
  TEXT: "文本",
  NUMBER: "数字",
  SELECT: "选项",
}

/** 爽点/泪点 kind 标签 */
export const TROPE_KIND_LABELS: Record<"SATISFACTION" | "TEAR", string> = {
  SATISFACTION: "爽点",
  TEAR: "泪点",
}

/** 章节状态标签 */
export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  OUTLINE: "大纲待评审",
  REVIEWED: "评审通过",
  WRITTEN: "已生成",
  CHAPTER_REVIEWED: "正文已评审",
  FINAL: "已定稿",
}

/** 人工评审状态标签 */
export const REVIEW_HUMAN_STATUS_LABELS: Record<ReviewHumanStatus, string> = {
  PENDING: "待人工确认",
  APPROVED: "已通过",
  REJECTED: "已驳回",
}

export const TAB_TYPE_LABELS: Record<TabType, string> = {
  "story-workflow": "创作进度",
  "story-review": "创作评审",
  "story-activity": "正在创作",
  novel: "小说概览",
  "novel-cover": "小说封面",
  theme: "主题",
  world: "世界",
  setting: "设定",
  attributes: "属性",
  characters: "角色",
  character: "角色",
  "character-image": "角色图像",
  items: "物品",
  item: "物品",
  "item-image": "图标",
  scenes: "场景",
  scene: "场景",
  "scene-image": "场景示意图",
  trope: "爽点/泪点",
  worldline: "世界线",
  narrative: "叙事线",
  outline: "大纲",
  "chapter-outline": "章节大纲",
  "chapter-content": "正文",
  "chapter-candidate": "候选稿",
  cascade: "级联修订",
  subagent: "子代理",
  scenario: "情景试验场",
  foreshadow: "伏笔",
}
