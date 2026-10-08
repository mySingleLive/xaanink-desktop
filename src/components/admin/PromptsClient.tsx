"use client"

import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch, EmptyState, TableSkeleton } from "./shared"
import { extractPromptVariables } from "@/lib/prompts/variables"
import type { LocalPromptItem } from "@desktop/shared/template-library"

type PromptTemplateItem = LocalPromptItem
type CreatePromptForm = { key: string; name: string; content: string }
type CreatePromptSubmission = {
  body: CreatePromptForm
  draft: CreatePromptForm
  epoch: number
  selectedId: string | null
}

/** 从内容中提取 {{变量}} 名 */
export function extractVariables(content: string): string[] {
  return extractPromptVariables(content)
}

/** 把 {{var}} 高亮渲染 */
export function HighlightedContent({ content }: { content: string }) {
  const parts = content.split(/(\{\{\s*[\w.-]+\s*\}\})/g)
  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) =>
        /^\{\{.*\}\}$/.test(part) ? (
          <mark key={i} className="rounded bg-primary/15 px-0.5 text-primary">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </div>
  )
}

export function PromptsClient() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PromptTemplateItem | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreatePromptForm>({ key: "", name: "", content: "" })
  const [deleting, setDeleting] = useState(false)
  const createEpoch = useRef(0)
  const live = useRef({ createOpen, createForm, selectedId })
  live.current = { createOpen, createForm, selectedId }

  const changeCreateOpen = (open: boolean) => {
    if (open !== live.current.createOpen) createEpoch.current++
    live.current.createOpen = open
    setCreateOpen(open)
  }
  const changeCreateForm = (form: CreatePromptForm) => {
    live.current.createForm = form
    setCreateForm(form)
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "prompts"],
    queryFn: () =>
      apiFetch<{ prompts: PromptTemplateItem[] }>("/api/admin/prompts"),
  })

  const selected = useMemo(() => {
    const list = data?.prompts ?? []
    return list.find((p) => p.id === selectedId) ?? null
  }, [data, selectedId])

  // 编辑器展示草稿（有改动时）否则展示服务端数据
  const current = draft && draft.id === selected?.id ? draft : selected

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "prompts"] })

  const saveMutation = useMutation({
    mutationFn: (item: PromptTemplateItem) =>
      apiFetch<{ prompt: PromptTemplateItem }>(`/api/admin/prompts/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: item.name,
          content: item.content,
          variables: extractVariables(item.content),
          enabled: item.enabled,
          expectedVersion: item.version,
        }),
      }),
    onSuccess: (res, submitted) => {
      invalidate()
      setDraft(previous => previous === submitted ? null : previous?.id === submitted.id && previous.version === submitted.version ? { ...previous, version: res.prompt.version } : previous)
      toast.success(`已保存，版本升至 v${res.prompt.version}`)
    },
    onError: (err) => toast.error(err.message),
  })

  const createMutation = useMutation({
    mutationFn: ({ body }: CreatePromptSubmission) =>
      apiFetch<{ prompt: PromptTemplateItem }>("/api/admin/prompts", {
        method: "POST",
        body: JSON.stringify({ ...body, variables: extractVariables(body.content) }),
      }),
    onSuccess: (res, submitted) => {
      invalidate()
      // A committed row may refresh the list, but only the same still-open
      // creation session owns the selected editor. A changed key remains a new
      // creation draft; newer text for the accepted key follows its new version.
      const form = live.current.createForm
      if (
        live.current.createOpen &&
        createEpoch.current === submitted.epoch &&
        live.current.selectedId === submitted.selectedId &&
        (form === submitted.draft || form.key.trim() === submitted.body.key)
      ) {
        changeCreateOpen(false)
        changeCreateForm({ key: "", name: "", content: "" })
        live.current.selectedId = res.prompt.id
        setSelectedId(res.prompt.id)
        setDraft(form === submitted.draft ? null : {
          ...res.prompt,
          name: form.name,
          content: form.content,
        })
      }
      toast.success("已创建")
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (item: PromptTemplateItem) =>
      apiFetch(`/api/admin/prompts/${item.id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: item.version }) }),
    onSuccess: (_res, item) => {
      invalidate()
      setSelectedId(previous => previous === item.id ? null : previous)
      setDraft(previous => previous?.id === item.id ? null : previous)
      setDeleting(false)
      toast.success("已删除")
    },
    onError: (err) => toast.error(err.message),
  })

  const dirty =
    !!draft &&
    !!selected &&
    (draft.name !== selected.name ||
      draft.content !== selected.content ||
      draft.enabled !== selected.enabled)

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      {/* 左侧模板列表 */}
      <div className="w-full shrink-0 rounded-lg border sm:w-64">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">模板列表</span>
          <Button variant="ghost" size="sm" onClick={() => changeCreateOpen(true)}>
            <Plus className="size-4" />
            新建
          </Button>
        </div>
        <ScrollArea className="h-[calc(100svh-15rem)]">
          {isLoading ? (
            <TableSkeleton columns={1} rows={8} />
          ) : !data || data.prompts.length === 0 ? (
            <EmptyState text="暂无提示词模板" className="py-10" />
          ) : (
            <div className="p-1">
              {data.prompts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    live.current.selectedId = p.id
                    setSelectedId(p.id)
                    setDraft(null)
                  }}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
                    p.id === selectedId
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <FileText className="size-3.5 shrink-0" />
                    <span className="truncate">{p.name}</span>
                    {!p.enabled ? (
                      <Badge variant="outline" className="ml-auto shrink-0">
                        停用
                      </Badge>
                    ) : null}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {p.key} · v{p.version}
                  </span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* 右侧编辑器 */}
      <div className="min-w-0 flex-1">
        {!current ? (
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            从左侧选择一个模板，或点击「新建」
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">v{current.version}</Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {current.key}
                </span>
                <span className="text-xs text-muted-foreground">
                  保存后版本自动 +1，旧版本存入历史
                </span>
                <Badge variant="outline">{current.source === "builtin" ? "内置模板" : current.source === "customized" ? "已自定义" : "用户模板"}</Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { changeCreateForm({key:`${current.key}.copy`,name:`${current.name}（副本）`,content:current.content});changeCreateOpen(true) }}>另存为</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleting(true)}
                  disabled={current.source !== "user" || deleteMutation.isPending}
                >
                  <Trash2 className="size-4" />
                  删除
                </Button>
                <Button
                  size="sm"
                  disabled={!dirty || saveMutation.isPending}
                  onClick={() => current && saveMutation.mutate(current)}
                >
                  保存
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>名称</Label>
              <Input
                aria-label="提示词名称"
                value={current.name}
                onChange={(e) => setDraft({ ...current, name: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label>内容（{"{{变量}}"} 语法）</Label>
              <Textarea
                aria-label="提示词内容"
                value={current.content}
                onChange={(e) => setDraft({ ...current, content: e.target.value })}
                rows={14}
                className="font-mono text-sm"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div className="space-y-1">
                <Label>启用该模板</Label>
                <div className="flex flex-wrap gap-1.5">
                  {extractVariables(current.content).length === 0 ? (
                    <span className="text-xs text-muted-foreground">无变量</span>
                  ) : (
                    extractVariables(current.content).map((v) => (
                      <Badge key={v} variant="outline" className="font-mono">
                        {"{{" + v + "}}"}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <Switch
                checked={current.enabled}
                onCheckedChange={(checked) =>
                  setDraft({ ...current, enabled: checked })
                }
              />
            </div>

            <div className="grid gap-2">
              <Label>变量高亮预览</Label>
              <HighlightedContent content={current.content} />
            </div>
          </div>
        )}
      </div>

      {/* 新建模板 */}
      <Dialog open={createOpen} onOpenChange={changeCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建提示词模板</DialogTitle>
            <DialogDescription>key 创建后不可修改。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Key（唯一标识）</Label>
              <Input
                aria-label="提示词Key"
                value={createForm.key}
                onChange={(e) => changeCreateForm({ ...createForm, key: e.target.value })}
                placeholder="如 outline.generate"
                className="font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label>名称</Label>
              <Input
                aria-label="新提示词名称"
                value={createForm.name}
                onChange={(e) => changeCreateForm({ ...createForm, name: e.target.value })}
                placeholder="如 大纲生成"
              />
            </div>
            <div className="grid gap-2">
              <Label>内容</Label>
              <Textarea
                aria-label="新提示词内容"
                value={createForm.content}
                onChange={(e) =>
                  changeCreateForm({ ...createForm, content: e.target.value })
                }
                rows={8}
                className="font-mono text-sm"
                placeholder="支持 {{变量}} 占位符"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => changeCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                createMutation.isPending ||
                !createForm.key.trim() ||
                !createForm.name.trim() ||
                !createForm.content.trim()
              }
              onClick={() =>
                createMutation.mutate({
                  body: {
                    key: createForm.key.trim(),
                    name: createForm.name.trim(),
                    content: createForm.content,
                  },
                  draft: createForm,
                  epoch: createEpoch.current,
                  selectedId,
                })
              }
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除模板</DialogTitle>
            <DialogDescription>
              将删除「{current?.name}」（{current?.key}），删除后引用该模板的生成流程会失败。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => current && deleteMutation.mutate(current)}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
