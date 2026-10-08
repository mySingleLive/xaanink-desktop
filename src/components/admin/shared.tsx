"use client"

import type { LucideIcon } from "lucide-react"
import { Inbox } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** 统一 fetch：非 2xx 时抛出带服务端 error 信息的 Error */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  if (!res.ok) {
    let message = `请求失败（${res.status}）`
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return n.toLocaleString("zh-CN")
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`
}

export function formatDateTime(value: string | Date): string {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function StatCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string
  value: string
  icon: LucideIcon
  description?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-8 w-28 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  )
}

export function TableSkeleton({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: columns }).map((__, j) => (
            <div key={j} className="h-5 flex-1 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground",
        className
      )}
    >
      <Inbox className="size-8" />
      <p className="text-sm">{text}</p>
    </div>
  )
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        共 {total} 条 · 第 {page} / {totalPages} 页
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}

export const PLAN_LABELS: Record<string, string> = {
  FREE: "免费版",
  BASIC: "基础版",
  PRO: "专业版",
}

export const STAGE_LABELS: Record<string, string> = {
  THEME: "主题",
  SETTING: "核心设定",
  STYLE: "文风",
  CHARACTER: "角色",
  TROPE: "爽点泪点",
  MAP: "势力地图",
  OUTLINE: "大纲",
  OUTLINE_REVIEW: "大纲评审",
  WRITING: "正文",
  CHAPTER_REVIEW: "正文评审",
  DONE: "已完成",
}

export const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "kimi", label: "Kimi（月之暗面）" },
  { value: "qwen", label: "通义千问" },
  { value: "zhipu", label: "智谱" },
  { value: "openai-compatible", label: "OpenAI 兼容" },
] as const
