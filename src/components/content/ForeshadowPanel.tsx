"use client"

/**
 * 伏笔面板（tab 类型 foreshadow）：左列伏笔列表 + 右列档案与触点链。
 * 触点三态：埋入 PLANT / 提及 MENTION / 回收 PAYOFF，各带关联目标链接与写作质量评分。
 * 布局与交互照 SettingPanel：查询缓存 + 显式保存 + 面板聚焦（panelFocus.foreshadowId）。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Flag,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { TouchReferenceList } from "@/components/foreshadow/references"
import { usePanelFocusRequest } from "@/components/foreshadow/use-panel-focus"
import type { PanelFocus } from "@/stores/tabs"
import { Badge } from "@/components/ui/badge"
import { MarkdownEditor } from "@/components/editor/MarkdownEditor"
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { FORESHADOW_STATUS_LABELS, TOUCH_KIND_LABELS } from "@/lib/foreshadow"
import { buildTabId } from "@/stores/tabs"
import type { ForeshadowDTO, ForeshadowTouchDTO } from "@/lib/services/foreshadow"

import { apiGet, apiSend } from "./api"
import type { ContentPanelProps } from "./registry"
import type { OutlineVolumeNode } from "./types"

/* ---------------- 数据类型（与服务层 DTO 对齐） ---------------- */

type TouchKind = ForeshadowTouchDTO["kind"]
type ForeshadowStatus = ForeshadowDTO["status"]
type ForeshadowItem = ForeshadowDTO

const STATUS_BADGE: Record<ForeshadowStatus, { label: string; className: string }> = {
  PLANNED: { label: "未埋", className: "bg-muted text-muted-foreground" },
  PLANTED: { label: "已埋", className: "bg-ink-blue/15 text-ink-blue" },
  RESOLVED: { label: "已回收", className: "bg-success/15 text-success" },
  DROPPED: { label: "废弃", className: "bg-muted text-muted-foreground line-through" },
}

const KIND_STYLE: Record<TouchKind, string> = {
  PLANT: "text-ink-blue",
  MENTION: "text-muted-foreground",
  PAYOFF: "text-primary",
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "bg-success/15 text-success"
  if (score >= 60) return "bg-warning/15 text-warning"
  return "bg-destructive/15 text-destructive"
}

/** 新增触点对话框：类型 → 目标章 → 摘要 */
function AddTouchDialog({
  novelId,
  foreshadowId,
  open,
  onOpenChange,
  onAdded,
}: {
  novelId: string
  foreshadowId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}) {
  const [kind, setKind] = useState<TouchKind>("MENTION")
  const [chapterId, setChapterId] = useState("")
  const [summary, setSummary] = useState("")

  const { data: outline } = useQuery({
    queryKey: ["outline", novelId],
    queryFn: () => apiGet<{ volumes: OutlineVolumeNode[] }>(`/api/novels/${novelId}/outline`, "加载大纲失败"),
  })

  const mutation = useMutation({
    mutationFn: () =>
      apiSend(
        `/api/novels/${novelId}/foreshadows/${foreshadowId}/touches`,
        "POST",
        { kind, summary: summary.trim(), chapterId },
        "挂触点失败"
      ),
    onSuccess: () => {
      toast.success("触点已挂上")
      onOpenChange(false)
      setSummary("")
      onAdded()
    },
    onError: (err) => toast.error(err.message),
  })

  const canSubmit = !mutation.isPending && summary.trim().length > 0 && !!chapterId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增触点</DialogTitle>
          <DialogDescription>记录这条伏笔在哪里埋入、提及或回收。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 rounded-md border bg-muted p-0.5">
            {(["PLANT", "MENTION", "PAYOFF"] as TouchKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-xs transition-colors",
                  kind === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                {TOUCH_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <select
            value={chapterId}
            onChange={(e) => setChapterId(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">选择章节…</option>
            {(outline?.volumes ?? []).flatMap((v) =>
              v.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  第 {v.index} 卷第 {c.index} 章《{c.title}》
                </option>
              ))
            )}
          </select>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="这一笔的情节摘要（建议 30 字以内，便于与原文核对）"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="animate-spin" />}
            挂上触点
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 单条伏笔的详情编辑区 */
function ForeshadowDetail({
  novelId,
  item,
  onChanged,
  onDeleted,
  focus,
}: {
  novelId: string
  item: ForeshadowItem
  focus: PanelFocus | null
  onChanged: () => void
  onDeleted: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const [content, setContent] = useState(item.content)
  const [expectation, setExpectation] = useState(item.expectation)
  const [plannedChapter, setPlannedChapter] = useState(item.plannedChapter ? String(item.plannedChapter) : "")
  const [note, setNote] = useState(item.note)
  const [previousItem, setPreviousItem] = useState(item)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addTouchOpen, setAddTouchOpen] = useState(false)
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const handledTouchFocus = useRef<PanelFocus | null>(null)

  // AI 写入/触点评审刷新同一档案时同步未编辑字段，保留作者正在输入的草稿。
  // 在渲染期比较来源，避免 effect 延迟期间把旧字段当作新修改保存回去。
  if (previousItem !== item) {
    setPreviousItem(item)
    if (title === previousItem.title) setTitle(item.title)
    if (content === previousItem.content) setContent(item.content)
    if (expectation === previousItem.expectation) setExpectation(item.expectation)
    if (note === previousItem.note) setNote(item.note)
    if ((plannedChapter.trim() ? Number(plannedChapter) : null) === previousItem.plannedChapter) {
      setPlannedChapter(item.plannedChapter === null ? "" : String(item.plannedChapter))
    }
  }

  /* 面板聚焦：选中后滚到顶部（切换条目重置表单——父层 key=item.id 保证重建） */
  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 })
  }, [item.id])

  useEffect(() => {
    if (focus?.foreshadowId !== item.id || !focus.touchId || handledTouchFocus.current === focus) return
    const card = detailRef.current?.querySelector<HTMLElement>(`[data-touch-id="${CSS.escape(focus.touchId)}"]`)
    if (!card) return
    handledTouchFocus.current = focus
    card.scrollIntoView({ block: "center" })
    card.focus({ preventScroll: true })
  }, [focus, item.id, item.touches])

  const saveMutation = useMutation({
    mutationFn: () =>
      apiSend(
        `/api/novels/${novelId}/foreshadows/${item.id}`,
        "PATCH",
        {
          ...(title !== item.title ? { title: title.trim() || item.title } : {}),
          ...(content !== item.content ? { content } : {}),
          ...(expectation !== item.expectation ? { expectation } : {}),
          ...(note !== item.note ? { note } : {}),
          ...((plannedChapter.trim() ? Number(plannedChapter) : null) !== item.plannedChapter
            ? { plannedChapter: plannedChapter.trim() ? Number(plannedChapter) : null }
            : {}),
        },
        "保存伏笔失败"
      ),
    onSuccess: () => {
      toast.success("已保存")
      onChanged()
    },
    onError: (err) => toast.error(err.message),
  })

  const statusMutation = useMutation({
    mutationFn: (status: ForeshadowStatus) =>
      apiSend(`/api/novels/${novelId}/foreshadows/${item.id}`, "PATCH", { status }, "更新状态失败"),
    onSuccess: () => onChanged(),
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiSend(`/api/novels/${novelId}/foreshadows/${item.id}`, "DELETE", undefined, "删除失败"),
    onSuccess: () => {
      toast.success("伏笔已删除")
      setConfirmDelete(false)
      onDeleted()
    },
    onError: (err) => toast.error(err.message),
  })

  const removeTouchMutation = useMutation({
    mutationFn: (touchId: string) =>
      apiSend(`/api/novels/${novelId}/foreshadows/${item.id}/touches/${touchId}`, "DELETE", undefined, "移除触点失败"),
    onSuccess: () => onChanged(),
    onError: (err) => toast.error(err.message),
  })

  const evaluateTouch = async (touchId: string) => {
    setEvaluatingId(touchId)
    try {
      await apiSend(
        `/api/novels/${novelId}/foreshadows/${item.id}/touches/${touchId}/evaluate`,
        "POST",
        undefined,
        "评估失败"
      )
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "评估失败")
    } finally {
      setEvaluatingId(null)
    }
  }

  const dirty =
    title !== item.title ||
    content !== item.content ||
    expectation !== item.expectation ||
    note !== item.note ||
    (plannedChapter.trim() ? Number(plannedChapter) : null) !== item.plannedChapter

  return (
    <div ref={detailRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="flex items-center gap-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="伏笔标题"
          className="max-w-64 font-medium"
        />
        <Badge className={cn("border-0", STATUS_BADGE[item.status].className)}>
          {FORESHADOW_STATUS_LABELS[item.status] ?? item.status}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending && <Loader2 className="animate-spin" />}
            保存
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="删除该伏笔"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">内容（谜面 / 真相 / 兑现计划）</div>
          <MarkdownEditor value={content} onChange={setContent} className="h-64 min-h-48" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">预期回收位置</div>
            <Input
              value={expectation}
              onChange={(e) => setExpectation(e.target.value)}
              placeholder="如「第二卷结尾」"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">预期回收章序号（线性，可空）</div>
            <Input
              value={plannedChapter}
              onChange={(e) => setPlannedChapter(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="如 42"
            />
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">备注（写作备忘，不进 AI 上下文）</div>
          <MarkdownEditor value={note} onChange={setNote} className="h-40 min-h-32" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">状态：</span>
          {(["PLANNED", "PLANTED", "RESOLVED", "DROPPED"] as ForeshadowStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate(s)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                item.status === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-hover-wash"
              )}
            >
              {FORESHADOW_STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="mt-2">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium">触点链</span>
            <Button variant="outline" size="sm" onClick={() => setAddTouchOpen(true)}>
              <Plus />
              新增触点
            </Button>
          </div>
          {item.touches.length === 0 && (
            <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              还没有触点。埋入/提及/回收这条伏笔时，在这里或对话里挂上触点。
            </div>
          )}
          <div className="flex flex-col gap-2">
            {item.touches.map((t) => (
              <div key={t.id} data-touch-id={t.id} tabIndex={-1} className="foreshadow-touch-card rounded-lg border bg-popover p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("text-xs font-semibold", KIND_STYLE[t.kind])}>
                    {TOUCH_KIND_LABELS[t.kind]}
                  </span>
                  {t.score !== null ? (
                    <span
                      title={t.scoreComment || undefined}
                      className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", scoreBadgeClass(t.score))}
                    >
                      {Math.round(t.score)}
                    </span>
                  ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-6 px-2 text-xs"
                      disabled={evaluatingId !== null}
                      onClick={() => void evaluateTouch(t.id)}
                    >
                      {evaluatingId === t.id ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      {t.score === null ? "评估" : "重新评估"}
                    </Button>
                  <button
                    type="button"
                    aria-label="移除触点"
                    className={cn("text-muted-foreground hover:text-destructive", t.score === null ? "" : "ml-auto")}
                    onClick={() => removeTouchMutation.mutate(t.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="mt-1 text-sm">{t.summary || "（无摘要）"}</div>
                <TouchReferenceList novelId={novelId} fid={item.id} touch={t} />
                {t.scoreComment && (
                  <div className="mt-0.5 text-xs text-muted-foreground">{t.scoreComment}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <AddTouchDialog
        novelId={novelId}
        foreshadowId={item.id}
        open={addTouchOpen}
        onOpenChange={setAddTouchOpen}
        onAdded={onChanged}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除伏笔</DialogTitle>
            <DialogDescription>
              确定要删除「{item.title}」吗？该档案及其全部触点将一并删除，此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 伏笔面板：左列列表 + 右列详情 */
export function ForeshadowPanel({ novelId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const tabId = buildTabId("foreshadow", novelId)
  const focus = usePanelFocusRequest(tabId)
  const [selectedId, setSelectedId] = useState<string | null>(focus?.foreshadowId ?? null)
  const [previousFocus, setPreviousFocus] = useState(focus)
  if (focus !== previousFocus) { setPreviousFocus(focus); if (focus?.foreshadowId) setSelectedId(focus.foreshadowId) }

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["foreshadows", novelId],
    queryFn: () =>
      apiGet<{ foreshadows: ForeshadowItem[] }>(
        `/api/novels/${novelId}/foreshadows`,
        "加载伏笔失败"
      ),
  })

  const items = useMemo(() => data?.foreshadows ?? [], [data])
  const selected = items.find((f) => f.id === selectedId) ?? items[0] ?? null

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["foreshadows", novelId] })
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const names = new Set(items.map((f) => f.title))
      let n = 1
      while (names.has(`未命名伏笔 ${n}`)) n += 1
      return apiSend<{ foreshadow: ForeshadowItem }>(
        `/api/novels/${novelId}/foreshadows`,
        "POST",
        { title: `未命名伏笔 ${n}` },
        "新建伏笔失败"
      )
    },
    onSuccess: (res) => {
      invalidate()
      setSelectedId(res.foreshadow.id)
    },
    onError: (err) => toast.error(err.message),
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载伏笔…
      </div>
    )
  }

  if (error) {
    return <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
      <p role="alert">{error.message}</p>
      <Button variant="outline" onClick={() => void refetch()}>重新加载</Button>
    </div>
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* 左列：伏笔列表 */}
      <div className="flex w-40 shrink-0 flex-col rounded-lg border bg-card @xl:w-52">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">伏笔</span>
          <button
            type="button"
            aria-label="新建伏笔"
            title="新建伏笔"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover-wash hover:text-foreground"
          >
            {createMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground">
              还没有伏笔。点上方 + 登记第一条，或在对话里告诉参谋「帮我埋一条伏笔：……」。
            </div>
          )}
          {items.map((f) => {
            const plant = f.touches.find((t) => t.kind === "PLANT")
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedId(f.id)}
                className={cn(
                  "mb-0.5 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                  selected?.id === f.id ? "bg-selected-surface" : "hover:bg-hover-wash"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Flag className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{f.title}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0 text-[10px]",
                      STATUS_BADGE[f.status].className
                    )}
                  >
                    {FORESHADOW_STATUS_LABELS[f.status]}
                  </span>
                </div>
                <div className="mt-0.5 pl-[18px] text-[11px] text-muted-foreground">
                  {f.status === "PLANNED" && "已登记 · 尚未埋入"}
                  {f.status === "PLANTED" &&
                    `已埋${f.mentionCount > 0 ? ` · 提及 ${f.mentionCount} 次` : ""}`}
                  {f.status === "RESOLVED" && `已回收${plant ? "" : "（无埋入记录）"}`}
                  {f.status === "DROPPED" && "已废弃"}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 右列：详情 */}
      {selected ? (
        <ForeshadowDetail
          key={selected.id}
          novelId={novelId}
          item={selected}
          focus={focus}
          onChanged={invalidate}
          onDeleted={() => {
            invalidate()
            setSelectedId(null)
          }}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          选择或新建一条伏笔
        </div>
      )}
    </div>
  )
}
