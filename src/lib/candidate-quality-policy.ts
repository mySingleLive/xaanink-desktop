import type { ContentCheck } from "./content-policy"

export interface ComparableReview { id: string; score: number; contentHash: string; reviewConfigHash: string; criticalKeys: string[] }
export interface CandidateDecision { autoAccept: boolean; comparable: boolean; baselineScore: number | null; candidateScore: number | null; reasons: string[] }
/** 分数只比较同一口径和不可变稿件；任何降分都保留当前稿。 */
export function decideCandidate(input: {
  baseHash: string; candidateHash: string; reviewConfigHash: string; checks: ContentCheck[]
  baseline: ComparableReview | null; candidate: ComparableReview | null; authorAuthorized: boolean; currentMatches: boolean
}): CandidateDecision {
  const { baseline, candidate } = input
  const comparable = !!baseline && !!candidate && baseline.contentHash === input.baseHash && candidate.contentHash === input.candidateHash && baseline.reviewConfigHash === input.reviewConfigHash && candidate.reviewConfigHash === input.reviewConfigHash
  const reasons = input.checks.map(check => check.message)
  if (!input.currentMatches) reasons.push("当前稿已有变化，候选须重新比较")
  if (!input.authorAuthorized) reasons.push("等待作者决定是否采用")
  if (!comparable) reasons.push("缺少同一配置、对应版本的可比较评分")
  else {
    if (candidate.score < baseline.score) reasons.push(`候选评分由 ${baseline.score} 降为 ${candidate.score}，当前稿保留`)
    if (candidate.criticalKeys.some(key => !baseline.criticalKeys.includes(key))) reasons.push("候选新增了有出处的关键一致性问题")
  }
  return { autoAccept: reasons.length === 0, comparable, baselineScore: baseline?.score ?? null, candidateScore: candidate?.score ?? null, reasons }
}
