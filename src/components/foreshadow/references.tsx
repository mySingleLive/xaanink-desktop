"use client"

import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PreviewCard } from "@base-ui/react/preview-card"
import { Menu } from "@base-ui/react/menu"
import { ArrowUpRight, ChevronRight, FileText, Flag, ListTree, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { apiGet, apiSend } from "@/components/content/api"
import { TOUCH_KIND_LABELS } from "@/lib/foreshadow"
import { REFERENCE_TARGET_LABELS, type ForeshadowReferenceDTO, type ForeshadowTarget } from "@/lib/foreshadow-reference"
import { foreshadowBrief, foreshadowReferenceGroups } from "@/lib/foreshadow-reference-card"
import type { ForeshadowDTO, ForeshadowTouchDTO } from "@/lib/services/foreshadow"
import type { selectionSnapshot } from "@/lib/comment-selection"
import { cn } from "@/lib/utils"
import { buildTabId, useTabsStore } from "@/stores/tabs"

export type ReferenceSelection = ReturnType<typeof selectionSnapshot>
export interface ReferenceEntry { foreshadow: ForeshadowDTO; touch: ForeshadowTouchDTO; reference: ForeshadowReferenceDTO }
export function useForeshadows(novelId?: string) {
  return useQuery({ queryKey: ["foreshadows", novelId], enabled: !!novelId,
    queryFn: () => apiGet<{ foreshadows: ForeshadowDTO[] }>(`/api/novels/${novelId}/foreshadows`, "加载伏笔失败") })
}
export function useReferences(target?: ForeshadowTarget) {
  const query = useForeshadows(target?.novelId)
  const entries = useMemo(() => (query.data?.foreshadows ?? []).flatMap(foreshadow => foreshadow.touches.flatMap(touch =>
    (touch.references ?? []).filter(reference => reference.targetType === target?.targetType && reference.targetId === target?.targetId && !reference.missing)
      .map(reference => ({ foreshadow, touch, reference })))), [query.data, target?.targetType, target?.targetId])
  return { ...query, entries }
}
export function openForeshadowTouch(novelId: string, fid: string, tid: string) {
  const store = useTabsStore.getState(), tabId = buildTabId("foreshadow", novelId)
  store.requestPanelFocus(tabId, "", undefined, fid, { touchId: tid })
  store.openTab({ id: tabId, type: "foreshadow", novelId, title: "伏笔" })
}
export function openReference(novelId: string, reference: ForeshadowReferenceDTO) {
  if (reference.missing) return
  const store = useTabsStore.getState()
  const type = reference.targetType === "CHAPTER_OUTLINE" ? "chapter-outline" : "chapter-content"
  const refId = reference.targetId
  const tabId = buildTabId(type, novelId, { refId })
  store.requestPanelFocus(tabId, "", undefined, undefined, { referenceId: reference.id, targetType: reference.targetType, targetId: reference.targetId })
  store.openTab({ id: tabId, type, novelId, refId, title: reference.label })
}

const REFERENCE_ICONS = { CHAPTER_OUTLINE: ListTree, CHAPTER_CONTENT: FileText }
const KIND_COLORS = { PLANT: "text-ink-blue", MENTION: "text-gold", PAYOFF: "text-success" }

export function ReferenceInfo({ entries, novelId, onNavigate, onMenuOpenChange }: {
  entries: ReferenceEntry[]; novelId: string; onNavigate?: () => void; onMenuOpenChange?: (open: boolean) => void
}) {
  const unique = entries.filter((e, i) => entries.findIndex(other => other.foreshadow.id === e.foreshadow.id) === i)
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const activeMenuRef = useRef<string | null>(null)
  const navigating = useRef(false)
  const menuTriggers = useRef(new Map<string, HTMLButtonElement>())
  const navigate = (action: () => void) => { navigating.current = true; activeMenuRef.current = null; setActiveMenu(null); onMenuOpenChange?.(false); onNavigate?.(); action() }
  return <div className="flex max-h-[min(32rem,calc(100vh-2rem))] w-72 max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto p-3" role="group" aria-label="伏笔信息">
    {unique.map(({ foreshadow, touch }) => {
      const groups = foreshadowReferenceGroups(foreshadow)
      return <section key={foreshadow.id} aria-label={foreshadow.title}>
        <button type="button" className="flex w-full items-start gap-2 rounded-md p-1 text-left text-sm font-medium hover:bg-hover-wash focus-visible:outline-2 focus-visible:outline-ink-blue"
          aria-label={`打开伏笔：${foreshadow.title}`} onClick={() => navigate(() => openForeshadowTouch(novelId, foreshadow.id, touch.id))}>
          <Flag className="mt-0.5 size-3.5 shrink-0 text-ink-blue" /><span className="min-w-0 flex-1">{foreshadow.title}</span><ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        </button>
        <p className="mb-3 mt-1 px-1 text-xs leading-relaxed text-muted-foreground" data-foreshadow-brief>{foreshadowBrief(foreshadow.content)}</p>
        {groups.length > 0 && <div className="border-t border-border pt-2">
          <p className="mb-1 px-1 text-[11px] text-muted-foreground">伏笔引用</p>
          {groups.map(group => {
            const key = `${foreshadow.id}:${group.kind}`
            return <Menu.Root key={key} modal={false} open={activeMenu === key} onOpenChange={(open, details) => {
              if (open) { navigating.current = false; activeMenuRef.current = key; setActiveMenu(key); onMenuOpenChange?.(true) }
              else if (activeMenuRef.current === key) {
                if (details.reason === "escape-key") menuTriggers.current.get(key)?.focus({ preventScroll: true })
                activeMenuRef.current = null; setActiveMenu(null); onMenuOpenChange?.(false)
              }
            }}>
              <Menu.Trigger ref={(element: HTMLButtonElement | null) => { if (element) menuTriggers.current.set(key, element); else menuTriggers.current.delete(key) }} openOnHover delay={100} closeDelay={180}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-hover-wash focus-visible:outline-2 focus-visible:outline-ink-blue data-popup-open:bg-hover-wash"
                aria-label={`${group.label} · ${group.entries.length} 处引用`}>
                <Flag className={cn("size-3", KIND_COLORS[group.kind])} /><span className="flex-1 text-left">{group.label}</span><span className="text-[11px] text-muted-foreground">{group.entries.length} 处</span><ChevronRight className="size-3 text-muted-foreground" />
              </Menu.Trigger>
              <Menu.Portal><Menu.Positioner side="right" align="start" sideOffset={6} collisionPadding={8} className="z-[130] outline-none" data-foreshadow-submenu>
                <Menu.Popup finalFocus={() => !navigating.current} onKeyDown={event => { if (event.key === "Escape") event.stopPropagation() }} aria-label={`${foreshadow.title} · ${group.label}引用`}
                  className="max-h-[min(24rem,var(--available-height))] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2 outline-none">
                  {group.entries.map(({ touch: sourceTouch, reference }) => {
                    const Icon = REFERENCE_ICONS[reference.targetType]
                    return <Menu.Item key={reference.id} disabled={reference.missing} label={`${REFERENCE_TARGET_LABELS[reference.targetType]} ${reference.label}`}
                      className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2.5 text-xs outline-none data-highlighted:bg-hover-wash data-disabled:cursor-default data-disabled:opacity-50"
                      onClick={() => navigate(() => openReference(novelId, reference))}>
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className={cn("shrink-0", KIND_COLORS[group.kind])}>{REFERENCE_TARGET_LABELS[reference.targetType]}</span><span className="truncate" title={reference.label}>{reference.label}</span></span>
                        <span className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{reference.quote || sourceTouch.summary || "打开引用位置"}</span>
                        {reference.status !== "located" && <span className="mt-1 block text-[10px] text-muted-foreground">{reference.missing ? "来源已删除" : reference.status === "changed" ? "原文已改动" : "待定位"}</span>}
                      </span><ArrowUpRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                    </Menu.Item>
                  })}
                </Menu.Popup>
              </Menu.Positioner></Menu.Portal>
            </Menu.Root>
          })}
        </div>}
      </section>
    })}
  </div>
}

export function ReferenceChip({ entry, novelId, iconOnly = false, onLocate }: { entry: ReferenceEntry; novelId: string; iconOnly?: boolean; onLocate?: () => void }) {
  const [open, setOpen] = useState(false)
  const submenuOpen = useRef(false), cardRef = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLElement | null>(null)
  return <PreviewCard.Root open={open} onOpenChange={(next, details) => {
    if (!next && submenuOpen.current && (details.reason === "trigger-hover" || details.reason === "trigger-focus" || (details.event.target as Element | null)?.closest?.("[data-foreshadow-submenu]"))) { details.cancel(); return }
    if (!next) submenuOpen.current = false
    setOpen(next)
  }}>
    <PreviewCard.Trigger ref={(element: HTMLElement | null) => { triggerRef.current = element }} delay={250} closeDelay={160} render={<button type="button" />}
      className={cn("foreshadow-chip", iconOnly && "foreshadow-chip-icon")}
      data-kind={entry.touch.kind} data-reference-id={entry.reference.id}
      aria-label={`${entry.foreshadow.title} · ${TOUCH_KIND_LABELS[entry.touch.kind]}`}
      aria-description={onLocate ? "点击定位本篇引用段落，悬停查看伏笔信息" : undefined}
      onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); setOpen(false); if (onLocate) onLocate(); else openForeshadowTouch(novelId, entry.foreshadow.id, entry.touch.id) }}>
      <Flag className="size-3" />{!iconOnly && <><span className="max-w-36 truncate">{entry.foreshadow.title}</span><span className="text-[10px] opacity-80">{TOUCH_KIND_LABELS[entry.touch.kind]}</span></>}
    </PreviewCard.Trigger>
    <PreviewCard.Portal><PreviewCard.Positioner side="bottom" align="start" sideOffset={8} className="z-[100]">
      <PreviewCard.Popup ref={cardRef} className="rounded-xl border border-border bg-popover text-popover-foreground shadow-2" onClick={e => e.stopPropagation()}>
        <ReferenceInfo entries={[entry]} novelId={novelId} onNavigate={() => { submenuOpen.current = false; setOpen(false) }} onMenuOpenChange={next => {
          submenuOpen.current = next
          if (!next && !cardRef.current?.matches(":hover") && !triggerRef.current?.matches(":hover") && !cardRef.current?.contains(document.activeElement)) setOpen(false)
        }} />
      </PreviewCard.Popup>
    </PreviewCard.Positioner></PreviewCard.Portal>
  </PreviewCard.Root>
}

export function ReferencePicker({ target, selection, onClose }: { target: ForeshadowTarget; selection?: ReferenceSelection; onClose: () => void }) {
  const queryClient = useQueryClient(), query = useForeshadows(target.novelId)
  const [search, setSearch] = useState("")
  const [touchId, setTouchId] = useState("")
  const [relocateId, setRelocateId] = useState("")
  const choices = (query.data?.foreshadows ?? []).flatMap(f => f.touches.map(t => ({ f, t })))
  const selected = choices.find(c => c.t.id === touchId)
  const existing = (selected?.t.references ?? []).filter(r => r.targetType === target.targetType && r.targetId === target.targetId)
  const mutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("请选择触点")
      const base = `/api/novels/${target.novelId}/foreshadows/${selected.f.id}/touches/${touchId}/references`
      const current = existing.find(r => r.id === relocateId)
      await apiSend(current ? `${base}/${current.id}` : base, current ? "PATCH" : "POST", {
        targetType: target.targetType, targetId: target.targetId,
        ...(selection ? { quote: selection.quote, prefix: selection.prefix, suffix: selection.suffix, startOffset: selection.startOffset, endOffset: selection.endOffset } : {}),
        ...(current ? { expectedUpdatedAt: current.updatedAt } : {}),
      }, "保存引用失败")
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["foreshadows", target.novelId] }); toast.success(relocateId ? "引用已重新定位" : "已引用伏笔"); onClose() },
    onError: (e) => toast.error(e.message),
  })
  return <Dialog open onOpenChange={open => { if (!open && !mutation.isPending) onClose() }}><DialogContent className="max-w-lg" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <DialogHeader><DialogTitle>{selection ? "标注伏笔" : "引用伏笔"}</DialogTitle><DialogDescription>选择这次埋入、提及或回收的触点。同一触点可在多个位置引用。</DialogDescription></DialogHeader>
    {selection && <blockquote className="max-h-24 overflow-y-auto rounded-md border-l-2 border-ink-blue bg-ink-blue/5 p-3 text-sm" aria-label="选中的原文">{selection.quote}</blockquote>}
    <input aria-label="搜索伏笔或触点" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索伏笔、触点摘要…" className="h-9 rounded-md border bg-background px-3 text-sm" />
    <div className="flex max-h-64 flex-col gap-1 overflow-y-auto" role="group" aria-label="选择触点">
      {query.isLoading && <p className="p-3 text-sm text-muted-foreground">加载伏笔…</p>}
      {query.error && <Button variant="outline" onClick={() => void query.refetch()}>加载失败，重新加载</Button>}
      {choices.filter(({ f, t }) => `${f.title} ${t.summary}`.includes(search)).map(({ f, t }) => <button type="button" key={t.id} aria-pressed={touchId === t.id}
        onClick={() => { setTouchId(t.id); setRelocateId(selection ? t.references.find(r => r.targetType === target.targetType && r.targetId === target.targetId && (r.status === "unlocated" || r.anchorSource === "summary" || r.anchorSource === "evidence"))?.id ?? "" : "") }}
        className={cn("rounded-lg border p-3 text-left text-sm", touchId === t.id ? "border-ink-blue bg-ink-blue/10" : "border-transparent hover:bg-hover-wash")}>
        <span className="flex items-center gap-2"><Flag className="size-3.5 text-ink-blue" />{f.title}<span className="ml-auto text-xs text-muted-foreground">{TOUCH_KIND_LABELS[t.kind]}</span></span>
        <span className="mt-1 block text-xs text-muted-foreground">{t.summary || "无触点摘要"}</span>
      </button>)}
      {!query.isLoading && !query.error && !choices.length && <p className="p-3 text-sm text-muted-foreground">先到伏笔面板创建档案和触点，即可在这里引用。</p>}
    </div>
    {selection && existing.length > 0 && <label className="flex flex-col gap-1 text-xs text-muted-foreground">此次操作<select aria-label="引用操作" className="rounded-md border bg-background p-2 text-foreground" value={relocateId} onChange={e => setRelocateId(e.target.value)}>
      <option value="">新增一处文字引用</option>{existing.map((r, i) => <option key={r.id} value={r.id}>重新定位引用 {i + 1} · {r.quote?.slice(0, 24) || "待定位"}</option>)}
    </select></label>}
    <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={onClose}>取消</Button><Button disabled={!selected || mutation.isPending} onClick={() => mutation.mutate()}>
      {mutation.isPending && <Loader2 className="size-3.5 animate-spin" />}{relocateId ? "保存定位" : "添加引用"}</Button></DialogFooter>
  </DialogContent></Dialog>
}

export function ReferenceStrip({ target, detailed = false, allowAdd = true }: { target: ForeshadowTarget; detailed?: boolean; allowAdd?: boolean }) {
  const { entries, error, refetch } = useReferences(target)
  const [picker, setPicker] = useState(false)
  const unique = entries.filter((e, i) => entries.findIndex(other => other.touch.id === e.touch.id) === i)
  return <div className="foreshadow-strip" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    {unique.map(entry => <div key={entry.touch.id} className={detailed ? "w-full" : undefined}>
      <ReferenceChip entry={entry} novelId={target.novelId} />
      {detailed && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{entry.touch.summary}</p>}
    </div>)}
    {error && <button className="text-xs text-destructive" onClick={() => void refetch()}>伏笔加载失败 · 重试</button>}
    {allowAdd && <button type="button" className="foreshadow-add" onClick={() => setPicker(true)} aria-label="引用伏笔"><Plus className="size-3" />引用伏笔</button>}
    {picker && <ReferencePicker target={target} onClose={() => setPicker(false)} />}
  </div>
}

export function TouchReferenceList({ novelId, fid, touch }: { novelId: string; fid: string; touch: ForeshadowTouchDTO }) {
  const queryClient = useQueryClient()
  const remove = useMutation({ mutationFn: (rid: string) => apiSend(`/api/novels/${novelId}/foreshadows/${fid}/touches/${touch.id}/references/${rid}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["foreshadows", novelId] }), onError: e => toast.error(e.message) })
  return <div className="mt-3 border-t border-border pt-2"><p className="mb-1 text-[11px] text-muted-foreground">引用位置 · {touch.references.length}</p>
    {touch.references.map(ref => <div key={ref.id} className="group flex items-start gap-1 rounded-md hover:bg-hover-wash">
      <button type="button" disabled={ref.missing} className="min-w-0 flex-1 rounded-md p-2 text-left text-xs disabled:opacity-60" onClick={() => openReference(novelId, ref)}>
        <span className="flex items-center gap-2"><span className="shrink-0 text-ink-blue">{REFERENCE_TARGET_LABELS[ref.targetType]}</span><span className="truncate">{ref.label}</span><ArrowUpRight className="ml-auto size-3 shrink-0" /></span>
        {ref.quote && <span className="mt-1 line-clamp-2 block text-muted-foreground">「{ref.quote}」</span>}
        {(ref.anchorSource === "summary" || ref.anchorSource === "evidence") && <span className="mt-1 block text-muted-foreground">根据触点内容定位 · 可框选调整</span>}
        {ref.status !== "located" && <span className="mt-1 block text-warning">{ref.status === "missing" ? "来源已删除" : ref.status === "changed" ? "原文已改动 · 打开后框选重新定位" : "待定位 · 打开后框选原文"}</span>}
      </button>
      <button type="button" aria-label={`移除引用：${REFERENCE_TARGET_LABELS[ref.targetType]} ${ref.label}`} disabled={remove.isPending} onClick={() => remove.mutate(ref.id)} className="m-2 text-muted-foreground hover:text-destructive"><Trash2 className="size-3" /></button>
    </div>)}
  </div>
}
