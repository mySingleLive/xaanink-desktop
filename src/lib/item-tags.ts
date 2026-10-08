/**
 * 物品标签：自由分类词（「法宝」「金手指」「成长型」等短词），字符串数组。
 * 存储为 Item.tags Json，本模块是规整逻辑的唯一来源（纯 TS，零依赖），
 * 写法对齐 src/lib/aliases.ts 的 normalizeAliases。
 */

/** 单个标签最大长度 */
export const ITEM_TAG_MAX = 20
/** 标签数量上限 */
export const ITEM_TAGS_MAX = 8

/** 把 DB/AI 输出中的 tags 规整为字符串数组（去非字符串、去空白、去重、限额） */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const tags: string[] = []
  for (const x of raw) {
    if (typeof x !== "string") continue
    const t = x.trim().slice(0, ITEM_TAG_MAX)
    if (t && !tags.includes(t)) tags.push(t)
    if (tags.length >= ITEM_TAGS_MAX) break
  }
  return tags
}
