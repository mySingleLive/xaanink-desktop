import { z } from "zod"

/** AI 评审意见条目（落库到 Review.aiComments 的 Json 结构） */
export interface ReviewCommentItem {
  aspect: string
  issue: string
  suggestion: string
  excerpt?: string
  /** 结构性硬伤（如叙事线符合度不达标）：总分再高也阻塞通过 */
  blocking?: boolean
}

/** 评审结构化输出 schema（review.outline/review.chapter 同形） */
export const aiReviewSchema = z.object({
  score: z.number().min(0).max(100),
  /** 多维度评分（2026-09 悬浮评分指示器）：逐维 0~100，维度名与模板检查项一致 */
  dimensions: z
    .array(
      z.object({
        dimension: z.string(),
        score: z.number().min(0).max(100),
      })
    )
    .default([]),
  comments: z
    .array(
      z.object({
        // 模板输出字段为 dimension，兼容 aspect 命名
        aspect: z.string().optional(),
        dimension: z.string().optional(),
        issue: z.string().default(""),
        suggestion: z.string().default(""),
        excerpt: z.string().nullish().transform(value => value ?? undefined).optional(),
        blocking: z.boolean().optional(),
      })
    )
    .default([]),
  /**
   * 伏笔触点评价（2026-09 伏笔运营维度）：评审范围内出现的伏笔触点逐条打分，
   * 服务层按标题+摘要模糊匹配触点回填评分（匹配不上静默丢弃）
   */
  foreshadowEvaluations: z
    .array(
      z.object({
        foreshadowTitle: z.string(),
        touchKind: z.enum(["PLANT", "MENTION", "PAYOFF"]).optional(),
        touchSummary: z.string().default(""),
        score: z.number().min(0).max(100),
        comment: z.string().default(""),
      })
    )
    .default([]),
})

/** AI 评审结构化输出类型（judgeFn/独立评审/工具层共用，含 dimensions 维度分） */
export type AiReviewData = z.infer<typeof aiReviewSchema>

/**
 * judgeFn DI 桩的返回类型：zod default 字段（comments/dimensions/foreshadowEvaluations）
 * 在 in 侧可选，测试桩只给 score/dimensions/comments 即可；运行时经 judgeToLoopResult 消费。
 */
export type AiReviewInput = z.input<typeof aiReviewSchema>

export function normalizeComments(raw: z.infer<typeof aiReviewSchema>["comments"]): ReviewCommentItem[] {
  return raw.map((c) => ({
    aspect: c.aspect ?? c.dimension ?? "综合",
    issue: c.issue,
    suggestion: c.suggestion,
    ...(c.excerpt ? { excerpt: c.excerpt } : {}),
    ...(c.blocking ? { blocking: true } : {}),
  }))
}
