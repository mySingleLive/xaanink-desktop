"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, ListTree, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { ReferenceStrip } from "@/components/foreshadow/references"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { ScoreIndicator } from "@/components/score/ScoreIndicator"
import { directScoreReviewKey } from "@/components/score/use-score-report"
import { buildTabId, useTabsStore } from "@/stores/tabs"

import { apiGet, apiSend } from "./api"
import { CHAPTER_STATUS_ICONS } from "./chapter-status"
import { CHAPTER_STATUS_LABELS } from "./labels"
import type { ContentPanelProps } from "./registry"
import { ReviewHistory } from "./ReviewHistory"
import type { OutlineChapterNode, OutlineVolumeNode } from "./types"
import { SaveStatusIndicator, useAutosave } from "./use-autosave"

function useOutline(novelId: string) {
  return useQuery({
    queryKey: ["outline", novelId],
    queryFn: () =>
      apiGet<{ volumes: OutlineVolumeNode[] }>(
        `/api/novels/${novelId}/outline`,
        "加载大纲失败"
      ),
  })
}

/** 单卷卡片：卷标题/卷简介可编辑（自动保存），章列表可点开章大纲 tab，支持卷级 AI 评审 */
function VolumeCard({ novelId, volume }: { novelId: string; volume: OutlineVolumeNode }) {
  const queryClient = useQueryClient()
  const openTab = useTabsStore((s) => s.openTab)
  const [title, setTitle] = useState(volume.title)
  const [summary, setSummary] = useState(volume.summary)
  const [previousVolume, setPreviousVolume] = useState(volume)
  const pendingFields = useRef<{ title?: string; summary?: string }>({})
  const updatedAtRef = useRef(volume.updatedAt)
  if (previousVolume !== volume) {
    setPreviousVolume(volume)
    if (title === previousVolume.title) setTitle(volume.title)
    if (summary === previousVolume.summary) setSummary(volume.summary)
  }
  useEffect(() => {
    if (!Object.keys(pendingFields.current).length) updatedAtRef.current = volume.updatedAt
  }, [volume.updatedAt])
  const [reviewOpen, setReviewOpen] = useState(false)

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["outline", novelId] })
    queryClient.invalidateQueries({ queryKey: ["novels", novelId] })
    queryClient.invalidateQueries({ queryKey: ["novels"] })
  }

  const { status, schedule } = useAutosave<{ title?: string; summary?: string }>(async (value) => {
    if (value.title !== undefined && !value.title.trim()) throw new Error("卷名不能为空")
    const result = await apiSend<{ volume: OutlineVolumeNode }>(
      `/api/novels/${novelId}/outline/volumes/${volume.id}`,
      "PATCH",
      { ...value, expectedUpdatedAt: updatedAtRef.current },
      "保存卷失败"
    )
    updatedAtRef.current = result.volume.updatedAt
    for (const field of ["title", "summary"] as const) if (pendingFields.current[field] === value[field]) delete pendingFields.current[field]
    invalidateAll()
  })

  const reviewMutation = useMutation({
    mutationKey: directScoreReviewKey(novelId, "VOLUME_OUTLINE", volume.id),
    mutationFn: () =>
      apiSend(
        `/api/novels/${novelId}/review/ai`,
        "POST",
        { targetType: "VOLUME_OUTLINE", targetId: volume.id },
        "AI 评审失败"
      ),
    onSuccess: () => {
      toast.success("AI 评审完成")
      setReviewOpen(true)
      queryClient.invalidateQueries({
        queryKey: ["reviews", novelId, "VOLUME_OUTLINE", volume.id],
      })
    },
    onError: (err) => { if (err.message !== "评审已停止") toast.error(err.message) },
  })

  const openChapter = (chapter: OutlineChapterNode) =>
    openTab({
      id: buildTabId("chapter-outline", novelId, { refId: chapter.id }),
      type: "chapter-outline",
      novelId,
      refId: chapter.id,
      title: chapter.title,
    })

  return (
    <Card className="relative pb-8">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">第 {volume.index} 卷</Badge>
          <Input
            aria-label={`第 ${volume.index} 卷卷名`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              pendingFields.current.title = e.target.value
              schedule({ ...pendingFields.current })
            }}
            className="h-8 max-w-xs font-medium"
            maxLength={100}
          />
          <SaveStatusIndicator status={status} />
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={reviewMutation.isPending}
            onClick={() => {
              setReviewOpen(true)
              reviewMutation.mutate()
            }}
          >
            {reviewMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            AI 评审本卷
          </Button>
        </div>
        <Textarea
          aria-label={`第 ${volume.index} 卷简介`}
          value={summary}
          onChange={(e) => {
            setSummary(e.target.value)
            pendingFields.current.summary = e.target.value
            schedule({ ...pendingFields.current })
          }}
          placeholder="卷简介"
          rows={2}
          maxLength={5000}
          className="mt-2 text-sm text-muted-foreground"
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {volume.chapters.map((chapter) => {
          const StatusIcon = CHAPTER_STATUS_ICONS[chapter.status]
          return (
            <div key={chapter.id}>
            <button
              type="button"
              onClick={() => openChapter(chapter)}
              className="group flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted"
            >
              <StatusIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  第 {chapter.index} 章 {chapter.title}
                  <span className="text-xs font-normal text-muted-foreground">
                    {CHAPTER_STATUS_LABELS[chapter.status]}
                  </span>
                </span>
                {chapter.outline && (
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                    {chapter.outline}
                  </span>
                )}
              </span>
              <ChevronRight
                className={cn(
                  "mt-1 size-4 shrink-0 text-muted-foreground/50",
                  "group-hover:text-muted-foreground"
                )}
              />
            </button>
            <div className="pb-2 pl-9"><ReferenceStrip target={{ novelId, targetType: "CHAPTER_OUTLINE", targetId: chapter.id }} /></div>
            </div>
          )
        })}

        {reviewOpen && (
          <div className="mt-3 border-t pt-3">
            <ReviewHistory
              novelId={novelId}
              targetType="VOLUME_OUTLINE"
              targetId={volume.id}
              onResolved={invalidateAll}
            />
          </div>
        )}

        {/* 悬浮评分指示器（卷大纲，sm 尺寸）：卡片右下角 */}
        <ScoreIndicator
          novelId={novelId}
          targetType="VOLUME_OUTLINE"
          targetId={volume.id}
          size="sm"
          className="absolute bottom-2 right-3 z-10"
        />
      </CardContent>
    </Card>
  )
}

/** 大纲面板（type=outline）：生成配置条 + 分卷大纲编辑 */
export function OutlinePanel({ novelId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useOutline(novelId)

  const [volumeCount, setVolumeCount] = useState(3)
  const [chaptersPerVolume, setChaptersPerVolume] = useState(10)
  const [guidance, setGuidance] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)

  const volumes = data?.volumes ?? []
  const hasOutline = volumes.length > 0

  const generateMutation = useMutation({
    mutationFn: () =>
      apiSend<{ volumes: OutlineVolumeNode[] }>(
        `/api/novels/${novelId}/outline/generate`,
        "POST",
        { volumes: volumeCount, chaptersPerVolume, guidance: guidance.trim() || undefined },
        "生成大纲失败"
      ),
    onSuccess: () => {
      toast.success("大纲生成完成")
      setConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ["outline", novelId] })
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] })
      queryClient.invalidateQueries({ queryKey: ["novels"] })
    },
    onError: (err) => toast.error(err.message),
  })

  const onGenerateClick = () => {
    if (hasOutline) {
      setConfirmOpen(true)
    } else {
      generateMutation.mutate()
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListTree className="size-4" />
              分卷大纲
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="outline-volumes">卷数</Label>
                <Input
                  id="outline-volumes"
                  type="number"
                  min={1}
                  max={20}
                  value={volumeCount}
                  onChange={(e) => setVolumeCount(Math.max(1, Number(e.target.value) || 1))}
                  className="w-24"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="outline-chapters">每卷章数</Label>
                <Input
                  id="outline-chapters"
                  type="number"
                  min={1}
                  max={50}
                  value={chaptersPerVolume}
                  onChange={(e) =>
                    setChaptersPerVolume(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="w-24"
                />
              </div>
              <Button
                className="ml-auto"
                disabled={generateMutation.isPending}
                onClick={onGenerateClick}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
                {generateMutation.isPending
                  ? "生成中（可能需要 1-2 分钟）…"
                  : hasOutline
                    ? "重新生成"
                    : "生成大纲"}
              </Button>
            </div>
            <Textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder="补充要求（可选）：如整体基调、想突出的主线、需要规避的桥段等"
              rows={2}
              maxLength={2000}
            />
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : isError ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            大纲加载失败，请稍后重试
          </p>
        ) : !hasOutline ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            还没有大纲。配置上方参数后点击「生成大纲」，AI 将基于主题、设定、角色与爽点规划全书分卷大纲。
          </p>
        ) : (
          volumes.map((volume) => (
            <VolumeCard key={volume.id} novelId={novelId} volume={volume} />
          ))
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重新生成大纲</DialogTitle>
            <DialogDescription>
              重新生成将覆盖现有全部分卷与章节大纲（含已生成的正文），且不可恢复。确定继续吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending && <Loader2 className="animate-spin" />}
              确认重新生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
