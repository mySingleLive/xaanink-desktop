import type { AnchorLike, TextAnchor } from "./comment-anchor"

export const REFERENCE_TARGET_LABELS = {
  CHAPTER_OUTLINE: "大纲", CHAPTER_CONTENT: "正文",
} as const
export type ReferenceTargetType = keyof typeof REFERENCE_TARGET_LABELS
export interface ForeshadowTarget { novelId: string; targetType: ReferenceTargetType; targetId: string }
export interface ForeshadowReferenceDTO extends AnchorLike {
  id: string; touchId: string; targetType: ReferenceTargetType; targetId: string
  label: string; missing: boolean
  anchor: TextAnchor | null; status: "located" | "unlocated" | "changed" | "missing"
  anchorSource: "selection" | "summary" | "evidence" | null
  updatedAt: string
}

/** 重复摘录不能沿用旧偏移盲选；上下文得分必须唯一。 */
export function resolveReferenceAnchor(text: string, ref: AnchorLike): TextAnchor | null {
  if (!ref.quote) return null
  const candidates: { start: number; end: number; score: number }[] = []
  let from = 0
  while (from <= text.length) {
    const start = text.indexOf(ref.quote, from)
    if (start < 0) break
    const end = start + ref.quote.length
    let score = 0
    const before = text.slice(Math.max(0, start - (ref.prefix?.length ?? 0)), start)
    const after = text.slice(end, end + (ref.suffix?.length ?? 0))
    for (let i = 1; i <= Math.min(before.length, ref.prefix?.length ?? 0); i++) {
      if (before.at(-i) !== ref.prefix?.at(-i)) break
      score++
    }
    for (let i = 0; i < Math.min(after.length, ref.suffix?.length ?? 0); i++) {
      if (after[i] !== ref.suffix?.[i]) break
      score++
    }
    candidates.push({ start, end, score }); from = start + 1
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score)
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null
  const { start, end } = candidates[0]
  return { start, end }
}

/** 将重叠引用切成不相交区间；每一段保留所有关联 id。 */
export function referenceSegments(refs: { id: string; anchor: TextAnchor | null }[]) {
  const points = [...new Set(refs.flatMap(r => r.anchor ? [r.anchor.start, r.anchor.end] : []))].sort((a,b)=>a-b)
  return points.slice(0, -1).flatMap((start, i) => {
    const end = points[i + 1]
    const ids = refs.filter(r => r.anchor && r.anchor.start <= start && r.anchor.end >= end).map(r => r.id)
    return ids.length ? [{ start, end, ids }] : []
  })
}
