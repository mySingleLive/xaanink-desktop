/**
 * 性格标签：纯性格描述词（「内向」「腼腆」「护短」「INTP」等短词），
 * 与 Character.personality（人物描述：总体上是怎样一个人）分工。
 * 存储为 Character.personalityTags 字符串数组，本模块是规整逻辑的唯一来源。
 */

/** 单个标签最大长度 */
export const PERSONALITY_TAG_MAX = 30
/** 标签数量上限 */
export const PERSONALITY_TAGS_MAX = 20

/** 把 DB/AI 输出中的 personalityTags 规整为字符串数组（去非字符串、去空白、去重） */
export function normalizePersonalityTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const tags: string[] = []
  for (const x of raw) {
    if (typeof x !== "string") continue
    const t = x.trim()
    if (t && !tags.includes(t)) tags.push(t)
  }
  return tags
}
