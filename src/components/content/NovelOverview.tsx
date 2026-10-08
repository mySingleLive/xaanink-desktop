"use client"

import { useQuery } from "@tanstack/react-query"
import { BookOpen, CalendarDays, Check, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TentativeBadge } from "@/components/ui/tentative-badge"
import { cn } from "@/lib/utils"
import { isTentativeNovelTitle } from "@/lib/novel-title"
import { buildTabId, useTabsStore, type Tab } from "@/stores/tabs"
import type { NovelStage } from "@/generated/prisma/enums"

import { NOVEL_STAGES, SETTING_TYPE_LABELS } from "./labels"
import type { ContentPanelProps } from "./registry"
import type { NovelDetail, WorldRecord } from "./types"

const STAGE_INDEX = new Map(NOVEL_STAGES.map((s, i) => [s.value, i]))

/** 各阶段点击后跳转的 tab；无对应内容模块的阶段返回 null（不可点击） */
function stageTabTarget(
  stage: NovelStage,
  novel: NovelDetail,
  firstWorld: WorldRecord | null
): Tab | null {
  const novelId = novel.id
  const title = novel.title
  switch (stage) {
    case "THEME":
      return { id: buildTabId("theme", novelId), type: "theme", novelId, title: "主题" }
    case "SETTING":
    case "MAP":
      // 世界观与世界地图都挂在世界下：打开第一个世界；暂无世界则不可点击
      return firstWorld
        ? {
            id: buildTabId("world", novelId, { refId: firstWorld.id }),
            type: "world",
            novelId,
            refId: firstWorld.id,
            title: firstWorld.name,
          }
        : null
    case "STYLE":
      return {
        id: buildTabId("setting", novelId, { settingType: "STYLE" }),
        type: "setting",
        novelId,
        settingType: "STYLE",
        title: SETTING_TYPE_LABELS.STYLE,
      }
    case "CHARACTER":
      return { id: buildTabId("characters", novelId), type: "characters", novelId, title: "角色" }
    case "TROPE":
      return { id: buildTabId("trope", novelId), type: "trope", novelId, title: "爽点/泪点" }
    case "OUTLINE":
    case "OUTLINE_REVIEW":
      return { id: buildTabId("outline", novelId), type: "outline", novelId, title: "大纲" }
    case "WRITING": {
      // 优先打开第一个可写章（大纲已评审）的正文页，否则回到大纲
      const chapter = findFirstChapter(novel, (c) => c.status === "REVIEWED")
      return chapter
        ? chapterContentTab(novelId, chapter)
        : { id: buildTabId("outline", novelId), type: "outline", novelId, title: "大纲" }
    }
    case "CHAPTER_REVIEW": {
      // 优先打开第一个已生成待评审章的正文页，否则回到大纲
      const chapter = findFirstChapter(
        novel,
        (c) => c.status === "WRITTEN" || c.status === "CHAPTER_REVIEWED"
      )
      return chapter
        ? chapterContentTab(novelId, chapter)
        : { id: buildTabId("outline", novelId), type: "outline", novelId, title: "大纲" }
    }
    case "DONE":
      return { id: buildTabId("novel", novelId), type: "novel", novelId, title }
    default:
      return null
  }
}

type ChapterNode = NovelDetail["volumes"][number]["chapters"][number]

/** 按 卷→章 顺序找第一个满足条件的章 */
function findFirstChapter(
  novel: NovelDetail,
  predicate: (chapter: ChapterNode) => boolean
): ChapterNode | null {
  for (const volume of novel.volumes) {
    for (const chapter of volume.chapters) {
      if (predicate(chapter)) return chapter
    }
  }
  return null
}

function chapterContentTab(novelId: string, chapter: ChapterNode): Tab {
  return {
    id: buildTabId("chapter-content", novelId, { refId: chapter.id }),
    type: "chapter-content",
    novelId,
    refId: chapter.id,
    title: chapter.title,
  }
}

/** 小说概览（type=novel）：信息卡片 + 创作流程阶段进度 */
export function NovelOverview({ novelId }: ContentPanelProps) {
  const openTab = useTabsStore((s) => s.openTab)
  const { data, isLoading, isError } = useQuery<{ novel: NovelDetail }>({
    queryKey: ["novels", novelId],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novelId}`)
      if (!res.ok) throw new Error("加载失败")
      return res.json()
    },
  })
  const { data: worldsData } = useQuery<{ worlds: WorldRecord[] }>({
    queryKey: ["worlds", novelId],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novelId}/worlds`)
      if (!res.ok) throw new Error("加载世界失败")
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (isError || !data?.novel) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        小说信息加载失败，请稍后重试
      </div>
    )
  }

  const novel = data.novel
  const firstWorld = worldsData?.worlds.find((w) => w.parentId === null) ?? null
  const currentIndex = STAGE_INDEX.get(novel.currentStage) ?? 0
  const chapterCount = novel.volumes.reduce((sum, v) => sum + v.chapters.length, 0)

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
                {novel.coverUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- 本地封面缩略图 */
                  <img
                    src={novel.coverUrl}
                    alt={novel.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <BookOpen className="size-5" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <CardTitle className="truncate text-xl">{novel.title}</CardTitle>
                  {isTentativeNovelTitle(novel.title) && <TentativeBadge className="text-[11px] leading-[1.6]" />}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  创建于 {new Date(novel.createdAt).toLocaleDateString("zh-CN")}
                  <Badge variant={novel.status === "ACTIVE" ? "default" : "secondary"}>
                    {novel.status === "ACTIVE" ? "创作中" : "已归档"}
                  </Badge>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
              {[
                { label: "设定", value: novel.settings.length },
                { label: "角色", value: novel.characters.length },
                { label: "分卷", value: novel.volumes.length },
                { label: "章节", value: chapterCount },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-muted/60 px-3 py-4">
                  <div className="text-2xl font-semibold">{item.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">创作流程</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-1">
              {NOVEL_STAGES.map((stage, index) => {
                const done = index < currentIndex
                const current = index === currentIndex
                const target = stageTabTarget(stage.value, novel, firstWorld)
                return (
                  <li key={stage.value}>
                    <button
                      type="button"
                      disabled={!target}
                      onClick={() => target && openTab(target)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        target && "hover:bg-muted",
                        !target && "cursor-not-allowed opacity-70",
                        current && "bg-primary/10 font-medium text-primary"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                          done && "border-primary bg-primary text-primary-foreground",
                          current && "border-primary text-primary",
                          !done && !current && "border-border text-muted-foreground"
                        )}
                      >
                        {done ? <Check className="size-3.5" /> : index + 1}
                      </span>
                      {stage.label}
                      {current && <span className="ml-auto text-xs">当前阶段</span>}
                    </button>
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
