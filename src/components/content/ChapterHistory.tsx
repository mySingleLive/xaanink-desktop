"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, ChevronRight, History, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { MarkdownPreview } from "@/components/editor/MarkdownPreview"
import { MarkdownEditor } from "@/components/editor/MarkdownEditor"
import type { ContentReceipt } from "@/lib/services/content-commit"
import type { ContentCheck } from "@/lib/content-policy"
import { apiGet, apiSend } from "./api"
import { paragraphDiff } from "@/lib/text-diff"
import { wordRequirementLabel, type WordRequirement } from "@/lib/word-requirement"

export interface ChapterBoundary { expectedVersion: number; localRevision: number; content: string }
type Entry = { id: string; version?: number; baseVersion?: number; status?: string; reason?: string; wordCount?: number | null; createdAt: string; restorable?: boolean; checks?: ContentCheck[] }
type Selected = Entry & { content: string; contentHash: string; baseContent?: string | null; wordRequirement?: WordRequirement | null; reviewConfigHash?: string | null; qualityDecision?: { comparable: boolean; baselineScore: number | null; candidateScore: number | null; reasons: string[] } | null }
const LABELS: Record<string, string> = { incomplete: "生成未完成", reviewing: "正在评审", ready: "可采用", needs_review: "待检查", accepted: "已采用", discarded: "已丢弃", withdrawn: "已撤回" }

function formatVersionTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  })
}

export function ChapterHistory({ novelId, chapterId, mode, boundary, onClose, beforeCommit, onCommitted, onCommitError }: {
  novelId: string; chapterId: string; mode: "versions" | "candidates"; boundary: ChapterBoundary
  onClose: () => void
  beforeCommit: (boundary: ChapterBoundary) => void
  onCommitted: (receipt: ContentReceipt, content: string, boundary: ChapterBoundary) => void
  onCommitError: () => void
}) {
  const root = `/api/novels/${novelId}/chapters/${chapterId}/${mode}`
  const [cursor, setCursor] = useState<string | undefined>()
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const operationRef = useRef<{ id: string; entryId: string } | null>(null)
  const generation = useRef(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => () => { generation.current++ }, [])
  useEffect(() => {
    if (mode === "versions") headingRef.current?.focus()
  }, [mode, selectedEntry?.id])
  const diff = useMemo(() => selected ? paragraphDiff(boundary.content, selected.content) : [], [boundary.content, selected])
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [mode === "versions" ? "content-versions" : "content-candidates", chapterId, cursor], queryFn: () => apiGet<{ versions?: Entry[]; candidates?: Entry[]; nextCursor: string | null }>(`${root}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, "加载稿件记录失败") })
  const entries = data?.versions ?? data?.candidates ?? []
  const choose = async (entry: Entry) => {
    if (busyRef.current) return
    const ticket = ++generation.current
    setSelectedEntry(entry)
    setSelected(null)
    setReading(true)
    setReadError(null)
    try {
      const result = await apiGet<{ version?: Selected; candidate?: Selected }>(`${root}/${entry.id}`, "读取稿件失败")
      if (ticket === generation.current) { setSelected(result.version ?? result.candidate ?? null); operationRef.current = null }
    } catch (e) {
      if (ticket === generation.current) setReadError((e as Error).message)
    } finally {
      if (ticket === generation.current) setReading(false)
    }
  }
  const returnToList = () => {
    generation.current++
    setSelectedEntry(null)
    setSelected(null)
    setReading(false)
    setReadError(null)
  }
  const commit = async (withdraw = false) => {
    if (!selected || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      beforeCommit(boundary)
      const entryId = `${selected.id}:${withdraw ? "withdraw" : "commit"}`
      if (operationRef.current?.entryId !== entryId) operationRef.current = { id: crypto.randomUUID(), entryId }
      const result = await apiSend<{ receipt: ContentReceipt; content?: string }>(`${root}/${selected.id}/${mode === "versions" ? "restore" : withdraw ? "withdraw" : "accept"}`, "POST", { expectedVersion: boundary.expectedVersion, operationId: operationRef.current.id, candidateHash: selected.contentHash })
      onCommitted(result.receipt, result.content ?? selected.content, boundary)
      toast.success("正文已保存为新修订")
      onClose()
    } catch (e) { onCommitError(); toast.error((e as Error).message) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const discard = async () => {
    if (!selected || busyRef.current) return
    busyRef.current = true; setBusy(true)
    try { await apiSend(`${root}/${selected.id}/discard`, "POST"); setSelected(null); await refetch() }
    catch (e) { toast.error((e as Error).message) }
    finally { busyRef.current = false; setBusy(false) }
  }

  if (mode === "versions") {
    return <section aria-label="版本历史" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2.5">
        <Button
          variant="ghost" size="icon-sm" disabled={busy}
          aria-label={selectedEntry ? "返回版本列表" : "返回正文"}
          title={selectedEntry ? "返回版本列表" : "返回正文"}
          onClick={selectedEntry ? returnToList : onClose}
        ><ArrowLeft aria-hidden="true" /></Button>
        <div className="min-w-0 flex-1">
          <h2 ref={headingRef} tabIndex={-1} className="font-serif text-base font-semibold outline-none">
            {selectedEntry ? `历史正文 · 修订 ${selectedEntry.version}` : "版本历史"}
          </h2>
          {selectedEntry && <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{selectedEntry.wordCount ?? "—"} 字</span>
            <time dateTime={selectedEntry.createdAt}>{formatVersionTime(selectedEntry.createdAt)}</time>
            <span>只读</span>
          </p>}
        </div>
        {selectedEntry && <Button size="sm" disabled={busy || reading || !selected} onClick={() => void commit()}>
          <RotateCcw aria-hidden="true" />{busy ? "正在保存" : "恢复为当前稿"}
        </Button>}
      </div>
      <div hidden={!!selectedEntry} className="min-h-0 flex-1 overflow-y-auto bg-card">
        <p className="px-4 py-3 text-sm text-muted-foreground">选择一个修订，查看完整正文。</p>
        {isLoading && <p role="status" className="px-4 py-3 text-sm text-muted-foreground">正在加载版本历史</p>}
        {error && <div className="px-4 py-3 text-sm">
          <p role="alert" className="text-destructive">{error.message}</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => void refetch()}>重新加载</Button>
        </div>}
        {!isLoading && !error && !entries.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">暂无可恢复版本</p>}
        <ul aria-label="正文版本列表" className="divide-y divide-border border-y">
          {entries.map(entry => <li key={entry.id}>
            <Button
              variant="ghost" disabled={entry.restorable === false}
              className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-left whitespace-normal"
              onClick={() => void choose(entry)}
            >
              <History aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
                <span>修订 {entry.version}</span>
                <span className="text-xs text-muted-foreground">{entry.wordCount ?? "—"} 字</span>
                <time dateTime={entry.createdAt} className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{formatVersionTime(entry.createdAt)}</time>
                {entry.restorable === false && <span className="w-full text-xs text-muted-foreground">记录损坏，无法查看或恢复</span>}
              </span>
              <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </Button>
          </li>)}
        </ul>
        <div className="flex justify-between gap-2 p-4">
          {cursor && <Button size="sm" variant="outline" onClick={() => setCursor(undefined)}>回到最新</Button>}
          {data?.nextCursor && <Button size="sm" variant="outline" className="ml-auto" onClick={() => setCursor(data.nextCursor!)}>更早记录</Button>}
        </div>
      </div>
      {selectedEntry && <>
        {reading && <p role="status" className="p-4 text-sm text-muted-foreground">正在读取历史正文</p>}
        {readError && <div className="p-4 text-sm">
          <p role="alert" className="text-destructive">{readError}</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => void choose(selectedEntry)}>重试读取</Button>
        </div>}
        {selected && <>
          <details className="shrink-0 border-b bg-card px-4 py-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">与当前稿比较 · 修订 {boundary.expectedVersion}</summary>
            <p className="mt-2 text-muted-foreground">恢复会保存为新修订，仅替换正文。</p>
            <div className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words">
              {diff.every(part => part.kind === "equal") && <p className="text-muted-foreground">此版本与当前正文相同</p>}
              {diff.filter(part => part.kind !== "equal").map((part, index) => <p key={index} className={part.kind === "removed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}>
                <span aria-label={part.kind === "removed" ? "移除" : "增加"}>{part.kind === "removed" ? "− " : "+ "}</span>{part.text}
              </p>)}
            </div>
          </details>
          <section aria-label="历史正文" className="flex min-h-0 flex-1 flex-col">
            <MarkdownEditor key={selected.id} value={selected.content} onChange={() => {}} readOnly novel defaultMode="preview" className="min-h-0 flex-1 rounded-none border-0" />
          </section>
        </>}
      </>}
    </section>
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
      <DialogHeader><DialogTitle>候选稿</DialogTitle><DialogDescription>先比较正文，再决定是否保存为新修订。历史中的标题、大纲和定稿状态不会被恢复。</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2" aria-label="稿件记录">
        {isLoading && <p role="status">正在加载稿件记录</p>}
        {error && <p role="alert" className="text-destructive">{error.message}</p>}
        {!isLoading && !error && !entries.length && <p className="text-muted-foreground">暂无候选稿</p>}
        {entries.map(entry => <Button key={entry.id} size="sm" variant={selected?.id === entry.id ? "default" : "outline"} disabled={busy || entry.restorable === false} onClick={() => void choose(entry)}>{entry.version ? `修订 ${entry.version}` : LABELS[entry.status ?? ""] ?? "候选稿"} · {entry.wordCount ?? "—"} 字</Button>)}
        {cursor && <Button size="sm" variant="ghost" onClick={() => setCursor(undefined)}>回到最新</Button>}
        {data?.nextCursor && <Button size="sm" variant="ghost" onClick={() => setCursor(data.nextCursor!)}>更早记录</Button>}
      </div>
      {reading && <p role="status" className="text-sm text-muted-foreground">正在读取稿件</p>}
      {readError && <p role="alert" className="text-sm text-destructive">{readError}</p>}
      {selected && <>
        <section aria-label="候选质量比较" className="rounded-card border bg-card p-3 text-sm">
          <p>基线 {selected.qualityDecision?.baselineScore ?? "未评"} 分 → 候选 {selected.qualityDecision?.candidateScore ?? "未评"} 分 · {selected.qualityDecision?.comparable ? "同配置可比较" : "评分不可直接比较"}</p>
          {selected.wordRequirement && <p>{wordRequirementLabel(selected.wordRequirement)} · 候选 {selected.wordCount ?? "—"} 字</p>}
          {selected.qualityDecision?.reasons.map((reason, index) => <p key={index} className="text-muted-foreground">{reason}</p>)}
          {selected.baseVersion !== boundary.expectedVersion && !["accepted", "withdrawn"].includes(selected.status ?? "") && <p className="text-destructive">此候选基于修订 {selected.baseVersion}，当前稿已有变化，不能直接采用。</p>}
          <p className="text-muted-foreground">完整候选可由作者比较后选择；采用后仍需检查并确认定稿。</p>
        </section>
        {selected.checks?.map(check => <p key={check.code} className={check.hard ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{check.message}</p>)}
        <details className="shrink-0 rounded-card border bg-editor p-2 text-sm">
          <summary className="cursor-pointer">查看段落差异 · 移除 {diff.filter(p => p.kind === "removed").length} 段 / 增加 {diff.filter(p => p.kind === "added").length} 段</summary>
          <div className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words">{diff.filter(p => p.kind !== "equal").map((part, index) => <p key={index} className={part.kind === "removed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}><span aria-label={part.kind === "removed" ? "移除" : "增加"}>{part.kind === "removed" ? "− " : "+ "}</span>{part.text}</p>)}</div>
        </details>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto md:grid-cols-2">
          <section className="min-w-0"><h3 className="mb-2 text-sm font-medium">当前稿 · 修订 {boundary.expectedVersion}</h3><MarkdownPreview source={boundary.content} novel className="h-80 rounded-card border bg-editor" /></section>
          <section className="min-w-0"><h3 className="mb-2 text-sm font-medium">候选稿</h3><MarkdownPreview source={selected.content} novel className="h-80 rounded-card border bg-editor" /></section>
        </div>
        <div className="flex justify-end gap-2">
          {!["accepted", "discarded", "withdrawn"].includes(selected.status ?? "") && <Button variant="outline" disabled={busy} onClick={() => void discard()}>丢弃候选稿</Button>}
          {selected.status === "accepted" ? <Button variant="outline" disabled={busy} onClick={() => void commit(true)}>撤回本次采用</Button> : <Button disabled={busy || selected.checks?.some(check => check.hard) || !["ready", "needs_review"].includes(selected.status ?? "") || selected.baseVersion !== boundary.expectedVersion} onClick={() => void commit()}>{busy ? "正在保存" : "采用候选稿"}</Button>}
        </div>
      </>}
    </DialogContent>
  </Dialog>
}
