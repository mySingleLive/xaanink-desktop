"use client"

/**
 * ⌘K 对话内搜索（§5.4）：输入即过滤（用户消息优先），↑↓ 导航、Enter 跳转定位
 * （命中消息短暂高亮）、Esc 关闭（Esc 层级最优先）。长会话里快速定位历史提问。
 */
import { useMemo, useState } from "react"
import { Search } from "lucide-react"

import { cn } from "@/lib/utils"

import type { ChatMessageView } from "./types"

interface Hit {
  id: string
  role: "user" | "assistant"
  snippet: string
}

const MAX_HITS = 20

function buildHits(messages: ChatMessageView[], query: string): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Hit[] = []
  for (const m of messages) {
    const idx = m.content.toLowerCase().indexOf(q)
    if (idx < 0) continue
    const start = Math.max(0, idx - 20)
    const end = Math.min(m.content.length, idx + q.length + 40)
    const snippet =
      (start > 0 ? "…" : "") +
      m.content.slice(start, end).replace(/\s+/g, " ") +
      (end < m.content.length ? "…" : "")
    hits.push({ id: m.id, role: m.role, snippet })
  }
  // 用户提问优先（WorkBuddy User Prompt 跳转语义），其余保持时间序
  hits.sort((a, b) => (a.role === b.role ? 0 : a.role === "user" ? -1 : 1))
  return hits.slice(0, MAX_HITS)
}

export function SearchPalette({
  messages,
  onJump,
  onClose,
}: {
  messages: ChatMessageView[]
  onJump: (messageId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const hits = useMemo(() => buildHits(messages, query), [messages, query])

  return (
    <>
      {/* 点击空白处关闭 */}
      <div className="absolute inset-0 z-40" onClick={onClose} />
      <div className="absolute top-3 left-1/2 z-50 w-[min(480px,92%)] -translate-x-1/2 rounded-card border border-(--chat-line) bg-popover shadow-2">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((i) => Math.min(i + 1, hits.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                const hit = hits[Math.min(active, hits.length - 1)]
                if (hit) onJump(hit.id)
              } else if (e.key === "Escape") {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="搜索对话内容…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <kbd className="rounded border border-input px-1 py-px text-[10.5px] text-muted-foreground">
            Esc
          </kbd>
        </div>
        {query.trim() && (
          <div className="max-h-[300px] overflow-y-auto p-1">
            {hits.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">无匹配消息</div>
            ) : (
              hits.map((h, i) => (
                <button
                  key={h.id}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onJump(h.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-inner px-2.5 py-1.5 text-left",
                    i === active && "bg-selected-surface"
                  )}
                >
                  <span className="shrink-0 pt-px text-[11px] text-muted-foreground">
                    {h.role === "user" ? "你" : "参谋"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">
                    {h.snippet}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </>
  )
}
