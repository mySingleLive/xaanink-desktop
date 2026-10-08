"use client"

/**
 * 叙事卡检查报告卡（创作流程 v4 §2）：checkChapterNarrative 工具结果，以及任何
 * output.code==="NARRATIVE_NOT_READY"（drawChapterCandidates/generateChapterContent 前置
 * 拦截）的专用渲染。状态徽标（ready 青绿 / thin 琥珀 / missing 朱红）+ 汇总行 +
 * issues 列表 + 可折叠卡片明细；ready 时收起为单行摘要。
 * 明细行点击高亮定位到叙事线工作区（复用 story-focus 的 openTab + requestPanelFocus）。
 */
import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { buildTabId, useTabsStore } from "@/stores/tabs"
import type { NarrativeAssessment, NarrativeCardReport } from "@/lib/services/narrative-assessment"

import { Collapse } from "./Collapse"
import type { ToolCallView } from "./types"

const STATUS_META: Record<NarrativeAssessment["status"], { label: string; className: string }> = {
  ready: { label: "完备", className: "bg-success/12 text-success" },
  thin: { label: "待细化", className: "bg-warning/12 text-warning" },
  missing: { label: "缺失", className: "bg-destructive/10 text-destructive" },
}

/** 报告来源：checkChapterNarrative 平铺在 output；NARRATIVE_NOT_READY 装在 output.assessment */
function narrativeReportOf(call: ToolCallView): { assessment: NarrativeAssessment; guidance?: string } | null {
  if (call.status !== "done") return null
  const output = call.output
  if (!output || typeof output !== "object") return null
  const record = output as Record<string, unknown>
  if (record.code === "NARRATIVE_NOT_READY") {
    const assessment = record.assessment
    if (assessment && typeof assessment === "object" && typeof (assessment as { chapterId?: unknown }).chapterId === "string") {
      return {
        assessment: assessment as NarrativeAssessment,
        guidance: typeof record.guidance === "string" ? record.guidance : undefined,
      }
    }
    return null
  }
  if (call.toolName === "checkChapterNarrative" && typeof record.chapterId === "string" && typeof record.status === "string" && record.totals && typeof record.totals === "object") {
    return { assessment: output as unknown as NarrativeAssessment }
  }
  return null
}

/** 点击明细行：定位到叙事线工作区对应卡片（无挂载点则由 tab 激活兜底） */
function focusNarrativeCard(novelId: string, card: NarrativeCardReport) {
  const tabId = buildTabId("narrative", novelId, { refId: card.id })
  const store = useTabsStore.getState()
  if (store.activeTabId !== tabId) {
    store.openTab({ id: tabId, type: "narrative", novelId, refId: card.id, title: card.title })
  }
  store.requestPanelFocus(tabId, card.id)
}

function CardDetailRow({ card, novelId }: { card: NarrativeCardReport; novelId: string }) {
  return (
    <button
      type="button"
      onClick={() => focusNarrativeCard(novelId, card)}
      title="在叙事线工作区定位这张卡"
      className="flex w-full flex-col gap-0.5 rounded-inner px-2 py-1.5 text-left transition-colors hover:bg-hover-wash"
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
        <span className="font-medium text-foreground">{card.title}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          深度 {card.depth} · 视角 {card.tellings} · 节拍 {card.beats} · 引用 {card.refs}
          {card.wordBudget != null && card.wordBudget > 0 ? ` · 预算 ${card.wordBudget} 字` : ""}
        </span>
      </span>
      {card.problems.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {card.problems.map((problem) => (
            <span key={problem} className="rounded-full bg-warning/12 px-1.5 py-[0.5px] text-[10.5px] text-warning">
              {problem}
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

export function NarrativeCheckCard({
  assessment,
  guidance,
  novelId,
}: {
  assessment: NarrativeAssessment
  guidance?: string
  novelId: string
}) {
  const [detailOpen, setDetailOpen] = useState(false)
  const status = STATUS_META[assessment.status] ?? STATUS_META.missing
  const { totals } = assessment

  // ready：收起为单行摘要（§2）
  if (assessment.status === "ready") {
    return (
      <div
        data-testid="narrative-check-card"
        className="chat-enter flex w-full items-center gap-2 rounded-card border border-(--chat-line) bg-chat-surface px-3.5 py-2 shadow-1"
      >
        <span className="text-[12.5px] text-success">
          ✓ 叙事卡{assessment.preparation?.checked ? "与创作资料" : ""}完备 · 《{assessment.chapterTitle}》 {totals.readingCards} 卡 {totals.totalBeats} 节拍{assessment.preparation ? ` · ${assessment.preparation.materials} 项资料 / ${assessment.preparation.plants} 处首埋` : ""}，可以抽卡
        </span>
      </div>
    )
  }

  return (
    <div
      data-testid="narrative-check-card"
      className="chat-enter flex w-full flex-col gap-1.5 rounded-card border border-(--chat-line) bg-chat-surface px-3.5 py-2.5 shadow-1"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
        <span className="font-medium text-foreground">🧭 叙事卡检查 · 《{assessment.chapterTitle}》</span>
        <span className={cn("shrink-0 rounded-full px-2 py-[1px] text-[11px]", status.className)}>
          {status.label}（{assessment.status}）
        </span>
        {(assessment.wordMin > 0 || assessment.wordBudget > 0) && (
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            章字数档 {assessment.wordMin}–{assessment.wordBudget}
          </span>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground tabular-nums">
        阅读卡 {totals.readingCards} 张 · 已细化节拍 {totals.cardsWithBeats}/{totals.readingCards} · 总节拍 {totals.totalBeats}（预期 ≥{totals.expectedBeats}）
      </p>
      {assessment.issues.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-[12px] font-medium text-warning">⚠ 待处理</p>
          {assessment.issues.map((issue, index) => (
            <p key={index} className="text-[12px] leading-[1.6] text-foreground/85">
              ・{issue.message}
            </p>
          ))}
        </div>
      )}
      {assessment.issues.length === 0 && guidance && (
        <p className="text-[12px] leading-[1.6] whitespace-pre-wrap text-muted-foreground">{guidance}</p>
      )}
      {assessment.cards.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            className="group/ncd flex items-center gap-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {detailOpen ? "收起卡片明细" : "查看卡片明细"}
            {detailOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3 opacity-0 transition-opacity group-hover/ncd:opacity-100" />}
          </button>
          <Collapse open={detailOpen} className="mt-1 ml-1 border-l border-border/70 pl-2">
            <div className="flex flex-col">
              {assessment.cards.map((card) => (
                <CardDetailRow key={card.id} card={card} novelId={novelId} />
              ))}
            </div>
          </Collapse>
        </div>
      )}
    </div>
  )
}

/** 消息级分派：checkChapterNarrative 或 output.code==="NARRATIVE_NOT_READY" → 报告卡 */
export function NarrativeCheckCards({
  toolCalls,
  novelId,
}: {
  toolCalls: ToolCallView[]
  novelId: string
}) {
  const entries: { key: string; assessment: NarrativeAssessment; guidance?: string }[] = []
  for (const call of toolCalls) {
    const report = narrativeReportOf(call)
    if (report) entries.push({ key: call.toolCallId, ...report })
  }
  if (entries.length === 0) return null
  return (
    <>
      {entries.map((entry) => (
        <NarrativeCheckCard key={entry.key} assessment={entry.assessment} guidance={entry.guidance} novelId={novelId} />
      ))}
    </>
  )
}
