/**
 * 悬浮评分指示器·评分聚合（2026-09；契约 design/research/score-indicator-tech.md）：
 * 按内容目标聚合「最新综合分 + 多维度分 + 评委/读者团评价卡 + 评审历史 + 评审中标志」，
 * 供 GET /api/novels/[id]/score-report 与前端 ScoreIndicator/ScoreReportPanel 消费。
 *
 * 数据源与关联约定：
 * - 章/卷（CHAPTER_CONTENT/CHAPTER_OUTLINE/VOLUME_OUTLINE）：Review 表（aiScore/aiDimensions/aiComments）
 *   + SubAgentRun（targetType/targetId 标量列，2026-09 迁移新增）：judge 回放链接、reader 读者团卡、
 *   status=running 即「评审中」。读者团同批=同一 sopNodeRunId（runReaderPanel fan-out）。
 * - 存量 SopNodeRun.nodeId / SubAgentRun.targetType 字符串列中的故事板旧值保留不迁移；
 *   读取端经 SCORE_TARGET_TYPES 白名单自然拒绝（400）。
 * - 目标不存在抛 ReviewTargetNotFoundError（路由映射 404）；从未评审返回空态（score=null），不报错。
 */
import { prisma } from "@/lib/db"
import { ReviewTargetNotFoundError } from "@/lib/services/review"
import { VARIANT_LABELS } from "@/lib/card-select-actions"
import { contentHash } from "./content-commit"
import { chatActionSchema } from "@/lib/chat-parts"
import { SCORE_TARGET_TYPES, type ScoreTargetType, type ScoreReviewContext } from "@/lib/score-types"
import { ContentError } from "@/lib/content-errors"
import { countChineseWords } from "@/lib/text"
import { REDRAW_WORD_LIMIT } from "@/lib/draw-redraw"
import { assessChapterNarrative } from "./narrative-assessment"
import {
  dimensionItemId, reviewItemId, commentItemId,
  type ImprovementDimension, type ImprovementItem, type ImproveItemsPayload,
} from "@/lib/improve-draw"

export { SCORE_TARGET_TYPES, type ScoreTargetType } from "@/lib/score-types"

/* ------------------------------ 类型 ------------------------------ */

export function isScoreTargetType(v: string): v is ScoreTargetType {
  return (SCORE_TARGET_TYPES as readonly string[]).includes(v)
}

export interface ScoreDimension {
  dimension: string
  score: number
}

/** 评价卡条目：评委=维度+问题+建议+原文引用；读者=维度+感受 detail */
export interface ScoreAgentItem {
  aspect: string
  issue?: string
  suggestion?: string
  excerpt?: string
  detail?: string
}

export interface ScoreAgentEntry {
  kind: "judge" | "reader"
  /** 「AI 评审员」/「读者 · 小白读者」 */
  name: string
  score: number | null
  summary: string
  items: ScoreAgentItem[]
  at: string
  /** 子代理回放 tab（subagent:{runId}） */
  runId?: string
  reviewId?: string
}

export interface ScoreHistoryEntry {
  contentVersion?: number | null
  verified?: boolean
  at: string
  score: number | null
  /** 评委 / 读者团 */
  source: string
  summary: string
}

export interface ScoreReport {
  contentBinding?: { version: number; hash: string }
  candidateReports?: Array<{ candidateId: string; reviewId: string; score: number | null; at: string; reviewConfigHash: string | null }>
  /** 候选评审报告时携带：评审关联的候选 id（章级报告为 undefined） */
  candidateId?: string | null
  /** 候选稿上下文（候选评审报告时携带）：前端「按意见改进」拼 improveMessage 用；status 供已丢弃只读收口 */
  candidate?: { candidateId: string; chapterId: string; chapterTitle: string; variantLabel: string; status: string } | null
  targetType: ScoreTargetType
  targetId: string
  /** 「第 3 章《雨夜来客》正文」/「第 2 卷《风起》大纲」等 */
  targetLabel: string
  /** prose=正文类 / outline=大纲类（详情页文案用） */
  contentKind: "prose" | "outline"
  /** 读者团试读入口仅章正文有 */
  supportsReaderPanel: boolean
  score: number | null
  scoredAt: string | null
  /** 内容晚于评分时间被修改 */
  stale: boolean
  /** 有进行中的评审/生成评审循环 */
  reviewing: boolean
  /** 正在执行此评审的回合；停止复用受鉴权保护的回合取消接口。 */
  reviewTurnIds: string[]
  reviewContext: ScoreReviewContext | null
  /** 内容为空（未生成/未填写）——评审按钮禁用态 */
  contentEmpty: boolean
  dimensions: ScoreDimension[]
  agents: ScoreAgentEntry[]
  history: ScoreHistoryEntry[]
}

/* ------------------------------ 规整帮手 ------------------------------ */

/** 维度分规整：容错旧数据（无 dimensions）与脏数据，分数夹 0~100 取整 */
export function normalizeScoreDimensions(raw: unknown): ScoreDimension[] {
  if (!Array.isArray(raw)) return []
  const out: ScoreDimension[] = []
  for (const d of raw) {
    if (!d || typeof d !== "object") continue
    const rec = d as Record<string, unknown>
    const dimension = String(rec.dimension ?? rec.aspect ?? "").trim()
    const score = Math.round(Number(rec.score))
    if (!dimension || !Number.isFinite(score)) continue
    out.push({ dimension, score: Math.min(100, Math.max(0, score)) })
  }
  return out
}

/** 评委意见条目规整（Review.aiComments / judge run result.comments 同构） */
function normalizeCommentItems(raw: unknown): ScoreAgentItem[] {
  if (!Array.isArray(raw)) return []
  const out: ScoreAgentItem[] = []
  for (const c of raw) {
    if (!c || typeof c !== "object") continue
    const rec = c as Record<string, unknown>
    const aspect = String(rec.aspect ?? rec.dimension ?? "综合").trim() || "综合"
    out.push({
      aspect,
      ...(rec.issue ? { issue: String(rec.issue) } : {}),
      ...(rec.suggestion ? { suggestion: String(rec.suggestion) } : {}),
      ...(rec.excerpt ? { excerpt: String(rec.excerpt) } : {}),
    })
  }
  return out
}

/** 读者试读 transcript 规整：{ score, summary, impressions:[{aspect,detail}] } */
function parseReaderTranscript(raw: unknown): {
  score: number | null
  summary: string
  items: ScoreAgentItem[]
} {
  if (!raw || typeof raw !== "object") return { score: null, summary: "", items: [] }
  const rec = raw as Record<string, unknown>
  const score = Number(rec.score)
  const impressions = Array.isArray(rec.impressions) ? rec.impressions : []
  return {
    score: Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : null,
    summary: typeof rec.summary === "string" ? rec.summary : "",
    items: impressions
      .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
      .map((i) => ({
        aspect: String(i.aspect ?? "感受").trim() || "感受",
        ...(i.detail ? { detail: String(i.detail) } : {}),
      })),
  }
}

/** 读者任务文案解析人设标签：「试读第 3 章《雨夜来客》（小白读者）」→ 小白读者 */
function parseReaderPersonaLabel(task: string): string | null {
  const m = task.match(/（([^（）]+)）\s*$/)
  return m ? m[1] : null
}

export async function getReviewActivity(novelId: string, targetType: string, targetId: string, candidateId?: string) {
  // 候选分支：直连评审无对话回合，chat action 无候选维度——动作兜底与 latestReviewContext 回退都会
  // 串入章级对话评审（reviewTurnIds/reviewing 误置位、浮卡露出「查看评审对话」打开章级会话）。
  // 只按 candidateId 等值的 standalone run 计 reviewing；reviewTurnIds 恒 []、reviewContext 恒 null。
  if (candidateId) {
    const candidateRuns = await prisma.subAgentRun.findMany({
      where: { novelId, targetType, targetId, candidateId, attemptId: null, status: "running" },
      select: { id: true },
    })
    return { reviewTurnIds: [], reviewContext: null, reviewing: candidateRuns.length > 0 }
  }
  const attempts = await prisma.chatAttempt.findMany({
    where: { status: { in: ["queued", "running"] }, turn: { conversation: { novelId } } },
    select: { id: true, turnId: true, createdAt: true, turn: { select: { action: true, conversationId: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  })
  const runs = await prisma.subAgentRun.findMany({
    where: {
      novelId, targetType, targetId,
      // 章级与候选 standalone run 共享 targetType/targetId，必须显式 candidateId:null 隔离
      // （先例：chapterReport 的 readerRuns 过滤），否则候选评审会把章级报告的 reviewing 误置 true
      candidateId: null,
      OR: [{ status: "running" }, { attemptId: { in: attempts.map(a => a.id) } }],
    },
    select: { attemptId: true, status: true },
  })
  const reviewAttempts = new Set(runs.map(run => run.attemptId))
  const matchingAttempts = attempts.filter(attempt => {
    const action = chatActionSchema.safeParse(attempt.turn.action)
    // 明确的评审动作覆盖首个子代理启动前；run 关联兼容从普通对话发起的评审。
    return reviewAttempts.has(attempt.id) || (action.success && action.data.kind === "review" &&
      action.data.targetType === targetType && action.data.targetId === targetId)
  })
  const reviewTurnIds = [...new Set(matchingAttempts.map(attempt => attempt.turnId))]
  const active = matchingAttempts[0]
  const reviewContext = active
    ? { conversationId: active.turn.conversationId, startedAt: active.createdAt.toISOString() }
    : await latestReviewContext(novelId, targetType, targetId)
  return { reviewTurnIds, reviewContext, reviewing: reviewTurnIds.length > 0 || runs.some(run => !run.attemptId && run.status === "running") }
}

/** 从持久化动作或子代理关联找原会话，不用运行中筛选，以覆盖首个工具调用前就失败的评审。 */
async function latestReviewContext(novelId: string, targetType: string, targetId: string): Promise<ScoreReviewContext | null> {
  const [turn, run] = await Promise.all([
    prisma.chatTurn.findFirst({
      where: { conversation: { novelId }, AND: [
        { action: { path: ["kind"], equals: "review" } },
        { action: { path: ["targetType"], equals: targetType } },
        { action: { path: ["targetId"], equals: targetId } },
      ] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { conversationId: true, createdAt: true },
    }),
    prisma.subAgentRun.findFirst({
      where: { novelId, targetType, targetId, OR: [{ attemptId: { not: null } }, { conversationId: { not: null } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { attemptId: true, conversationId: true, createdAt: true },
    }),
  ])
  if (run && (!turn || run.createdAt > turn.createdAt)) {
    const attempt = run.attemptId ? await prisma.chatAttempt.findFirst({
      where: { id: run.attemptId, turn: { conversation: { novelId } } },
      select: { turn: { select: { conversationId: true } } },
    }) : null
    // 旧 run 的 conversationId 是纯标量，也需核对同书归属及会话是否还存在。
    const conversation = attempt ? { id: attempt.turn.conversationId } : run.conversationId ? await prisma.conversation.findFirst({
      where: { id: run.conversationId, novelId }, select: { id: true },
    }) : null
    if (conversation) return { conversationId: conversation.id, startedAt: run.createdAt.toISOString() }
  }
  return turn ? { conversationId: turn.conversationId, startedAt: turn.createdAt.toISOString() } : null
}

/* ------------------------------ 章/卷聚合 ------------------------------ */

async function chapterReport(
  novelId: string,
  targetType: "CHAPTER_CONTENT" | "CHAPTER_OUTLINE" | "VOLUME_OUTLINE",
  targetId: string
): Promise<ScoreReport> {
  let targetLabel: string
  let contentUpdatedAt: Date
  let contentEmpty = false
  let binding: { version: number; hash: string } | undefined
  if (targetType === "VOLUME_OUTLINE") {
    const volume = await prisma.volume.findUnique({ where: { id: targetId } })
    if (!volume || volume.novelId !== novelId) throw new ReviewTargetNotFoundError("卷不存在")
    targetLabel = `第 ${volume.index} 卷《${volume.title}》大纲`
    contentUpdatedAt = volume.updatedAt
  } else {
    const chapter = await prisma.chapter.findUnique({
      where: { id: targetId },
      include: { volume: true },
    })
    if (!chapter || chapter.volume.novelId !== novelId) {
      throw new ReviewTargetNotFoundError("章节不存在")
    }
    targetLabel = `第 ${chapter.index} 章《${chapter.title}》${targetType === "CHAPTER_CONTENT" ? "正文" : "大纲"}`
    contentUpdatedAt = chapter.updatedAt
    if (targetType === "CHAPTER_CONTENT") binding = { version: chapter.version, hash: contentHash(chapter.content) }
    contentEmpty =
      targetType === "CHAPTER_CONTENT" ? !chapter.content.trim() : !chapter.outline.trim()
  }

  // approveTargetByAuthor 会落只有人工结论、无评分的 Review——评分口径一律过滤 aiScore 非空
  const reviews = await prisma.review.findMany({
    where: { novelId, targetType, targetId },
    orderBy: { createdAt: "desc" },
  })
  const scored = reviews.filter((r) => r.aiScore !== null && (!binding || r.purpose === "current"))
  const latest = (binding ? scored.filter(r => r.contentHash === binding.hash && r.contentVersion === binding.version) : scored)[0] ?? null

  // 评委评价卡：最新一次有评分的 Review；runId 链最近的 judge run 供回放
  const agents: ScoreAgentEntry[] = []
  if (latest) {
    const judgeRun = await prisma.subAgentRun.findFirst({
      where: { novelId, targetType, targetId, agentKind: "judge", status: "done", ...(binding ? { id: latest.sourceRunId ?? "unbound", contentHash: binding.hash } : {}) },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
    const items = normalizeCommentItems(latest.aiComments)
    agents.push({
      kind: "judge",
      name: "AI 评审员 · 评委",
      score: latest.aiScore,
      summary: items.length ? `${items.length} 条意见` : "无意见",
      items,
      at: latest.createdAt.toISOString(),
      ...(judgeRun ? { runId: judgeRun.id } : {}),
      reviewId: latest.id,
    })
  }

  // 读者团（仅章正文）：最新一批=最新 run 的 sopNodeRunId 同组
  if (targetType === "CHAPTER_CONTENT") {
    const readerRuns = await prisma.subAgentRun.findMany({
      where: { novelId, targetType, targetId, agentKind: "reader", status: "done", contentHash: binding!.hash, contentVersion: binding!.version, candidateId: null },
      orderBy: { createdAt: "desc" },
      take: 12,
    })
    if (readerRuns.length > 0) {
      const batchKey = readerRuns[0].sopNodeRunId ?? readerRuns[0].id
      const batch = readerRuns.filter((r) => (r.sopNodeRunId ?? r.id) === batchKey)
      // 同一批内按创建时间升序呈现（fan-out 并行，保持人设稳定顺序靠任务文案）
      batch.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      for (const run of batch) {
        const parsed = parseReaderTranscript(run.transcript)
        const persona = parseReaderPersonaLabel(run.task)
        agents.push({
          kind: "reader",
          name: persona ? `读者 · ${persona}` : "读者",
          score: parsed.score,
          summary: parsed.summary,
          items: parsed.items,
          at: run.createdAt.toISOString(),
          runId: run.id,
        })
      }
    }
  }

  // 历史：评委历次评分 + 读者团历次均分（nodeId:"content" 的 SopNodeRun.finalScore）
  const history: ScoreHistoryEntry[] = scored.map((r) => {
    const items = normalizeCommentItems(r.aiComments)
    return {
      at: r.createdAt.toISOString(),
      score: r.aiScore,
      source: "评委",
      ...(binding ? { contentVersion: r.contentVersion, verified: !!r.contentHash && r.contentVersion !== null } : {}),
      summary: binding && (!r.contentHash || r.contentVersion === null) ? `历史评分，版本未核验 · ${items.length} 条意见` : `${r.contentVersion ? `修订 ${r.contentVersion} · ` : ""}${items.length ? `${items.length} 条意见` : "无意见"}`,
    }
  })
  if (targetType === "CHAPTER_CONTENT") {
    const readerNodeRuns = await prisma.sopNodeRun.findMany({
      where: { novelId, nodeId: "content", targetId, finalScore: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 20,
    })
    for (const nr of readerNodeRuns) {
      history.push({
        at: nr.createdAt.toISOString(),
        score: nr.finalScore,
        source: "读者团",
        summary: "历史读者团均分，版本未核验",
        verified: false,
      })
    }
  }
  history.sort((a, b) => b.at.localeCompare(a.at))

  return {
    targetType,
    targetId,
    ...(binding ? { contentBinding: binding, candidateReports: reviews.filter(r => r.purpose === "candidate" && r.candidateId).map(r => ({ candidateId: r.candidateId!, reviewId: r.id, score: r.aiScore, at: r.createdAt.toISOString(), reviewConfigHash: r.reviewConfigHash })) } : {}),
    targetLabel,
    contentKind: targetType === "CHAPTER_CONTENT" ? "prose" : "outline",
    supportsReaderPanel: targetType === "CHAPTER_CONTENT",
    score: latest?.aiScore ?? null,
    scoredAt: latest ? latest.createdAt.toISOString() : null,
    stale: binding ? !latest && scored.length > 0 : !!latest && contentUpdatedAt > latest.createdAt,
    ...await getReviewActivity(novelId, targetType, targetId),
    contentEmpty,
    dimensions: normalizeScoreDimensions(latest?.aiDimensions ?? null),
    agents,
    history: history.slice(0, 20),
  }
}

/* ------------------------------ 候选稿聚合 ------------------------------ */

/**
 * 候选稿评分报告（候选面板评审视图）：候选 ready 后内容不可变（stale 恒 false、锚点恒稳定），
 * 评审按 candidateId + purpose="candidate" 聚合（改进链路与候选直连评审同一存储口径）；
 * 仅评委卡，无读者团段，不回 candidateReports。
 */
async function candidateReport(
  novelId: string,
  chapterId: string,
  candidateId: string
): Promise<ScoreReport> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { volume: true },
  })
  const candidate = await prisma.contentCandidate.findFirst({ where: { id: candidateId, novelId, chapterId } })
  if (!chapter || chapter.volume.novelId !== novelId || !candidate) throw new ReviewTargetNotFoundError("候选稿不存在")

  const variantLabel = (candidate.variant && VARIANT_LABELS[candidate.variant]) || candidate.variant || "候选稿"
  const targetLabel = `《${chapter.title}》候选稿 · ${variantLabel}`

  const reviews = await prisma.review.findMany({
    where: { novelId, candidateId, purpose: "candidate" },
    orderBy: { createdAt: "desc" },
  })
  const scored = reviews.filter((r) => r.aiScore !== null)
  const latest = scored[0] ?? null

  // 评委评价卡：最新一次有评分的 Review；回放链 runId=latest.sourceRunId ?? 最近的候选 judge run
  const agents: ScoreAgentEntry[] = []
  if (latest) {
    const judgeRun = await prisma.subAgentRun.findFirst({
      where: { novelId, candidateId, agentKind: "judge", status: "done" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
    const items = normalizeCommentItems(latest.aiComments)
    const runId = latest.sourceRunId ?? judgeRun?.id
    agents.push({
      kind: "judge",
      name: "AI 评审员 · 评委",
      score: latest.aiScore,
      summary: items.length ? `${items.length} 条意见` : "无意见",
      items,
      at: latest.createdAt.toISOString(),
      ...(runId ? { runId } : {}),
      reviewId: latest.id,
    })
  }

  // 历史：候选评审全部评分；候选 contentVersion 恒 null，不走章级「版本未核验」分支
  const history: ScoreHistoryEntry[] = scored.map((r) => {
    const items = normalizeCommentItems(r.aiComments)
    return {
      at: r.createdAt.toISOString(),
      score: r.aiScore,
      source: "评委",
      summary: `候选评审 · ${items.length ? `${items.length} 条意见` : "无意见"}`,
    }
  })

  return {
    targetType: "CHAPTER_CONTENT",
    targetId: chapterId,
    candidateId,
    candidate: { candidateId, chapterId, chapterTitle: chapter.title, variantLabel, status: candidate.status },
    // contentBinding 仅作信息展示：候选不可变，无版本核验语义
    contentBinding: { version: candidate.baseVersion, hash: candidate.contentHash },
    targetLabel,
    contentKind: "prose",
    supportsReaderPanel: false,
    score: latest?.aiScore ?? null,
    scoredAt: latest ? latest.createdAt.toISOString() : null,
    stale: false,
    ...await getReviewActivity(novelId, "CHAPTER_CONTENT", chapterId, candidateId),
    contentEmpty: !candidate.content.trim(),
    dimensions: normalizeScoreDimensions(latest?.aiDimensions ?? null),
    agents,
    history: history.slice(0, 20),
  }
}

/* ------------------------------ 入口 ------------------------------ */

/** AI 评审批注的内容格式解析（`**{aspect}** {issue}\n\n建议：{suggestion}`，挂载处见 candidate-comments.ts）；不匹配时整体作为 text */
function parseAttachedComment(content: string): { aspect?: string; text: string; suggestion?: string } {
  const m = content.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/)
  const aspect = m?.[1]?.trim() || undefined
  const body = (m ? m[2] : content).trim()
  const sug = body.match(/^([\s\S]*?)\n\n建议：([\s\S]*)$/)
  return sug ? { aspect, text: sug[1].trim(), suggestion: sug[2].trim() } : { aspect, text: body }
}

/**
 * 正文改进对话框的改进项聚合（仅 CHAPTER_CONTENT）：
 * 维度（含 issueCount）+ AI 评审建议（未挂载的评审意见 + OPEN 的 AI 行内评论，挂载去重）+ 用户建议（OPEN），
 * 附本章规划字数档（对话框默认值；缺档回落当前正文字数）与当前正文字数。
 * 去重口径：评审条目已挂载为评论（确定性 id `review:{reviewId}:{index}`，candidate-comments.ts）时不重复列入，
 * 由评论项代表——该评论被作者拒绝（REJECTED）时两者都不出现（尊重已拒绝意见）。
 */
export async function listImprovementItems(
  novelId: string,
  targetType: ScoreTargetType,
  targetId: string,
  userId: string
): Promise<ImproveItemsPayload> {
  if (targetType !== "CHAPTER_CONTENT") throw new ContentError("INVALID_INPUT", "正文改进对话框仅支持章正文", 400)
  const chapter = await prisma.chapter.findUnique({ where: { id: targetId }, include: { volume: true } })
  if (!chapter || chapter.volume.novelId !== novelId) throw new ReviewTargetNotFoundError("章节不存在")
  const binding = { version: chapter.version, hash: contentHash(chapter.content) }
  const contentWordCount = countChineseWords(chapter.content)

  // 最新有效评审（口径同 chapterReport：有评分 + purpose=current + 版本/hash 匹配当前稿）
  const reviews = await prisma.review.findMany({ where: { novelId, targetType, targetId }, orderBy: { createdAt: "desc" } })
  const latest = reviews.filter(r => r.aiScore !== null && r.purpose === "current")
    .filter(r => r.contentHash === binding.hash && r.contentVersion === binding.version)[0] ?? null

  const commentItems = normalizeCommentItems(latest?.aiComments ?? null)
  const dimensions: ImprovementDimension[] = normalizeScoreDimensions(latest?.aiDimensions ?? null).map(d => ({
    id: dimensionItemId(d.dimension),
    dimension: d.dimension,
    score: d.score,
    issueCount: commentItems.filter(c => c.aspect === d.dimension).length,
  }))
  const dimKeyOf = (aspect: string | undefined) => dimensions.find(d => d.dimension === aspect)?.id

  // 本次评审挂载的全部评论（含已处理状态，仅用于去重判定）
  const reviewAttached = latest
    ? await prisma.textComment.findMany({ where: { novelId, targetType, targetId, parentId: null, reviewId: latest.id }, select: { id: true, content: true } })
    : []
  const attachedIds = new Set(reviewAttached.map(c => c.id))
  const attachedContents = reviewAttached.map(c => c.content)

  const items: ImprovementItem[] = []
  if (latest) {
    commentItems.forEach((c, index) => {
      const id = reviewItemId(latest.id, index)
      if (attachedIds.has(id)) return
      // 旧数据兜底：非确定性 id 的挂载评论按内容前缀匹配
      if (c.issue && attachedContents.some(content => content.includes(c.issue!.slice(0, 30)))) return
      const text = (c.issue ?? "").trim()
      const suggestion = (c.suggestion ?? "").trim()
      if (!text && !suggestion) return
      items.push({
        id, group: "report", label: c.aspect, aspect: c.aspect, dimKey: dimKeyOf(c.aspect),
        text: text || suggestion, ...(suggestion && text ? { suggestion } : {}), ...(c.excerpt ? { quote: c.excerpt } : {}),
      })
    })
  }

  // 顶层 OPEN 评论：AI 批注（评审挂载/对话工具添加）与用户建议；回复不列入
  const comments = await prisma.textComment.findMany({
    where: { novelId, targetType, targetId, parentId: null, status: "OPEN" },
    select: { id: true, authorType: true, authorName: true, content: true, quote: true, startOffset: true, createdAt: true },
  })
  comments.sort((a, b) => (a.startOffset ?? Number.MAX_SAFE_INTEGER) - (b.startOffset ?? Number.MAX_SAFE_INTEGER) || a.createdAt.getTime() - b.createdAt.getTime())
  for (const c of comments) {
    if (c.authorType === "AI") {
      const parsed = parseAttachedComment(c.content)
      items.push({
        id: commentItemId(c.id), group: "ai-comment",
        label: parsed.aspect ? `行内评论 · ${parsed.aspect}` : `行内评论 · ${c.authorName}`,
        ...(parsed.aspect ? { aspect: parsed.aspect, dimKey: dimKeyOf(parsed.aspect) } : {}),
        text: parsed.text, ...(parsed.suggestion ? { suggestion: parsed.suggestion } : {}), ...(c.quote ? { quote: c.quote } : {}),
      })
    } else {
      items.push({ id: commentItemId(c.id), group: "user-comment", label: "我的评论", text: c.content, ...(c.quote ? { quote: c.quote } : {}) })
    }
  }

  // 字数默认值：本章规划档；缺档/非法时回落当前正文字数（保持现有篇幅）
  const assessment = await assessChapterNarrative({ userId, novelId, chapterId: targetId })
  let wordMin = assessment.wordMin
  let wordBudget = assessment.wordBudget
  if (!Number.isInteger(wordMin) || !Number.isInteger(wordBudget) || wordMin < 1 || wordMin > wordBudget) {
    const base = Math.min(REDRAW_WORD_LIMIT, Math.max(1, contentWordCount))
    wordMin = base
    wordBudget = base
  }

  return { wordMin, wordBudget, contentWordCount, dimensions, items }
}

export async function getScoreReport(
  novelId: string,
  targetType: ScoreTargetType,
  targetId: string,
  candidateId?: string
): Promise<ScoreReport> {
  // candidateId 存在时走候选维度（路由已强制 targetType=CHAPTER_CONTENT，targetId 即 chapterId）
  if (candidateId) return candidateReport(novelId, targetId, candidateId)
  return chapterReport(novelId, targetType, targetId)
}
