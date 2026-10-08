"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { TropeKind } from "@/generated/prisma/enums"

import { apiGet, apiSend } from "./api"
import { TROPE_KIND_LABELS } from "./labels"
import type { ContentPanelProps } from "./registry"

interface TropeItem {
  id: string
  kind: TropeKind
  category: string
  content: string
  referenceCase: string
  isCustom: boolean
  selected: boolean
  userTropeId: string | null
}

/** 爽点/泪点选择（type=trope）：平台库勾选 + 自定义 */
export function TropePanel({ novelId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<TropeKind>("SATISFACTION")
  const [createOpen, setCreateOpen] = useState(false)
  const [customForm, setCustomForm] = useState({ category: "", content: "", referenceCase: "" })

  const { data, isLoading, isError } = useQuery({
    queryKey: ["tropes", novelId],
    queryFn: () =>
      apiGet<{ tropes: TropeItem[] }>(`/api/novels/${novelId}/tropes`, "加载爽点/泪点失败"),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tropes", novelId] })
    queryClient.invalidateQueries({ queryKey: ["novels"] })
    queryClient.invalidateQueries({ queryKey: ["novels", novelId] })
  }

  const toggleMutation = useMutation({
    mutationFn: async (item: TropeItem) => {
      if (item.selected && item.userTropeId) {
        // 已选 → 取消勾选
        await apiSend(
          `/api/novels/${novelId}/tropes/${item.userTropeId}`,
          "PATCH",
          { selected: false },
          "操作失败"
        )
      } else if (item.isCustom) {
        await apiSend(
          `/api/novels/${novelId}/tropes/${item.id}`,
          "PATCH",
          { selected: true },
          "操作失败"
        )
      } else {
        // 平台库条目 → 复制为本小说的选中记录
        await apiSend(
          `/api/novels/${novelId}/tropes/select`,
          "POST",
          { tropeId: item.id },
          "操作失败"
        )
      }
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      apiSend(
        `/api/novels/${novelId}/tropes`,
        "POST",
        { kind, ...customForm },
        "创建失败"
      ),
    onSuccess: () => {
      toast.success("已添加自定义条目并选中")
      setCreateOpen(false)
      setCustomForm({ category: "", content: "", referenceCase: "" })
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiSend(`/api/novels/${novelId}/tropes/${id}`, "DELETE", undefined, "删除失败"),
    onSuccess: () => {
      toast.success("已删除")
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        爽点/泪点加载失败，请稍后重试
      </div>
    )
  }

  const items = (data?.tropes ?? []).filter((t) => t.kind === kind)
  const sorted = [...items].sort((a, b) => Number(b.selected) - Number(a.selected))
  const categories = Array.from(new Set(sorted.map((t) => t.category)))
  const selectedCount = items.filter((t) => t.selected).length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-3">
        <Tabs value={kind} onValueChange={(v) => setKind(v as TropeKind)}>
          <TabsList>
            <TabsTrigger value="SATISFACTION">爽点</TabsTrigger>
            <TabsTrigger value="TEAR">泪点</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted-foreground">已选 {selectedCount} 项</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
          自定义{TROPE_KIND_LABELS[kind]}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {categories.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              暂无{TROPE_KIND_LABELS[kind]}条目
            </p>
          ) : (
            categories.map((category) => (
              <section key={category} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">{category}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {sorted
                    .filter((t) => t.category === category)
                    .map((item) => (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleMutation.mutate(item)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            toggleMutation.mutate(item)
                          }
                        }}
                        className={cn(
                          "group relative flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 transition-shadow hover:shadow-sm",
                          item.selected && "border-primary bg-primary/5"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={cn(
                              "mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded border",
                              item.selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input"
                            )}
                          >
                            {item.selected && <Check className="size-3" />}
                          </span>
                          <p className="min-w-0 flex-1 text-sm leading-relaxed">{item.content}</p>
                        </div>
                        {item.referenceCase && (
                          <p className="pl-6.5 text-xs text-muted-foreground">
                            参考：{item.referenceCase}
                          </p>
                        )}
                        <div className="absolute top-2 right-2 flex items-center gap-1">
                          {item.isCustom && (
                            <>
                              <Badge variant="secondary" className="text-xs">
                                自定义
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="删除自定义条目"
                                className="size-6 opacity-0 group-hover:opacity-100"
                                disabled={deleteMutation.isPending}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  deleteMutation.mutate(item.id)
                                }}
                              >
                                <Trash2 className="size-3.5 text-muted-foreground" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>自定义{TROPE_KIND_LABELS[kind]}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label>分类</Label>
              <Input
                value={customForm.category}
                onChange={(e) => setCustomForm({ ...customForm, category: e.target.value })}
                placeholder="如：扮猪吃虎、生离死别"
                maxLength={50}
              />
            </div>
            <div className="grid gap-2">
              <Label>内容说明</Label>
              <Textarea
                value={customForm.content}
                onChange={(e) => setCustomForm({ ...customForm, content: e.target.value })}
                placeholder="这个爽点/泪点具体是什么"
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label>参考案例（可选）</Label>
              <Textarea
                value={customForm.referenceCase}
                onChange={(e) =>
                  setCustomForm({ ...customForm, referenceCase: e.target.value })
                }
                placeholder="出自哪部作品的哪个桥段"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={
                !customForm.category.trim() ||
                !customForm.content.trim() ||
                createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending && <Loader2 className="animate-spin" />}
              创建并选中
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
