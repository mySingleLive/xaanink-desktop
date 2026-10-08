"use client"

/**
 * 候选全文内容面板（tab type=chapter-candidate，refId=候选 id，chapterId 由 tab 携带）：
 * 抽卡组卡点卡进入，与正文/大纲同内容区 Tab 体系。拉取候选全文，正文区复用 MarkdownEditor
 * 的「预览 + 评审」两视图（modes 限定、Monaco 不挂载，天然只读）：预览=排版预览 + 行内评论
 * （评论目标为候选稿 CANDIDATE_CONTENT，作者评论与 AI 评审意见同列）；评审=该候选的 AI 评分
 * 详情（ScoreReportPanel 候选维度）+ 候选评论区块。右下角悬浮评分指示器（ScoreIndicator
 * 候选维度）一键切评审视图；子视图状态存模块级 Map（重挂载/关闭重开均恢复）。
 * 底部操作条：采用（三分支——命中当前会话待答选稿问答时经 chat:send-message
 * 走真实回答链路；无问答时 REST accept 并追加推进消息；已采用时转为「让参谋继续推进」
 * 只发推进消息）、以此为基础改进（内联反馈 → chat:send-message 发用户消息）。
 * 采用走既有候选 REST，成功后失效 ["content-candidates"]、["chapter", chapterId]、
 * ["comments"]、["score-report"] 并刷新本面板状态（tab 保留，展示已采用/已撤回等状态）。
 */
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { MarkdownEditor, type EditorMode } from "@/components/editor/MarkdownEditor"
import { ScoreIndicator } from "@/components/score/ScoreIndicator"
import { buildTabId } from "@/stores/tabs"
import { hardContentChecks } from "@/lib/content-policy"
import { wordBounds } from "@/lib/word-requirement"
import { ACCEPTABLE_STATUSES, CANDIDATE_STATUS_LABELS, improveMessage, VARIANT_LABELS } from "@/lib/card-select-actions"
import { dispatchChatSendMessage } from "@/components/chat/ui-events"
import { usePendingAnswerMatch } from "@/components/chat/pending-answer"

import { apiGet } from "./api"
import { acceptCandidateAction, candidateAdvanceMessage, useLaterChapterCount, type CandidateDetail } from "./candidate-accept"
import type { ContentPanelProps } from "./registry"
import type { ChapterDetail } from "./types"

/** 候选状态徽标文案（与 ChapterHistory 的 LABELS 同源语义） */
const STATUS_LABELS = CANDIDATE_STATUS_LABELS

/** 预览/评审视图记忆（会话级，按 tab.id）：重挂载（revertNonce）与关闭重开都恢复——
    subTabs 在 closeTab 时被清（store 既有语义），无法满足「重开恢复上次视图」（01-product-design §2），故用模块级 Map */
const panelViews = new Map<string, EditorMode>()

export function CandidatePanel({ novelId, refId, chapterId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const candidateId = refId
  const root = chapterId && candidateId
    ? `/api/novels/${novelId}/chapters/${chapterId}/candidates/${candidateId}`
    : null
  // 详情键挂在 ["content-candidates"] 前缀下：对话侧任何写工具完成（含问答链采用）都会
  // 失效列表并顺带刷新本面板状态徽标（invalidateNovelQueries 只失效该前缀）
  const detailQuery = useQuery({
    queryKey: ["content-candidates", "detail", chapterId, candidateId],
    enabled: root !== null,
    queryFn: () => apiGet<{ candidate: CandidateDetail }>(root!, "读取候选全文失败"),
  })
  // 章题（与 ChapterContentPanel 共享 ["chapter", chapterId] 缓存）
  const chapterQuery = useQuery({
    queryKey: ["chapter", chapterId],
    enabled: !!chapterId,
    queryFn: () => apiGet<{ chapter: ChapterDetail }>(`/api/novels/${novelId}/chapters/${chapterId}`, "加载章节失败"),
  })
  const detail = detailQuery.data?.candidate ?? null
  const chapter = chapterQuery.data?.chapter ?? null
  const chapterTitle = chapter?.title ?? "本章"
  // 换用（card-select F7）：候选 baseVersion 与当前章版本不一致时，「采用这张」转为 replace 语义
  const replaceMode = detail !== null && chapter !== null && detail.baseVersion !== chapter.version
  const laterCount = useLaterChapterCount(novelId, chapter?.id ?? null)
  const [busy, setBusy] = useState<"accept" | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [improveOpen, setImproveOpen] = useState(false)
  const [feedback, setFeedback] = useState("")
  /* 预览/评审子视图：模块级 Map 按 tab.id 记忆（重挂载/关闭重开均恢复；subTabs 会在 closeTab 时被清，不适用） */
  const tabId = buildTabId("chapter-candidate", novelId, { refId: candidateId })
  const [view, setViewState] = useState<EditorMode>(() => (panelViews.get(tabId) === "review" ? "review" : "preview"))
  const setView = (m: EditorMode) => {
    panelViews.set(tabId, m)
    setViewState(m)
  }
  // 当前会话待答问题里命中本候选的选项（采用哪一张？类问答）；命中时「采用这张」走回答链路
  const answerMatch = usePendingAnswerMatch(novelId, candidateId, [
    detail?.variant ? VARIANT_LABELS[detail.variant] : null,
    detail?.variant,
  ])

  if (!root) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        候选信息不完整，请从对话里的抽卡卡片重新打开
      </div>
    )
  }

  const hardChecks = detail ? hardContentChecks(detail.checks) : []
  const hardBlocked = hardChecks.length > 0 || detail?.status === "incomplete"
  const statusBlocked = detail !== null && !ACCEPTABLE_STATUSES.includes(detail.status)
  const acceptDisabledReason = hardBlocked
    ? hardChecks.map((c) => c.message).join("；") || "生成未完成，未通过硬检查"
    : statusBlocked
      ? `该候选当前状态为「${STATUS_LABELS[detail!.status] ?? detail!.status}」，不可采用`
      : null

  const variantLabel = (detail?.variant && VARIANT_LABELS[detail.variant]) || detail?.variant || "候选稿"
  const bounds = detail?.wordRequirement ? wordBounds(detail.wordRequirement) : null
  const outOfRange = detail !== null && bounds !== null &&
    ((bounds.min !== null && detail.wordCount < bounds.min) || (bounds.max !== null && detail.wordCount > bounds.max))

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["content-candidates"] }),
      queryClient.invalidateQueries({ queryKey: ["chapter", chapterId] }),
      // 候选评论与候选/章级评分报告一并失效（react-query 前缀匹配覆盖 4 元素键）
      queryClient.invalidateQueries({ queryKey: ["comments"] }),
      queryClient.invalidateQueries({ queryKey: ["score-report"] }),
    ])
  }

  /** 采用成功后（quiet）或已采用态点「让参谋继续推进」发给对话的推进消息：模型核实并驱动定稿/下一章。
      asAnswer（candidate-continue 点击）走回答通道：send 会把挂着的 pendingQuestion.interaction 附进请求，
      推进消息送达即视为对该问答的正式回答（自由文本回答合法），过时选稿问答随之退去；无待答问答时无害（等同普通发送） */
  const sendAdvance = (detail: CandidateDetail, quiet = false, asAnswer = false) => {
    dispatchChatSendMessage(candidateAdvanceMessage(chapterTitle, variantLabel, detail.wordCount), novelId, asAnswer ? { answer: true } : undefined)
    if (!quiet) toast.info("已发到对话，参谋将核实采用结果并推进后续环节")
  }

  /** 采用（共享链路 candidate-accept）：命中待答选稿问答走 answer 通道；否则 REST accept。
      候选 baseVersion 与当前章版本不一致时为换用（replace）：以当前章版本 CAS 替换正文、原采用稿撤回，
      本章之后已有后续正文时由对话侧发换用过渡检查指令。 */
  const accept = async () => {
    if (busy || !detail || !chapter || acceptDisabledReason) return
    setBusy("accept")
    setActionError(null)
    const result = await acceptCandidateAction({
      novelId,
      chapterTitle,
      chapter: { id: chapter.id, version: chapter.version },
      candidate: detail,
      label: variantLabel,
      answerMatch,
      mode: replaceMode ? "replace" : undefined,
      hasLaterChapters: laterCount > 0,
      queryClient,
      refetchDetail: () => detailQuery.refetch(),
    })
    // 采用成功：候选评审提升为 current 并挂载正文 AI 评论，补失效评论/评分缓存
    if (result.ok) await invalidate()
    else setActionError(result.message)
    setBusy(null)
  }

  /** 改进抽卡：拼装用户消息经 chat:send-message 事件发回当前对话（ChatPanel 统一发送入口；文案与选卡操作面板同源） */
  const sendImprove = () => {
    if (!detail) return
    dispatchChatSendMessage(
      improveMessage({ chapterTitle, label: variantLabel, chapterId: detail.chapterId, candidateId: detail.id }, feedback),
      novelId
    )
    setImproveOpen(false)
    toast.info("改进请求已发到对话，可切回对话面板查看抽卡进度")
  }

  return (
    <div data-testid="candidate-panel" className="flex h-full min-h-0 flex-col bg-editor">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate font-serif text-base font-semibold text-foreground">
          《{chapterTitle}》候选稿 · {variantLabel}
        </h2>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-[1px] text-[11px] text-primary">
          {variantLabel}
        </span>
        {detail && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-[1px] text-[11px]",
              hardBlocked
                ? "bg-destructive/10 text-destructive"
                : detail.status === "ready"
                  ? "bg-success/12 text-success"
                  : detail.status === "accepted"
                    ? "border border-success/40 text-success"
                    : "bg-muted text-muted-foreground"
            )}
          >
            {hardBlocked ? "未通过检查" : STATUS_LABELS[detail.status] ?? detail.status}
          </span>
        )}
        {detail && (
          <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
            {detail.wordCount.toLocaleString()} 字
            {bounds && bounds.min !== null ? ` / 档 ${bounds.min}–${bounds.max ?? "∞"}` : ""}
            {outOfRange && <span className="text-destructive">（超档）</span>}
          </span>
        )}
        <span className="shrink-0 text-[11.5px] text-muted-foreground">基于修订 {detail?.baseVersion ?? "—"}</span>
      </div>

      {hardChecks.length > 0 && (
        <div className="shrink-0 border-b bg-destructive/6 px-4 py-2">
          {hardChecks.map((check, index) => (
            <p key={index} className="text-[12px] text-destructive">⚠ {check.message}</p>
          ))}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {detailQuery.isLoading && (
          <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 正在读取候选全文
          </p>
        )}
        {detailQuery.isError && (
          <div className="p-4 text-sm">
            <p role="alert" className="text-destructive">{detailQuery.error.message}</p>
            <Button className="mt-2" size="sm" variant="outline" onClick={() => void detailQuery.refetch()}>
              重新读取
            </Button>
          </div>
        )}
        {/* 预览+评审两视图（与正文页同构）；预览态无 Monaco 即天然只读，已丢弃稿显式只读 */}
        {detail && (
          <MarkdownEditor
            value={detail.content}
            onChange={() => {}}
            novel
            modes={["preview", "review"]}
            defaultMode="preview"
            mode={view}
            onModeChange={setView}
            readOnly={detail.status === "discarded"}
            commentsTarget={{ novelId, targetType: "CANDIDATE_CONTENT", targetId: detail.id }}
            reviewTarget={chapterId ? { novelId, targetType: "CHAPTER_CONTENT", targetId: chapterId, candidateId: detail.id } : undefined}
            className="h-full min-h-0 rounded-none border-0"
          />
        )}
        {detail && chapterId && (
          <ScoreIndicator novelId={novelId} targetType="CHAPTER_CONTENT" targetId={chapterId} candidateId={detail.id} onOpenReview={() => setView("review")} />
        )}
      </div>

      {actionError && (
        <p role="alert" className="shrink-0 border-t bg-destructive/6 px-4 py-2 text-[12px] text-destructive">
          {actionError}（可刷新候选列表核对最新状态后重试）
        </p>
      )}

      {improveOpen && detail && (
        <div className="shrink-0 border-t bg-card px-4 py-2.5">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="说说要改什么，如：加强验尸细节、放慢节奏…（可留空）"
            className="w-full resize-none rounded-inner border border-input bg-background px-2.5 py-1.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-ring"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setImproveOpen(false)}>收起</Button>
            <Button size="sm" data-testid="candidate-improve-submit" disabled={busy !== null} onClick={sendImprove}>
              生成 3 张新候选
            </Button>
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t bg-card px-4 py-2.5">
        {detail?.status === "accepted" ? (
          /* 已采用：不再发 REST（服务端会 409），只做对话推进派发；走回答通道——
             挂着的过时选稿问答随这条消息被视为已回答而退去（自由文本回答合法），
             无待答问答时等同普通发送 */
          <Button
            size="sm"
            variant="outline"
            data-testid="candidate-continue"
            disabled={busy !== null}
            onClick={() => sendAdvance(detail, false, true)}
            className="border-success/40 text-success hover:bg-success/10"
          >
            已采用 · 让参谋继续推进
          </Button>
        ) : (
          <span title={acceptDisabledReason ?? undefined} className="inline-flex">
            <Button
              size="sm"
              data-testid="candidate-accept"
              disabled={busy !== null || !detail || acceptDisabledReason !== null}
              onClick={() => void accept()}
            >
              {busy === "accept" ? "正在采用…" : replaceMode ? "替换当前正文，采用这张" : "采用这张"}
            </Button>
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          data-testid="candidate-improve"
          disabled={busy !== null || !detail}
          onClick={() => setImproveOpen((v) => !v)}
        >
          以此为基础改进…
        </Button>
      </div>
    </div>
  )
}
