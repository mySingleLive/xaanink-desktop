"use client"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MarkdownPreview } from "@/components/editor/MarkdownPreview"

export interface ComparedDraft<T> { title: string; text: string; data: T }
/** 冲突处理必须先看到两份稿件；采用当前稿会同时下载完整本地副本。 */
export function DraftConflictTools<T>({ readLocal, readCurrent, revision, pause, saveLocal, adoptCurrent }: {
  readLocal(): ComparedDraft<T>; readCurrent(): Promise<ComparedDraft<T>>; revision(): number; pause(): void
  saveLocal(current: ComparedDraft<T>, local: ComparedDraft<T>, operationId: string, localRevision: number): Promise<void>
  adoptCurrent(current: ComparedDraft<T>, localRevision: number): void
}) {
  const [comparison, setComparison] = useState<{ local: ComparedDraft<T>; current: ComparedDraft<T>; revision: number; operationId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const compare = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); pause()
    try { const current = await readCurrent(); setComparison({ current, local: readLocal(), revision: revision(), operationId: crypto.randomUUID() }) }
    catch (error) { toast.error((error as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  const apply = async (local: boolean) => {
    if (!comparison || lock.current) return
    lock.current = true; setBusy(true)
    try {
      if (revision() !== comparison.revision) throw new Error("比较期间又有编辑，请重新打开对比")
      if (local) await saveLocal(comparison.current, comparison.local, comparison.operationId, comparison.revision)
      else {
        const href = URL.createObjectURL(new Blob([`${comparison.local.title}\n\n${comparison.local.text}`], { type: "text/markdown;charset=utf-8" }))
        const link = document.createElement("a"); link.href = href; link.download = "保留的本地草稿.md"; link.click()
        setTimeout(() => URL.revokeObjectURL(href), 1000)
        adoptCurrent(comparison.current, comparison.revision)
      }
      setComparison(null)
    } catch (error) { toast.error((error as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <><Button size="sm" variant="ghost" disabled={busy} onClick={() => void compare()}>比较并处理冲突</Button>
    <Dialog open={comparison !== null} onOpenChange={open => { if (!open && !busy) setComparison(null) }}><DialogContent className="sm:max-w-5xl">
      <DialogHeader><DialogTitle>比较并处理保存冲突</DialogTitle><DialogDescription>两份稿件均已保留。选择本地稿将按服务器当前版本保存；选择当前稿会先下载本地副本。</DialogDescription></DialogHeader>
      {comparison && <><div className="grid gap-3 md:grid-cols-2">
        <section className="min-w-0"><h3>服务器当前稿 · {comparison.current.title}</h3><MarkdownPreview source={comparison.current.text} className="h-80 rounded-card border bg-editor" /></section>
        <section className="min-w-0"><h3>本地草稿 · {comparison.local.title}</h3><MarkdownPreview source={comparison.local.text} className="h-80 rounded-card border bg-editor" /></section>
      </div><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => void apply(false)}>下载草稿并载入当前稿</Button><Button disabled={busy} onClick={() => void apply(true)}>采用本地稿并保存</Button></div></>}
    </DialogContent></Dialog></>
}
