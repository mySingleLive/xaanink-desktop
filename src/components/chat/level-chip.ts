"use client"

/**
 * 等级引用芯片（@[设定·{设定名}/{settingId}·{等级名}]）的组装：
 * 「引用到对话」菜单与卡片拖拽共用的芯片数据源，序列格式与 AI 提示词、
 * ComposerChipHoverCard、fallbackChipData 的既有契约一致。
 * 拖拽传输通道在 chip-drag.ts（等级/角色共用）。
 */
import type { ChipData } from "./composer-editor"
import { sanitizeChipName } from "./chip-drag"

/** 组装等级引用芯片数据；levelName 传展示名（空名称由调用方先落到「未命名等级」） */
export function buildLevelChip(input: {
  settingId: string
  settingName: string
  levelName: string
}): ChipData {
  const label = sanitizeChipName(input.levelName)
  const settingName = sanitizeChipName(input.settingName)
  return {
    insertText: `@[设定·${settingName}/${input.settingId}·${label}]`,
    label,
    groupLabel: `设定·${settingName}`,
    kind: "setting",
    avatarUrl: null,
  }
}
