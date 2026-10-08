"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  ListTree,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { apiGet, apiSend } from "./api"
import type { ContentPanelProps } from "./registry"

type CascadeJobStatus = "PENDING" | "RUNNING" | "WAITING_CONFIRM" | "DONE" | "FAILED"
type CascadeItemStatus = "PENDING" | "APPLIED" | "SKIPPED" | "ERROR"
type CascadeTargetType = "CHAPTER_OUTLINE" | "CHAPTER_CONTENT"

interface CascadeJobSummary {
  id: string
  triggerType: "SETTING" | "CHARACTER"
  triggerId: string
  triggerName: string | null
  status: CascadeJobStatus
  totalCount: number
  resolvedCount: number
  createdAt: string
  updatedAt: string
}

interface CascadeResultItem {
  targetType: CascadeTargetType
  targetId: string
  title: string
  volumeTitle: string
  before: string
  after: string
  changes: string
  status: CascadeItemStatus
  error?: string
}

interface CascadeJobDetail {
  id: string
  novelId: string
  triggerType: "SETTING" | "CHARACTER"
  triggerId: string
  triggerName: string | null
  status: CascadeJobStatus
  affectedItems: unknown
  result: CascadeResultItem[]
  createdAt: string
  updatedAt: string
}

const JOB_STATUS_LABELS: Record<CascadeJobStatus, string> = {
  PENDING: "排队中",
  RUNNING: "修订中",
  WAITING_CONFIRM: "待确认",
  DONE: "已完成",
  FAILED: "失败",
}

const ITEM_STATUS_LABELS: Record<CascadeItemStatus, string> = {
  PENDING: "待确认",
  APPLIED: "已应用",
  SKIPPED: "已跳过",
  ERROR: "失败",
}

function triggerLabel(job: { triggerType: "SETTING" | "CHARACTER"; triggerName: string | null }) {
  const source = job.triggerType === "SETTING" ? "设定" : "角色"
  return `${source}：${job.triggerName ?? "已删除"}`
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

/** 单条修订项：标题行 + 可展开的 before/after 对照 */
function RevisionItem({
  item,
  busy,
  onApply,
  onSkip,
}: {
  item: CascadeResultItem
  busy: boolean
  onApply: () => void
  onSkip: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const TypeIcon = item.targetType === "CHAPTER_OUTLINE" ? ListTree : FileText

  return (
    <div className="rounded-lg border">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        className="flex cursor-pointer items-center gap-2 px-3 py-2 select-none"
      >
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />
        <TypeIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">
          {item.volumeTitle} · {item.title}
        </span>
        <Badge variant="outline">
          {item.targetType === "CHAPTER_OUTLINE" ? "大纲" : "正文"}
        </Badge>
        <Badge
          variant={
            item.status === "APPLIED"
              ? "secondary"
              : item.status === "ERROR"
                ? "destructive"
                : item.status === "SKIPPED"
                  ? "outline"
                  : "default"
          }
        >
          {ITEM_STATUS_LABELS[item.status]}
        </Badge>
        {item.status === "PENDING" && (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="outline" disabled={busy} onClick={onApply}>
              <Check />
              应用
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onSkip}>
              <X />
              跳过
            </Button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 border-t px-3 py-3">
          {item.changes && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              <span className="font-medium">AI 修订说明：</span>
              {item.changes}
            </div>
          )}
          {item.status === "ERROR" && item.error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <CircleAlert className="size-4 shrink-0" />
              {item.error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-h-0 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">修订前</span>
              <div className="max-h-96 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                {item.before || "（空）"}
              </div>
            </div>
            <div className="flex min-h-0 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">修订后</span>
              <div className="max-h-96 overflow-y-auto rounded-md border border-primary/30 bg-primary/5 p-3 text-sm whitespace-pre-wrap">
                {item.after || "（空）"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 级联修订面板（type=cascade）：左侧任务列表 + 右侧修订项确认 */
export function CascadePanel({ novelId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const listQuery = useQuery({
    queryKey: ["cascade", novelId],
    queryFn: () =>
      apiGet<{ jobs: CascadeJobSummary[]; pendingCount: number }>(
        `/api/novels/${novelId}/cascade`,
        "加载级联任务失败"
      ),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((j) => j.status === "RUNNING") ? 3000 : false,
  })

  const jobs = listQuery.data?.jobs ?? []
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? jobs[0] ?? null

  const detailQuery = useQuery({
    queryKey: ["cascade", novelId, selectedJob?.id],
    queryFn: () =>
      apiGet<{ job: CascadeJobDetail }>(
        `/api/novels/${novelId}/cascade/${selectedJob!.id}`,
        "加载修订详情失败"
      ),
    enabled: !!selectedJob,
    refetchInterval: (query) =>
      query.state.data?.job.status === "RUNNING" ? 3000 : false,
  })

  const detail = detailQuery.data?.job ?? null

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["cascade", novelId] })
    queryClient.invalidateQueries({ queryKey: ["outline", novelId] })
    queryClient.invalidateQueries({ queryKey: ["chapter"] })
    queryClient.invalidateQueries({ queryKey: ["novels"] })
    queryClient.invalidateQueries({ queryKey: ["novels", novelId] })
  }

  const itemMutation = useMutation({
    mutationFn: async ({
      action,
      targetId,
      targetType,
    }: {
      action: "apply" | "skip"
      targetId: string
      targetType: CascadeTargetType
    }) => {
      await apiSend(
        `/api/novels/${novelId}/cascade/${selectedJob!.id}/${action}`,
        "POST",
        { targetId, targetType },
        action === "apply" ? "应用修订失败" : "跳过失败"
      )
    },
    onSuccess: invalidateAll,
    onError: (err) => toast.error(err.message),
  })

  const bulkMutation = useMutation({
    mutationFn: async (action: "apply-all" | "finish") => {
      await apiSend(
        `/api/novels/${novelId}/cascade/${selectedJob!.id}/${action}`,
        "POST",
        undefined,
        action === "apply-all" ? "全部应用失败" : "完成失败"
      )
    },
    onSuccess: (_data, action) => {
      toast.success(action === "apply-all" ? "已应用全部修订" : "任务已完成")
      invalidateAll()
    },
    onError: (err) => toast.error(err.message),
  })

  if (listQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="size-8 text-muted-foreground/50" />
        <p>
          暂无级联修订任务
          <br />
          修改设定或角色后，AI 会自动修订受影响的大纲与正文
        </p>
      </div>
    )
  }

  const busy = itemMutation.isPending || bulkMutation.isPending
  const pendingItems = detail?.result.filter((it) => it.status === "PENDING") ?? []

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r">
        <div className="border-b px-3 py-2 text-sm font-medium">修订任务</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => setSelectedJobId(job.id)}
              className={cn(
                "mb-1 flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left",
                selectedJob?.id === job.id
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {triggerLabel(job)}
                </span>
                <Badge
                  variant={
                    job.status === "WAITING_CONFIRM"
                      ? "default"
                      : job.status === "FAILED"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {job.status === "RUNNING" && (
                    <Loader2 className="size-3 animate-spin" />
                  )}
                  {JOB_STATUS_LABELS[job.status]}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatTime(job.createdAt)}</span>
                <span>
                  {job.resolvedCount}/{job.totalCount}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {detailQuery.isLoading || !detail ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <span className="text-sm font-medium">{triggerLabel(detail)}</span>
              <Badge variant="secondary">{JOB_STATUS_LABELS[detail.status]}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatTime(detail.createdAt)}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy || detail.status !== "WAITING_CONFIRM" || pendingItems.length === 0}
                  onClick={() => bulkMutation.mutate("apply-all")}
                >
                  {bulkMutation.isPending && bulkMutation.variables === "apply-all" && (
                    <Loader2 className="animate-spin" />
                  )}
                  全部应用（{pendingItems.length}）
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    busy || detail.status === "RUNNING" || detail.status === "DONE"
                  }
                  onClick={() => bulkMutation.mutate("finish")}
                >
                  完成
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {detail.status === "RUNNING" && (
                <div className="mb-3 flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  AI 正在逐条修订受影响内容，请稍候…
                </div>
              )}
              {detail.status === "FAILED" && (
                <div className="mb-3 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <CircleAlert className="size-4 shrink-0" />
                  该任务执行失败，请修改设定/角色后重新触发。
                </div>
              )}
              {detail.result.length === 0 && detail.status !== "RUNNING" ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  暂无修订项
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {detail.result.map((item) => (
                    <RevisionItem
                      key={`${item.targetType}:${item.targetId}`}
                      item={item}
                      busy={busy}
                      onApply={() =>
                        itemMutation.mutate({
                          action: "apply",
                          targetId: item.targetId,
                          targetType: item.targetType,
                        })
                      }
                      onSkip={() =>
                        itemMutation.mutate({
                          action: "skip",
                          targetId: item.targetId,
                          targetType: item.targetType,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
