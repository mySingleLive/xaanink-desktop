"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Bot, Check, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import { apiSend } from "./api"
import { REVIEW_HUMAN_STATUS_LABELS } from "./labels"
import { normalizeReviewComments, type ReviewRecord } from "./types"

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400"
  if (score >= 60) return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
  return "border-destructive/40 bg-destructive/10 text-destructive"
}

const HUMAN_STATUS_VARIANT: Record<ReviewRecord["humanStatus"], "default" | "secondary" | "destructive"> = {
  PENDING: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
}

/**
 * AI 评审卡片：分数 Badge + 逐条意见（aspect/issue/suggestion）+ 人工操作区。
 * 人工通过/驳回后调用 onResolved，由使用方刷新章节/大纲/阶段等相关查询。
 */
export function ReviewCard({
  novelId,
  review,
  onResolved,
}: {
  novelId: string
  review: ReviewRecord
  onResolved?: () => void
}) {
  const queryClient = useQueryClient()
  const [comment, setComment] = useState("")
  const comments = normalizeReviewComments(review.aiComments)

  const mutation = useMutation({
    mutationFn: (status: "APPROVED" | "REJECTED") =>
      apiSend(
        `/api/novels/${novelId}/review/human`,
        "POST",
        { reviewId: review.id, status, comment: comment.trim() || undefined },
        "提交评审结论失败"
      ),
    onSuccess: (_data, status) => {
      toast.success(status === "APPROVED" ? "已通过评审" : "已驳回")
      queryClient.invalidateQueries({ queryKey: ["reviews", novelId] })
      setComment("")
      onResolved?.()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm">AI 评审</CardTitle>
          {review.aiScore !== null && (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                scoreBadgeClass(review.aiScore)
              )}
            >
              {Math.round(review.aiScore)} 分
            </span>
          )}
          <Badge variant={HUMAN_STATUS_VARIANT[review.humanStatus]}>
            {REVIEW_HUMAN_STATUS_LABELS[review.humanStatus]}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {new Date(review.createdAt).toLocaleString("zh-CN")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {comments.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {comments.map((item, i) => (
              <li key={i} className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <div className="font-medium">{item.aspect}</div>
                {item.issue && <div className="mt-0.5 text-muted-foreground">{item.issue}</div>}
                {item.suggestion && <div className="mt-0.5">建议：{item.suggestion}</div>}
                {item.excerpt && (
                  <blockquote className="mt-1 border-l-2 pl-2 text-xs text-muted-foreground">
                    {item.excerpt}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">无具体意见。</p>
        )}

        {review.humanStatus === "PENDING" ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="人工评审附言（可选；驳回时请说明原因，供重新生成参考）"
              rows={2}
              maxLength={2000}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate("APPROVED")}
              >
                {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                通过
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate("REJECTED")}
              >
                <X />
                驳回
              </Button>
            </div>
          </div>
        ) : (
          review.humanComment && (
            <p className="border-t pt-2 text-sm text-muted-foreground">
              人工附言：{review.humanComment}
            </p>
          )
        )}
      </CardContent>
    </Card>
  )
}
