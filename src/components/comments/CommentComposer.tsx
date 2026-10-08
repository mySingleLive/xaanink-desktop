"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

import { useCommentDraft } from "./comment-drafts"

import { ACTION_BTN } from "./CommentBubble"
import type { CommentComposerProps } from "./types"

/**
 * 评论/回复输入气泡：Markdown 输入 + 收起 / 丢弃 / 发表。
 * 不展示被引用的原文(锚点已在正文里高亮,引用条冗余);quote 由调用方作数据提交。
 * Cmd/Ctrl+Enter 提交；提交成功清除草稿，关闭/Esc/点外保留可恢复草稿。
 */
export function CommentComposer({ quote, anchor, threadId, draftTarget, reply, submitting, onSubmit, onCancel }: CommentComposerProps) {
  const { draft, setDraft, clear, warning, ready } = useCommentDraft(anchor ?? (quote ? { quote } : undefined), threadId, draftTarget)
  const root = useRef<HTMLDivElement>(null)
  const sending = useRef(false)
  /** 本地防重:onSubmit 进行期间禁再点(父组件的 submitting 到达前也有保护) */
  const [busy, setBusy] = useState(false)
  const pending = submitting || busy

  const submit = async () => {
    const content = draft.trim()
    if (!content || pending || sending.current || !ready) return
    sending.current = true
    setBusy(true)
    try {
      await onSubmit(content)
      clear()
      onCancel()
    } catch {
      // 失败提示由数据层 toast;草稿保留,是否关闭由父组件决定
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!pending && !sending.current && !root.current?.contains(event.target as Node)) onCancel() }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [onCancel, pending])

  return (
    <div ref={root} data-comment-composer className="w-full rounded-xl border bg-card px-4 py-3 shadow-sm">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !pending) { e.preventDefault(); e.stopPropagation(); onCancel() }
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder={reply ? "写下你的回复,支持 Markdown…" : "写下你的评论,支持 Markdown…"}
        maxLength={4000}
        autoFocus
        disabled={pending || !ready}
      />
      {warning && <p role="status" className="text-xs text-muted-foreground">{warning}</p>}
      <div className="mt-2 flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" className={ACTION_BTN} onClick={onCancel} disabled={pending || !ready}>
          收起
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { clear(); onCancel() }} disabled={pending}>丢弃</Button>
        <Button size="sm" disabled={!draft.trim() || pending || !ready} onClick={() => void submit()}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "发表中…" : reply ? "发送" : "发表评论"}
        </Button>
      </div>
    </div>
  )
}
