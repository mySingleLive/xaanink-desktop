"use client"

/**
 * 回合进度卡（W4 长任务等待体验，ISS-007）：挂在 AssistantMessage 流式分支，
 * 长任务全程可见，只呈现「在做什么」，不呈现内部重试细节（与 W6 配合）。
 * - 当前步：服务端阶段文案（chatStageLabel）+ 计时 shimmer；同作品近期回合
 *   时长均值 ≥60s 时附「同类任务通常约 X 分钟」估时。
 * - 进行中：未完结工具调用 + 子代理实时进度（liveRuns）。
 * - 最近完成步骤：默认折叠的清单（复用 Collapse + WorkLogRows）。
 * - 草稿预览：正在写入的最新草稿前 ~200 字只读片段（useStoryActivityStore，
 *   经 toolCallId 与本回合工具核对后由 ChatPanel 传入）。
 */
import { useState } from "react"
import { ChevronDown, ChevronRight, Cog, Drama, FileText, Gavel, PenLine, TrendingUp, Users, Wrench, type LucideIcon } from "lucide-react"

import { chatStageLabel } from "@/lib/chat-stage"
import { formatDuration } from "@/lib/duration"

import { Collapse } from "./Collapse"
import { WorkLogRows } from "./GroupedToolRows"
import type { ChatMessageView, ToolCallView } from "./types"

/** 草稿预览截取长度（前 ~200 字） */
export const TURN_PROGRESS_DRAFT_PREVIEW_CHARS = 200
/** 估时显示阈值：低于 60s 的同类任务不显示估时 */
export const TURN_PROGRESS_ESTIMATE_MIN_MS = 60_000

export interface TurnProgressDraft {
  toolCallId: string
  title: string
  text: string
}

export interface TurnProgressView {
  stageLabel: string
  estimateText: string | null
  runningTools: ToolCallView[]
  liveRuns: NonNullable<ChatMessageView["liveRuns"]>
  doneCalls: ToolCallView[]
  draft: { title: string; preview: string } | null
}

/** 估时文案：同作品近期成功回合均值 ≥60s 才给出「约 X 分钟」 */
export function turnProgressEstimateText(estimateMs: number | null | undefined): string | null {
  if (typeof estimateMs !== "number" || !Number.isFinite(estimateMs) || estimateMs < TURN_PROGRESS_ESTIMATE_MIN_MS) return null
  return `同类任务通常约 ${Math.max(1, Math.round(estimateMs / 60_000))} 分钟`
}

/** 进度卡派生（纯逻辑）：当前步/进行中/最近完成/草稿片段，派生不出草稿时回 null */
export function deriveTurnProgress(message: ChatMessageView, draft: TurnProgressDraft | null | undefined): TurnProgressView {
  const toolCalls = message.toolCalls ?? []
  const runningTools = toolCalls.filter(call => call.status === "running")
  const doneCalls = toolCalls.filter(call => call.status === "done")
  const liveRuns = (message.liveRuns ?? []).filter(run => run.stage !== "done")
  const owns = draft && toolCalls.some(call => call.toolCallId === draft.toolCallId)
  const text = owns && draft ? draft.text.trim() : ""
  return {
    stageLabel: message.stage ? chatStageLabel(message.stage) : "正在工作",
    estimateText: turnProgressEstimateText(message.estimateMs),
    runningTools,
    liveRuns,
    doneCalls,
    draft: owns && draft && text ? { title: draft.title, preview: text.slice(0, TURN_PROGRESS_DRAFT_PREVIEW_CHARS) } : null,
  }
}

const AGENT_KINDS: Record<string, { label: string; Icon: LucideIcon }> = {
  writer: { label: "写手", Icon: PenLine }, judge: { label: "评委", Icon: Gavel },
  reader: { label: "读者团", Icon: Users }, playwright: { label: "剧作家", Icon: Drama },
  editor: { label: "编辑", Icon: TrendingUp },
}

export function TurnProgressCard({
  message,
  elapsedSeconds,
  draft,
  showToolLog = true,
}: {
  message: ChatMessageView
  elapsedSeconds: number
  draft?: TurnProgressDraft | null
  /** 消息流已展示工具条目时关闭，避免同一次调用重复出现。 */
  showToolLog?: boolean
}) {
  const progress = deriveTurnProgress(message, draft)
  const [logOpen, setLogOpen] = useState(false)
  // 活跃思考已有可展开的 ThinkingRow 和独立计时，避免再用整轮计时重复呈现。
  const showStage = message.stage !== "thinking" || !message.thinking?.active
  return (
    <div data-testid="turn-progress-card" role="status" className="flex w-full max-w-[640px] flex-col gap-1.5">
      {/* 当前步（默认展开）：阶段文案 shimmer + 计时；估时紧随其后 */}
      {showStage && <div className="flex items-center gap-1.5 font-mono text-[13.5px] text-muted-foreground select-none">
        <Cog className="size-3.5 shrink-0" />
        <span className="text-shimmer tabular-nums">
          {progress.stageLabel}
          {elapsedSeconds > 0 ? ` ${formatDuration(elapsedSeconds)}` : ""}
        </span>
      </div>}
      {progress.estimateText && (
        <div className="text-xs text-muted-foreground">{progress.estimateText}</div>
      )}
      {/* 进行中：未完结工具 + 子代理实时进度 */}
      {showToolLog && progress.runningTools.length > 0 && (
        <div className="flex flex-col gap-1">
          <WorkLogRows calls={progress.runningTools} />
        </div>
      )}
      {progress.liveRuns.map(run => {
        const { label, Icon } = AGENT_KINDS[run.agentKind] ?? { label: "子代理", Icon: Wrench }
        return (
          <div key={run.runId} className="flex items-center gap-1.5 font-mono text-[13.5px] text-muted-foreground">
            <Icon className="size-3.5 shrink-0" />
            <span className="min-w-0">{label} · {run.stage === "done" ? "已完成" : "等待模型"} · {run.task}</span>
          </div>
        )
      })}
      {/* 草稿片段只读预览 */}
      {progress.draft && (
        <div className="rounded-inner border border-(--chat-line) bg-popover px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <FileText className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{progress.draft.title} · 草稿预览</span>
          </div>
          <p className="mt-1 line-clamp-3 text-xs leading-[1.7] whitespace-pre-wrap text-foreground/80">{progress.draft.preview}</p>
        </div>
      )}
      {/* 最近完成步骤（默认折叠的历史步） */}
      {showToolLog && progress.doneCalls.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setLogOpen(v => !v)}
            className="group/tp flex w-fit items-center gap-1.5 text-xs text-muted-foreground select-none transition-colors hover:text-foreground"
          >
            最近完成 {progress.doneCalls.length} 步
            {logOpen ? (
              <ChevronDown className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/tp:opacity-100" />
            )}
          </button>
          <Collapse open={logOpen} className="mt-0.5 ml-2 border-l border-border/70 pl-4">
            <div className="flex flex-col gap-1">
              <WorkLogRows calls={progress.doneCalls} />
            </div>
          </Collapse>
        </div>
      )}
    </div>
  )
}
