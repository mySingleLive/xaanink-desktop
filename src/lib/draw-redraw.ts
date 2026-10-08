/**
 * 抽卡「换一批」共享定义（纯模块，客户端/服务端均可引用）：
 * 注入选项标签、固定回答/指令文案拼装、悬浮框设置默认值。
 * 文案是参谋路由换一批的协议——修改需同步 chat.system 三点十的换一批条款。
 */

import type { DrawChapterResult } from "@/lib/services/chapter-draw"

/** 从工具 output 提取抽卡结果（形状守卫：draw 缺失或字段不符时返回 null）；服务端路由与客户端组卡共用（纯函数，本章仅类型引用服务层） */
export function drawResultOf(output: unknown): DrawChapterResult | null {
  if (!output || typeof output !== "object") return null
  const draw = (output as { draw?: unknown }).draw
  if (!draw || typeof draw !== "object") return null
  const d = draw as Partial<DrawChapterResult>
  if (typeof d.drawId !== "string" || typeof d.chapterId !== "string" || typeof d.chapterTitle !== "string") return null
  if (!Array.isArray(d.candidates)) return null
  return draw as DrawChapterResult
}

/** 问答面板注入行标签 */
export const REDRAW_DIRECT_LABEL = "直接换一批"
export const REDRAW_REQUIRE_LABEL = "根据要求换一批"

/** 悬浮框设置：抽卡数量与字数范围（count 上限与 DRAW_MAX_COUNT 对齐） */
export interface DrawRedrawSettings {
  count: number
  wordMin: number
  wordBudget: number
}

export const REDRAW_DEFAULT_COUNT = 3
export const REDRAW_MAX_COUNT = 5
export const REDRAW_WORD_LIMIT = 20000

/** 悬浮框字数校验：1 ≤ 下限 ≤ 上限 ≤ 20000 */
export function redrawWordRangeError(wordMin: number, wordBudget: number): string | null {
  if (!Number.isInteger(wordMin) || !Number.isInteger(wordBudget) || wordMin < 1) return "字数须为不小于 1 的整数"
  if (wordMin > wordBudget) return "下限不能大于上限"
  if (wordBudget > REDRAW_WORD_LIMIT) return `上限不能超过 ${REDRAW_WORD_LIMIT.toLocaleString()} 字`
  return null
}

/** 「直接换一批」选项与组卡按钮（作答时）共用的回答文案；字数设置与本章规划档不同时附带覆盖说明 */
export function redrawDirectAnswer(settings?: Partial<DrawRedrawSettings>, defaults?: { wordMin: number; wordBudget: number }): string {
  const count = settings?.count ?? REDRAW_DEFAULT_COUNT
  const wordClause = defaults && settings?.wordMin !== undefined && settings.wordBudget !== undefined && (settings.wordMin !== defaults.wordMin || settings.wordBudget !== defaults.wordBudget)
    ? `，字数调整为 ${settings.wordMin}～${settings.wordBudget} 字（仅本批）`
    : ""
  return `${REDRAW_DIRECT_LABEL}（不附带改进要求，重新抽 ${count} 张候选稿${wordClause}）`
}

/** 「根据要求换一批」选项的回答文案：不带底稿、feedback=作者要求 */
export function redrawRequireAnswer(requirement: string): string {
  return `${REDRAW_REQUIRE_LABEL}：${requirement}（按此要求重新抽 ${REDRAW_DEFAULT_COUNT} 张候选稿，不以现有候选为底稿）`
}

/**
 * 组卡按钮（无待答问答时）的换一批指令。
 * 设置非默认（数量≠3 / 字数≠本章规划档）时把覆盖写进指令，参谋据提示词传 count / wordMin / wordBudget。
 */
export function redrawInstruction(chapterTitle: string, defaults: { wordMin: number; wordBudget: number }, settings: DrawRedrawSettings): string {
  const parts = [`【换一批】《${chapterTitle}》候选稿：不附带改进要求、不以现有候选为底稿，重新抽 ${settings.count} 张候选稿。`]
  if (settings.wordMin !== defaults.wordMin || settings.wordBudget !== defaults.wordBudget) {
    parts.push(`字数范围调整为 ${settings.wordMin}～${settings.wordBudget} 字（仅本批候选，不改卷章大纲）。`)
  }
  return parts.join("")
}
