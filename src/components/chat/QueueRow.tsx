"use client"

/**
 * 执行中消息排队（§2.5）：生成中发送的消息进入队列，当前轮流结束后自动按序发送。
 * 队列行位于 composer 上方：「队列 (N)」分组标题 + 消息摘要行（truncate）+
 * hover 出 立即发送/编辑/删除 图标。停止钮/Esc 只停当前流，不影响队列。
 */
import { Pencil, Trash2, Zap } from "lucide-react"

import { useChatStore } from "@/stores/chat"

const ACTION_BTN =
  "flex size-[22px] items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/q:opacity-100 hover:bg-hover-wash hover:text-foreground"

export function QueueRows({ onSendNow }: { onSendNow: (id: string) => void }) {
  const queued = useChatStore((s) => s.queuedMessages)
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage)
  const setDraft = useChatStore((s) => s.setDraft)

  if (queued.length === 0) return null

  return (
    <div className="mx-auto mb-1.5 flex w-full max-w-[960px] flex-col gap-1">
      <div className="text-[11.5px] text-muted-foreground">队列 ({queued.length})</div>
      {queued.map((q) => (
        <div
          key={q.id}
          className="group/q flex items-center gap-2 rounded-inner border border-(--chat-line) bg-chat-surface px-2.5 py-1.5 text-xs"
        >
          <span className="min-w-0 flex-1 truncate text-foreground/80">{q.text}</span>
          {/* 立即发送 = 提到队首 + 停止当前流（停止触发的自动按序发送自然拿起队首，不会双发） */}
          <button
            type="button"
            title="立即发送（停止当前生成）"
            aria-label="立即发送"
            onClick={() => onSendNow(q.id)}
            className={ACTION_BTN}
          >
            <Zap className="size-3.5" />
          </button>
          {/* 编辑 = 文本回填草稿并移出队列 */}
          <button
            type="button"
            title="编辑"
            aria-label="编辑"
            onClick={() => {
              setDraft(q.text)
              removeQueuedMessage(q.id)
            }}
            className={ACTION_BTN}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            title="删除"
            aria-label="删除"
            onClick={() => removeQueuedMessage(q.id)}
            className={ACTION_BTN}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
