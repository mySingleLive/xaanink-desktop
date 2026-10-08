"use client"

/**
 * SOP 计划卡与进行中计划吸顶条（2026-08 graph-engineering SOP，参考 Codex Task List）：
 * - SopPlanCard：消息级通栏卡，assistant 消息含 createSopPlan 调用时原位渲染；
 *   数据驱动（DB 的 SopPlan），流式期间 3s 轮询 + SOP 工具完成时失效刷新，实时打勾。
 *   视觉复用 ProgressPanel 勾圈派三态 dot（skipped=划除线 muted），卡尾附挂账问题区。
 * - ActivePlanBar：会话有进行中计划时吸顶 compact 进度条（计划名 + 当前项 + N/M），
 *   点击滚动定位到计划卡；计划完成/作废自动消失。
 * 与推断式进程面板（ProgressPanel）的分工：本卡是「计划先行、数据驱动、跨轮次」的 SOP ToDo List。
 */
import { useQuery, type QueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Check, ChevronDown, ChevronRight, ListChecks, Minus, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { SOP_NODES } from "@/lib/sop/graph"

import { Collapse } from "./Collapse"

/* ------------------------------- 数据 ------------------------------- */

export type SopPlanItemStatus = "pending" | "active" | "done" | "failed" | "skipped"

export interface SopPlanItemView {
  id: string
  label: string
  nodeId: string
  targetId?: string
  status: SopPlanItemStatus
  summary?: string
}

export interface DeferredQuestionView {
  id: string
  nodeId: string
  question: string
  status: "deferred" | "resolved"
  answer?: string
}

export interface SopPlanView {
  id: string
  title: string
  status: "active" | "done" | "superseded"
  items: SopPlanItemView[]
  deferredQuestions: DeferredQuestionView[] | null
}

const NODE_LABELS = new Map(SOP_NODES.map((n) => [n.id, n.label]))

export function nodeLabel(nodeId: string): string {
  return NODE_LABELS.get(nodeId as never) ?? (nodeId === "manual" ? "人工" : nodeId)
}

async function fetchPlans(conversationId: string): Promise<{ active: SopPlanView | null; recent: SopPlanView[] }> {
  const res = await fetch(`/api/chat/conversations/${conversationId}/sop-plan`)
  if (!res.ok) throw new Error("加载计划失败")
  return res.json()
}

/** 会话 SOP 计划查询（流式期间 3s 轮询；SOP 工具完成时经 invalidateSopPlan 失效） */
export function useSopPlans(conversationId: string | null, streaming: boolean) {
  return useQuery({
    queryKey: ["sop-plan", conversationId],
    queryFn: () => fetchPlans(conversationId!),
    enabled: !!conversationId,
    refetchInterval: streaming ? 3000 : false,
  })
}

/** SOP 工具完成时刷新计划卡（use-agent-chat 在 tool-output-available 时调用） */
export function invalidateSopPlan(queryClient: QueryClient, conversationId: string | null | undefined) {
  if (!conversationId) return
  queryClient.invalidateQueries({ queryKey: ["sop-plan", conversationId] })
}

/* ------------------------------- 三态圆点 ------------------------------- */

/** 勾圈派三态 + 失败 + 跳过（15px）：done=success 实底勾 / failed=destructive 叉 / active=primary 半填 / skipped=muted 横杠 / pending=空心 */
function PlanDot({ status }: { status: SopPlanItemStatus }) {
  if (status === "done") {
    return (
      <span className="flex size-[15px] shrink-0 items-center justify-center rounded-full bg-success">
        <Check className="size-[9px] text-primary-foreground" strokeWidth={3.5} />
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="flex size-[15px] shrink-0 items-center justify-center rounded-full bg-destructive">
        <X className="size-[9px] text-primary-foreground" strokeWidth={3.5} />
      </span>
    )
  }
  if (status === "active") {
    return (
      <span className="size-[15px] shrink-0 rounded-full border-2 border-primary [background:linear-gradient(90deg,var(--primary)_50%,transparent_50%)]" />
    )
  }
  if (status === "skipped") {
    return (
      <span className="flex size-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-input text-muted-foreground">
        <Minus className="size-[9px]" strokeWidth={3} />
      </span>
    )
  }
  return <span className="size-[15px] shrink-0 rounded-full border-[1.5px] border-input" />
}

function terminalCount(plan: SopPlanView): number {
  return plan.items.filter(
    (i) => i.status === "done"
  ).length
}

/* ------------------------------- 计划卡 ------------------------------- */

export function SopPlanCard({
  conversationId,
  planId,
  streaming,
}: {
  conversationId: string
  planId: string | null
  streaming: boolean
}) {
  const { data } = useSopPlans(conversationId, streaming)
  const [open, setOpen] = useState(true)

  const plan =
    (planId && data?.active?.id === planId ? data.active : null) ??
    (planId ? (data?.recent.find((p) => p.id === planId) ?? null) : null) ??
    (planId ? null : (data?.active ?? null))
  // 查询尚未返回时不渲染（避免历史消息闪空卡）
  if (!plan) return null

  const doneCount = terminalCount(plan)
  const deferred = (plan.deferredQuestions ?? []).filter((q) => q.status === "deferred")
  const superseded = plan.status === "superseded"

  return (
    <div
      data-sop-plan={plan.id}
      className="chat-enter w-full rounded-card border border-(--chat-line) bg-chat-surface px-3 py-2 shadow-1"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/tl flex w-full items-center gap-1.5 text-left text-xs font-medium text-foreground select-none"
      >
        <ListChecks className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">
          {plan.title}
          {superseded && <span className="text-muted-foreground">（已被新计划取代）</span>}
        </span>
        <span className="shrink-0 font-mono font-normal text-muted-foreground tabular-nums">
          成功 {doneCount}/{plan.items.length} · 失败 {plan.items.filter(i => i.status === "failed").length}
        </span>
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/tl:opacity-100" />
        )}
      </button>
      <Collapse open={open} className="mt-1">
        <div className="flex flex-col gap-1">
          {plan.items.map((item) => (
            <div key={item.id} className="flex items-start gap-2 text-[12.5px] leading-[1.5]">
              <span className="mt-[2px]">
                <PlanDot status={item.status} />
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1",
                  item.status === "pending" && "text-muted-foreground",
                  item.status === "skipped" && "text-muted-foreground line-through"
                )}
              >
                {item.label}
                {item.status === "active" && (
                  <span className="text-muted-foreground">（进行中）</span>
                )}
                {item.summary && item.status !== "pending" && item.status !== "active" && (
                  <span className="block text-[11.5px] text-muted-foreground">{item.summary}</span>
                )}
              </span>
            </div>
          ))}
          {deferred.length > 0 && (
            <div className="mt-1 border-t border-(--chat-line) pt-1.5">
              {deferred.map((q) => (
                <div
                  key={q.id}
                  className="text-[11.5px] leading-[1.6] text-muted-foreground"
                >
                  待澄清：{q.question}
                  <span className="text-foreground/60">（到「{nodeLabel(q.nodeId)}」环节再定）</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Collapse>
    </div>
  )
}

/* ------------------------------- 吸顶进度条 ------------------------------- */

/**
 * 进行中计划吸顶条：会话有 active 计划时钉在消息区顶部。
 * 点击经 onLocate 回调滚动定位到计划卡。
 */
export function ActivePlanBar({
  conversationId,
  streaming,
  onLocate,
}: {
  conversationId: string | null
  streaming: boolean
  onLocate?: (planId: string) => void
}) {
  const { data } = useSopPlans(conversationId, streaming)
  const plan = data?.active
  // 完成/作废后自动消失（数据刷新前短暂保留也由 query 下一轮清掉）
  if (!plan) return null

  const doneCount = terminalCount(plan)
  const current = plan.items.find((i) => i.status === "active")
  const deferredCount = (plan.deferredQuestions ?? []).filter((q) => q.status === "deferred").length

  return (
    <button
      type="button"
      onClick={() => onLocate?.(plan.id)}
      className="flex w-full items-center gap-2 border-b border-(--chat-line) bg-chat-surface px-4 py-1.5 text-left select-none"
    >
      <ListChecks className="size-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
        {plan.title}
      </span>
      {current && (
        <span className="hidden min-w-0 max-w-[40%] truncate text-[11.5px] text-muted-foreground sm:inline">
          {current.label}
        </span>
      )}
      {deferredCount > 0 && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {deferredCount} 个问题挂账
        </span>
      )}
      <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums">
        成功 {doneCount}/{plan.items.length} · 失败 {plan.items.filter(i => i.status === "failed").length}
      </span>
    </button>
  )
}
