"use client"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { MarkdownPreview } from "@/components/editor/MarkdownPreview"
import type { ContentReceipt } from "@/lib/services/content-commit"
import { apiSend } from "./api"

export function ChapterConflictDialog({ current, draft, url, beforeCommit, onCommitted, onUseCurrent, onClose }: {
  current: { version: number; content: string }; draft: string; url: string
  beforeCommit: () => void
  onCommitted: (receipt: ContentReceipt) => void
  onUseCurrent: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const operationId = useRef<string | null>(null)
  const save = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try {
      beforeCommit()
      operationId.current ??= crypto.randomUUID()
      const result = await apiSend<{ receipt: ContentReceipt }>(url, "PATCH", { content: draft, expectedVersion: current.version, operationId: operationId.current })
      onCommitted(result.receipt)
      onClose()
    } catch (error) { toast.error((error as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  const useCurrent = () => {
    try {
      beforeCommit()
      const href = URL.createObjectURL(new Blob([draft], { type: "text/markdown;charset=utf-8" }))
      const link = document.createElement("a"); link.href = href; link.download = "保留的正文草稿.md"; link.click()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
      onUseCurrent(); onClose()
    } catch (error) { toast.error((error as Error).message) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="sm:max-w-5xl">
    <DialogHeader><DialogTitle>比较并处理保存冲突</DialogTitle><DialogDescription>查看服务器当前稿与本地草稿，选择要继续编辑的版本。采用本地稿仍会校验修订号并保留历史。</DialogDescription></DialogHeader>
    <div className="grid gap-3 md:grid-cols-2">
      <section className="min-w-0"><h3>服务器当前稿 · 修订 {current.version}</h3><MarkdownPreview source={current.content} novel className="h-80 rounded-card border bg-editor" /></section>
      <section className="min-w-0"><h3>保留的本地草稿</h3><MarkdownPreview source={draft} novel className="h-80 rounded-card border bg-editor" /></section>
    </div>
    <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={useCurrent}>下载草稿并载入当前稿</Button><Button disabled={busy} onClick={() => void save()}>采用本地稿并保存</Button></div>
  </DialogContent></Dialog>
}
