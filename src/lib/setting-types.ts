import type { SettingType } from "@/generated/prisma/enums"

/**
 * 设定的作用域划分：
 * - 世界级：挂在某个世界（World）下，世界观设定的一部分，可按需添加
 * - 小说级：整本小说共享（金手指/文风设定），Setting.worldId 为 NULL
 */
export const WORLD_SETTING_TYPES = [
  "LEVEL_SYSTEM",
  "POWER_SYSTEM",
  "CONCEPT",
  "FACTION",
  "MAP",
  "SOCIETY",
  "CULTURE",
  "GEOGRAPHY",
  "WORLD_HISTORY",
] as const satisfies readonly SettingType[]

export const NOVEL_SETTING_TYPES = ["GOLD_FINGER", "STYLE"] as const satisfies readonly SettingType[]

/** 整本小说唯一、不可增删的设定类型（文风设定）：面板不提供列表、新增与删除入口 */
export const SINGLETON_SETTING_TYPES = ["STYLE"] as const satisfies readonly SettingType[]

export type WorldSettingType = (typeof WORLD_SETTING_TYPES)[number]

export function isWorldSettingType(type: SettingType): type is WorldSettingType {
  return (WORLD_SETTING_TYPES as readonly SettingType[]).includes(type)
}

export function isSingletonSettingType(type: SettingType): boolean {
  return (SINGLETON_SETTING_TYPES as readonly SettingType[]).includes(type)
}

/** 设定分类对外标签（MAP 对外称「世界地图」，枚举值不变） */
export const SETTING_TYPE_LABELS: Record<SettingType, string> = {
  LEVEL_SYSTEM: "等级体系",
  POWER_SYSTEM: "力量体系",
  CONCEPT: "概念体系",
  GOLD_FINGER: "金手指",
  STYLE: "文风设定",
  MAP: "世界地图",
  FACTION: "势力分布",
  SOCIETY: "社会环境",
  CULTURE: "人文环境",
  GEOGRAPHY: "地理环境",
  WORLD_HISTORY: "世界历史",
}
