"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, FilePlus2, FolderPlus, ListTree, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiSend } from "@/components/content/api"
import type { NovelDetail, NovelSummary } from "@/components/content/types"
import { ManuscriptExportItems } from "@/components/content/ManuscriptExportItems"
import { commentEditors } from "@/components/comments/comment-save-coordinator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { ManuscriptExportFormat } from "@/lib/manuscript-export"
import type { OutlineCollection, OutlineDeletionPreview, OutlineDeletionReceipt, OutlineExportKind } from "@/lib/outline-collection"
import { buildTabId, useTabsStore } from "@/stores/tabs"

type Action = "add-volume" | "add-chapter" | "rename" | "delete" | null

export function OutlineTreeMenu({ novel, volume, kind }: {
  novel: NovelSummary
  volume?: NovelDetail["volumes"][number]
  kind: OutlineExportKind
}) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<Action>(null)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportJob = useRef<AbortController | null>(null)
  useEffect(() => { setExporting(false); return () => { exportJob.current?.abort(); exportJob.current = null } }, [novel.id, volume?.id, kind])
  const [error, setError] = useState<string | null>(null)
  const deleteOperation = useRef("")
  const prefix = `/api/novels/${novel.id}`
  const scope = volume ? `本卷` : `整书`
  const label = volume ? `第 ${volume.index} 卷${kind === "outline" ? "大纲" : "正文"}功能菜单` : kind === "outline" ? "大纲功能菜单" : "正文导航功能菜单"
  const dialogTitle = dialog === "add-volume" ? "添加卷" : dialog === "add-chapter" ? "添加章节" : dialog === "rename" ? "重命名卷" : volume ? "删除本卷" : "删除全部卷章"

  const deletion = useQuery({
    queryKey: ["outline-deletion", novel.id, volume?.id], enabled: dialog === "delete", retry: false, gcTime: 0, refetchOnWindowFocus: false,
    queryFn: async () => {
      const url = `${prefix}/outline/deletion${volume ? `?volumeId=${encodeURIComponent(volume.id)}` : ""}`
      let preview = await apiGet<OutlineDeletionPreview>(url, "读取删除范围失败")
      const editors = preview.chapterIds.flatMap(id => ["CHAPTER_CONTENT", "CHAPTER_OUTLINE"].flatMap(type => commentEditors(novel.id, type, id)))
      await Promise.all(editors.map(editor => editor.flush()))
      if (editors.length) preview = await apiGet<OutlineDeletionPreview>(url, "读取删除范围失败")
      return { preview, revisions: editors.map(editor => ({ editor, revision: editor.revision() })) }
    },
  })

  const openDialog = (action: Action) => {
    setTitle(action === "rename" ? volume?.title ?? "" : "")
    setError(null)
    deleteOperation.current = crypto.randomUUID()
    setDialog(action)
  }

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["outline", novel.id] }),
      queryClient.invalidateQueries({ queryKey: ["novels"] }),
    ])
  }

  const submit = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      if (dialog === "delete") {
        if (!deletion.data) throw new Error("请等待删除范围加载完成")
        if (deletion.data.revisions.some(({ editor, revision }) => editor.revision() !== revision)) throw new Error("本地草稿已有变化，请重新打开删除窗口核对后再操作")
        const receipt = await apiSend<OutlineDeletionReceipt>(`${prefix}/outline/deletion`, "DELETE", {
          volumeId: volume?.id, expectedRevision: deletion.data.preview.revision, operationId: deleteOperation.current,
        }, "删除失败")
        const store = useTabsStore.getState()
        for (const tab of store.tabs) {
          if (tab.novelId === novel.id && tab.refId && receipt.chapterIds.includes(tab.refId) && (tab.type === "chapter-content" || tab.type === "chapter-outline")) store.closeTab(tab.id)
        }
        for (const id of receipt.chapterIds) queryClient.removeQueries({ queryKey: ["chapter", id] })
      } else if (dialog === "add-chapter" && volume) {
        const { chapter } = await apiSend<{ chapter: { id: string; title: string } }>(`${prefix}/outline/volumes/${volume.id}/chapters`, "POST", { title: title.trim() })
        const type = kind === "outline" ? "chapter-outline" : "chapter-content"
        useTabsStore.getState().openTab({ id: buildTabId(type, novel.id, { refId: chapter.id }), novelId: novel.id, type, refId: chapter.id, title: chapter.title })
      } else if (dialog === "rename" && volume) {
        await apiSend(`${prefix}/outline/volumes/${volume.id}`, "PATCH", { title: title.trim(), expectedUpdatedAt: volume.updatedAt })
      } else if (dialog === "add-volume") {
        await apiSend(`${prefix}/outline/volumes`, "POST", { title: title.trim() })
      }
      setDialog(null)
      toast.success(dialog === "delete" ? "卷章已删除" : dialog === "rename" ? "卷名已更新" : "添加成功")
      await invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试")
      if (dialog === "rename") await invalidate()
    }
    finally { setBusy(false) }
  }

  const exportCollection = async (format: ManuscriptExportFormat, exportKind: OutlineExportKind) => {
    if (exportJob.current) return
    const job = new AbortController(); exportJob.current = job
    setExporting(true)
    const notification = toast.loading(`正在导出${scope}${exportKind === "content" ? "正文" : "大纲"}…`)
    try {
      const collection = await apiGet<OutlineCollection>(`${prefix}/manuscript?kind=${exportKind}${volume ? `&volumeId=${encodeURIComponent(volume.id)}` : ""}`, "读取导出内容失败")
      if (job.signal.aborted) return
      // Like single-chapter export, include an open editor's current draft without saving it.
      for (const item of collection.volumes) for (const chapter of item.chapters) {
        const texts = new Set(commentEditors(novel.id, exportKind === "content" ? "CHAPTER_CONTENT" : "CHAPTER_OUTLINE", chapter.id).map(editor => editor.read().text))
        if (texts.size > 1) throw new Error("同一章节存在不同草稿，请先核对后再导出")
        if (texts.size) chapter.text = [...texts][0]
      }
      const { createCollectionExport } = await import("@/lib/collection-export")
      const { downloadManuscript, manuscriptFilename } = await import("@/lib/manuscript-export")
      const { blob, title: exportTitle } = await createCollectionExport(format, collection)
      const saved = await downloadManuscript(blob, manuscriptFilename(exportTitle, format), { signal: job.signal })
      if (saved && !job.signal.aborted) toast.success(window.desktop ? "导出文件已保存" : "导出文件已生成", { id: notification })
      else toast.dismiss(notification)
    } catch (cause) { if (!job.signal.aborted) toast.error(cause instanceof Error ? cause.message : "导出失败，请重试", { id: notification }) }
    finally { if (job.signal.aborted) toast.dismiss(notification); if (exportJob.current === job) { exportJob.current = null; setExporting(false) } }
  }

  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" aria-label={label} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-muted-foreground/15 group-hover:opacity-100 group-focus-within:opacity-100 data-popup-open:opacity-100" />}>
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {/* 根部菜单同样提供「添加卷」：侧栏大纲树退役后正文树是唯一手工卷章入口，删除全部卷章后的重建依赖它 */}
        <DropdownMenuItem onClick={() => openDialog(volume ? "add-chapter" : "add-volume")}>
          {volume ? <FilePlus2 aria-hidden="true" /> : <FolderPlus aria-hidden="true" />}{volume ? "添加章节" : "添加卷"}
        </DropdownMenuItem>
        {volume && <>
          <DropdownMenuItem onClick={() => openDialog("rename")}><Pencil aria-hidden="true" />重命名卷</DropdownMenuItem>
          <DropdownMenuItem onClick={() => openDialog("add-volume")}><FolderPlus aria-hidden="true" />添加卷</DropdownMenuItem>
        </>}
        <DropdownMenuSeparator />
        {(["content", "outline"] as const).map(exportKind => <DropdownMenuSub key={exportKind}>
          <DropdownMenuSubTrigger>{exportKind === "content" ? <Download aria-hidden="true" /> : <ListTree aria-hidden="true" />}导出{scope}{exportKind === "content" ? "正文" : "大纲"}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48"><ManuscriptExportItems disabled={exporting} onExport={format => void exportCollection(format, exportKind)} /></DropdownMenuSubContent>
        </DropdownMenuSub>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => openDialog("delete")}><Trash2 aria-hidden="true" />{volume ? "删除本卷" : "删除全部卷章"}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !busy) setDialog(null) }}>
      <DialogContent showCloseButton={!busy}>
        <form className="contents" onSubmit={event => { event.preventDefault(); void submit() }}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialog === "delete" ? `将删除${volume ? `「${volume.title}」` : `《${novel.title}》的全部卷章`}及其大纲和正文。此操作无法撤销。` : dialog === "rename" ? "修改本卷的名称。" : dialog === "add-chapter" ? `在「${volume?.title}」末尾添加一章。` : `在《${novel.title}》末尾添加一卷。`}</DialogDescription>
          </DialogHeader>
          {dialog === "delete" ? <div className="text-sm" aria-live="polite">
            {deletion.isPending || deletion.isFetching ? <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在核对卷章…</span> : deletion.error ? <p role="alert" className="text-destructive">{deletion.error.message}</p> : deletion.data && <p>共 {deletion.data.preview.volumeCount} 卷、{deletion.data.preview.chapterCount} 章，正文 {deletion.data.preview.wordCount.toLocaleString()} 字{deletion.data.preview.finalizedCount > 0 && `，其中 ${deletion.data.preview.finalizedCount} 章已定稿`}。</p>}
          </div> : <div className="grid gap-2">
            <Label htmlFor={`outline-title-${kind}-${volume?.id ?? novel.id}`}>{dialog === "add-chapter" ? "章节名" : "卷名"}</Label>
            <Input id={`outline-title-${kind}-${volume?.id ?? novel.id}`} value={title} onChange={event => setTitle(event.target.value)} maxLength={100} disabled={busy} autoFocus />
          </div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>取消</Button>
            <Button type="submit" variant={dialog === "delete" ? "destructive" : "default"} disabled={busy || (dialog === "delete" ? deletion.isFetching || !!deletion.error || !deletion.data?.preview.volumeCount : !title.trim())}>
              {busy && <Loader2 className="animate-spin" />}{dialog === "delete" ? "确认删除" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>
}
