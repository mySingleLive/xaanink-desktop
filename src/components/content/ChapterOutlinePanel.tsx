"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MarkdownEditor, type EditorMode } from "@/components/editor/MarkdownEditor"
import { ScoreIndicator } from "@/components/score/ScoreIndicator"
import { directScoreReviewKey } from "@/components/score/use-score-report"
import { DraftConflictTools } from "./DraftConflictTools"
import { useRegisterCommentSave } from "@/components/comments/comment-save-coordinator"

import { apiGet, apiSend } from "./api"
import { CHAPTER_STATUS_LABELS } from "./labels"
import type { ContentPanelProps } from "./registry"
import type { ChapterDetail } from "./types"
import {
  SaveStatusIndicator,
  useAutosave,
  useExternalSyncKey,
  useOwnSyncTokens,
} from "./use-autosave"

function ChapterOutlineEditor({
  novelId,
  chapter,
  onChanged,
  onDirtyChange,
}: {
  novelId: string
  chapter: ChapterDetail
  /* 保存成功回传服务端 version：外层登记为自己的回写，避免 key 重挂载重置编辑器 */
  onChanged: (version: number) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(chapter.title)
  const titleRef = useRef(chapter.title)
  const [outline, setOutline] = useState(chapter.outline)
  const outlineRef = useRef(chapter.outline)
  const versionRef = useRef(chapter.version)
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveRequests = useRef(new Map<string, { title: string; outline: string; expectedVersion: number; operationId: string }>())
  /* 编辑器视图（受控）：评分指示器点击切到「评审」 */
  const [editorMode, setEditorMode] = useState<EditorMode>("edit")

  const { status, schedule, retry, flush, controller } = useAutosave<{ title: string; outline: string }>(async (value, attempt) => {
    if (!value.title.trim()) throw new Error("章节名不能为空")
    if (!saveRequests.current.has(attempt.operationId)) saveRequests.current.set(attempt.operationId, { ...value, expectedVersion: versionRef.current, operationId: attempt.operationId })
    try {
      const res = await apiSend<{ chapter: ChapterDetail }>(
      `/api/novels/${novelId}/outline/chapters/${chapter.id}`,
      "PATCH",
      saveRequests.current.get(attempt.operationId),
      "保存章大纲失败"
    )
      versionRef.current = res.chapter.version
      saveRequests.current.delete(attempt.operationId)
      setSaveError(null)
      onChanged(res.chapter.version)
    } catch (error) { setSaveError((error as Error).message); throw error }
  })
  useEffect(() => { onDirtyChange(status === "pending" || status === "saving" || status === "error") }, [status, onDirtyChange])
  useRegisterCommentSave(novelId, "CHAPTER_OUTLINE", chapter.id, {
    identity: controller,
    flush, revision: () => controller.revision,
    read: () => ({ text: outlineRef.current, version: versionRef.current }),
    pause: () => { controller.pause(); onDirtyChange(true) },
    conflict: message => { controller.pause(); setSaveError(message); onDirtyChange(true) },
    receive: (receipt, text, localRevision) => {
      if (receipt.version === null) throw new Error("缺少章大纲修订回执")
      if (receipt.version < versionRef.current) return
      onChanged(receipt.version)
      if (!controller.confirmExternal(localRevision)) { setSaveError("评论保存期间有新编辑，请保留本地稿后重新比较"); return }
      versionRef.current = receipt.version; outlineRef.current = text; setOutline(text)
      controller.resume(); setSaveError(null); onDirtyChange(false)
    },
  })

  const reviewMutation = useMutation({
    mutationKey: directScoreReviewKey(novelId, "CHAPTER_OUTLINE", chapter.id),
    mutationFn: () =>
      apiSend(
        `/api/novels/${novelId}/review/ai`,
        "POST",
        { targetType: "CHAPTER_OUTLINE", targetId: chapter.id },
        "AI 评审失败"
      ),
    onSuccess: () => {
      toast.success("AI 评审完成")
      /* 作者点了「AI 评审」就是要看结果：切到编辑器「评审」视图（评分+意见+评论一屏齐备） */
      setEditorMode("review")
      /* 评审视图/悬浮指示器的评分聚合即时刷新（直连 mutation 不经对话写工具失效机制） */
      queryClient.invalidateQueries({
        queryKey: ["score-report", "CHAPTER_OUTLINE", chapter.id],
      })
      /* 评审意见会自动挂为行内评论,刷新评论查询让气泡立刻出现 */
      queryClient.invalidateQueries({
        queryKey: ["comments", "CHAPTER_OUTLINE", chapter.id],
      })
    },
    onError: (err) => { if (err.message !== "评审已停止") toast.error(err.message) },
  })

  return (
    <div className="relative flex h-full flex-col">
      {/* 工具条：卷章 / 状态 / 保存状态 / AI 评审 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-4 py-2.5">
        <h2 className="font-serif text-base font-semibold">
          第 {chapter.volume.index} 卷 · 第 {chapter.index} 章
        </h2>
        <Badge variant={chapter.status === "OUTLINE" ? "secondary" : "default"}>
          {CHAPTER_STATUS_LABELS[chapter.status]}
        </Badge>
        <SaveStatusIndicator status={status} />
        <Button
          size="sm"
          className="ml-auto"
          disabled={reviewMutation.isPending}
          onClick={() => reviewMutation.mutate()}
        >
          {reviewMutation.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles />
          )}
          AI 评审
        </Button>
      </div>

      {/* 章节名（bg-card 与对话区底色拉开层次） */}
      {saveError && <div role="alert" className="border-b bg-card px-4 py-2 text-sm text-destructive">{saveError} · 草稿已保留 <Button size="sm" variant="ghost" onClick={() => void retry().catch(error => toast.error(error.message))}>重试原保存</Button>
        <DraftConflictTools
          readLocal={() => ({ title: titleRef.current, text: outlineRef.current, data: { version: versionRef.current } })}
          readCurrent={async () => { const { chapter: current } = await apiGet<{ chapter: ChapterDetail }>(`/api/novels/${novelId}/chapters/${chapter.id}`); return { title: current.title, text: current.outline, data: { version: current.version } } }}
          revision={() => controller.revision} pause={() => controller.pause()}
          saveLocal={async (current, local, operationId, revision) => {
            const { chapter: saved } = await apiSend<{ chapter: ChapterDetail }>(`/api/novels/${novelId}/outline/chapters/${chapter.id}`, "PATCH", { title: local.title, outline: local.text, expectedVersion: current.data.version, operationId })
            onChanged(saved.version)
            if (!controller.confirmExternal(revision)) throw new Error("已保存比较稿，期间的新输入也已保留，请重新比较")
            versionRef.current = saved.version; titleRef.current = saved.title; outlineRef.current = saved.outline; setTitle(saved.title); setOutline(saved.outline); setSaveError(null); onDirtyChange(false)
          }}
          adoptCurrent={(current, revision) => {
            if (!controller.confirmExternal(revision)) throw new Error("仍有未确认的保存，请稍后核对")
            versionRef.current = current.data.version; titleRef.current = current.title; outlineRef.current = current.text; setTitle(current.title); setOutline(current.text); onChanged(current.data.version); setSaveError(null); onDirtyChange(false)
          }}
        />
      </div>}
      <div className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-2">
        <Input
          value={title}
          onChange={(e) => {
            onDirtyChange(true)
            titleRef.current = e.target.value
            setTitle(e.target.value)
            schedule({ title: e.target.value, outline })
          }}
          placeholder="章节名"
          maxLength={100}
          className="min-w-0 flex-1 border-0 bg-transparent px-0 font-medium shadow-none focus-visible:ring-0"
        />
        <span className="hidden shrink-0 text-xs text-muted-foreground xl:inline">
          修改自动保存；对话里确认「大纲没问题」后即可生成正文
        </span>
      </div>

      {/* 编辑器铺满剩余区域 */}
      <MarkdownEditor
        foreshadowTarget={{ novelId, targetType: "CHAPTER_OUTLINE", targetId: chapter.id }}
        value={outline}
        onChange={(v) => {
          onDirtyChange(true)
          outlineRef.current = v
          setOutline(v)
          schedule({ title, outline: v })
        }}
        mode={editorMode}
        onModeChange={setEditorMode}
        reviewTarget={{ novelId, targetType: "CHAPTER_OUTLINE", targetId: chapter.id }}
        placeholder="本章大纲：剧情梗概、出场角色、冲突与钩子……"
        commentsTarget={{ novelId, targetType: "CHAPTER_OUTLINE", targetId: chapter.id }}
        className="min-h-0 flex-1 rounded-none border-0"
      />

      {/* 悬浮评分指示器：右下角（悬停多维度浮窗 / 点击切编辑器评审视图） */}
      <ScoreIndicator
        novelId={novelId}
        targetType="CHAPTER_OUTLINE"
        targetId={chapter.id}
        onOpenReview={() => setEditorMode("review")}
      />
    </div>
  )
}

/** 章大纲面板（type=chapter-outline，refId=chapterId）：大纲编辑 + AI/人工评审 */
export function ChapterOutlinePanel({ novelId, refId }: ContentPanelProps) {
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
        请从左侧「大纲」树选择一个章节
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

  const onChanged = (version: number) => {
    ownSaves.track(version)
    queryClient.invalidateQueries({ queryKey: ["chapter", refId] })
    queryClient.invalidateQueries({ queryKey: ["foreshadows", novelId] })
    queryClient.invalidateQueries({ queryKey: ["outline", novelId] })
    queryClient.invalidateQueries({ queryKey: ["novels", novelId] })
    queryClient.invalidateQueries({ queryKey: ["novels"] })
  }

  return (
    <div className="h-full">
      <ChapterOutlineEditor
        key={`${data.chapter.id}:${syncKey}`}
        novelId={novelId}
        chapter={data.chapter}
        onChanged={onChanged}
        onDirtyChange={setDirty}
      />
    </div>
  )
}
