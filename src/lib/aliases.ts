/**
 * 角色别名/外号：昵称性质的别称（「老陈」「沉默的大多数」），字符串数组。
 * 注意边界：别名是同一个角色的称呼，不是多重身份——同一个人物的不同身份
 * （本名/化名/马甲/代号）仍按 chat.system 约定建成多个角色。
 * 存储为 Character.aliases Json，本模块是规整逻辑的唯一来源（纯 TS，零依赖）。
 */

/** 单个别名最大长度 */
export const ALIAS_MAX = 50
/** 别名数量上限 */
export const ALIASES_MAX = 10

/** 把 DB/AI 输出中的 aliases 规整为字符串数组（去非字符串、去空白、去重、限额） */
export function normalizeAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const aliases: string[] = []
  for (const x of raw) {
    if (typeof x !== "string") continue
    const t = x.trim().slice(0, ALIAS_MAX)
    if (t && !aliases.includes(t)) aliases.push(t)
    if (aliases.length >= ALIASES_MAX) break
  }
  return aliases
}
