import { z } from "zod"

const count = z.number().int().min(1).max(200000)
export const wordRequirementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("target"), target: count }),
  z.object({ kind: z.literal("range"), min: count, max: count }),
  z.object({ kind: z.literal("minimum"), min: count }),
]).refine(value => value.kind !== "range" || value.min <= value.max, "字数范围的下限不能大于上限")
export type WordRequirement = z.infer<typeof wordRequirementSchema>
export function wordBounds(value: WordRequirement) {
  return value.kind === "target" ? { min: Math.ceil(value.target * 85 / 100), max: Math.floor(value.target * 115 / 100) }
    : value.kind === "range" ? { min: value.min, max: value.max } : { min: value.min, max: null }
}
export function wordRequirementLabel(value: WordRequirement) {
  const bounds = wordBounds(value)
  return value.kind === "target" ? `目标 ${value.target} 字（${bounds.min}–${bounds.max} 字）` : value.kind === "minimum" ? `至少 ${value.min} 字` : `${value.min}–${value.max} 字`
}

function parseCount(raw: string) {
  const text = raw.replace(/[,，]/g, "")
  const decimal = text.match(/^(\d+(?:\.\d+)?)([千kK万]?)$/)
  if (decimal) return Math.round(Number(decimal[1]) * (decimal[2] === "万" ? 10000 : decimal[2] ? 1000 : 1))
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0, section = 0, digit = 0
  for (const char of text) {
    if (char in digits) digit = digits[char]
    else if (char === "万") { total += (section + digit || 1) * 10000; section = 0; digit = 0 }
    else if (char in units) { section += (digit || 1) * units[char]; digit = 0 }
  }
  return total + section + digit
}
const amount = "([0-9][0-9,，]*(?:\\.[0-9]+)?[千kK万]?|[零〇一二两三四五六七八九十百千万]+)"
/** 仅由服务端传入本轮作者消息/章纲；工具不能通过传较低目标覆盖作者要求。 */
export function inferWordRequirement(authorText: string, outline: string, previousWords: number): { requirement: WordRequirement; compressionAuthorized: boolean; source: "author" | "outline" | "baseline" } {
  for (const [source, rawText] of [["author", authorText], ["outline", outline]] as const) {
    const text = rawText.replace(/(?:不要|不许|不得|禁止)\s*(?:压缩|缩写|缩短|精简)[^。！？\n，,；;]*/g, "").replace(/(?:不要低于|不要少于)/g, "至少")
    const range = [...text.matchAll(new RegExp(`${amount}\\s*(?:[~～—–-]|到|至)\\s*${amount}\\s*字`, "g"))].at(-1)
    const minimum = [...text.matchAll(new RegExp(`(?:至少|不少于|不低于|最低)\\s*${amount}\\s*字`, "g"))].at(-1)
    const target = [...text.matchAll(new RegExp(`${amount}\\s*字`, "g"))].at(-1)
    const options = [
      ...(range ? [{ end: range.index! + range[0].length, priority: 2, value: { kind: "range", min: parseCount(range[1]), max: parseCount(range[2]) } }] : []),
      ...(minimum ? [{ end: minimum.index! + minimum[0].length, priority: 1, value: { kind: "minimum", min: parseCount(minimum[1]) } }] : []),
      ...(target ? [{ end: target.index! + target[0].length, priority: 0, value: { kind: "target", target: parseCount(target[1]) } }] : []),
    ].sort((a, b) => b.end - a.end || b.priority - a.priority)
    const raw = options[0]?.value ?? null
    const parsed = wordRequirementSchema.safeParse(raw)
    if (parsed.success) return { requirement: parsed.data, compressionAuthorized: source === "author" && /(?:压缩|缩写|缩短|精简)/.test(authorText) && !/(?:不要|不许|不得|禁止)\s*(?:压缩|缩写|缩短|精简)/.test(authorText), source }
  }
  return { requirement: { kind: "target", target: Math.max(1, previousWords || 3000) }, compressionAuthorized: false, source: "baseline" }
}
