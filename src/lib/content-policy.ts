import { countChineseWords } from "@/lib/text"
import { wordBounds, wordRequirementLabel, type WordRequirement } from "@/lib/word-requirement"

export type CandidateStatus = "incomplete" | "reviewing" | "ready" | "needs_review" | "accepted" | "discarded" | "withdrawn"
export interface ContentCheck {
  code: "INCOMPLETE" | "EMPTY" | "TOO_LONG" | "UNKNOWN_FINISH" | "SHORTENED" | "UNDER_TARGET" | "OVER_TARGET" | "SUSPICIOUS_ENDING" | "CONSISTENCY" | "COMMENT_ACTION" | "REVIEW_FAILED"
  message: string
  hard: boolean
}

/** 候选 checks（JSON 列）里的硬性检查项；宽松解析，坏数据按无硬性项处理。 */
export function hardContentChecks(checks: unknown): ContentCheck[] {
  if (!Array.isArray(checks)) return []
  return checks.filter((c): c is ContentCheck => !!c && typeof c === "object" && (c as ContentCheck).hard === true && typeof (c as ContentCheck).message === "string")
}

/** 仅衡量可证实的完成状态与篇幅风险，不声称能判断文学完整性。 */
export function checkGeneratedContent(input: {
  content: string
  previousContent: string
  finishReason?: string | null
  targetWordCount?: number
  wordRequirement?: WordRequirement
  /** 来自已验证的作者动作，模型工具不能自行设置。 */
  compressionAuthorized?: boolean
}): { status: "incomplete" | "ready" | "needs_review"; checks: ContentCheck[]; wordCount: number; previousWordCount: number } {
  const wordCount = countChineseWords(input.content)
  const previousWordCount = countChineseWords(input.previousContent)
  const checks: ContentCheck[] = []
  if (input.content.length > 200000) checks.push({ code: "TOO_LONG", hard: true, message: "候选超过单章长度上限，未替换原稿" })
  if (!wordCount) checks.push({ code: "EMPTY", hard: true, message: "未收到正文，原稿保留" })
  if (["length", "error", "abort", "content-filter"].includes(input.finishReason ?? "")) {
    checks.push({ code: "INCOMPLETE", hard: true, message: "生成未完整结束，原稿保留" })
  } else if (input.finishReason !== "stop" && input.finishReason !== "tool-calls") {
    checks.push({ code: "UNKNOWN_FINISH", hard: false, message: "完整性待检查，尚未确认生成结束" })
  }
  if (previousWordCount > 0 && wordCount < previousWordCount * 0.7 && !input.compressionAuthorized) {
    checks.push({ code: "SHORTENED", hard: false, message: `由 ${previousWordCount} 字缩短为 ${wordCount} 字，请检查差异` })
  }
  const requirement = input.wordRequirement ?? (input.targetWordCount ? { kind: "target" as const, target: input.targetWordCount } : undefined)
  if (requirement) {
    const { min, max } = wordBounds(requirement)
    if (wordCount < min) checks.push({ code: "UNDER_TARGET", hard: false, message: `实际 ${wordCount} 字，未达到${wordRequirementLabel(requirement)}` })
    if (max !== null && wordCount > max) checks.push({ code: "OVER_TARGET", hard: false, message: `实际 ${wordCount} 字，超过${wordRequirementLabel(requirement)}` })
  }
  if (wordCount && !/[。！？.!?…—」』”’）)\]】*_`]$/.test(input.content.trimEnd())) {
    checks.push({ code: "SUSPICIOUS_ENDING", hard: false, message: "结尾可能未完句，请查看末段" })
  }
  return { status: checks.some(c => c.hard) ? "incomplete" : checks.length ? "needs_review" : "ready", checks, wordCount, previousWordCount }
}
