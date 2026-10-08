"use client"

import { useEffect, useRef, useState } from "react"
import { Droplet, MessageCircleQuestion } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

import { formatCostEstimate } from "./cost-estimate"
import type { PendingQuestion, QuestionMarkerStyle } from "./types"
import { REDRAW_DIRECT_LABEL, REDRAW_REQUIRE_LABEL, redrawDirectAnswer, redrawRequireAnswer } from "@/lib/draw-redraw"
import { StoryTaskNavigationPanel } from "./StoryTaskNavigationPanel"
import type { StorySelection } from "@/lib/story-task"
import { ModelPicker } from "./ModelPicker"

/** 选项序号序列（最多 5 个模型选项 + 抽卡注入 2 行 + 末尾「其他」，共 8 个） */
export const MARKERS: Record<QuestionMarkerStyle, string[]> = {
  letters: ["A", "B", "C", "D", "E", "F", "G", "H"],
  numbers: ["1", "2", "3", "4", "5", "6", "7", "8"],
  stems: ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"],
}

interface AskUserPanelProps {
  pending: PendingQuestion
  /** 提交回答（已拼装为「【回答问题】…」文本），由调用方走正常发送流程 */
  onSubmit: (text: string, selection?: StorySelection) => void | Promise<void>
  /** 取消问答：面板消失、恢复输入框，不向参谋发送任何消息 */
  onCancel: () => void
}

/**
 * 参谋提问（askUserQuestion 工具）的问答面板：生成结束时替换 composer 输入框。
 * 单问题时点击选项直接提交（codex 式）；多问题逐题单选后统一提交。
 * 每题末尾恒有「其他」行，自带自由文本输入框；Esc 取消（不发任何消息）。
 */
export function AskUserPanel(props: AskUserPanelProps) {
  return props.pending.storyNavigation?.schemaVersion === 2 ? <StoryTaskNavigationPanel key={props.pending.interaction?.id} {...props} /> : <LegacyAskUserPanel {...props} />
}
function LegacyAskUserPanel({ pending, onSubmit, onCancel }: AskUserPanelProps) {
  const single = pending.questions.length === 1
  const submitted = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const sendAnswer = async (text: string) => {
    if (submitted.current) return
    submitted.current = true
    setSubmitting(true)
    try { await onSubmit(text) }
    finally { submitted.current = false; setSubmitting(false) }
  }
  const navigation = pending.storyNavigation
  /** 抽卡后的选稿问答（服务端附加 drawRedraw，仅单问题）：注入「直接换一批 / 根据要求换一批」两行 */
  const redraw = pending.drawRedraw && pending.questions.length === 1 ? pending.drawRedraw : null
  /** 每题选中的行号；无注入时行号 === options.length 表示「其他」；有注入时 n/n+1/n+2 = 直接换一批/根据要求换一批/其他 */
  const [selections, setSelections] = useState<(number | null)[]>(() =>
    pending.questions.map(() => null)
  )
  const [customTexts, setCustomTexts] = useState<string[]>(() => pending.questions.map(() => ""))
  const [redrawTexts, setRedrawTexts] = useState<string[]>(() => pending.questions.map(() => ""))
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const redrawInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const markers = MARKERS[pending.markerStyle] ?? MARKERS.letters

  // Esc 取消问答（面板挂载期间全局生效；composer 此时未渲染，不与 @ 弹窗的 Esc 冲突）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !(e.target instanceof Element && e.target.closest('[role="menu"]'))) {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onCancel])

  const selectRow = (qi: number, row: number) => {
    setSelections((prev) => prev.map((s, i) => (i === qi ? row : s)))
  }

  const answerFor = (qi: number): string => {
    const q = pending.questions[qi]
    const sel = selections[qi]
    const n = q.options.length
    if (sel !== null && sel < n) return q.options[sel]
    if (redraw && sel === n) return redrawDirectAnswer()
    if (redraw && sel === n + 1) return redrawRequireAnswer(redrawTexts[qi].trim())
    return customTexts[qi].trim()
  }

  const canSubmit = pending.questions.every((q, i) => {
    const sel = selections[i]
    const n = q.options.length
    if (sel === null) return false
    if (sel < n) return true
    if (redraw && sel === n) return true
    if (redraw && sel === n + 1) return redrawTexts[i].trim().length > 0
    return customTexts[i].trim().length > 0
  })

  const composeAnswerText = (): string => {
    if (single) {
      return `【回答问题】${pending.questions[0].question}\n我的回答：${answerFor(0)}`
    }
    const parts = pending.questions.map(
      (q, i) => `${i + 1}. ${q.question}\n我的回答：${answerFor(i)}`
    )
    return `【回答问题】\n${parts.join("\n")}`
  }

  const submit = () => {
    if (!canSubmit) return
    sendAnswer(composeAnswerText())
  }

  /** 单问题模式：点击选项立即提交 */
  const pickDirect = (optionIndex: number) => {
    const q = pending.questions[0]
    sendAnswer(`【回答问题】${q.question}\n我的回答：${q.options[optionIndex]}`)
  }

  /** 注入行「直接换一批」：与普通选项同交互，单问题点击即提交 */
  const pickRedrawDirect = () => {
    const q = pending.questions[0]
    sendAnswer(`【回答问题】${q.question}\n我的回答：${redrawDirectAnswer()}`)
  }

  /** 其他行的行号（有注入时往后让两位） */
  const otherRowOf = (qi: number) => pending.questions[qi].options.length + (redraw ? 2 : 0)

  const pickOther = (qi: number) => {
    selectRow(qi, otherRowOf(qi))
    inputRefs.current[qi]?.focus()
  }

  const pickRedrawRequire = (qi: number) => {
    selectRow(qi, pending.questions[qi].options.length + 1)
    redrawInputRefs.current[qi]?.focus()
  }

  return (
    <div
      data-testid="ask-user-panel"
      className="mx-auto w-full max-w-[960px] overflow-hidden rounded-composer border border-(--chat-line-strong) bg-chat-surface"
    >
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <MessageCircleQuestion className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12.5px] font-medium text-foreground">{navigation ? "这一版如何继续？" : "参谋想请你确认"}</span>
        <ModelPicker />
      </div>

      {navigation && <div className="border-b border-border px-3.5 py-2 text-xs text-muted-foreground">
        {navigation.score !== null && <p>当前版本 {navigation.score} 分 · 合格线 {navigation.threshold} 分</p>}
        <p>“认可并…”会接受当前版本并开始所选任务；继续改进不代表认可。</p>
      </div>}
      {/* 高成本操作的消耗预估（§2.6）：墨滴区间（mono 11.5px muted + 墨滴图标，不加彩色）；
          出图不消耗墨滴，改显示耗时说明 */}
      {pending.costEstimate && (
        <div className="flex items-center gap-1.5 border-b border-border px-3.5 py-2 font-mono text-[11.5px] text-muted-foreground">
          <Droplet className="size-3 shrink-0" />
          {pending.costEstimate.kind === "characterImages" ? (
            <span>
              出图不消耗墨滴 · 每张约 20 秒 · 共{" "}
              <b className="font-normal text-foreground/75 tabular-nums">
                {pending.costEstimate.count}
              </b>{" "}
              张
            </span>
          ) : (
            <span>
              预计消耗{" "}
              <b className="font-normal text-foreground/75 tabular-nums">
                {formatCostEstimate(pending.costEstimate)}
              </b>{" "}
              墨滴
            </span>
          )}
        </div>
      )}

      <div className="max-h-[50vh] overflow-y-auto">
        {pending.questions.map((q, qi) => {
          const n = q.options.length
          const directRow = n
          const requireRow = n + 1
          const otherRow = n + (redraw ? 2 : 0)
          return (
            <div key={qi} className={cn("px-3.5 py-3", qi > 0 && "border-t border-border")}>
              <p className="text-[13px] leading-relaxed font-medium text-foreground">
                {q.question}
              </p>
              <div className="mt-2 flex flex-col gap-1">
                {q.options.map((opt, oi) => {
                  const selected = selections[qi] === oi
                  return (
                    <button
                      key={oi}
                      type="button"
                      disabled={submitting}
                      data-testid={`ask-option-${qi}-${oi}`}
                      onClick={() => (single ? pickDirect(oi) : selectRow(qi, oi))}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-inner px-2 py-1.5 text-left text-[12.5px] transition-colors",
                        selected
                          ? "bg-selected-surface text-foreground"
                          : "text-foreground/90 hover:bg-hover-wash"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-medium",
                          selected
                            ? "border-primary text-primary"
                            : "border-input text-muted-foreground"
                        )}
                      >
                        {markers[oi]}
                      </span>
                      <span className="min-w-0 flex-1 leading-relaxed">{opt}
                        {navigation?.choices[oi]?.description && <span className="mt-0.5 block text-xs text-muted-foreground">{navigation.choices[oi].description}</span>}
                      </span>
                    </button>
                  )
                })}
                {/* 抽卡选稿问答注入：直接换一批（点击即提交）/ 根据要求换一批（右侧输入框） */}
                {redraw && (
                  <button
                    type="button"
                    disabled={submitting}
                    data-testid={`ask-option-${qi}-redraw-direct`}
                    onClick={pickRedrawDirect}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-inner px-2 py-1.5 text-left text-[12.5px] transition-colors",
                      selections[qi] === directRow
                        ? "bg-selected-surface text-foreground"
                        : "text-foreground/90 hover:bg-hover-wash"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-medium",
                        selections[qi] === directRow
                          ? "border-primary text-primary"
                          : "border-input text-muted-foreground"
                      )}
                    >
                      {markers[directRow]}
                    </span>
                    <span className="min-w-0 flex-1 leading-relaxed">
                      {REDRAW_DIRECT_LABEL}
                      <span className="ml-1.5 text-[11px] text-muted-foreground">不附带要求，重新抽 3 张</span>
                    </span>
                  </button>
                )}
                {redraw && (
                  <div
                    data-testid={`ask-option-${qi}-redraw-require`}
                    onClick={() => pickRedrawRequire(qi)}
                    className={cn(
                      "flex w-full cursor-text items-center gap-2.5 rounded-inner px-2 py-1.5 text-[12.5px] transition-colors",
                      selections[qi] === requireRow
                        ? "bg-selected-surface"
                        : "text-foreground/90 hover:bg-hover-wash"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-medium",
                        selections[qi] === requireRow
                          ? "border-primary text-primary"
                          : "border-input text-muted-foreground"
                      )}
                    >
                      {markers[requireRow]}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{REDRAW_REQUIRE_LABEL}</span>
                    <input
                      ref={(el) => {
                        redrawInputRefs.current[qi] = el
                      }}
                      value={redrawTexts[qi]}
                      onChange={(e) => {
                        const v = e.target.value
                        setRedrawTexts((prev) => prev.map((t, i) => (i === qi ? v : t)))
                        // 输入即视为选中「根据要求换一批」
                        if (selections[qi] !== requireRow) selectRow(qi, requireRow)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault()
                          submit()
                        }
                      }}
                      placeholder="输入改进方向或要求…"
                      className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70"
                    />
                  </div>
                )}
                {/* 其他：恒在末尾，自带自由文本输入框 */}
                <div
                  data-testid={`ask-option-${qi}-other`}
                  onClick={() => pickOther(qi)}
                  className={cn(
                    "flex w-full cursor-text items-center gap-2.5 rounded-inner px-2 py-1.5 text-[12.5px] transition-colors",
                    selections[qi] === otherRow
                      ? "bg-selected-surface"
                      : "text-foreground/90 hover:bg-hover-wash"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-medium",
                      selections[qi] === otherRow
                        ? "border-primary text-primary"
                        : "border-input text-muted-foreground"
                    )}
                  >
                    {markers[otherRow]}
                  </span>
                  <span className="shrink-0 text-muted-foreground">其他</span>
                  <input
                    ref={(el) => {
                      inputRefs.current[qi] = el
                    }}
                    value={customTexts[qi]}
                    onChange={(e) => {
                      const v = e.target.value
                      setCustomTexts((prev) => prev.map((t, i) => (i === qi ? v : t)))
                      // 输入即视为选中「其他」
                      if (selections[qi] !== otherRow) selectRow(qi, otherRow)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        submit()
                      }
                    }}
                    placeholder="输入你自己的答案…"
                    className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {navigation && <div className="flex flex-wrap gap-2 border-t border-border px-3.5 py-2">
        {navigation.shortcuts.map(choice => <Button key={choice.label} variant="ghost" size="sm" disabled={submitting} onClick={() => sendAnswer(`【回答问题】${pending.questions[0].question}\n我的回答：${choice.label}`)}>{choice.label}</Button>)}
        <Button variant="ghost" size="sm" disabled={submitting} onClick={onCancel}>暂停</Button>
      </div>}
      <div className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2">
        <span className="text-[11px] text-muted-foreground">
          {single
            ? redraw
              ? "点击选项直接提交，「根据要求换一批」「其他」可自由填写 · 可点开上方候选卡片看全文"
              : "点击选项直接提交，「其他」可自由填写"
            : "为每个问题选择答案后提交"}
          {" · "}
          <kbd className="rounded border border-border bg-muted px-1 font-sans text-[10px]">Esc</kbd>
          {" 取消"}
        </span>
        <Button
          size="sm"
          className="h-7 shrink-0 text-xs"
          disabled={!canSubmit || submitting}
          onClick={submit}
          data-testid="ask-submit"
        >
          提交回答
        </Button>
      </div>
    </div>
  )
}
