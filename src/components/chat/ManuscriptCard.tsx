"use client"

/**
 * 稿件卡（§4.4）：finalizeChapter 定稿确认后在消息流呈现的里程碑卡——
 * 章节名 + 状态 pill「定稿」（success 灰度）+ 「阅读 ›」动作，通栏卡。
 * 与 file-card 分工：file-card 是出稿流水账（+N 字），稿件卡是定稿里程碑。
 */
import { BookOpen } from "lucide-react"

import { openEntityRef } from "./entity-refs"
import { summarizeOutput, type ToolCallView } from "./types"
import type { EntityIndex } from "./use-entity-index"

interface ManuscriptEntry {
  key: string
  chapterId: string
  label: string
}

/** 从工具调用记录提取定稿条目（仅成功的 finalizeChapter） */
function deriveManuscripts(toolCalls: ToolCallView[], index: EntityIndex): ManuscriptEntry[] {
  const entries: ManuscriptEntry[] = []
  for (const call of toolCalls) {
    if (call.toolName !== "finalizeChapter" || call.status !== "done") continue
    if (!summarizeOutput(call.toolName, call.input, call.output).ok) continue
    const input = (call.input ?? {}) as Record<string, unknown>
    const chapterId = typeof input.chapterId === "string" ? input.chapterId : null
    if (!chapterId) continue
    const label =
      index.chapterLabelById(chapterId) ??
      (() => {
        const output = (call.output ?? {}) as Record<string, unknown>
        return typeof output.message === "string"
          ? (output.message.match(/《([^》]+)》/)?.[1] ?? "章节正文")
          : "章节正文"
      })()
    entries.push({ key: call.toolCallId, chapterId, label })
  }
  return entries
}

export function ManuscriptCards({
  toolCalls,
  index,
  novelId,
}: {
  toolCalls: ToolCallView[]
  index: EntityIndex
  novelId: string
}) {
  const entries = deriveManuscripts(toolCalls, index)
  if (entries.length === 0) return null

  return (
    <>
      {entries.map((e) => (
        <div
          key={e.key}
          className="chat-enter flex w-full items-center gap-2.5 rounded-card border border-(--chat-line) bg-chat-surface px-3.5 py-2 shadow-1"
        >
          <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {e.label}
          </span>
          <span className="shrink-0 rounded-full bg-success/12 px-2 py-[1px] text-[11px] text-success">
            定稿
          </span>
          <button
            type="button"
            onClick={() => openEntityRef({ kind: "chapter", id: e.chapterId, name: e.label }, novelId)}
            className="shrink-0 rounded-inner border border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
          >
            阅读 ›
          </button>
        </div>
      ))}
    </>
  )
}
