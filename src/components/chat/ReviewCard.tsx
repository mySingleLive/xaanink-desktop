"use client"

/**
 * 朱砂批注评审卡（§4.3）：requestAIReview 完成后在消息流呈现的评审摘要卡——
 * 朱砂头部图标 + 评分数字朱砂加粗 + 「查看批注 › / 按意见修改」双动作，通栏卡。
 * 与行内评论系统的关系：评审意见已自动挂行内评论（attachReviewComments），
 * 本卡是其对话区入口与摘要，不改数据层。
 */
import { ClipboardCheck } from "lucide-react"

import { useChatStore } from "@/stores/chat"

import { openEntityRef } from "./entity-refs"
import { summarizeOutput, type ToolCallView } from "./types"
import type { EntityIndex } from "./use-entity-index"

interface ReviewEntry {
  key: string
  objectName: string
  chapterId: string | null
  score: number
  commentCount: number
  /** 总评一段：评审 JSON 无总评字段，取首条意见的 issue 作引子（没有则不渲染 body） */
  summary: string | null
}

/** 从工具调用记录提取评审卡条目（仅成功的 requestAIReview） */
function deriveReviewCards(toolCalls: ToolCallView[], index: EntityIndex): ReviewEntry[] {
  const entries: ReviewEntry[] = []
  for (const call of toolCalls) {
    if (call.toolName !== "requestAIReview" || call.status !== "done") continue
    if (!summarizeOutput(call.toolName, call.input, call.output).ok) continue

    const input = (call.input ?? {}) as Record<string, unknown>
    const output = (call.output ?? {}) as Record<string, unknown>
    const score = typeof output.score === "number" && Number.isFinite(output.score) ? output.score : null
    if (score == null) continue

    const targetId = typeof input.targetId === "string" ? input.targetId : null
    const targetType = typeof input.targetType === "string" ? input.targetType : ""
    const isChapter = targetType.startsWith("CHAPTER")
    const chapterLabel = isChapter && targetId ? index.chapterLabelById(targetId) : undefined
    const objectName =
      chapterLabel ??
      (targetType === "VOLUME_OUTLINE" ? "卷大纲" : null) ??
      (typeof output.message === "string"
        ? (output.message.match(/《([^》]+)》/)?.[1] ?? null)
        : null) ??
      "评审对象"

    const comments = Array.isArray(output.comments) ? output.comments : []
    const first = comments[0] as { issue?: unknown } | undefined
    const summary = typeof first?.issue === "string" && first.issue.trim() ? first.issue : null

    entries.push({
      key: call.toolCallId,
      objectName,
      chapterId: isChapter ? targetId : null,
      score,
      commentCount: comments.length,
      summary,
    })
  }
  return entries
}

export function ReviewCards({
  toolCalls,
  index,
  novelId,
}: {
  toolCalls: ToolCallView[]
  index: EntityIndex
  novelId: string
}) {
  const setDraft = useChatStore((s) => s.setDraft)
  const entries = deriveReviewCards(toolCalls, index)
  if (entries.length === 0) return null

  return (
    <>
      {entries.map((e) => (
        <div
          key={e.key}
          className="chat-enter w-full rounded-card border border-(--chat-line) bg-chat-surface px-3.5 py-2.5 shadow-1"
        >
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <ClipboardCheck className="size-3.5 shrink-0 text-primary" />
            AI 评审员 · {e.objectName}
          </div>
          {e.summary && (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-[1.7] text-foreground">
              {e.summary}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-2.5 font-mono text-xs text-muted-foreground">
            <span>
              评分{" "}
              <b className="font-semibold text-primary tabular-nums">{e.score}/100</b>
            </span>
            <span>
              · <b className="font-semibold text-foreground tabular-nums">{e.commentCount}</b>{" "}
              条行内批注
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {e.chapterId && (
              <button
                type="button"
                onClick={() =>
                  openEntityRef(
                    { kind: "chapter", id: e.chapterId!, name: e.objectName },
                    novelId
                  )
                }
                className="rounded-inner bg-primary px-3 py-[5px] text-xs text-primary-foreground transition-colors hover:bg-primary/90"
              >
                查看批注 ›
              </button>
            )}
            {/* 与模板卡同款：只填草稿不发送，作者确认后再发给参谋 */}
            <button
              type="button"
              onClick={() => setDraft(`按评审意见修改${e.objectName}`)}
              className="rounded-inner border border-input px-3 py-[5px] text-xs text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
            >
              按意见修改
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
