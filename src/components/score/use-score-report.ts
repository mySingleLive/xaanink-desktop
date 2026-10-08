"use client"

/**
 * 悬浮评分指示器·前端取数层（2026-09；契约 design/research/score-indicator-tech.md）。
 * 类型为 src/lib/services/score-report.ts 的客户端镜像（那边 import prisma，不能共用），
 * queryKey 契约：["score-report", targetType, targetId]，候选稿维度追加第 4 段
 * ["score-report", targetType, targetId, candidateId]——对话写工具失效见 use-agent-chat.ts。
 */
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiSend, ApiError } from "@/components/content/api"
import { chatActionSchema } from "@/lib/chat-parts"
import type { ScoreTargetType, ScoreReviewContext } from "@/lib/score-types"
import { useChatStore } from "@/stores/chat"

export type { ScoreTargetType } from "@/lib/score-types"

/* ------------------------------ 类型（服务端镜像） ------------------------------ */

export interface ScoreDimension {
  dimension: string
  score: number
}

export interface ScoreAgentItem {
  aspect: string
  issue?: string
  suggestion?: string
  excerpt?: string
  detail?: string
}

export interface ScoreAgentEntry {
  kind: "judge" | "reader"
  name: string
  score: number | null
  summary: string
  items: ScoreAgentItem[]
  at: string
  runId?: string
  reviewId?: string
}

export interface ScoreHistoryEntry {
  contentVersion?: number | null
  verified?: boolean
  at: string
  score: number | null
  source: string
  summary: string
}

export interface ScoreReport {
  contentBinding?: { version: number; hash: string }
  candidateReports?: Array<{ candidateId: string; reviewId: string; score: number | null; at: string; reviewConfigHash: string | null }>
  /** 候选评审报告时携带：评审关联的候选 id（章级报告为 undefined） */
  candidateId?: string | null
  /** 候选稿上下文（候选评审报告时携带）：「按意见改进」拼 improveMessage 用；status 供已丢弃只读收口 */
  candidate?: { candidateId: string; chapterId: string; chapterTitle: string; variantLabel: string; status: string } | null
  targetType: ScoreTargetType
  targetId: string
  targetLabel: string
  contentKind: "prose" | "outline"
  supportsReaderPanel: boolean
  score: number | null
  scoredAt: string | null
  stale: boolean
  reviewing: boolean
  reviewTurnIds?: string[]
  reviewContext?: ScoreReviewContext | null
  contentEmpty: boolean
  dimensions: ScoreDimension[]
  agents: ScoreAgentEntry[]
  history: ScoreHistoryEntry[]
}

/* ------------------------------ 分档色温 ------------------------------ */

/** 分档：≥80 绿 / 60~79 橘 / <60 红（产品设计拍板） */
export function scoreBand(score: number | null): "high" | "mid" | "low" | null {
  if (score === null) return null
  if (score >= 80) return "high"
  if (score >= 60) return "mid"
  return "low"
}

export const SCORE_BAND_VAR: Record<"high" | "mid" | "low", string> = {
  high: "var(--score-high)",
  mid: "var(--score-mid)",
  low: "var(--score-low)",
}

/* ------------------------------ 取数 ------------------------------ */

/**
 * 评审启动窗登记（30s，与评审视图 reviewStarting 同长）：
 * 对话路径里模型思考到首个 run 落库之间服务端 reviewing 尚未置位，
 * 用短时效登记让指示器在窗口期内保持评审中、轮询不断档（否则乐观态会被下一拍轮询的清空数据顶掉）。
 */
const reviewStartMarks = new Map<string, number>()
const REVIEW_START_WINDOW_MS = 30_000

/** 启动窗键控命名空间：章级尾部空段（"T:I:"），候选带 candidateId 段——两维度互不串 */
const reviewStartKey = (targetType: ScoreTargetType, targetId: string, candidateId?: string | null) =>
  `${targetType}:${targetId}:${candidateId ?? ""}`

function markReviewStarting(targetType: ScoreTargetType, targetId: string, candidateId?: string | null) {
  reviewStartMarks.set(reviewStartKey(targetType, targetId, candidateId), Date.now())
}

function isReviewStarting(targetType: ScoreTargetType, targetId: string, candidateId?: string | null): boolean {
  const key = reviewStartKey(targetType, targetId, candidateId)
  const at = reviewStartMarks.get(key)
  if (at === undefined) return false
  if (Date.now() - at > REVIEW_START_WINDOW_MS) {
    reviewStartMarks.delete(key)
    return false
  }
  return true
}

function receiveScoreReport(report: ScoreReport): ScoreReport {
  // 与服务端 report.candidateId 还原同一启动窗键（候选维度不碰章级标记）
  const key = reviewStartKey(report.targetType, report.targetId, report.candidateId)
  const startedAt = reviewStartMarks.get(key)
  // 本次请求已落库并结束时立即结束启动窗，不能继续显示 30 秒「评审中」。
  if (!report.reviewing && startedAt !== undefined && report.reviewContext &&
    Date.parse(report.reviewContext.startedAt) >= startedAt) reviewStartMarks.delete(key)
  return report
}

/** 直连评审 mutation key：候选维度追加 candidateId 段（章级保持 4 元素不变） */
export const directScoreReviewKey = (novelId: string, targetType: ScoreTargetType, targetId: string, candidateId?: string) =>
  candidateId
    ? ["direct-score-review", novelId, targetType, targetId, candidateId]
    : ["direct-score-review", novelId, targetType, targetId]

export function useScoreReport(
  novelId: string,
  targetType: ScoreTargetType,
  targetId: string,
  enabled = true,
  candidateId?: string
) {
  /* exact: 章级过滤器不前缀误匹配候选 mutation（候选键多一段 candidateId） */
  const directlyReviewing = useIsMutating({ mutationKey: directScoreReviewKey(novelId, targetType, targetId, candidateId), exact: true }) > 0
  const query = useQuery({
    queryKey: candidateId ? ["score-report", targetType, targetId, candidateId] : ["score-report", targetType, targetId],
    enabled,
    queryFn: () =>
      apiGet<{ report: ScoreReport }>(
        `/api/novels/${novelId}/score-report?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}${candidateId ? `&candidateId=${encodeURIComponent(candidateId)}` : ""}`,
        "加载评分失败"
      ).then((r) => receiveScoreReport(r.report)),
    // 评审中 3s 轮询直到出分；启动窗内同样轮询（等首个 run 落库）；对话内评审经 invalidateNovelQueries 即时失效双通道刷新
    refetchInterval: (q) =>
      q.state.data?.reviewing || isReviewStarting(targetType, targetId, candidateId) || directlyReviewing ? 3000 : false,
  })
  /* 启动窗内服务端尚未置位时派生 reviewing=true（run 落库后由服务端数据接管） */
  const data =
    query.data && !query.data.reviewing && (isReviewStarting(targetType, targetId, candidateId) || directlyReviewing)
      ? { ...query.data, reviewing: true }
      : query.data
  return { ...query, data }
}

/**
 * 「发起/重新评审」统一动作（评审视图 ScoreReportPanel 与悬浮卡 ScoreHoverCard 共用，章/卷目标）：
 * ① 先乐观置 reviewing=true——右下角悬浮指示器立刻转评审中动画并开启 3s 轮询
 *   （对话路径此前漏了这步：点「发起评审」后指示器不联动的根因；服务端 run 落库后由轮询数据接管）；
 * ② 开新会话走对话全量评审（评委[+读者团]，过程在对话面板实时呈现）。
 * 内容为空不在按钮上 disabled（禁用按钮不触发 mouse 事件，title 提示永远不显示、
 * 点击零反馈，用户读作「按钮坏了」）——保持可点，在这里 toast 引导先生成内容。
 */
export function useStartScoreReview(novelId: string) {
  const queryClient = useQueryClient()
  const requestNewConversation = useChatStore((s) => s.requestNewConversation)

  const start = (report: ScoreReport) => {
    if (report.contentEmpty) {
      toast.warning(
        `还没有内容可评审——请先生成${report.contentKind === "prose" ? "正文" : "大纲"}。`
      )
      return
    }
    const chat = useChatStore.getState()
    if (chat.recoveryStatus !== "ready" || chat.isGenerating || chat.creatingNovel || chat.pendingQuestion || chat.pendingPlan || chat.pendingRequest) {
      toast.warning("请先结束当前对话任务，再发起评审。")
      return
    }
    /* 启动窗登记（30s 防轮询顶掉乐观态）+ 乐观置 reviewing（指示器即时联动） */
    markReviewStarting(report.targetType, report.targetId)
    queryClient.setQueryData<ScoreReport>(
      ["score-report", report.targetType, report.targetId],
      (old) => (old ? { ...old, reviewing: true } : old)
    )
    requestNewConversation({ novelId, draft: reviewDraftFor(report), action: { kind: "review", targetType: report.targetType, targetId: report.targetId }, autoSend: true })
  }
  return { start }
}

/**
 * 候选稿直连评审（不经对话）：POST score-review 带 candidateId，服务端评委单跑、
 * 落 Review(purpose="candidate") 并把 AI 意见挂载到候选稿行内评论。
 * 乐观 reviewing + 启动窗登记与章级同一套（键带 candidateId 段，互不串）；
 * mutation 经 mutationCache.build 携带 directScoreReviewKey(...candidateId)，
 * useScoreReport 的 directlyReviewing 与停止循环的 awaitingBinding 才能按候选维度核对。
 * 409（评审进行中）提示并失效拉回真实态，不留假乐观态。
 */
export function useStartCandidateReview(novelId: string) {
  const queryClient = useQueryClient()

  const start = (report: ScoreReport) => {
    const candidateId = report.candidateId ?? report.candidate?.candidateId
    if (!candidateId) return
    if (report.contentEmpty) {
      toast.warning("还没有内容可评审——候选稿内容为空。")
      return
    }
    markReviewStarting(report.targetType, report.targetId, candidateId)
    queryClient.setQueryData<ScoreReport>(
      ["score-report", report.targetType, report.targetId, candidateId],
      (old) => (old ? { ...old, reviewing: true } : old)
    )
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: directScoreReviewKey(novelId, report.targetType, report.targetId, candidateId),
      mutationFn: async () => {
        await apiSend(`/api/novels/${novelId}/score-review`, "POST", { targetType: report.targetType, targetId: report.targetId, candidateId }, "发起候选评审失败，请重试")
      },
      onSuccess: () => toast.success("候选稿评审完成"),
      onError: (error) => {
        // 停止链路以 REVIEW_CANCELLED(409) 中断在途 POST——与「正在进行中」同码不同义，必须先判取消（停止成功提示由 useStopScoreReview 给）
        if (error instanceof ApiError && error.code === "REVIEW_CANCELLED") return
        if (error instanceof ApiError && error.status === 409) toast.warning("该候选稿评审正在进行中")
        else if (error instanceof Error) toast.error(error.message)
      },
      onSettled: () => {
        // POST 返回时服务端已是终态：清启动窗标记，快速评审（<30s）完成后不留「评审中」尾巴
        // （候选直连 reviewContext 恒 null，receiveScoreReport 的提前清除不会触发）
        reviewStartMarks.delete(reviewStartKey(report.targetType, report.targetId, candidateId))
        // 直连 mutation 不经对话写工具失效机制：拉回真实报告与候选行内评论（同 ChapterContentPanel 直连评审先例）
        void queryClient.invalidateQueries({ queryKey: ["score-report"] })
        void queryClient.invalidateQueries({ queryKey: ["comments", "CANDIDATE_CONTENT", candidateId] })
      },
    })
    void mutation.execute(undefined).catch(() => { /* onError 已提示 */ })
  }
  return { start }
}

/** 打开正在评审的原会话；已在该会话时只展开面板，避免重新加载打断流。 */
export function useOpenScoreReviewConversation(novelId: string) {
  const mutation = useMutation({
    mutationFn: async (report: ScoreReport) => {
      // 首条请求尚未绑定回合时，仅在目标匹配时展示当前评审上下文。
      const chat = useChatStore.getState()
      const pending = chat.pendingRequest ? JSON.parse(chat.pendingRequest.body) : null
      const payload = chat.newConversationPayload
      const context = pending ?? (chat.newConversationRequested && payload ? payload : {
        novelId: chat.draftNovelId, action: chat.draftAction,
      })
      const action = chatActionSchema.safeParse(context.action)
      if ((pending || chat.newConversationRequested) &&
        context.novelId === novelId && action.success && action.data.kind === "review" &&
        action.data.targetType === report.targetType && action.data.targetId === report.targetId) {
        chat.requestChatFocus()
        return
      }
      const contextReport = report.reviewContext && !report.reviewing ? report : (await apiGet<{ report: ScoreReport }>(
        `/api/novels/${novelId}/score-report?targetType=${report.targetType}&targetId=${encodeURIComponent(report.targetId)}`,
        "加载评审对话失败，请重试"
      )).report
      const conversationId = contextReport.reviewContext?.conversationId
      if (conversationId) {
        const current = useChatStore.getState()
        current.requestChatFocus()
        if (current.conversationId !== conversationId) current.requestConversation(conversationId)
        return
      }
      toast.info("此评审暂无关联的 AI 对话。")
    },
    onError: (error: Error) => toast.error(error.message),
  })
  return { open: (report: ScoreReport) => { if (!mutation.isPending) mutation.mutate(report) } }
}

/** 按评分目标定位回合，复用服务端取消：撤销执行权限并中断模型，而非只清除动画。 */
export function useStopScoreReview(novelId: string, targetType: ScoreTargetType, targetId: string, candidateId?: string) {
  const queryClient = useQueryClient()
  // 候选维度键控隔离（章级保持 4 元素不变）；评论/评分缓存键随维度切换
  const mutationKey = candidateId
    ? ["stop-score-review", novelId, targetType, targetId, candidateId]
    : ["stop-score-review", novelId, targetType, targetId]
  const reportQueryKey = candidateId
    ? ["score-report", targetType, targetId, candidateId]
    : ["score-report", targetType, targetId]
  const commentsQueryKey = candidateId ? ["comments", "CANDIDATE_CONTENT", candidateId] : ["comments", targetType, targetId]
  const stopping = useIsMutating({ mutationKey, exact: true }) > 0
  const mutation = useMutation({
    mutationKey,
    mutationFn: async () => {
      const matches = (raw: unknown) => {
        const action = chatActionSchema.safeParse(raw)
        return action.success && action.data.kind === "review" && action.data.targetType === targetType && action.data.targetId === targetId
      }
      const chat = useChatStore.getState()
      // 尚未自动发送时移除草稿，ChatPanel 的延迟发送守卫会阻止这次请求。
      if (!candidateId && !chat.isGenerating && !chat.pendingRequest && chat.draftNovelId === novelId && matches(chat.draftAction)) {
        useChatStore.setState({ draft: "", draftAction: null })
      }
      const deadline = Date.now() + 15_000
      for (;;) {
        const pending = useChatStore.getState().pendingRequest
        const request = pending ? JSON.parse(pending.body) : null
        const awaitingBinding = (!candidateId && request?.novelId === novelId && matches(request.action)) ||
          queryClient.isMutating({ mutationKey: directScoreReviewKey(novelId, targetType, targetId, candidateId), exact: true }) > 0
        const { report } = await apiGet<{ report: ScoreReport }>(
          // 候选维度必须带 candidateId——否则拿到章级报告 reviewing=false，停止逻辑直接跳过
          `/api/novels/${novelId}/score-report?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}${candidateId ? `&candidateId=${encodeURIComponent(candidateId)}` : ""}`,
          "无法核对评审任务，请重试"
        )
        const turnIds = report.reviewTurnIds ?? []
        if (report.reviewing) {
          await apiSend(`/api/novels/${novelId}/score-review`, "DELETE", { targetType, targetId, ...(candidateId ? { candidateId } : {}) }, "停止评审失败，请重试")
        }
        // 候选评审直连执行、无对话回合——turnIds 只可能来自同章的对话评审，候选停止不误伤
        if (!candidateId && turnIds.length > 0) {
          await Promise.all(turnIds.map(id => apiSend(`/api/chat/turns/${encodeURIComponent(id)}/cancel`, "POST", undefined, "停止评审失败，请重试")))
          return
        }
        if (!awaitingBinding) {
          return // 评审已结束，或自动发送前就已取消。
        }
        if (Date.now() >= deadline) throw new Error("评审请求仍在确认中，请稍后重试停止。")
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    },
    onSuccess: async () => {
      reviewStartMarks.delete(reviewStartKey(targetType, targetId, candidateId))
      await queryClient.cancelQueries({ queryKey: reportQueryKey })
      queryClient.setQueryData<ScoreReport>(reportQueryKey, old => old ? { ...old, reviewing: false, reviewTurnIds: [] } : old)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reportQueryKey }),
        queryClient.invalidateQueries({ queryKey: commentsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["chat-conversations"] }),
      ])
      toast.success("已停止评审")
    },
    onError: (error: Error) => toast.error(error.message),
  })
  return { stop: () => mutation.mutate(), stopping }
}

/* ------------------------------ 「按意见改进」草稿 ------------------------------ */

/** 改进草稿的最小入参：ScoreReport 可直接传入；正文面板「改进正文」按钮按章节信息拼参复用同一流程 */
export type ImproveDraftInput = Pick<
  ScoreReport,
  "targetType" | "targetId" | "targetLabel" | "score"
>

/**
 * 章正文/章大纲的「按意见改进」统一流程草稿（2026-09 三入口合一：
 * 评审视图头部按钮 / 悬浮评分指示器浮窗按钮 / 正文面板工具条「改进正文」按钮）。
 * 流程：① 逐条处理行内评论（listTextComments → handleTextComment，同正文面板原逻辑）
 * → ② 对照评分报告整体改进（getScoreReport 读回多维度评分+评委意见+读者团反馈）
 * → ③ 重评刷新分数并对比汇报。
 */
export function improveActionFor(report: ImproveDraftInput) {
  const parsed = chatActionSchema.safeParse({ kind: "improve", targetType: report.targetType, targetId: report.targetId })
  return parsed.success ? parsed.data : undefined
}
export function improveDraftFor(report: ImproveDraftInput): string {
  const group = report.targetType === "CHAPTER_CONTENT" ? "正文" : "大纲"
  const label = report.targetLabel.replace(/(?: · )?(正文|大纲)$/, "").trim().replace(/^第\s*(\d+)\s*章《(.*)》$/, "第$1章 · $2")
  const compare = report.score == null ? "" : `（当前 ${report.score} 分）`
  return `请根据最新评审与未处理评论，改进 @[${group}/${label}]${compare}。先核对当前稿和上下文，保留我已拒绝的建议；逐条判断需要修改的地方，保持文风和原有情节。准备好候选后检查完整性、字数和一致性，再对比评审结果，告诉我改了什么、哪些意见未采纳及原因。存在风险或质量下降时保留当前稿，交给我选择；不要自动定稿。`
}

/** 候选评审「按意见改进」的意见摘要：评委卡前 3 条【aspect】issue 拼接（无则空串，improveMessage 走可留空口径） */
export function candidateReviewFeedback(report: ScoreReport): string {
  const judge = report.agents.find((a) => a.kind === "judge")
  return (judge?.items ?? [])
    .slice(0, 3)
    .map((i) => (i.issue ? `【${i.aspect}】${i.issue}` : ""))
    .filter(Boolean)
    .join("；")
}

/**
 * 「发起/重新评审」的对话草稿（requestNewConversation autoSend；chat.system 意图路由
 * 「全量评审」承接）：章正文=评委+读者团两路全量，章/卷大纲=仅评委评审。
 */
export function reviewDraftFor(report: ScoreReport): string {
  const base = report.targetLabel.replace(/(正文|大纲)$/, "")
  const compare = report.score !== null ? `，并与上次得分（${report.score} 分）对比` : ""
  if (report.targetType === "CHAPTER_CONTENT") {
    return `重新评审${base}的正文（全量）：先让 AI 评审员逐维度评审，再让三位读者（小白/老白/目标受众）试读；全部完成后汇报评委与读者团评分${compare}，并汇总核心意见。`
  }
  const kindText = report.targetType === "VOLUME_OUTLINE" ? "的大纲" : "的大纲"
  return `重新评审${base}${kindText}：让 AI 评审员逐维度打分并给出修改意见，汇报评分与核心问题${compare}。`
}

/** 「改进」按钮文案：按目标类型区分（正文/大纲） */
export function improveActionLabel(targetType: ScoreTargetType): string {
  switch (targetType) {
    case "CHAPTER_CONTENT":
      return "改进正文"
    case "CHAPTER_OUTLINE":
    case "VOLUME_OUTLINE":
      return "改进大纲"
  }
}

/* ------------------------------ 时间格式 ------------------------------ */

/** 「MM-DD HH:mm」（评分时间/历史行用） */
export function formatScoreTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 「YYYY-MM-DD HH:mm」（详情页头部用） */
export function formatScoreTimeFull(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${formatScoreTime(iso)}`
}
