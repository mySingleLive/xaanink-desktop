"use client"

/**
 * 评审视图「行内评论」区块（2026-09）：章正文/章大纲评分详情页内嵌——
 * 该目标的全部评论线程（作者留言 + AI 批注）以正文视图同款 CommentBubble 卡片呈现，
 * showQuote 强制显示引用条（这里没有「锚点原文就在气泡上方高亮」的语境）。
 * 动作与编辑器一致：回复 / 同意 / 拒绝 / 立刻应用 / 删除；
 * 「立刻应用」走 apply commit 服务端落稿（无编辑器缓冲区可本地替换），
 * 完成后失效章节/小说/评分缓存——打开中的正文面板按 version 重挂载拿到新稿。
 * 「添加评论」：无引用输入框，一律落无锚点整体评论（要锚定具体段落，
 * 请在正文编辑/预览里选中段落评论）。
 * 已同意/已修改/已拒绝状态的卡片默认折叠为单行摘要（头像+作者+徽标+首句预览），点击展开、
 * 卡片头部「收起」按钮折回；展开集合为本地 UI 状态（新到的已处理评论仍默认折叠）。
 * 排序：可折叠（已同意/已修改/已拒绝）的卡片稳定排到区块末尾，未折叠（未处理）在前，
 * 组内保持服务端的锚点偏移顺序；手动展开不改变分组位次（避免点击瞬间卡片跳动）。
 * 「原文已改动」（锚点失效的孤儿评论）默认隐藏，底部切换行可显示/再隐藏；
 * 章节原文未加载完不判孤儿（避免加载期误藏）。
 * 评论/章节查询 key 与编辑器侧一致（["comments",t,i] / ["chapter",id]），缓存共享。
 */
import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, MessageSquarePlus } from "lucide-react"

import { resolveAnchor } from "@/lib/comment-anchor"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CommentComposer } from "@/components/comments/CommentComposer"
import { CommentDraftProvider, CommentDraftList } from "@/components/comments/comment-drafts"
import { apiGet } from "@/components/content/api"
import type { ChapterDetail } from "@/components/content/types"
import type { CandidateDetail } from "@/components/content/candidate-accept"
import { firstSentence } from "@/components/chat/use-entity-index"
import { AuthorAvatar, CommentBubble, relativeTime } from "@/components/comments/CommentBubble"
import { useTextComments } from "@/components/comments/use-text-comments"
import type { CommentStatus, ResolvedThread, TextCommentThread } from "@/components/comments/types"

import type { ScoreTargetType } from "./use-score-report"

/** 行内评论支持的评分目标（卷大纲无行内评论） */
export type CommentableScoreTarget = "CHAPTER_CONTENT" | "CHAPTER_OUTLINE"

export function isCommentableScoreTarget(t: ScoreTargetType): t is CommentableScoreTarget {
  return t === "CHAPTER_CONTENT" || t === "CHAPTER_OUTLINE"
}

/** 默认折叠的评论状态：已同意 / 已修改（AI 已按评论落稿）/ 已拒绝（无需修改，原文划线展示）——均已定性、无需作者再处理 */
const COLLAPSED_STATUSES: ReadonlySet<CommentStatus> = new Set([
  "AGREED",
  "APPLIED",
  "REJECTED",
])

/** 折叠态单行摘要卡：头像 + 作者 + 时间 + 状态徽标 + 评论首句预览 + 展开箭头；整行点击展开 */
function CollapsedCommentCard({
  thread,
  orphaned,
  onExpand,
}: {
  thread: TextCommentThread
  orphaned: boolean
  onExpand: () => void
}) {
  const rejected = thread.status === "REJECTED"
  const preview = firstSentence(thread.content)
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-left shadow-sm transition-colors hover:bg-hover-wash/40"
    >
      <AuthorAvatar comment={thread} small />
      <span className="shrink-0 text-sm font-medium">{thread.authorName}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {relativeTime(thread.createdAt)}
      </span>
      {thread.status === "AGREED" && <Badge className="shrink-0">已同意</Badge>}
      {thread.status === "APPLIED" && <Badge className="shrink-0">已修改</Badge>}
      {rejected && (
        <Badge variant="secondary" className="shrink-0">
          已拒绝
        </Badge>
      )}
      {orphaned && (
        <Badge variant="destructive" className="shrink-0">
          原文已改动
        </Badge>
      )}
      {preview && (
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs text-muted-foreground",
            rejected && "line-through opacity-60"
          )}
        >
          {preview}
        </span>
      )}
      <ChevronDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

export function ReviewCommentsSection({
  novelId,
  targetType,
  targetId,
  candidateId,
  chapterId,
  readOnly,
}: {
  novelId: string
  targetType: CommentableScoreTarget
  targetId: string
  /** 候选稿维度：评论目标改挂 CANDIDATE_CONTENT，原文取自候选详情缓存（与 CandidatePanel 共享同一键） */
  candidateId?: string
  chapterId?: string
  /** 只读查看（已丢弃候选）：隐藏「添加评论」、气泡动作经 CommentBubble readOnly 收口 */
  readOnly?: boolean
}) {
  const queryClient = useQueryClient()
  const [composerOpen, setComposerOpen] = useState(false)
  /** 「原文已改动」（锚点失效）评论默认隐藏；true 时显示 */
  const [showOrphaned, setShowOrphaned] = useState(false)
  /** 已处理（已修改/已拒绝）评论中被用户手动展开的线程 id；默认全部折叠 */
  const [expandedHandledIds, setExpandedHandledIds] = useState<ReadonlySet<string>>(new Set())

  const setHandledExpanded = (id: string, expanded: boolean) => {
    setExpandedHandledIds((prev) => {
      const next = new Set(prev)
      if (expanded) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const commentsTarget = candidateId
    ? { targetType: "CANDIDATE_CONTENT" as const, targetId: candidateId }
    : { targetType, targetId }
  const {
    threads,
    createComment,
    reply,
    setStatus,
    apply,
    applyingId,
    remove,
  } = useTextComments(novelId, commentsTarget)

  /* 目标原文（锚点解析用）：章级与正文/大纲面板同一 ["chapter", id] 查询，缓存共享 */
  const { data: chapterData, isLoading: chapterLoading } = useQuery({
    queryKey: ["chapter", targetId],
    enabled: !candidateId,
    queryFn: () =>
      apiGet<{ chapter: ChapterDetail }>(
        `/api/novels/${novelId}/chapters/${targetId}`,
        "加载章节失败"
      ),
  })
  /* 候选稿原文：候选详情缓存 ["content-candidates","detail",chapterId,candidateId]（与 CandidatePanel 共享） */
  const { data: candidateData, isLoading: candidateLoading } = useQuery({
    queryKey: ["content-candidates", "detail", chapterId, candidateId],
    enabled: !!candidateId && !!chapterId,
    queryFn: () =>
      apiGet<{ candidate: CandidateDetail }>(
        `/api/novels/${novelId}/chapters/${chapterId}/candidates/${candidateId}`,
        "读取候选全文失败"
      ),
  })
  const textLoading = candidateId ? candidateLoading : chapterLoading
  const text = candidateId
    ? (candidateData?.candidate.content ?? "")
    : targetType === "CHAPTER_CONTENT"
      ? (chapterData?.chapter.content ?? "")
      : (chapterData?.chapter.outline ?? "")

  /* 锚点解析：无锚点整体评论（quote=null）不算孤儿（与编辑器侧口径一致） */
  const resolvedThreads = useMemo<ResolvedThread[]>(
    () => threads.map((t) => ({ thread: t, anchor: resolveAnchor(text, t) })),
    [threads, text]
  )

  /* 排序：未折叠（未处理）在前、可折叠（已同意/已修改/已拒绝）稳定排后，组内保持锚点顺序 */
  const orderedThreads = useMemo<ResolvedThread[]>(() => {
    const active: ResolvedThread[] = []
    const handled: ResolvedThread[] = []
    for (const rt of resolvedThreads) {
      ;(COLLAPSED_STATUSES.has(rt.thread.status) ? handled : active).push(rt)
    }
    return [...active, ...handled]
  }, [resolvedThreads])

  /** 孤儿（锚点失效）判定：原文未加载时不判（避免加载期误藏/闪现徽标）；无锚点整体评论不算孤儿（候选锚点恒稳定，孤儿恒 0） */
  const isOrphaned = useMemo(
    () => (rt: ResolvedThread) =>
      !textLoading && rt.anchor === null && !!rt.thread.quote,
    [textLoading]
  )
  const orphanCount = useMemo(
    () => orderedThreads.filter(isOrphaned).length,
    [orderedThreads, isOrphaned]
  )
  /** 可见线程：默认滤掉「原文已改动」 */
  const visibleThreads = useMemo(
    () => (showOrphaned ? orderedThreads : orderedThreads.filter((rt) => !isOrphaned(rt))),
    [orderedThreads, isOrphaned, showOrphaned]
  )

  /** 「立刻应用」：服务端替换落稿 + 置已修改；失效章节/小说/评分缓存让打开中的面板与指示器刷新 */
  const applyAndCommit = async (threadId: string, range?: "paragraph") => {
    try { await apply(threadId, { range }) } catch { return }
    queryClient.invalidateQueries({ queryKey: ["chapter", targetId] })
    queryClient.invalidateQueries({ queryKey: ["novels"] })
    queryClient.invalidateQueries({ queryKey: ["score-report", targetType, targetId] })
  }

  const create = async (content: string) => {
    await createComment({ content })
  }

  return (
    <CommentDraftProvider target={{ novelId, targetType: commentsTarget.targetType, targetId: commentsTarget.targetId }} source={textLoading ? undefined : text}>
    <div>
      <div className="sp-sec-title" style={{ padding: "0 2px" }}>
        行内评论 <span className="n">{visibleThreads.length} 条</span>
        {!readOnly && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            onClick={() => setComposerOpen((v) => !v)}
          >
            <MessageSquarePlus />
            添加评论
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {composerOpen && !readOnly && (
          <CommentComposer quote=""
            submitting={false}
            onSubmit={create}
            onCancel={() => setComposerOpen(false)}
          />
        )}
        {visibleThreads.map((rt) => {
          const orphaned = isOrphaned(rt)
          /* 已同意/已修改/已拒绝默认折叠为单行摘要，点击展开（可再收起）；未处理常展开 */
          const collapsible = COLLAPSED_STATUSES.has(rt.thread.status)
          if (collapsible && !expandedHandledIds.has(rt.thread.id)) {
            return (
              <CollapsedCommentCard
                key={rt.thread.id}
                thread={rt.thread}
                orphaned={orphaned}
                onExpand={() => setHandledExpanded(rt.thread.id, true)}
              />
            )
          }
          return (
            <CommentBubble
              key={rt.thread.id}
              thread={rt.thread}
              /* 章节原文未加载时锚点一律解析为 null，此时不判孤儿（避免加载期闪现「原文已改动」徽标） */
              orphaned={orphaned}
              showQuote
              readOnly={readOnly}
              applying={applyingId === rt.thread.id}
              onCollapse={
                collapsible ? () => setHandledExpanded(rt.thread.id, false) : undefined
              }
              onReply={async (content) => {
                await reply(rt.thread.id, content)
              }}
              onToggleReject={() => {
                void setStatus(
                  rt.thread.id,
                  rt.thread.status === "REJECTED" ? "OPEN" : "REJECTED"
                )
              }}
              onApply={() => {
                void applyAndCommit(rt.thread.id)
              }}
              onApplyParagraph={() => { void applyAndCommit(rt.thread.id, "paragraph") }}
              onDelete={() => {
                void remove(rt.thread.id)
              }}
            />
          )
        })}
        {visibleThreads.length === 0 && orphanCount === 0 && !composerOpen && (
          <div className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
            还没有评论——点右上角「添加评论」，或在正文编辑/预览里选中段落评论。
          </div>
        )}
        {orphanCount > 0 && (
          <button
            type="button"
            onClick={() => setShowOrphaned((v) => !v)}
            className="rounded-xl border border-dashed px-4 py-2.5 text-center text-xs text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
          >
            {showOrphaned
              ? `收起 ${orphanCount} 条锚点失效的评论（原文已改动）`
              : `${orphanCount} 条评论锚点已失效（原文已改动），点击显示`}
          </button>
        )}
      </div>
      <CommentDraftList />
    </div>
    </CommentDraftProvider>
  )
}
