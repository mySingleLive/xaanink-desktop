import { TOUCH_KIND_LABELS } from "./foreshadow"
import type { ForeshadowDTO } from "./services/foreshadow"

/** 只压缩展示文本，不改写伏笔档案。优先保留完整的一至两句。 */
export function foreshadowBrief(content: string) {
  const plain = content.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim()
  if (!plain) return "尚未填写伏笔简介"
  const sentences = plain.match(/[^。！？.!?]+[。！？.!?]*/gu) ?? [plain]
  const two = sentences.slice(0, 2).join("").trim()
  if (Array.from(two).length <= 88) return two
  const first = sentences[0].trim()
  if (Array.from(first).length <= 88) return first
  return Array.from(first).slice(0, 87).join("").replace(/[，、；：,;:\s]+$/u, "") + "…"
}

/** 分类覆盖该伏笔全部触点；同一位置的不同选区不能互相吞掉。 */
export function foreshadowReferenceGroups(foreshadow: Pick<ForeshadowDTO, "touches">) {
  return (["PLANT", "MENTION", "PAYOFF"] as const).flatMap(kind => {
    const seen = new Set<string>()
    const entries = foreshadow.touches.filter(touch => touch.kind === kind).flatMap(touch => touch.references.flatMap(reference => {
      if (seen.has(reference.id)) return []
      seen.add(reference.id)
      return [{ touch, reference }]
    }))
    return entries.length ? [{ kind, label: TOUCH_KIND_LABELS[kind], entries }] : []
  })
}
