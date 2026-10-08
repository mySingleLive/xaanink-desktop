/** 评分目标契约，供服务端、对话动作与评分 UI 共用。 */
export const SCORE_TARGET_TYPES = [
  "CHAPTER_CONTENT",
  "CHAPTER_OUTLINE",
  "VOLUME_OUTLINE",
] as const

export type ScoreTargetType = (typeof SCORE_TARGET_TYPES)[number]

/** 对话入口独立于执行状态，评审完成或中断后仍可查看原上下文。 */
export interface ScoreReviewContext {
  conversationId: string
  startedAt: string
}
