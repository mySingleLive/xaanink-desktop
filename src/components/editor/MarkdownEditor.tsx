"use client"
import { CommentDraftProvider, CommentDraftList } from "@/components/comments/comment-drafts"

/**
 * Markdown 编辑器（嵌入式 VS Code）：编辑 / 分屏 / 预览 三态；传 reviewTarget 追加「评审」视图（AI 评分详情）。
 * value/onChange 接口与 use-autosave 兼容，可直接替换 Textarea 大字段。
 * 传入 commentsTarget 后启用行内评论（锚点高亮 + 气泡 + 选区评论）。
 * modes 可限定可用视图子集（如候选稿面板只要 预览+评审，Monaco 不挂载）；缺省=全集，行为与现状一致。
 */
import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react"
import { useTheme } from "next-themes"
import { Flag } from "lucide-react"
import { openReference, ReferenceChip, ReferencePicker, useReferences, type ReferenceSelection } from "@/components/foreshadow/references"
import { useEditorReferences } from "@/components/foreshadow/use-editor-references"
import { usePanelFocusRequest } from "@/components/foreshadow/use-panel-focus"
import { resolveReferenceAnchor, type ForeshadowTarget } from "@/lib/foreshadow-reference"
import { buildTabId, type PanelFocus } from "@/stores/tabs"
import { ClipboardCheck, Columns2, Eye, MessageSquare, MessageSquareOff, SquarePen } from "lucide-react"

import { resolveAnchor } from "@/lib/comment-anchor"
import { countChineseWords } from "@/lib/text"
import { cn } from "@/lib/utils"
import { CommentablePreview } from "@/components/comments/CommentablePreview"
import { CommentBubble } from "@/components/comments/CommentBubble"
import type { CommentsTarget, ResolvedThread } from "@/components/comments/types"
import { useTextComments } from "@/components/comments/use-text-comments"

import { MarkdownPreview } from "./MarkdownPreview"
import type { MonacoMarkdownEditorProps } from "./MonacoMarkdownEditor"
import { ScoreReportPanel } from "../score/ScoreReportPanel"
import type { ScoreTargetType } from "../score/use-score-report"
import { useEditorCommands, type MarkdownEditorHandle } from "./use-editor-commands"
import { useDesktopCommands } from "@/lib/desktop/use-command-target"
import { installPreviewTextCommands } from "@/lib/desktop/preview-text-commands"
export type { MarkdownEditorHandle } from "./use-editor-commands"

const MonacoMarkdownEditor = dynamic(() => import("./MonacoMarkdownEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      编辑器加载中…
    </div>
  ),
})

export type EditorMode = "edit" | "split" | "preview" | "review"

const MODE_OPTIONS: { value: EditorMode; label: string; icon: typeof SquarePen }[] = [
  { value: "edit", label: "编辑", icon: SquarePen },
  { value: "split", label: "分屏", icon: Columns2 },
  { value: "preview", label: "预览", icon: Eye },
]
/** 评审档仅在有 reviewTarget 时追加 */
const REVIEW_OPTION: { value: EditorMode; label: string; icon: typeof SquarePen } = {
  value: "review",
  label: "评审",
  icon: ClipboardCheck,
}

type MonacoInstance = Parameters<
  NonNullable<MonacoMarkdownEditorProps["onMountEditor"]>
>[0]

/** 行内评论挂载目标：小说 id + 评论目标（章大纲 / 章正文 / 世界观介绍 / 设定大字段） */
export type MarkdownEditorCommentsTarget = { novelId: string } & CommentsTarget

interface MarkdownEditorProps {
  ref?: Ref<MarkdownEditorHandle>
  value: string
  onChange: (value: string) => void
  /** 流式生成等场景下锁定编辑 */
  readOnly?: boolean
  /** 预览按书页排版（段落首行缩进），用于小说正文 */
  novel?: boolean
  /** 初始视图模式；缺省「编辑」，正文/样文这类打开即阅读的场景传「预览」 */
  defaultMode?: EditorMode
  placeholder?: string
  className?: string
  /** 行内评论挂载目标；缺省时编辑器行为与不带评论完全一致 */
  foreshadowTarget?: ForeshadowTarget
  referenceFocus?: PanelFocus | null
  commentsTarget?: MarkdownEditorCommentsTarget
  /** 文本内定位请求：选中首个匹配文本并滚动到视口中央（对话区实体芯片跳转用）；key 变化即重新触发 */
  focusText?: { text: string; key: number }
  /** 评审视图目标：有值时模式条追加「评审」档，视图内容为该目标的 AI 评分详情；candidateId 为候选稿维度 */
  reviewTarget?: { novelId: string; targetType: ScoreTargetType; targetId: string; candidateId?: string }
  /** 可用视图子集（缺省=全集）；不含 edit/split 时 Monaco 不挂载 */
  modes?: EditorMode[]
  /** 受控视图模式（外部入口如评分指示器切评审视图用）；与 onModeChange 成对传 */
  mode?: EditorMode
  onModeChange?: (mode: EditorMode) => void
}

export function MarkdownEditor({
  ref,
  value,
  onChange,
  readOnly,
  novel,
  defaultMode,
  placeholder,
  className,
  commentsTarget,
  foreshadowTarget,
  referenceFocus,
  focusText,
  reviewTarget,
  modes,
  mode: controlledMode,
  onModeChange,
}: MarkdownEditorProps) {
  const { resolvedTheme } = useTheme()
  const theme: "paper" | "ink" = resolvedTheme === "ink" ? "ink" : "paper"
  const [innerMode, setInnerMode] = useState<EditorMode>(defaultMode ?? "edit")
  /* 受控/非受控模式：外部传 mode 时以其为准（评分指示器切评审视图），否则内部状态 */
  const mode = controlledMode ?? innerMode
  const setMode = onModeChange ?? setInnerMode
  /* 无 reviewTarget 却落到 review（如受控初值），回退默认模式兜底；mode 不在 modes 子集内同样回退 */
  const effectiveMode = mode === "review" && !reviewTarget
    ? (defaultMode ?? "edit")
    : modes && !modes.includes(mode)
      ? (defaultMode ?? modes[0])
      : mode
  const words = useMemo(() => countChineseWords(value), [value])
  const [cursor, setCursor] = useState({ line: 1, column: 1 })

  const editorRef = useRef<MonacoInstance | null>(null)
  const [editorInstance, setEditorInstance] = useState<MonacoInstance | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const editingMode = !modes || modes.includes("edit") ? "edit" : modes.includes("split") ? "split" : null
  const applyPendingCommand = useEditorCommands({ ref, value, readOnly, mode: effectiveMode, editingMode, setMode, editorRef, previewRef, rootRef })
  const commandHandle = useRef(applyPendingCommand.handle)
  commandHandle.current = applyPendingCommand.handle
  useEffect(() => installPreviewTextCommands({ preview: () => previewRef.current, handle: () => commandHandle.current }), [previewRef])
  useDesktopCommands({
    "view.edit":{enabled:()=>!modes||modes.includes("edit"),run:()=>setMode("edit")},
    "view.preview":{enabled:()=>!modes||modes.includes("preview"),run:()=>setMode("preview")},
    "view.split":{enabled:()=>!modes||modes.includes("split"),run:()=>setMode("split")},
    "editor.focus":()=>{if(effectiveMode==="preview"||effectiveMode==="review"){rootRef.current?.focus()}else editorRef.current?.focus()},
  },rootRef)

  const references = useReferences(foreshadowTarget)
  const [referenceSelection, setReferenceSelection] = useState<ReferenceSelection | null>(null)
  const [referencePicker, setReferencePicker] = useState(false)
  useDesktopCommands({"md.reference":{enabled:()=>!!foreshadowTarget&&!!referenceSelection&&referenceSelection.sourceText===value,run:()=>setReferencePicker(true)}},rootRef)
  const localFocus = usePanelFocusRequest(foreshadowTarget
    ? buildTabId(foreshadowTarget.targetType === "CHAPTER_OUTLINE" ? "chapter-outline" : "chapter-content", foreshadowTarget.novelId, { refId: foreshadowTarget.targetId }) : undefined)
  const activeReferenceFocus = referenceFocus ?? localFocus
  const resolvedReferences = useMemo(() => references.entries.map(entry => ({ ...entry, anchor: resolveReferenceAnchor(value, entry.reference) })), [references.entries, value])
  const previewReferences = useMemo(() => foreshadowTarget ? {
    novelId: foreshadowTarget.novelId, entries: resolvedReferences, onSelection: setReferenceSelection,
    focus: activeReferenceFocus ?? undefined,
  } : undefined, [foreshadowTarget, resolvedReferences, activeReferenceFocus])
  const editorReferenceOverlay = useEditorReferences(editorInstance, value, previewReferences)
  useEffect(() => {
    if (activeReferenceFocus?.referenceId) setMode("preview")
  // 只在新定位请求时切视图，后续编辑不被缓存刷新打断。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReferenceFocus])
  useEffect(() => {
    if (!activeReferenceFocus?.referenceId || !references.data) return
    const hit = resolvedReferences.find(e => e.reference.id === activeReferenceFocus.referenceId)
    if (!hit?.anchor) {
      const badge = rootRef.current?.querySelector<HTMLElement>(`[data-reference-id="${CSS.escape(activeReferenceFocus.referenceId)}"]`)
      badge?.scrollIntoView({ block: "nearest" }); badge?.focus({ preventScroll: true })
    }
  }, [activeReferenceFocus, references.data, resolvedReferences])

  /* 行内评论数据层（commentsTarget 缺省时查询不启用，编辑器零评论 UI） */
  const {
    threads,
    showAll,
    setShowAll,
    expandedIds,
    toggleExpanded,
    createComment,
    reply,
    setStatus,
    apply,
    applyingId,
    remove,
  } = useTextComments(commentsTarget?.novelId, commentsTarget)

  /*
   * 锚点解析：threads/value 变化时重算。
   * 必须 useMemo——Monaco 侧 hook 靠数组身份触发 decorations/ViewZone 重建。
   */
  const resolvedThreads = useMemo<ResolvedThread[]>(
    () => threads.map((t) => ({ thread: t, anchor: resolveAnchor(value, t) })),
    [threads, value]
  )

  /* useTextComments 的 isExpanded 以 thread 为入参；Monaco/预览侧按 threadId 查询 */
  const isExpandedById = useCallback((id: string) => expandedIds.has(id), [expandedIds])

  /** 应用由服务端原子提交；不再在旧 value 闭包上本地替换或单独置 APPLIED。 */
  const applyThread = useCallback(async (rt: ResolvedThread) => {
    try { await apply(rt.thread.id) } catch { /* 数据层保留草稿并提示 */ }
  }, [apply])

  /** 评论气泡渲染：动作在此绑定（回复 / 同意 / 应用 / 删除），两侧（Monaco zone / 预览块）共用 */
  const renderBubble = useCallback(
    (rt: ResolvedThread) => (
      <CommentBubble
        thread={rt.thread}
        /* 无锚点整体评论(quote=null)不算孤儿——不挂「原文已改动」徽标（预览末尾集中展示为普通卡片） */
        orphaned={rt.anchor === null && !!rt.thread.quote}
        applying={applyingId === rt.thread.id}
        readOnly={readOnly}
        onReply={async (content) => {
          await reply(rt.thread.id, content)
        }}
        onToggleReject={() => {
          void setStatus(rt.thread.id, rt.thread.status === "REJECTED" ? "OPEN" : "REJECTED")
        }}
        onApply={() => {
          void applyThread(rt)
        }}
        onApplyParagraph={() => { void apply(rt.thread.id, { range: "paragraph" }).catch(() => {}) }}
        onDelete={() => {
          void remove(rt.thread.id)
        }}
      />
    ),
    [applyingId, readOnly, reply, setStatus, applyThread, apply, remove]
  )

  /* 光标位置（状态栏展示） */
  useEffect(() => {
    if (!editorInstance) return
    const disposable = editorInstance.onDidChangeCursorPosition(
      (e: { position: { lineNumber: number; column: number } }) => {
        setCursor({ line: e.position.lineNumber, column: e.position.column })
      }
    )
    return () => disposable.dispose()
  }, [editorInstance])

  /* 文本内定位（对话区实体芯片跳转）：选中首个匹配文本并滚动到视口中央 */
  useEffect(() => {
    if (!focusText || !editorInstance) return
    const model = editorInstance.getModel()
    if (!model) return
    const [match] = model.findMatches(focusText.text, false, false, false, null, false, 1)
    if (!match) return
    editorInstance.revealRangeInCenterIfOutsideViewport(match.range)
    editorInstance.setSelection(match.range)
    editorInstance.focus()
  }, [focusText, editorInstance])

  /* 分屏滚动同步：按滚动比例映射到预览 */
  useEffect(() => {
    if (mode !== "split") return
    const editor = editorRef.current
    const pane = previewRef.current
    if (!editor || !pane) return
    const disposable = editor.onDidScrollChange((e) => {
      const max = editor.getScrollHeight() - editor.getLayoutInfo().height
      if (max > 0) {
        pane.scrollTop = (e.scrollTop / max) * (pane.scrollHeight - pane.clientHeight)
      }
    })
    return () => disposable.dispose()
  }, [mode])

  /* 模式条选项：先并集（有 reviewTarget 追加评审档）再按 modes 过滤；缺省=全集 */
  const modePool = modes ?? ["edit", "split", "preview", "review"]
  const modeOptions = [...MODE_OPTIONS, ...(reviewTarget ? [REVIEW_OPTION] : [])].filter((o) => modePool.includes(o.value))

  return (
    <CommentDraftProvider target={commentsTarget ?? null} source={value}>
    <div ref={rootRef} tabIndex={-1} className={cn("desktop-markdown-editor flex min-h-0 flex-col overflow-hidden rounded-lg border bg-editor", className)}>
      {/* 工具条：字数 + 评论开关 + 三态切换 */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b bg-editor px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            字数 {words.toLocaleString()}
          </span>
          {foreshadowTarget && <button type="button" className="foreshadow-add" aria-label="标注伏笔" disabled={!referenceSelection}
            title={referenceSelection ? "为选中原文标注伏笔" : "先框选要引用伏笔的原文"}
            onMouseDown={e => e.preventDefault()} onClick={() => setReferencePicker(true)}><Flag className="size-3.5" />标注伏笔</button>}
          {commentsTarget && (
            <button
              type="button"
              title="显示/隐藏所有评论"
              onClick={() => setShowAll(!showAll)}
              className={cn(
                "flex h-6 items-center gap-1 rounded px-1.5 text-xs transition-colors hover:bg-hover-wash",
                showAll ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {showAll ? (
                <MessageSquare className="size-3.5" />
              ) : (
                <MessageSquareOff className="size-3.5" />
              )}
              {threads.length}
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5 rounded-md border bg-muted p-0.5">
          {modeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className={cn(
                "flex h-6 items-center gap-1 rounded px-2 text-xs transition-colors",
                effectiveMode === opt.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <opt.icon className="size-3" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {foreshadowTarget && <div className="foreshadow-editor-strip" aria-label="本篇伏笔引用">
        {resolvedReferences.map(entry => <span key={entry.reference.id} className="inline-flex items-center gap-1">
          <ReferenceChip entry={entry} novelId={foreshadowTarget.novelId} onLocate={() => openReference(foreshadowTarget.novelId, entry.reference)} />
          {!entry.anchor && <span className="text-[10px] text-muted-foreground">{entry.reference.quote ? "原文已改动" : "待定位"}</span>}
        </span>)}
        {!resolvedReferences.length && <span className="text-xs text-muted-foreground">框选原文，可标注伏笔</span>}
        {references.error && <button type="button" className="text-xs text-destructive" onClick={() => void references.refetch()}>伏笔加载失败 · 重试</button>}
      </div>}
      {editorReferenceOverlay}
      {referencePicker && foreshadowTarget && referenceSelection && <ReferencePicker target={foreshadowTarget} selection={referenceSelection} onClose={() => setReferencePicker(false)} />}
      {effectiveMode === "review" && reviewTarget ? (
        /* 评审视图：内容与独立的 AI 评分详情页完全一致（ScoreReportPanel 复用） */
        <div className="min-h-0 flex-1">
          <ScoreReportPanel
            novelId={reviewTarget.novelId}
            refId={`${reviewTarget.targetType}:${reviewTarget.targetId}`}
            candidateId={reviewTarget.candidateId}
          />
        </div>
      ) : (
      <div
        className={cn(
          "grid min-h-0 flex-1",
          /* minmax(0,1fr) 不可省：裸 1fr = minmax(auto,1fr)，Monaco 布局引擎会给自身写内联像素宽，
             从「编辑」全宽切到分屏时该宽度成为首列 auto 最小值、吃满全部空间，预览列被挤成 0px */
          mode === "split" && "grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]"
        )}
      >
        {mode !== "preview" && (
          <MonacoMarkdownEditor
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            theme={theme}
            placeholder={placeholder}
            commentsEnabled={!!commentsTarget}
            comments={
              commentsTarget
                ? {
                    showAll,
                    readOnly,
                    threads: resolvedThreads,
                    isExpanded: isExpandedById,
                    onToggleThread: toggleExpanded,
                    onCreateComment: createComment,
                    renderBubble,
                  }
                : undefined
            }
            onMountEditor={(e) => {
              editorRef.current = e
              setEditorInstance(e)
              e.onDidDispose(() => { if (editorRef.current === e) editorRef.current = null })
              applyPendingCommand(e)
            }}
          />
        )}
        {mode === "split" && <div className="bg-border" />}
        {mode !== "edit" && (
          <div ref={previewRef} tabIndex={-1} className="min-h-0 min-w-0">
            {commentsTarget || foreshadowTarget ? (
              <CommentablePreview
                foreshadows={previewReferences}
                commentsEnabled={!!commentsTarget}
                source={value}
                novel={novel}
                threads={resolvedThreads}
                showAll={showAll}
                readOnly={readOnly}
                isExpanded={isExpandedById}
                onToggleThread={toggleExpanded}
                onCreateComment={createComment}
                renderBubble={renderBubble}
              />
            ) : (
              <MarkdownPreview source={value} novel={novel} />
            )}
          </div>
        )}
      </div>
      )}

      {/* 状态栏：光标位置 / 语言 / 主题（对齐设计稿）；modes 不含编辑/分屏时 Monaco 不挂载，行列恒 1,1 无意义不渲染 */}
      <div className="flex h-[26px] shrink-0 items-center gap-3 border-t bg-sidebar px-3 font-kai text-xs text-muted-foreground dark:font-mono dark:text-[11px]">
        {(modePool.includes("edit") || modePool.includes("split")) && (
          <span>
            行 {cursor.line}，列 {cursor.column}
          </span>
        )}
        <span className="flex-1" />
        <span>Markdown</span>
        <span>{theme === "ink" ? "玄墨" : "宣纸"}</span>
      </div>
      {commentsTarget && <CommentDraftList />}
    </div>
    </CommentDraftProvider>
  )
}
