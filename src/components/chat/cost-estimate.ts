/**
 * 高成本操作的墨滴预估（§2.6）：前端系数表，把 askUserQuestion 传入的操作类型换算成消耗区间。
 * 系数标定依据 usage_records 实测均值（2026-08，1 token = 1 墨滴）：
 * - chapter.generate avg 43k tokens（输入 41k + 输出 2.7k，约 3000 字）→ 30k 基线 + 4/字，区间 ×0.85~×1.3
 * - outline.generate avg 3.6k，叠加对话循环的上下文开销 → 4,000 ~ 15,000
 * - 图像生成不经 recordUsage：不消耗墨滴，按张计外部 API 成本（每张约 20 秒）
 * 调整系数只改这里。
 */
export type CostEstimate =
  | { kind: "chapterContent"; wordCount?: number }
  | { kind: "characterImages"; count: number }
  | { kind: "outlineRebuild" }

const CHAPTER_BASE_TOKENS = 30_000
const CHAPTER_TOKENS_PER_WORD = 4
const CHAPTER_SPREAD: [number, number] = [0.85, 1.3]
const OUTLINE_RANGE: [number, number] = [4_000, 15_000]

const round100 = (v: number) => Math.round(v / 100) * 100

/** 操作的墨滴消耗区间；不消耗墨滴的操作（出图）返回 null */
export function estimateCostRange(e: CostEstimate): { min: number; max: number } | null {
  switch (e.kind) {
    case "chapterContent": {
      const wc = Math.min(8000, Math.max(800, Math.round(e.wordCount ?? 3000)))
      const mid = CHAPTER_BASE_TOKENS + wc * CHAPTER_TOKENS_PER_WORD
      return { min: round100(mid * CHAPTER_SPREAD[0]), max: round100(mid * CHAPTER_SPREAD[1]) }
    }
    case "outlineRebuild":
      return { min: OUTLINE_RANGE[0], max: OUTLINE_RANGE[1] }
    case "characterImages":
      return null
  }
}

/** 「35,700 ~ 54,600」；出图返回 null（面板改显示耗时与计费说明） */
export function formatCostEstimate(e: CostEstimate): string | null {
  const r = estimateCostRange(e)
  return r ? `${r.min.toLocaleString()} ~ ${r.max.toLocaleString()}` : null
}
