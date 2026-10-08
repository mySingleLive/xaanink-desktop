"use client"

/**
 * 选卡操作面板（card-select F1–F6）：点击抽卡候选卡后在 composer 槽位渲染（优先级：
 * 待答问答 > 本面板 > 输入框）。四大分区——采用 / 改进 / 修复（仅有问题时）/ 其他，
 * 行视觉与 AskUserPanel 一致（序号圆 + 行内输入）。纯客户端交互：采用走
 * candidate-accept 共享链路（普通/调档/换用），改进/修复/其他经 chat:send-message
 * 统一发送入口发固定文案（排队语义由 ChatPanel 既有处理接管）。
 */
import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { wordBounds } from "@/lib/word-requirement"
import {
  buildCardActions,
  CANDIDATE_STATUS_LABELS,
  improveMessage,
  otherMessage,
  VARIANT_LABELS,
  type CardActionRow,
} from "@/lib/card-select-actions"
import { useChatStore } from "@/stores/chat"
import { apiGet } from "@/components/content/api"
import { acceptCandidateAction, useLaterChapterCount, type CandidateDetail } from "@/components/content/candidate-accept"
import type { ChapterDetail } from "@/components/content/types"

import { MARKERS } from "./AskUserPanel"
import { usePendingAnswerMatch } from "./pending-answer"
import { dispatchChatSendMessage } from "./ui-events"
import { useCardSelection } from "./use-card-selection"

/** 发送入口会排队（而非立即发送）的判定：与 ChatPanel.handleSendCardMessage 的排队条件一致 */
function willQueueMessage(): boolean {
  const s = useChatStore.getState()
  return !!(s.pendingQuestion || s.pendingPlan || s.isGenerating || s.recoveryStatus !== "ready" || s.creatingNovel)
}

export function CandidateActionPanel({ novelId, conversationId }: { novelId: string; conversationId: string | null }) {
  const queryClient = useQueryClient()
  const selection = useCardSelection((s) => s.selection)
  const clearCard = useCardSelection((s) => s.clearCard)
  const active = selection !== null && selection.conversationId === conversationId && selection.novelId === novelId
  const chapterId = active ? selection.chapterId : null
  const candidateId = active ? selection.candidateId : null

  const detailQuery = useQuery({
    queryKey: ["content-candidates", "detail", chapterId, candidateId],
    enabled: active,
    queryFn: () =>
      apiGet<{ candidate: CandidateDetail }>(
        `/api/novels/${novelId}/chapters/${chapterId}/candidates/${candidateId}`,
        "读取候选全文失败"
      ),
  })
  const chapterQuery = useQuery({
    queryKey: ["chapter", chapterId],
    enabled: active,
    queryFn: () => apiGet<{ chapter: ChapterDetail }>(`/api/novels/${novelId}/chapters/${chapterId}`, "加载章节失败"),
  })
  const laterCount = useLaterChapterCount(novelId, chapterQuery.data?.chapter.id ?? null)

  const detail = detailQuery.data?.candidate ?? null
  const chapter = chapterQuery.data?.chapter ?? null
  const chapterTitle = chapter?.title ?? selection?.chapterTitle ?? "本章"
  const label = (detail?.variant && VARIANT_LABELS[detail.variant]) || selection?.label || "候选稿"

  const answerMatch = usePendingAnswerMatch(novelId, candidateId ?? undefined, [label, detail?.variant])

  const [texts, setTexts] = useState({ improve: "", other: "" })
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // 选中卡切换后重置行内输入与错误（渲染期校正模式：不经过 effect）
  const [prevCandidateId, setPrevCandidateId] = useState(candidateId)
  if (prevCandidateId !== candidateId) {
    setPrevCandidateId(candidateId)
    setTexts({ improve: "", other: "" })
    setActionError(null)
    setBusy(null)
  }

  // Esc 关闭面板（不发任何消息）
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        clearCard()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, clearCard])

  // 后续章节正文判定（小说详情缓存，仅作换用提示与分流）

  const groups = useMemo(() => {
    if (!active || !detail || !chapter) return null
    const bounds = detail.wordRequirement ? wordBounds(detail.wordRequirement) : null
    const wordMin = bounds?.min ?? 0
    const wordBudget = bounds?.max ?? 0
    const isCurrentAdopted = detail.status === "accepted"
    const baseMatchesCurrent = detail.baseVersion === chapter.version
    return buildCardActions({
      chapterId: detail.chapterId,
      chapterTitle,
      candidateId: detail.id,
      label,
      status: detail.status,
      checks: detail.checks ?? [],
      wordCount: detail.wordCount,
      wordMin,
      wordBudget,
      isCurrentAdopted,
      baseMatchesCurrent,
      hasLaterChapters: laterCount > 0,
      laterChapterRefs: `后续 ${laterCount} 章正文`,
    })
  }, [active, detail, chapter, chapterTitle, label, laterCount])

  if (!active || !selection) return null

  const baseMatchesCurrent = detail && chapter ? detail.baseVersion === chapter.version : true

  /** 发消息类动作：入队（生成中/待答问答等）时面板保留；立即发送则关闭面板回输入框 */
  const sendMessage = (text: string) => {
    const queued = willQueueMessage()
    dispatchChatSendMessage(text, novelId)
    if (!queued) clearCard()
  }

  const runRow = async (row: CardActionRow) => {
    if (busy || row.disabled || !detail || !chapter) return
    setActionError(null)
    if (row.kind === "improve" || row.kind === "fix") {
      if (row.message) sendMessage(row.message)
      return
    }
    // 采用三形态：普通 / 调档 / 换用（调档在换用场景自动叠加 replace）
    setBusy(row.testid)
    try {
      const result = await acceptCandidateAction({
        novelId,
        chapterTitle,
        chapter: { id: chapter.id, version: chapter.version },
        candidate: detail,
        label,
        answerMatch,
        mode: row.kind === "adopt-replace" || (row.kind === "adopt-adjust" && !baseMatchesCurrent) ? "replace" : undefined,
        wordRangeAdjust: row.adjust,
        hasLaterChapters: laterCount > 0,
        queryClient,
        refetchDetail: () => detailQuery.refetch(),
      })
      if (result.ok) clearCard()
      else setActionError(result.message)
    } finally {
      setBusy(null)
    }
  }

  const submitInput = (kind: "improve-require" | "other") => {
    if (!detail) return
    const text = (kind === "improve-require" ? texts.improve : texts.other).trim()
    if (!text) return
    sendMessage(
      kind === "improve-require"
        ? improveMessage({ chapterTitle, label, chapterId: detail.chapterId, candidateId: detail.id }, text)
        : otherMessage({ chapterTitle, label, chapterId: detail.chapterId, candidateId: detail.id }, text)
    )
  }

  const hard = detail ? (detail.checks ?? []).filter((c) => c.hard) : []
  const soft = detail ? (detail.checks ?? []).filter((c) => !c.hard) : []
  const bounds = detail?.wordRequirement ? wordBounds(detail.wordRequirement) : null
  const wordNote =
    detail && bounds && bounds.min !== null && bounds.max !== null
      ? detail.wordCount > bounds.max
        ? `（超 ${(detail.wordCount - bounds.max).toLocaleString()}）`
        : detail.wordCount < bounds.min
          ? `（差 ${(bounds.min - detail.wordCount).toLocaleString()}）`
          : "（档内）"
      : ""

  // 序号跨分区连续（A、B、C…）：分区起始序号 = 前序分区行数累计（纯函数，不在渲染期重赋变量）
  const markerOffset = (key: string) => {
    let n = 0
    for (const g of groups ?? []) {
      if (g.key === key) break
      n += g.rows.length
    }
    return n
  }

  return (
    <div
      data-testid="candidate-action-panel"
      className="mx-auto flex w-full max-w-[960px] flex-col rounded-composer border border-(--chat-line-strong) bg-chat-surface shadow-1"
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3.5 py-2 text-[12.5px]">
        <span className="font-medium text-foreground">已选择：《{chapterTitle}》候选稿</span>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-[1px] text-[11px] text-primary">{label}</span>
        {detail && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-[1px] text-[11px]",
              hard.length > 0 || detail.status === "incomplete"
                ? "bg-destructive/10 text-destructive"
                : detail.status === "ready"
                  ? "bg-success/12 text-success"
                  : detail.status === "accepted"
                    ? "border border-success/40 text-success"
                    : "bg-muted text-muted-foreground"
            )}
          >
            {hard.length > 0 ? "未通过检查" : CANDIDATE_STATUS_LABELS[detail.status] ?? detail.status}
          </span>
        )}
        {detail && (
          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
            {detail.wordCount.toLocaleString()} 字{bounds?.min != null && bounds.max != null ? ` · 档 ${bounds.min}–${bounds.max}` : ""}{wordNote}
          </span>
        )}
        <button
          type="button"
          data-testid="cap-close"
          title="关闭（Esc）"
          onClick={clearCard}
          className="ml-auto rounded-inner p-1 text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {hard.length > 0 && (
        <div className="border-b border-border px-3.5 py-1.5 text-[12px] text-destructive">⚠ {hard.map((c) => c.message).join("；")}</div>
      )}
      {hard.length === 0 && soft.length > 0 && (
        <div className="border-b border-border px-3.5 py-1.5 text-[12px] text-muted-foreground">△ {soft.map((c) => c.message).join("；")}</div>
      )}

      {detailQuery.isLoading && <p className="px-3.5 py-3 text-[12.5px] text-muted-foreground">正在读取候选状态…</p>}
      {detailQuery.isError && (
        <div className="flex items-center gap-2 px-3.5 py-3 text-[12.5px]">
          <p role="alert" className="text-destructive">{detailQuery.error.message}</p>
          <button type="button" className="rounded-inner border border-input px-2 py-0.5 text-xs" onClick={() => void detailQuery.refetch()}>重新读取</button>
        </div>
      )}

      {groups && (
        <div className="max-h-[50vh] overflow-y-auto px-3.5 py-1.5">
          {groups.map((group) => {
            const base = markerOffset(group.key)
            return (
            <div key={group.key} className={cn("py-1", group.key !== "adopt" && "border-t border-border/60")}>
              <p className="px-2 pt-1 pb-0.5 text-[11px] tracking-wide text-muted-foreground">{group.label}</p>
              <div className="flex flex-col gap-0.5">
                {group.rows.map((row, ri) => {
                  const m = MARKERS.letters[Math.min(base + ri, MARKERS.letters.length - 1)]
                  if (row.input) {
                    const value = row.kind === "improve-require" ? texts.improve : texts.other
                    return (
                      <div
                        key={row.testid}
                        data-testid={row.testid}
                        className="flex w-full cursor-text items-center gap-2.5 rounded-inner px-2 py-1.5 text-left text-[12.5px] text-foreground/90 transition-colors hover:bg-hover-wash"
                        onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-input text-[10.5px] font-medium text-muted-foreground">{m}</span>
                        <span className="shrink-0 text-foreground">{row.text}</span>
                        <input
                          value={value}
                          onChange={(e) => setTexts((t) => ({ ...t, [row.kind === "improve-require" ? "improve" : "other"]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                              e.preventDefault()
                              submitInput(row.kind as "improve-require" | "other")
                            }
                          }}
                          placeholder={row.input}
                          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70"
                        />
                      </div>
                    )
                  }
                  return (
                    <button
                      key={row.testid}
                      type="button"
                      data-testid={row.testid}
                      disabled={row.disabled || busy !== null}
                      onClick={() => void runRow(row)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-inner px-2 py-1.5 text-left text-[12.5px] transition-colors",
                        row.disabled ? "cursor-not-allowed opacity-55" : "text-foreground/90 hover:bg-hover-wash"
                      )}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-input text-[10.5px] font-medium text-muted-foreground">{m}</span>
                      <span className="min-w-0 flex-1 leading-relaxed">
                        {busy === row.testid ? "正在执行…" : row.text}
                        {row.sub && (
                          <span className={cn("mt-0.5 block text-xs", row.tone === "err" ? "text-destructive" : row.tone === "strong" ? "text-primary" : "text-muted-foreground")}>
                            {row.sub}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            )
          })}
        </div>
      )}

      {actionError && <p role="alert" className="border-t border-border px-3.5 py-1.5 text-[12px] text-destructive">{actionError}</p>}
      <div className="border-t border-border px-3.5 py-1.5 text-[11px] text-muted-foreground">
        选项即点即执行 · Esc 或 ✕ 返回输入框 · 右侧预览可对照全文
      </div>
    </div>
  )
}
