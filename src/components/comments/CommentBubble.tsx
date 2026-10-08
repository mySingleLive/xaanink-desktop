"use client"

import { useMemo, useState } from "react"
import { ChevronUp, Loader2, MessageSquareReply, Sparkles, Trash2, X } from "lucide-react"

import { Seal } from "@/components/marketing/seal"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CommentComposer } from "./CommentComposer"
import { renderMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"

import type { CommentBubbleProps, TextCommentDTO } from "./types"

/*
 * 气泡操作按钮的统一悬停态:ghost 变体的 hover:bg-muted 在玄墨主题下与卡片底色
 * 几乎无差(用户看不出悬停反馈),统一改为 暖调 wash 底 + 边框 的组合,双主题可读。
 */
export const ACTION_BTN =
  "border-transparent text-muted-foreground hover:border-border hover:bg-hover-wash hover:text-foreground dark:hover:bg-hover-wash"
const ACTION_BTN_DANGER =
  "border-transparent text-destructive/80 hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/10"

/** 相对时间:刚刚 / N 分钟前 / N 小时前 / 昨天 / MM-DD */
export function relativeTime(iso: string): string {
  const diffMinutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMinutes < 1) return "刚刚"
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffHours < 48) return "昨天"
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** 作者头像:AI 用品牌丹炉器物标(Seal mark),用户用昵称首字 Avatar */
export function AuthorAvatar({ comment, small }: { comment: TextCommentDTO; small?: boolean }) {
  const sizeClass = small ? "size-[18px]" : "size-[22px]"
  if (comment.authorType === "AI") {
    return <Seal variant="mark" className={sizeClass} />
  }
  return (
    <Avatar size="sm" className={sizeClass}>
      <AvatarFallback className={small ? "text-[10px]" : "text-xs"}>
        {comment.authorName.trim().charAt(0) || "?"}
      </AvatarFallback>
    </Avatar>
  )
}

/** 评论正文:Markdown 渲染,复用 globals.css 的 .markdown-body 紧凑变体(chat-message) */
function CommentMarkdown({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content])
  return (
    <div
      className="markdown-body chat-message text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * 行内评论气泡(Codex 行内评审卡风格,占满整行宽):
 * 头部(头像/作者/相对时间/状态徽标)+ 引用条 + Markdown 正文 + 回复串 + 操作按钮组。
 * 动作全部由 props 注入(由 MarkdownEditor 层经 useTextComments 绑定),本组件只管交互与展示。
 * 操作按钮无「同意」(2026-09 起移除):AGREED 状态仅由 AI 改进流程(handleTextComment AGREE)设置,
 * 用户手动路径只留 回复 / 拒绝 / 立刻应用 / 删除;已同意徽标照常显示。
 */
export function CommentBubble({
  thread,
  orphaned,
  applying,
  readOnly,
  showQuote,
  onCollapse,
  onReply,
  onToggleReject,
  onApply,
  onApplyParagraph,
  onDelete,
}: CommentBubbleProps) {
  const [replyOpen, setReplyOpen] = useState(false)

  const rejected = thread.status === "REJECTED"
  /* 引用条展示:孤儿评论(锚点已失)必展示;showQuote 场景(评审视图,气泡上方没有原文高亮)也展示 */
  const quoteVisible = !!thread.quote && (orphaned || !!showQuote)
  /* 无锚点整体评论没有可替换的原文区间,「立刻应用」(AI 改写锚点段落)不适用；候选稿只读,评论不可应用 */
  const canApply = thread.targetType !== "CANDIDATE_CONTENT" && !orphaned && !!thread.quote

  const handleDelete = () => {
    if (window.confirm("删除这条评论及其回复?")) onDelete()
  }

  return (
    <div className="w-full rounded-xl border bg-card px-4 py-3 shadow-sm">
      {/* 头部:头像 + 作者 + 相对时间 + 状态徽标 */}
      <div className="flex items-center gap-2">
        <AuthorAvatar comment={thread} />
        <span className="text-sm font-medium">{thread.authorName}</span>
        <span className="text-xs text-muted-foreground">{relativeTime(thread.createdAt)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {thread.status === "AGREED" && <Badge>已同意</Badge>}
          {thread.status === "APPLIED" && <Badge>已修改</Badge>}
          {rejected && <Badge variant="secondary">已拒绝</Badge>}
          {orphaned && <Badge variant="destructive">原文已改动</Badge>}
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="收起"
              aria-label="收起评论卡片"
              className={ACTION_BTN}
              onClick={onCollapse}
            >
              <ChevronUp />
            </Button>
          )}
        </div>
      </div>

      {/* 引用条:孤儿评论(原文已改动、锚点高亮已失)或 showQuote 场景展示——锚点有效且有原文高亮语境时不重复显示 */}
      {quoteVisible && (
        <blockquote className={cn("comment-quote mt-2", rejected && "line-through opacity-60")}>
          {thread.quote}
        </blockquote>
      )}

      {/* 评论正文(上方无引用条时补一点顶距) */}
      <div className={cn(!quoteVisible && "mt-1", rejected && "line-through opacity-60")}>
        <CommentMarkdown content={thread.content} />
      </div>

      {/* 回复串:左侧竖线缩进;回复不再带操作按钮 */}
      {thread.replies.length > 0 && (
        <div className="mt-2 flex flex-col gap-2.5 border-l pl-3">
          {thread.replies.map((reply) => (
            <div key={reply.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <AuthorAvatar comment={reply} small />
                <span className="text-xs font-medium">{reply.authorName}</span>
                <span className="text-xs text-muted-foreground">
                  {relativeTime(reply.createdAt)}
                </span>
              </div>
              <CommentMarkdown content={reply.content} />
            </div>
          ))}
        </div>
      )}

      {/* 内联回复输入:[回复]按钮切换(readOnly 不开) */}
      {replyOpen && !readOnly && <div className="mt-2"><CommentComposer
        quote="" reply threadId={thread.id}
        draftTarget={{ novelId: thread.novelId, targetType: thread.targetType, targetId: thread.targetId }}
        onSubmit={onReply} onCancel={() => setReplyOpen(false)}
      /></div>}

      {/* 操作按钮组(仅顶层;孤儿评论只剩[回复][删除];readOnly=只读查看(已丢弃候选等),回复/删除/应用全部收口) */}
      <div className="flex flex-wrap gap-1 pt-1">
        {!readOnly && (
          <Button variant="ghost" size="xs" className={ACTION_BTN} onClick={() => setReplyOpen((v) => !v)}>
            <MessageSquareReply />
            回复
          </Button>
        )}
        {!orphaned && (
          <Button
            variant="ghost"
            size="xs"
            className={cn(ACTION_BTN, rejected && "bg-hover-wash text-primary")}
            onClick={onToggleReject}
          >
            <X />
            {rejected ? "已拒绝" : "拒绝"}
          </Button>
        )}
        {canApply && (
          <Button variant="ghost" size="xs" className={ACTION_BTN} disabled={readOnly || applying} onClick={onApply}>
            {applying ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {applying ? "改写中…" : "立刻应用"}
          </Button>
        )}
        {canApply && (thread.quote?.length ?? 0) < 32 && onApplyParagraph && <Button variant="ghost" size="xs" className={ACTION_BTN} disabled={readOnly || applying} onClick={onApplyParagraph}>应用到整段</Button>}
        {!readOnly && (
          <Button
            variant="ghost"
            size="xs"
            className={ACTION_BTN_DANGER}
            onClick={handleDelete}
          >
            <Trash2 />
            删除
          </Button>
        )}
      </div>
    </div>
  )
}
