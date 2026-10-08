"use client"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/stores/chat"
import { wordRequirementLabel } from "@/lib/word-requirement"
import type { getChapterFinalizationChecklist } from "@/lib/services/chapter-finalization"
import type { ChapterBoundary } from "./ChapterHistory"
import { apiGet } from "./api"
import { toast } from "sonner"

type Checklist = Awaited<ReturnType<typeof getChapterFinalizationChecklist>>
export function ChapterFinalizationDialog({ novelId, chapterId, boundary, assertUnchanged, onClose }: { novelId: string; chapterId: string; boundary: ChapterBoundary; assertUnchanged: () => void; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false)
  const { data, error, isLoading } = useQuery({ queryKey: ["chapter-finalization", chapterId, boundary.expectedVersion], staleTime: 0, queryFn: () => apiGet<{ checklist: Checklist }>(`/api/novels/${novelId}/chapters/${chapterId}/finalization`, "读取定稿检查失败") })
  const checklist = data?.checklist
  const confirm = () => {
    if (!checklist || !confirmed) return
    try {
      assertUnchanged()
      if (checklist.version !== boundary.expectedVersion) throw new Error("正文已有新修订，请重新查看定稿检查")
      useChatStore.getState().requestNewConversation({ novelId, draft: `我已查看《${checklist.title}》修订 ${checklist.version} 的正文、评分和检查结果，确认此版本定稿。`, autoSend: true,
        action: { kind: "finalize", targetType: "CHAPTER_CONTENT", targetId: chapterId, expectedVersion: checklist.version, expectedHash: checklist.contentHash, checklistHash: checklist.checklistHash } })
      onClose()
    } catch (error) { toast.error((error as Error).message) }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>定稿检查{checklist ? ` · 修订 ${checklist.version}` : ""}</DialogTitle><DialogDescription>查看当前正文及以下检查结果后，确认此版本定稿。</DialogDescription></DialogHeader>
    {isLoading && <p role="status">正在读取本稿检查</p>}{error && <p role="alert">{error.message}</p>}
    {checklist && <>
      <p>{checklist.wordCount} 字 · {wordRequirementLabel(checklist.wordRequirement)} · 本稿评分 {checklist.score ?? "尚未评审"}{checklist.score !== null ? " 分" : ""}</p>
      <p>未处理评论 {checklist.openCommentCount} 条</p>
      {checklist.checks.length ? checklist.checks.map(check => <p key={check.code} className={check.hard ? "text-destructive" : "text-muted-foreground"}>{check.message}</p>) : <p>完整性和篇幅检查通过</p>}
      <section className="rounded-card border bg-card p-3 text-sm"><h3 className="font-medium">错字、断句与其他评审建议</h3>{checklist.suggestions.length ? checklist.suggestions.map((suggestion, index) => <p key={index} className="mt-2">{suggestion.issue} {suggestion.suggestion}</p>) : <p className="text-muted-foreground">暂无本稿对应建议，仍请作者检查全文。</p>}</section>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已查看本稿及检查结果，确认此版本定稿</label>
      <Button disabled={!confirmed || checklist.checks.some(check => check.hard) || checklist.version !== boundary.expectedVersion} onClick={confirm}>确认此版本定稿</Button>
    </>}
  </DialogContent></Dialog>
}
