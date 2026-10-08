"use client"

/**
 * file-card（§2.8/§4.1 创作版「+N 字」）：正文写入类工具成功后，在消息流呈现一行产物卡，
 * mono 12px「第3章 · 雨夜来客  +2,417 字」（success 色数字），点击打开正文 tab。
 * 与 ChangesCard 分工：file-card 呈现「稿件」类产物，ChangesCard 呈现设定类改动清单。
 */
import { FileText } from "lucide-react"

import { openEntityRef } from "./entity-refs"
import { summarizeOutput, type ToolCallView } from "./types"
import type { EntityIndex } from "./use-entity-index"

const FILE_CARD_TOOLS = new Set(["generateChapterContent", "writeChapterContent", "improveChapterContent"])

interface FileCardEntry {
  key: string
  title: string
  chapterId: string | null
  wordCount: number | null
  previousWordCount: number | null
  deltaWordCount: number | null
  version: number | null
}

/** 从工具调用记录提取正文产物条目（仅成功） */
export function deriveFileCards(toolCalls: ToolCallView[], index: EntityIndex | undefined): FileCardEntry[] {
  const entries: FileCardEntry[] = []
  for (const call of toolCalls) {
    if (call.status !== "done") continue
    if (!FILE_CARD_TOOLS.has(call.toolName)) continue
    if (!summarizeOutput(call.toolName, call.input, call.output).ok) continue

    const input = (call.input ?? {}) as Record<string, unknown>
    const chapterId = typeof input.chapterId === "string" ? input.chapterId : null
    const ref = chapterId && index ? index.chapterById(chapterId) : undefined
    const refName = ref && "name" in ref ? ref.name : ""
    const output = (call.output ?? {}) as Record<string, unknown>
    if (output.committed === false) continue
    const receipt = output.receipt && typeof output.receipt === "object" ? output.receipt as Record<string, unknown> : output
    const number = (key: string) => typeof receipt[key] === "number" && Number.isFinite(receipt[key]) ? receipt[key] as number : null
    const wordCount = number("wordCount"), previousWordCount = number("previousWordCount"), deltaWordCount = number("deltaWordCount"), version = number("version")
    // 名称优先取实体索引（第 N 章 · 标题形态），回退返回文案里的《标题》
    const title =
      refName ||
      (typeof output.message === "string"
        ? (output.message.match(/《([^》]+)》/)?.[1] ?? "")
        : "") ||
      "章节正文"
    entries.push({ key: call.toolCallId, title, chapterId, wordCount, previousWordCount, deltaWordCount, version })
  }
  return entries
}

export function FileCards({
  toolCalls,
  index,
  novelId,
}: {
  toolCalls: ToolCallView[]
  index: EntityIndex
  novelId: string
}) {
  const entries = deriveFileCards(toolCalls, index)
  if (entries.length === 0) return null

  return (
    <>
      {entries.map((e) => (
        <button
          key={e.key}
          type="button"
          disabled={!e.chapterId}
          title={e.chapterId ? "打开正文" : "未找到对应章节"}
          onClick={() => {
            if (e.chapterId) openEntityRef({ kind: "chapter", id: e.chapterId, name: e.title }, novelId)
          }}
          className="chat-enter group flex w-full items-center gap-2 rounded-card border border-(--chat-line) bg-chat-surface px-3 py-[7px] text-left font-mono text-xs shadow-1 transition-colors hover:border-primary disabled:cursor-default disabled:hover:border-(--chat-line)"
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          <span className="min-w-0 flex-1 truncate text-ink-blue">{e.title}</span>
          {e.wordCount != null && (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {e.version != null && `v${e.version} · `}{e.previousWordCount != null && `${e.previousWordCount.toLocaleString()} → `}{e.wordCount.toLocaleString()} 字
              {e.deltaWordCount != null && `（${e.deltaWordCount > 0 ? "+" : ""}${e.deltaWordCount.toLocaleString()}）`}
            </span>
          )}
        </button>
      ))}
    </>
  )
}
