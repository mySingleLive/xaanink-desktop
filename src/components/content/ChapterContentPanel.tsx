"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardPaste, Copy, Download, Files, History, ListChecks, Loader2, MoreHorizontal, Scissors, Sparkles, SquareDashed, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MarkdownEditor, type EditorMode, type MarkdownEditorHandle } from "@/components/editor/MarkdownEditor"
import type { EditorCommand, EditorSelectionState } from "@/components/editor/use-editor-commands"
import type { ManuscriptExportFormat, NovelExportMetadata } from "@/lib/manuscript-export"
import { useChatStore } from "@/stores/chat"
import { ScoreIndicator } from "@/components/score/ScoreIndicator"
import { directScoreReviewKey, improveDraftFor } from "@/components/score/use-score-report"
import { readSSE } from "@/lib/sse"
import type { ContentReceipt } from "@/lib/services/content-commit"
import { ChapterHistory, type ChapterBoundary } from "./ChapterHistory"
import { ManuscriptExportItems } from "./ManuscriptExportItems"
import { ChapterConflictDialog } from "./ChapterConflictDialog"
import { ChapterFinalizationDialog } from "./ChapterFinalizationDialog"
import { useRegisterCommentSave } from "@/components/comments/comment-save-coordinator"

import { apiGet, apiSend, readError } from "./api"
import { CHAPTER_STATUS_LABELS } from "./labels"
import type { ContentPanelProps } from "./registry"
import type { ChapterDetail } from "./types"
import {
  SaveStatusIndicator,
  useAutosave,
  useExternalSyncKey,
  useOwnSyncTokens,
} from "./use-autosave"

function ChapterContentEditor({
  novelId,
  chapter,
  onChanged,
  onDirtyChange,
}: {
  novelId: string
  chapter: ChapterDetail
  /* 自动保存成功回传服务端 version：外层登记为自己的回写，避免 key 重挂载重置编辑器；
     流式生成完成时不传（那是外部写入语义，照常重挂载取新稿） */
  onChanged: (version?: number) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState(chapter.content)
  const contentRef = useRef(chapter.content)
  const versionRef = useRef(chapter.version)
  const [baseVersion, setBaseVersion] = useState(chapter.version)
  const [conflict, setConflict] = useState<string | null>(null)
  const [history, setHistory] = useState<{ mode: "versions" | "candidates"; boundary: ChapterBoundary } | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const focusEditorOnClose = useRef(false)
  const [selection, setSelection] = useState<EditorSelectionState>({ hasSelection: false, canReplace: true })
  const [clipboardBusy, setClipboardBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportJob = useRef<AbortController | null>(null)
  useEffect(() => { setExporting(false); return () => { exportJob.current?.abort(); exportJob.current = null } }, [novelId, chapter.id])
  const [finalization, setFinalization] = useState<ChapterBoundary | null>(null)
  const [comparison, setComparison] = useState<{ current: ChapterDetail; draft: string; localRevision: number } | null>(null)
  const [draftPreview, setDraftPreview] = useState("")
  const generationLock = useRef(false)
  const saveRequests = useRef(new Map<string, { content: string; expectedVersion: number; operationId: string }>())
  const [streaming, setStreaming] = useState(false)
  /* 编辑器视图（受控）：评分指示器点击切到「评审」 */
  const [editorMode, setEditorMode] = useState<EditorMode>("preview")

  /**
   * 未同意(OPEN)顶层评论数:与编辑器的评论查询同 key 共享缓存,不重复请求;
   * 对话内「改进正文」流程处理评论时由对话的写工具缓存失效自动刷新(按钮文案随之回落)。
   */
  const { data: openCommentCount = 0 } = useQuery({
    queryKey: ["comments", "CHAPTER_CONTENT", chapter.id],
    queryFn: () =>
      apiGet<{ threads: { id: string; status: string }[] }>(
        `/api/novels/${novelId}/comments?targetType=CHAPTER_CONTENT&targetId=${chapter.id}`,
        "加载评论失败"
      ),
    select: (data) => data.threads.filter((t) => t.status === "OPEN").length,
  })

  /* 待比较候选稿（对话内生成/手写提交的候选不会改 chapter.version，编辑器不刷新，须显式提示入口） */
  const { data: pendingCandidates = [] } = useQuery({
    queryKey: ["content-candidates", chapter.id],
    queryFn: () =>
      apiGet<{ candidates?: { id: string; status?: string; wordCount?: number | null }[] }>(
        `/api/novels/${novelId}/chapters/${chapter.id}/candidates`,
        "加载候选稿失败"
      ),
    select: data => (data.candidates ?? []).filter(candidate => candidate.status === "ready" || candidate.status === "needs_review"),
  })

  const { status, schedule, flush, retry, controller } = useAutosave<string>(async (value, attempt) => {
    if (!saveRequests.current.has(attempt.operationId)) saveRequests.current.set(attempt.operationId, { content: value, expectedVersion: versionRef.current, operationId: attempt.operationId })
    try {
      const res = await apiSend<{ chapter: ChapterDetail }>(
      `/api/novels/${novelId}/chapters/${chapter.id}`,
      "PATCH",
      saveRequests.current.get(attempt.operationId),
      "保存正文失败"
    )
    versionRef.current = res.chapter.version
    setBaseVersion(res.chapter.version)
    saveRequests.current.delete(attempt.operationId)
    setConflict(null)
    onChanged(res.chapter.version)
    } catch (error) { setConflict((error as Error).message); throw error }
  })
  useEffect(() => { onDirtyChange(status === "pending" || status === "saving" || status === "error") }, [status, onDirtyChange])

  const openHistory = async (mode: "versions" | "candidates") => {
    try { await flush(); setHistory({ mode, boundary: { expectedVersion: versionRef.current, localRevision: controller.revision, content: contentRef.current } }) }
    catch (error) { toast.error((error as Error).message) }
  }
  const receiveCommit = (receipt: ContentReceipt, value: string, boundary: ChapterBoundary) => {
    if (receipt.version < versionRef.current) return
    onChanged(receipt.version)
    if (controller.revision !== boundary.localRevision) {
      setConflict("保存期间有新输入，草稿已保留。请比较当前稿后再保存。")
      return
    }
    versionRef.current = receipt.version
    setBaseVersion(receipt.version)
    contentRef.current = value
    setContent(value)
    controller.resume()
    controller.confirmExternal(boundary.localRevision)
    setConflict(null)
    void queryClient.invalidateQueries({ queryKey: ["score-report", "CHAPTER_CONTENT", chapter.id] })
    void queryClient.invalidateQueries({ queryKey: ["comments", "CHAPTER_CONTENT", chapter.id] })
  }
  useRegisterCommentSave(novelId, "CHAPTER_CONTENT", chapter.id, {
    identity: controller,
    flush, revision: () => controller.revision,
    read: () => ({ text: contentRef.current, version: versionRef.current }),
    pause: () => { controller.pause(); onDirtyChange(true) },
    conflict: message => { controller.pause(); setConflict(message); onDirtyChange(true) },
    receive: (receipt, text, localRevision) => {
      if (!receipt.chapterReceipt) throw new Error("正文提交缺少版本回执")
      receiveCommit(receipt.chapterReceipt, text, { expectedVersion: versionRef.current, localRevision, content: contentRef.current })
      if (controller.revision === localRevision) onDirtyChange(false)
    },
  })
  const compareConflict = async () => {
    try {
      controller.pause()
      const latest = await apiGet<{ chapter: ChapterDetail }>(`/api/novels/${novelId}/chapters/${chapter.id}`, "读取当前稿失败")
      setComparison({ current: latest.chapter, draft: contentRef.current, localRevision: controller.revision })
    } catch (error) { toast.error((error as Error).message) }
  }

  /** 生成文本留在独立候选预览；只按服务端提交回执更新编辑器。 */
  const generate = async () => {
    if (generationLock.current) return
    generationLock.current = true
    try {
      await flush()
      controller.pause()
      setStreaming(true)
      setDraftPreview("")
      const boundary = { expectedVersion: versionRef.current, localRevision: controller.revision, content: contentRef.current }
      const res = await fetch(`/api/novels/${novelId}/chapters/${chapter.id}/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: boundary.expectedVersion, operationId: crypto.randomUUID() }),
      })
      if (!res.ok || !res.body) throw new Error(await readError(res, "生成正文失败"))
      let draft = ""
      let saved = false
      let candidateReady = false
      for await (const event of readSSE(res.body)) {
        if (event.type === "draft-delta") { draft += (event.data as { delta: string }).delta; setDraftPreview(draft) }
        if (event.type === "candidate-ready") candidateReady = true
        if (event.type === "content-committed") { receiveCommit(event.data as ContentReceipt, draft, boundary); saved = true }
        if (event.type === "error") throw new Error((event.data as { message: string }).message)
      }
      if (saved) toast.success("正文已保存")
      else if (candidateReady) { toast.info("候选稿已保留，原稿未替换"); controller.resume(); await openHistory("candidates") }
      else throw new Error("生成连接中断，尚未确认保存，请查看候选稿")
    } catch (error) { toast.error((error as Error).message) }
    finally { controller.resume(); setStreaming(false); generationLock.current = false }
  }

  /**
   * 「改进正文」:不在面板内静默执行——开新会话并把流程交给对话里的 AI 执行。
   * 草稿与评审视图头部/悬浮评分指示器浮窗的「改进正文」完全同源（improveDraftFor）：
   * 逐条处理行内评论(listTextComments → handleTextComment) → 对照评分报告整体改进
   * (getScoreReport 多维度分+评委意见+读者团反馈) → 重评刷新分数,
   * 过程在对话区可见;评论/章节缓存由对话的写工具失效机制刷新,正文面板按 version 重挂载。
   */
  const improve = () => {
    const draft = improveDraftFor({
      targetType: "CHAPTER_CONTENT",
      targetId: chapter.id,
      targetLabel: `第 ${chapter.index} 章《${chapter.title}》正文`,
      score: null,
    })
    useChatStore.getState().requestNewConversation({ novelId, draft, action: { kind: "improve", targetType: "CHAPTER_CONTENT", targetId: chapter.id }, autoSend: true })
  }

  const reviewMutation = useMutation({
    mutationKey: directScoreReviewKey(novelId, "CHAPTER_CONTENT", chapter.id),
    mutationFn: () =>
      apiSend(
        `/api/novels/${novelId}/review/ai`,
        "POST",
        { targetType: "CHAPTER_CONTENT", targetId: chapter.id },
        "AI 评审失败"
      ),
    onSuccess: () => {
      toast.success("AI 评审完成")
      /* 作者点了「AI 评审」就是要看结果：切到编辑器「评审」视图（评分+意见+评论一屏齐备） */
      setEditorMode("review")
      /* 评审视图/悬浮指示器的评分聚合即时刷新（直连 mutation 不经对话写工具失效机制） */
      queryClient.invalidateQueries({
        queryKey: ["score-report", "CHAPTER_CONTENT", chapter.id],
      })
      /* 评审意见会自动挂为行内评论,刷新评论查询让气泡立刻出现 */
      queryClient.invalidateQueries({
        queryKey: ["comments", "CHAPTER_CONTENT", chapter.id],
      })
    },
    onError: (err) => { if (err.message !== "评审已停止") toast.error(err.message) },
  })

  const canGenerate = chapter.status !== "OUTLINE"

  const runEditorCommand = async (command: EditorCommand) => {
    focusEditorOnClose.current = command !== "copy"
    setClipboardBusy(true)
    try {
      await editorRef.current?.executeCommand(command)
      if (command === "copy") toast.success("已复制选中文字")
      if (command === "cut") toast.success("已剪切选中文字")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "文本操作失败，请重试")
      menuTriggerRef.current?.focus()
    } finally { setClipboardBusy(false) }
  }

  const exportManuscript = async (format: ManuscriptExportFormat) => {
    if (exportJob.current) return
    const job = new AbortController(); exportJob.current = job
    // Snapshot the current draft before loading converters; no save or model call is needed.
    const source = contentRef.current
    setExporting(true)
    const notification = toast.loading("正在生成导出文件…")
    try {
      const { createManuscriptExport, downloadManuscript, manuscriptFilename, manuscriptTitle } = await import("@/lib/manuscript-export")
      const title = manuscriptTitle(chapter.index, chapter.title)
      const metadata = format === "docx" || format === "pdf"
        ? await apiGet<NovelExportMetadata>(`/api/novels/${novelId}/manuscript?kind=metadata`, "读取小说简介失败") : undefined
      if (job.signal.aborted) return
      const saved = await downloadManuscript(await createManuscriptExport(format, title, source, undefined, metadata), manuscriptFilename(title, format), { signal: job.signal })
      if (saved && !job.signal.aborted) toast.success(window.desktop ? "导出文件已保存" : "导出文件已生成", { id: notification })
      else toast.dismiss(notification)
    } catch (error) {
      if (!job.signal.aborted) toast.error(error instanceof Error ? error.message : "导出失败，请稍后重试", { id: notification })
    } finally { if (job.signal.aborted) toast.dismiss(notification); if (exportJob.current === job) { exportJob.current = null; setExporting(false) } }
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* 浏览历史时保留当前编辑器实例及草稿，返回正文后继续原来的编辑位置。 */}
      <div className={history?.mode === "versions" ? "hidden" : "relative flex min-h-0 flex-1 flex-col"}>
      {/* 标题与状态保留在工具条，正文操作统一收纳到右侧菜单。 */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words font-serif text-base font-semibold">
            第 {chapter.volume.index} 卷 · 第 {chapter.index} 章《{chapter.title}》
          </h2>
          <Badge variant={chapter.status === "FINAL" ? "default" : "secondary"}>
            {CHAPTER_STATUS_LABELS[chapter.status]}
          </Badge>
          <SaveStatusIndicator status={status} />
        </div>
        <DropdownMenu onOpenChange={open => {
          if (open) {
            focusEditorOnClose.current = false
            setSelection(editorRef.current?.captureSelection() ?? { hasSelection: false, canReplace: false })
          }
        }}>
          <DropdownMenuTrigger
            render={<Button ref={menuTriggerRef} variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="正文功能菜单" title="正文功能菜单" />}
          >
            <MoreHorizontal aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48" finalFocus={() => !focusEditorOnClose.current}>
            <DropdownMenuItem disabled={streaming} onClick={() => void openHistory("versions")}>
              <History aria-hidden="true" />
              版本历史
            </DropdownMenuItem>
            <DropdownMenuItem disabled={streaming} onClick={() => void openHistory("candidates")}>
              <Files aria-hidden="true" />
              候选稿
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={streaming || !content.trim()}
              onClick={() => { void flush().then(() => setFinalization({ expectedVersion: versionRef.current, localRevision: controller.revision, content: contentRef.current })).catch(error => toast.error(error.message)) }}
            >
              <ListChecks aria-hidden="true" />
              定稿检查
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!canGenerate || streaming}
              onClick={() => (openCommentCount > 0 ? improve() : void generate())}
            >
              {streaming ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Wand2 aria-hidden="true" />}
              {streaming
                ? "生成中…"
                : openCommentCount > 0
                  ? "改进正文"
                  : content.trim()
                    ? "重新生成正文"
                    : "AI 生成正文"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={streaming || reviewMutation.isPending || !content.trim()}
              onClick={() => reviewMutation.mutate()}
            >
              {reviewMutation.isPending ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              AI 评审
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={clipboardBusy || !content} onClick={() => void runEditorCommand("selectAll")}>
              <SquareDashed aria-hidden="true" />
              全选
            </DropdownMenuItem>
            <DropdownMenuItem disabled={clipboardBusy || !selection.hasSelection} onClick={() => void runEditorCommand("copy")}>
              <Copy aria-hidden="true" />
              复制
            </DropdownMenuItem>
            <DropdownMenuItem disabled={streaming || clipboardBusy || !selection.hasSelection || !selection.canReplace} onClick={() => void runEditorCommand("cut")}>
              <Scissors aria-hidden="true" />
              剪切
            </DropdownMenuItem>
            <DropdownMenuItem disabled={streaming || clipboardBusy || !selection.canReplace} onClick={() => void runEditorCommand("paste")}>
              <ClipboardPaste aria-hidden="true" />
              粘贴
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Download aria-hidden="true" />
                导出
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <ManuscriptExportItems disabled={exporting} onExport={format => void exportManuscript(format)} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!canGenerate && (
        <p className="shrink-0 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          本章大纲尚未评审通过，请先在「大纲」中完成本章投影的评审；需要修改编排时前往「叙事线 → 卷章大纲」。
        </p>
      )}

      {!streaming && pendingCandidates.length > 0 && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          <Files aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">有 {pendingCandidates.length} 份候选稿待比较{pendingCandidates[0]?.wordCount ? `（最新 ${pendingCandidates[0].wordCount} 字）` : ""}，当前正文未被替换。</span>
          <Button size="sm" variant="outline" onClick={() => void openHistory("candidates")}>查看对比</Button>
        </div>
      )}

      {(conflict || (chapter.version !== baseVersion && status !== "saved")) && <div role="alert" className="shrink-0 border-b bg-card px-4 py-2 text-sm text-destructive">
        {conflict ?? "当前稿已有新修订，本地草稿已保留，请重新比较。"}
        <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(content)}>复制本地草稿</Button>
        <Button variant="ghost" size="sm" onClick={() => void compareConflict()}>比较并处理冲突</Button>
        <Button variant="ghost" size="sm" onClick={() => void retry().catch(error => toast.error(error.message))}>重试原保存</Button>
      </div>}
      {streaming && <div role="status" className="shrink-0 border-b bg-card px-4 py-2 text-sm text-muted-foreground">正在生成候选稿 · 已收到 {Array.from(draftPreview.replace(/\s/g, "")).length} 字</div>}

      {/* 编辑器铺满剩余区域（底部评审区已移除：评审信息统一在编辑器「评审」视图） */}
      <MarkdownEditor
        foreshadowTarget={{ novelId, targetType: "CHAPTER_CONTENT", targetId: chapter.id }}
        ref={editorRef}
        value={content}
        onChange={(v) => {
          contentRef.current = v
          setContent(v)
          if (!streaming) { onDirtyChange(true); schedule(v) }
        }}
        readOnly={streaming}
        novel
        mode={editorMode}
        onModeChange={setEditorMode}
        reviewTarget={{ novelId, targetType: "CHAPTER_CONTENT", targetId: chapter.id }}
        placeholder={streaming ? "" : "正文内容，可直接编辑（自动保存）"}
        commentsTarget={{ novelId, targetType: "CHAPTER_CONTENT", targetId: chapter.id }}
        className="min-h-0 flex-1 rounded-none border-0"
      />

      {/* 悬浮评分指示器：右下角（悬停多维度浮窗 / 点击切编辑器评审视图） */}
      <ScoreIndicator
        novelId={novelId}
        targetType="CHAPTER_CONTENT"
        targetId={chapter.id}
        onOpenReview={() => setEditorMode("review")}
      />
      </div>
      {history && <ChapterHistory novelId={novelId} chapterId={chapter.id} mode={history.mode} boundary={history.boundary} onClose={() => {
        setHistory(null)
        void queryClient.invalidateQueries({ queryKey: ["content-candidates"] })
        requestAnimationFrame(() => menuTriggerRef.current?.focus())
      }}
        beforeCommit={boundary => {
          if (controller.revision !== boundary.localRevision || controller.dirty) throw new Error("比较后又有编辑，请先保存并重新比较")
          controller.pause()
        }}
        onCommitted={receiveCommit}
        onCommitError={() => { controller.pause(); setConflict("保存结果尚未确认，草稿已保留，请重试原操作或重新读取记录") }}
      />}
      {finalization && <ChapterFinalizationDialog novelId={novelId} chapterId={chapter.id} boundary={finalization} onClose={() => setFinalization(null)} assertUnchanged={() => { if (controller.revision !== finalization.localRevision || controller.dirty) throw new Error("查看清单后又有编辑，请先保存并重新检查") }} />}
      {comparison && <ChapterConflictDialog current={comparison.current} draft={comparison.draft} url={`/api/novels/${novelId}/chapters/${chapter.id}`}
        onClose={() => setComparison(null)}
        beforeCommit={() => { if (controller.revision !== comparison.localRevision) throw new Error("比较期间草稿又有变化，请重新打开对比"); controller.pause() }}
        onCommitted={receipt => receiveCommit(receipt, comparison.draft, { expectedVersion: comparison.current.version, localRevision: comparison.localRevision, content: comparison.current.content })}
        onUseCurrent={() => {
          if (!controller.confirmExternal(comparison.localRevision)) throw new Error("仍有未确认保存，请稍后核对")
          versionRef.current = comparison.current.version; setBaseVersion(comparison.current.version)
          contentRef.current = comparison.current.content; setContent(comparison.current.content)
          onChanged(comparison.current.version); setConflict(null)
        }}
      />}
    </div>
  )
}

/** 章正文面板（type=chapter-content，refId=chapterId）：流式生成 + 编辑 + AI/人工评审 */
export function ChapterContentPanel({ novelId, refId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  /* 自己的自动保存令牌登记（见 useOwnSyncTokens/useExternalSyncKey）：保存回写不再触发 key 重挂载 */
  const ownSaves = useOwnSyncTokens<number>()
  const [dirty, setDirty] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["chapter", refId],
    enabled: !!refId,
    queryFn: () =>
      apiGet<{ chapter: ChapterDetail }>(
        `/api/novels/${novelId}/chapters/${refId}`,
        "加载章节失败"
      ),
  })

  /* 外部写入才推进的重挂载令牌（自己的保存回写保持原 key；数据未加载时以 0 占位） */
  const syncKey = useExternalSyncKey(data?.chapter.version ?? 0, ownSaves.isOwn, dirty)

  if (!refId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        请从左侧「正文」树选择一个章节
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (isError || !data?.chapter) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        章节加载失败，请稍后重试
      </div>
    )
  }

  const onChanged = (version?: number) => {
    if (version !== undefined) ownSaves.track(version)
    queryClient.invalidateQueries({ queryKey: ["chapter", refId] })
    queryClient.invalidateQueries({ queryKey: ["foreshadows", novelId] })
    queryClient.invalidateQueries({ queryKey: ["novels", novelId] })
    queryClient.invalidateQueries({ queryKey: ["novels"] })
    queryClient.invalidateQueries({ queryKey: ["score-report", "CHAPTER_CONTENT", refId] })
    queryClient.invalidateQueries({ queryKey: ["comments", "CHAPTER_CONTENT", refId] })
    queryClient.invalidateQueries({ queryKey: ["content-versions", refId] })
    queryClient.invalidateQueries({ queryKey: ["content-candidates", refId] })
  }

  return (
    <div className="h-full">
      <ChapterContentEditor
        key={`${data.chapter.id}:${syncKey}`}
        novelId={novelId}
        chapter={data.chapter}
        onChanged={onChanged}
        onDirtyChange={setDirty}
      />
    </div>
  )
}
