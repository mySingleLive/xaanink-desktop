import { ContentError, requireVersion } from "@/lib/content-errors"
import { hardContentChecks } from "@/lib/content-policy"
import { prisma } from "@/lib/db"
import { countChineseWords } from "@/lib/text"
import { REDRAW_WORD_LIMIT } from "@/lib/draw-redraw"
import { wordRequirementSchema } from "@/lib/word-requirement"
import { prepareChapterGeneration, consumeChapterGeneration } from "./chapter"
import { getContentCandidate } from "./content-candidate"
import { assessChapterNarrative, narrativeGateMessage, type NarrativeAssessment } from "./narrative-assessment"
import { ownedChapter } from "./content-commit"
import type { ChapterScope } from "./chapter-history"
import { assertChapterOutlineEvidence } from "./story-workflow"

/**
 * 正文抽卡：一次为章节并发生成 N 份（默认 3）差异化候选稿，全部保留待作者选稿。
 * 候选落库一律复用既有候选链（硬检查/字数闸/operationId 幂等），不自动采用、不绕过提交边界。
 */

export const DRAW_DEFAULT_COUNT = 3
export const DRAW_MAX_COUNT = 5

export interface DrawVariant { key: string; label: string; hint: string }

/** 首次抽卡：同一章纲下的三种写法角度 */
export const FRESH_VARIANTS: DrawVariant[] = [
  { key: "immersive", label: "沉浸氛围", hint: "环境与感官描写先行，节奏偏缓，重视场景质感与氛围铺垫；事件照常发生，但让读者先「进到场景里」。" },
  { key: "plot", label: "情节推进", hint: "事件密度优先，冲突与信息前置，段落短促有力；氛围描写收敛到刚好支撑事件，避免大段铺陈。" },
  { key: "character", label: "人物张力", hint: "以对话、动作与心理为主轴推动同样的剧情，突出人物关系与立场碰撞；环境与事件经过服务于人物表现。" },
]

/** 改进抽卡：以所选候选为底稿的三个改进方向 */
export const IMPROVE_VARIANTS: DrawVariant[] = [
  { key: "polish", label: "忠实润色", hint: "保留底稿的段落结构与剧情安排，逐段修订语言、节奏与描写精度，落实作者意见。" },
  { key: "restructure", label: "结构重组", hint: "保留底稿可用素材，按章纲重新组织段落顺序、视角分配与详略，落实作者意见。" },
  { key: "bold", label: "大胆重写", hint: "只守章纲约束与作者意见，不被底稿写法束缚，重新取材重写；可保留底稿中确实出彩的片段。" },
]

export interface DrawChapterInput {
  scope: ChapterScope
  expectedVersion: number
  /** 抽卡分组 id（= drawId）；每份候选的操作编号为 `${operationId}:${variant}` */
  operationId: string
  count?: number
  baseCandidateId?: string
  /** 以当前正文为底稿的改进抽卡（正文改进对话框）；与 baseCandidateId 互斥 */
  baseOnCurrent?: boolean
  feedback?: string
  /** 悬浮框设置的本批字数覆盖：只作用本批生成与候选检查，不改卷章大纲；须与 wordBudget 同传 */
  wordMin?: number
  wordBudget?: number
  sourceRunId?: string
  abortSignal?: AbortSignal
}

export interface DrawCandidateView {
  id: string
  variant: string
  label: string
  excerpt: string
  wordCount: number
  status: string
  hardChecks: string[]
}

export interface DrawChapterResult {
  drawId: string
  chapterId: string
  chapterTitle: string
  wordMin: number
  wordBudget: number
  /** 改进抽卡的底稿：候选稿（候选改进）或当前正文（正文改进对话框）；首次抽卡为 null */
  basedOn: { kind: "candidate"; candidateId: string; feedback: string } | { kind: "current"; feedback: string } | null
  candidates: DrawCandidateView[]
  failures: { variant: string; label: string; reason: string }[]
}

export type DrawChapterOutcome =
  | { ready: true; result: DrawChapterResult }
  | { ready: false; assessment: NarrativeAssessment; message: string }

const ALL_VARIANT_LABELS = new Map([...FRESH_VARIANTS, ...IMPROVE_VARIANTS].map(v => [v.key, v.label]))

/** 读取本章最近一次抽卡的真实候选状态（选稿前的状态核对与卡片就地重现）；无抽卡记录返回 null。 */
export async function getChapterDrawState(scope: ChapterScope): Promise<DrawChapterResult | null> {
  const chapter = await ownedChapter(prisma, scope.userId, scope.novelId, scope.chapterId)
  const latest = await prisma.contentCandidate.findFirst({ where: { userId: scope.userId, novelId: scope.novelId, chapterId: scope.chapterId, drawId: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
  if (!latest?.drawId) return null
  const rows = await prisma.contentCandidate.findMany({ where: { userId: scope.userId, novelId: scope.novelId, chapterId: scope.chapterId, drawId: latest.drawId }, orderBy: [{ iteration: "asc" }, { createdAt: "asc" }, { id: "asc" }] })
  const assessment = await assessChapterNarrative(scope)
  const basedOnId = rows.find(r => r.basedOnCandidateId)?.basedOnCandidateId
  // 改进批次识别：变体键命中改进角度池（正文改进对话框的底稿=当前正文，无 basedOnCandidateId）
  const improveBatch = rows.some(r => IMPROVE_VARIANTS.some(v => v.key === r.variant))
  // 本批字数档：候选带 wordRequirement（悬浮框覆盖批次为覆盖值）时以候选为准，否则回退当前规划档——
  // 保证覆盖批次「就地重现」时字数档徽标与抽卡时一致
  const batchRequirement = rows.map(row => wordRequirementSchema.safeParse(row.wordRequirement)).find(parsed => parsed.success && parsed.data.kind === "range")
  const wordRange = batchRequirement?.success && batchRequirement.data.kind === "range" ? batchRequirement.data : null
  return {
    drawId: latest.drawId,
    chapterId: scope.chapterId,
    chapterTitle: chapter.title,
    wordMin: wordRange?.min ?? assessment.wordMin,
    wordBudget: wordRange?.max ?? assessment.wordBudget,
    basedOn: basedOnId ? { kind: "candidate", candidateId: basedOnId, feedback: "" } : improveBatch ? { kind: "current", feedback: "" } : null,
    candidates: rows.map(row => ({
      id: row.id,
      variant: row.variant ?? "",
      label: ALL_VARIANT_LABELS.get(row.variant ?? "") ?? row.variant ?? "候选",
      excerpt: row.content.replace(/\s+/g, " ").trim().slice(0, 160),
      wordCount: countChineseWords(row.content),
      status: row.status,
      hardChecks: hardContentChecks(row.checks).map(c => c.message),
    })),
    failures: [],
  }
}

export async function drawChapterCandidates(input: DrawChapterInput): Promise<DrawChapterOutcome> {
  requireVersion(input.expectedVersion)
  if (!input.operationId) throw new ContentError("INVALID_OPERATION", "缺少抽卡操作编号", 400)
  if ((input.wordMin === undefined) !== (input.wordBudget === undefined)) throw new ContentError("INVALID_INPUT", "wordMin 与 wordBudget 须同时提供", 400)
  const wordRange = input.wordMin !== undefined && input.wordBudget !== undefined ? { min: input.wordMin, budget: input.wordBudget } : null
  if (wordRange && (!Number.isInteger(wordRange.min) || !Number.isInteger(wordRange.budget) || wordRange.min < 1 || wordRange.min > wordRange.budget || wordRange.budget > REDRAW_WORD_LIMIT)) {
    throw new ContentError("INVALID_INPUT", `本批字数范围须为 1 ≤ 下限 ≤ 上限 ≤ ${REDRAW_WORD_LIMIT} 的整数`, 400)
  }
  const count = Math.min(Math.max(1, Math.round(input.count ?? DRAW_DEFAULT_COUNT)), DRAW_MAX_COUNT)
  const assessment = await assessChapterNarrative(input.scope)
  if (assessment.status !== "ready") return { ready: false, assessment, message: narrativeGateMessage(assessment) }
  await assertChapterOutlineEvidence(input.scope)

  let basedOn: DrawChapterResult["basedOn"] = null
  let baseContent: string | null = null
  if (input.baseOnCurrent && input.baseCandidateId) throw new ContentError("INVALID_INPUT", "baseOnCurrent 与 baseCandidateId 互斥，只能指定一种底稿", 400)
  if (input.baseCandidateId) {
    const candidate = await getContentCandidate(input.scope, input.baseCandidateId)
    if (!["ready", "needs_review", "accepted", "withdrawn"].includes(candidate.status)) throw new ContentError("CANDIDATE_UNAVAILABLE", "底稿候选尚未完整生成，不能作为改进底稿", 409)
    baseContent = candidate.content
    basedOn = { kind: "candidate", candidateId: candidate.id, feedback: input.feedback?.trim() ?? "" }
  } else if (input.baseOnCurrent) {
    const chapter = await ownedChapter(prisma, input.scope.userId, input.scope.novelId, input.scope.chapterId)
    if (!chapter.content.trim()) throw new ContentError("EMPTY_BASE_CONTENT", "当前正文为空，不能作为改进底稿", 409)
    baseContent = chapter.content
    basedOn = { kind: "current", feedback: input.feedback?.trim() ?? "" }
  }

  const pool = baseContent !== null ? IMPROVE_VARIANTS : FRESH_VARIANTS
  const variants = Array.from({ length: count }, (_, i) => pool[i % pool.length])
  const feedback = input.feedback?.trim()
  // 批次幂等：operationId 由调用参数决定（同轮同参重试得到同一 drawId）。
  // 中断恢复的重试按变体 operationId 重放既有候选，只补生成缺失变体——不重新生成、不产生重复批次。
  const variantOperationIds = variants.map((variant, i) => {
    const round = Math.floor(i / pool.length)
    return `${input.operationId}:${variant.key}${round > 0 ? `-${round + 1}` : ""}`
  })
  const priorRows = await prisma.contentCandidate.findMany({ where: { userId: input.scope.userId, chapterId: input.scope.chapterId, operationId: { in: variantOperationIds } } })
  const priorByOperation = new Map(priorRows.map(row => [row.operationId, row]))
  const results = await Promise.allSettled(
    variants.map(async (variant, i) => {
      // 候选份数超过角度池时循环角度：操作编号带轮次后缀避免幂等坍缩，提示语加自由度
      const round = Math.floor(i / pool.length)
      const operationId = variantOperationIds[i]
      const prior = priorByOperation.get(operationId)
      if (prior) {
        return {
          id: prior.id,
          variant: variant.key,
          label: variant.label,
          excerpt: prior.content.replace(/\s+/g, " ").trim().slice(0, 160),
          wordCount: countChineseWords(prior.content),
          status: prior.status,
          hardChecks: hardContentChecks(prior.checks).map(c => c.message),
        } satisfies DrawCandidateView
      }
      const variantHint = `写作角度「${variant.label}」：${variant.hint}${round > 0 ? `\n这是同一角度的第 ${round + 1} 份候选：在遵守本角度方向的前提下，换一种切入、开头或段落组织，与同角度其他候选拉开差异。` : ""}`
      const guidance = baseContent !== null
        ? `【底稿（第 ${i + 1} 份候选以此为底）】\n${baseContent}\n\n【作者改进意见】\n${feedback?.trim() || "（作者未给具体意见：按本角度方向自行判断最需要改进之处）"}`
        : feedback ? `作者对本章写作的要求：${feedback}` : undefined
      const prepared = await prepareChapterGeneration(input.scope.chapterId, input.scope.userId, {
        expectedVersion: input.expectedVersion,
        operationId,
        sourceRunId: input.sourceRunId,
        abortSignal: input.abortSignal,
        guidance,
        variantHint,
        candidate: { drawId: input.operationId, variant: variant.key, basedOnCandidateId: basedOn?.kind === "candidate" ? basedOn.candidateId : undefined, iteration: i },
        progressKey: `chapter-draw:${input.operationId}:${variant.key}${round > 0 ? `-${round + 1}` : ""}`,
        ...(wordRange ? { wordRange } : {}),
      })
      const done = await consumeChapterGeneration(prepared)
      const candidate = done.candidate
      return {
        id: candidate.id,
        variant: variant.key,
        label: variant.label,
        excerpt: candidate.excerpt,
        wordCount: candidate.wordCount,
        status: candidate.status,
        hardChecks: hardContentChecks(candidate.checks).map(c => c.message),
      } satisfies DrawCandidateView
    }),
  )

  const candidates: DrawCandidateView[] = []
  const failures: DrawChapterResult["failures"] = []
  results.forEach((settled, i) => {
    if (settled.status === "fulfilled") candidates.push(settled.value)
    else failures.push({ variant: variants[i].key, label: variants[i].label, reason: settled.reason instanceof Error ? settled.reason.message : "生成失败" })
  })
  if (!candidates.length) {
    throw new ContentError("DRAW_FAILED", `本组 ${count} 份候选全部生成失败：${failures.map(f => `${f.label}（${f.reason}）`).join("；")}`, 502)
  }
  return {
    ready: true,
    result: {
      drawId: input.operationId,
      chapterId: input.scope.chapterId,
      chapterTitle: assessment.chapterTitle,
      wordMin: wordRange?.min ?? assessment.wordMin,
      wordBudget: wordRange?.budget ?? assessment.wordBudget,
      basedOn,
      candidates,
      failures,
    },
  }
}
