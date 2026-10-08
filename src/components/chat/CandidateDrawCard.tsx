"use client"

/**
 * 正文抽卡组卡（创作流程 v4 §3）：drawChapterCandidates 工具成功 output 的专用渲染。
 * 三卡横排（md 起）/窄屏纵排；每卡=角度徽标 + 状态徽标 + 4 行摘录 + 字数档；
 * 点击卡片在右侧内容区打开候选全文 Tab（chapter-candidate，与正文/大纲同体系）。
 * 标题行右侧 [换一批]：按当前设置直接重抽；悬停弹出抽卡设置悬浮框（数量/字数，仅本批）。
 * 历史消息是快照：采用/丢弃后不联动改态，最新状态以内容区候选面板/正文面板为准。
 */
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { buildTabId, useTabsStore } from "@/stores/tabs"
import { useChatStore } from "@/stores/chat"
import { Button } from "@/components/ui/button"
import type { DrawCandidateView, DrawChapterResult } from "@/lib/services/chapter-draw"
import {
  REDRAW_DEFAULT_COUNT,
  drawResultOf,
  redrawDirectAnswer,
  redrawInstruction,
  redrawWordRangeError,
  type DrawRedrawSettings,
} from "@/lib/draw-redraw"

import { dispatchChatSendMessage } from "./ui-events"
import { useCardSelection } from "./use-card-selection"
import { drawRedrawSettingsOf, useDrawRedrawSettings } from "./use-draw-redraw-settings"
import type { ToolCallView } from "./types"

/** 候选状态徽标文案（与 ChapterHistory 的 LABELS 同源语义） */
const STATUS_LABELS: Record<string, string> = {
  ready: "可采用",
  needs_review: "待检查",
  incomplete: "未通过检查",
  reviewing: "正在评审",
  accepted: "已采用",
  discarded: "已丢弃",
  withdrawn: "已撤回",
}

/** 状态徽标配色：可采用=青绿 / 待检查及其余=灰 / 硬检查未过=朱红（仅语义令牌） */
function statusBadgeClass(candidate: DrawCandidateView): string {
  if (candidate.hardChecks.length > 0 || candidate.status === "incomplete") {
    return "bg-destructive/10 text-destructive"
  }
  if (candidate.status === "ready") return "bg-success/12 text-success"
  if (candidate.status === "accepted") return "border border-success/40 text-success"
  return "bg-muted text-muted-foreground"
}

function statusBadgeLabel(candidate: DrawCandidateView): string {
  if (candidate.hardChecks.length > 0) return "未通过检查"
  return STATUS_LABELS[candidate.status] ?? candidate.status
}

/** 字数档：档内正常色；超档朱红并标差值（低于下限=差 N / 超出上限=超 N） */
function WordCountLine({ candidate, wordMin, wordBudget }: { candidate: DrawCandidateView; wordMin: number; wordBudget: number }) {
  const { wordCount } = candidate
  let note: string | null = null
  let outOfRange = false
  if (wordMin > 0 && wordCount < wordMin) {
    note = `差 ${wordMin - wordCount}`
    outOfRange = true
  } else if (wordBudget > 0 && wordCount > wordBudget) {
    note = `超 ${wordCount - wordBudget}`
    outOfRange = true
  } else if (wordMin > 0 || wordBudget > 0) {
    note = "档内"
  }
  return (
    <div className="flex items-baseline gap-1.5 border-t border-border/60 pt-1.5 text-[11.5px]">
      <span className="tabular-nums text-foreground/80">{wordCount.toLocaleString()} 字</span>
      {note && (
        <span className={outOfRange ? "text-destructive" : "text-muted-foreground"}>（{note}）</span>
      )}
    </div>
  )
}

/** 点击候选卡：内容区打开候选全文 Tab（已存在则激活），同时写入会话内选中态（对话区切换为选卡操作面板） */
function openCandidateTab(novelId: string, draw: DrawChapterResult, candidate: DrawCandidateView) {
  useTabsStore.getState().openTab({
    id: buildTabId("chapter-candidate", novelId, { refId: candidate.id }),
    type: "chapter-candidate",
    novelId,
    refId: candidate.id,
    chapterId: draw.chapterId,
    title: `${draw.chapterTitle} · ${candidate.label}`,
  })
  useCardSelection.getState().selectCard({
    conversationId: useChatStore.getState().conversationId,
    novelId,
    chapterId: draw.chapterId,
    chapterTitle: draw.chapterTitle,
    candidateId: candidate.id,
    label: candidate.label,
  })
}

/**
 * [换一批] 按钮 + 悬停抽卡设置悬浮框。
 * 点击=按当前设置（悬浮框记忆或默认 3 张/本章规划档）立即换一批：本章选稿问答待答时
 * 等同选「直接换一批」作答，否则发换一批指令（待答无关问答/生成中由发送入口排队）。
 * 悬停 120ms 开悬浮框、离开 250ms 关；框内交互后钉住，点外部/Esc/提交关闭。
 * 悬浮框在组卡容器内绝对定位，不走 portal（对话区令牌不覆盖 portal）。
 */
function DrawRedrawControl({ draw, novelId }: { draw: DrawChapterResult; novelId: string }) {
  const defaults = { wordMin: draw.wordMin, wordBudget: draw.wordBudget }
  const byChapter = useDrawRedrawSettings((s) => s.byChapter)
  const settings = drawRedrawSettingsOf(byChapter, draw.chapterId, defaults)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [draft, setDraft] = useState<{ count: number; wordMin: string; wordBudget: string } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const close = () => {
    setOpen(false)
    setPinned(false)
  }

  // 开启期间 Esc 关闭；钉住后点外部关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        close()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (pinned && wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onDown, true)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onDown, true)
    }
  }, [open, pinned])

  const openSoon = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    if (open) return
    openTimer.current = window.setTimeout(() => {
      setDraft({ count: settings.count, wordMin: String(settings.wordMin), wordBudget: String(settings.wordBudget) })
      setOpen(true)
    }, 120)
  }

  const closeSoon = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (pinned) return
    closeTimer.current = window.setTimeout(() => setOpen(false), 250)
  }

  const dispatch = (next: DrawRedrawSettings) => {
    const pending = useChatStore.getState().pendingQuestion
    if (pending?.drawRedraw?.chapterId === draw.chapterId && pending.questions.length === 1) {
      dispatchChatSendMessage(`【回答问题】${pending.questions[0].question}\n我的回答：${redrawDirectAnswer(next, defaults)}`, novelId, { answer: true })
    } else {
      dispatchChatSendMessage(redrawInstruction(draw.chapterTitle, defaults, next), novelId)
    }
    close()
  }

  const wordError = draft ? redrawWordRangeError(Number(draft.wordMin), Number(draft.wordBudget)) : null

  const submitSettings = () => {
    if (!draft || wordError) return
    const next = { count: draft.count, wordMin: Number(draft.wordMin), wordBudget: Number(draft.wordBudget) }
    useDrawRedrawSettings.getState().setSettings(draw.chapterId, next)
    dispatch(next)
  }

  const resetSettings = () => {
    useDrawRedrawSettings.getState().resetSettings(draw.chapterId)
    setDraft({ count: REDRAW_DEFAULT_COUNT, wordMin: String(defaults.wordMin), wordBudget: String(defaults.wordBudget) })
  }

  return (
    <span ref={wrapRef} className="relative ml-auto inline-flex shrink-0" onMouseEnter={openSoon} onMouseLeave={closeSoon}>
      <button
        type="button"
        data-testid="candidate-draw-redraw"
        onClick={() => dispatch(settings)}
        title="按当前设置重新抽一批候选稿；悬停可调整抽卡设置"
        className="inline-flex items-center gap-1 rounded-inner border border-(--chat-line) px-2 py-[3px] text-[11.5px] leading-none text-muted-foreground transition-colors hover:border-(--chat-line-strong) hover:bg-hover-wash hover:text-foreground"
      >
        ⟳ 换一批
      </button>
      {open && draft && (
        <div
          data-testid="redraw-settings"
          className="absolute right-0 top-[calc(100%+6px)] z-20 flex w-[248px] flex-col gap-2 rounded-card border border-(--chat-line-strong) bg-card p-3 text-left shadow-3"
          onPointerDown={() => setPinned(true)}
          onFocus={() => setPinned(true)}
        >
          <p className="text-[12px] font-medium text-foreground">抽卡设置</p>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="w-[54px] shrink-0 text-muted-foreground">抽卡数量</span>
            <div className="ml-auto flex overflow-hidden rounded-inner border border-(--chat-line)">
              {[1, 2, 3, 4, 5].map((c) => (
                <button
                  key={c}
                  type="button"
                  data-testid={`redraw-count-${c}`}
                  onClick={() => setDraft((d) => (d ? { ...d, count: c } : d))}
                  className={cn(
                    "border-l border-(--chat-line) px-2.5 py-[3px] text-[11.5px] first:border-l-0",
                    c === draft.count ? "bg-selected-surface font-medium text-primary" : "text-muted-foreground hover:bg-hover-wash"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="w-[54px] shrink-0 text-muted-foreground">字数范围</span>
            <input
              data-testid="redraw-word-min"
              value={draft.wordMin}
              onChange={(e) => setDraft((d) => (d ? { ...d, wordMin: e.target.value } : d))}
              inputMode="numeric"
              className="ml-auto w-[62px] rounded-inner border border-input bg-transparent px-1.5 py-[3px] text-right text-[12px] text-foreground outline-none focus:border-ring"
            />
            <span className="shrink-0 text-muted-foreground">～</span>
            <input
              data-testid="redraw-word-max"
              value={draft.wordBudget}
              onChange={(e) => setDraft((d) => (d ? { ...d, wordBudget: e.target.value } : d))}
              inputMode="numeric"
              className="w-[62px] rounded-inner border border-input bg-transparent px-1.5 py-[3px] text-right text-[12px] text-foreground outline-none focus:border-ring"
            />
            <span className="shrink-0 text-muted-foreground">字</span>
          </div>
          {wordError && <p className="text-[11px] text-destructive">{wordError}</p>}
          <p className="text-[10.5px] text-muted-foreground">仅作用本批候选，不改卷章大纲；默认取本章当前规划档</p>
          <div className="mt-0.5 flex items-center justify-between">
            <button
              type="button"
              data-testid="redraw-settings-reset"
              onClick={resetSettings}
              className="rounded-inner px-1.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
            >
              重置
            </button>
            <Button size="sm" className="h-7 text-xs" disabled={!!wordError} onClick={submitSettings} data-testid="redraw-settings-submit">
              换一批
            </Button>
          </div>
        </div>
      )}
    </span>
  )
}

function CandidateThumb({
  candidate,
  wordMin,
  wordBudget,
  onOpen,
}: {
  candidate: DrawCandidateView
  wordMin: number
  wordBudget: number
  onOpen: () => void
}) {
  const failed = candidate.hardChecks.length > 0 || candidate.status === "incomplete"
  // 选中态：对话区选卡操作面板的数据源（点卡即选中，面板操作该卡）
  const selected = useCardSelection((s) => s.selection?.candidateId === candidate.id)
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`candidate-card-${candidate.variant}`}
      aria-pressed={selected}
      title={failed ? candidate.hardChecks.join("；") || "生成未完成" : "点击在内容区查看全文"}
      className={cn(
        "flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-inner border border-(--chat-line) bg-card px-2.5 py-2 text-left transition-all hover:shadow-[inset_0_0_0_999px_var(--hover-wash)]",
        selected && "border-primary bg-selected-surface hover:bg-selected-surface hover:shadow-none"
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-[1px] text-[11px] text-primary">
          {candidate.label}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 rounded-full px-2 py-[1px] text-[11px]",
            statusBadgeClass(candidate)
          )}
        >
          {statusBadgeLabel(candidate)}
        </span>
      </div>
      <p className="line-clamp-4 min-h-[6.2em] text-[12px] leading-[1.55] whitespace-pre-wrap text-muted-foreground">
        {candidate.excerpt}
      </p>
      <WordCountLine candidate={candidate} wordMin={wordMin} wordBudget={wordBudget} />
    </button>
  )
}

/** 单次抽卡结果组卡：组头（章节 + 候选数）+ 三卡 + 失败行 */
export function CandidateDrawCard({
  draw,
  novelId,
}: {
  draw: DrawChapterResult
  novelId: string
}) {
  return (
    <div
      data-testid="candidate-draw-card"
      className="chat-enter flex w-full flex-col gap-2 rounded-card border border-(--chat-line) bg-chat-surface px-3.5 py-2.5 shadow-1"
    >
      <div className="flex items-start justify-between gap-2 text-[12.5px]">
        {/* 头部行：标题 + [换一批] 按钮；「基于…改进 · 作者意见」独立成行占满组卡全宽，不受按钮影响 */}
        <span className="min-w-0 flex-1 font-medium text-foreground">
          🃏 正文抽卡 · 《{draw.chapterTitle}》 · {draw.candidates.length} 张候选稿
        </span>
        <DrawRedrawControl draw={draw} novelId={novelId} />
      </div>
      {draw.basedOn && (
        <div
          className="line-clamp-3 text-[11.5px] whitespace-pre-wrap text-muted-foreground"
          title={draw.basedOn.feedback || undefined}
        >
          {draw.basedOn.kind === "current" ? "基于当前正文改进（正文改进对话框）" : "基于候选改进"}
          {draw.basedOn.feedback ? ` · 作者意见：${draw.basedOn.feedback}` : ""}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {draw.candidates.map((candidate) => (
          <CandidateThumb
            key={candidate.id}
            candidate={candidate}
            wordMin={draw.wordMin}
            wordBudget={draw.wordBudget}
            onOpen={() => openCandidateTab(novelId, draw, candidate)}
          />
        ))}
      </div>
      {draw.failures.length > 0 && (
        <div data-testid="candidate-draw-failures" className="flex flex-col gap-1">
          {draw.failures.map((failure) => (
            <p
              key={failure.variant}
              className="rounded-inner bg-muted px-2.5 py-1.5 text-[11.5px] text-muted-foreground"
            >
              「{failure.label}」角度生成失败：{failure.reason}
            </p>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        点击卡片在右侧内容区查看全文，并在下方选择对该卡的操作；本章已有正文时，采用另一候选将替换当前正文。
      </p>
    </div>
  )
}

/** 消息级分派：扫描工具调用，done 且带 draw 结果的 drawChapterCandidates / getChapterCandidates 渲染为组卡。
    会话级同批去重：suppressedDrawIds（此前消息已渲染的 drawId，ChatPanel 消息 map 处按序累计）之外的
    重复批次（getChapterCandidates 就地重现 / 同参重放 / 同消息重复）折叠为一行提示——同一 drawId 全会话
    只在首个出现位置渲染完整组卡，修复跨批次重复渲染与选中「联动」。按 toolCalls 顺序单遍完成。 */
export function CandidateDrawCards({
  toolCalls,
  novelId,
  suppressedDrawIds,
}: {
  toolCalls: ToolCallView[]
  novelId: string
  suppressedDrawIds?: ReadonlySet<string>
}) {
  const entries: { key: string; draw: DrawChapterResult }[] = []
  let suppressedCount = 0
  const seen = new Set(suppressedDrawIds ?? [])
  for (const call of toolCalls) {
    if ((call.toolName !== "drawChapterCandidates" && call.toolName !== "getChapterCandidates") || call.status !== "done") continue
    const draw = drawResultOf(call.output)
    if (!draw) continue
    if (seen.has(draw.drawId)) { suppressedCount++; continue }
    seen.add(draw.drawId)
    entries.push({ key: call.toolCallId, draw })
  }
  if (entries.length === 0 && suppressedCount === 0) return null
  return (
    <>
      {entries.map((entry) => (
        <CandidateDrawCard key={entry.key} draw={entry.draw} novelId={novelId} />
      ))}
      {suppressedCount > 0 && (
        <p data-testid="candidate-draw-dup-note" className="px-1 text-[11px] text-muted-foreground">
          该组候选与上文组卡为同一批，已在上文展示。
        </p>
      )}
    </>
  )
}
