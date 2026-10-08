"use client"

/**
 * 弧线链视图：阶段卡片按时间先后竖排，左侧时间轨串联
 * （出场前空心节点 / 出场卡朱砂实心 + 光晕 / 其后黛蓝实心）；
 * 卡片只读展示名称（+「出场」徽标）、定位 chips（gold 淡染，超 3 枚「+N」）、
 * 简介（summarizeStage，两行截断）、标签 chips（ink-blue 淡染）、起始章节行
 * （outline 实时解析；解析不到显示快照 + 失效样式）。
 * ⋯ 菜单（编辑/在下方插入新阶段/上移/下移/删除，菜单项 stopPropagation）
 * + dnd-kit 手柄拖拽排序（卡片本体点击/Enter/Space 打开编辑，拖拽只发生在手柄上）。
 * 排序/增删都是先改 form.arcStages 再走面板统一保存（离散操作立即保存）。
 */
import { useMemo, useRef, type CSSProperties, type HTMLAttributes } from "react"
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  GripVertical,
  MoreHorizontal,
  Plus,
  SquarePen,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ARC_STAGES_MAX,
  debutIndex,
  summarizeStage,
  type ArcStage,
  type ArcStageChapterRef,
} from "@/lib/arc-stage"
import { cn } from "@/lib/utils"
import type { StoryWorkflowView } from "@/lib/story-workflow"
import { focusStoryArtifact } from "@/components/chat/story-focus"

import { apiGet } from "../api"
import type { OutlineVolumeNode } from "../types"
import { markerKindLabel } from "./arc-marker-input"

/** 拉取大纲卷章树（queryKey 与 OutlinePanel 一致，共享缓存） */
export function useOutlineVolumes(novelId: string) {
  return useQuery({
    queryKey: ["outline", novelId],
    queryFn: () =>
      apiGet<{ volumes: OutlineVolumeNode[] }>(`/api/novels/${novelId}/outline`, "加载大纲失败"),
  })
}

/**
 * 起始章节展示解析：outline 中按 chapterId 解析实时「第 X 卷 … · 第 Y 章 …」；
 * 解析不到（卷/章已删除）回退快照 label 并标记失效（调用方加删除线样式）
 */
export function resolveStageChapter(
  ref: ArcStageChapterRef,
  volumes: OutlineVolumeNode[]
): { label: string; broken: boolean } {
  const volume = volumes.find((v) => v.id === ref.volumeId)
  const chapter = volume?.chapters.find((c) => c.id === ref.chapterId)
  if (!volume || !chapter) return { label: ref.label, broken: true }
  return {
    label: `第${volume.index}卷 ${volume.title} · 第${chapter.index}章 ${chapter.title}`,
    broken: false,
  }
}

/* ---------------- 卡片 ---------------- */

/** 时间轨节点分段：出场前空心 / 出场朱砂实心带光晕 / 其后黛蓝实心（无出场卡则整链 post） */
type ArcSegment = "pre" | "debut" | "post"

const SEGMENT_NODE_CLASS: Record<ArcSegment, string> = {
  pre: "border-muted-foreground bg-card",
  debut: "border-primary bg-primary shadow-[0_0_0_3px_var(--active-wash)]",
  post: "border-ink-blue bg-ink-blue",
}

interface ArcStageCardProps {
  stage: ArcStage
  sources?: { key: string; title: string; open?: () => void }[]
  sourcesStale?: boolean
  segment: ArcSegment
  /** 起始章节展示（null = 未设置） */
  chapter: { label: string; broken: boolean } | null
  isFirst: boolean
  isLast: boolean
  /** 达到卡片数上限时禁用「在下方插入新阶段」 */
  insertDisabled?: boolean
  dragging?: boolean
  innerRef?: (el: HTMLDivElement | null) => void
  rootStyle?: CSSProperties
  /** dnd-kit useSortable 的 attributes+listeners，只挂在拖拽手柄上（不抢占卡片点击） */
  handleProps?: HTMLAttributes<HTMLButtonElement>
  onEdit: () => void
  onInsertAfter: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}

function ArcStageCard({
  stage,
  sources,
  sourcesStale,
  segment,
  chapter,
  isFirst,
  isLast,
  insertDisabled,
  dragging,
  innerRef,
  rootStyle,
  handleProps,
  onEdit,
  onInsertAfter,
  onMoveUp,
  onMoveDown,
  onDelete,
}: ArcStageCardProps) {
  const brief = summarizeStage(stage)
  const markers = stage.markers.slice(0, 3)
  const overflow = stage.markers.length - markers.length
  const causalDetails = stage.description.split("\n").filter(line => /^(压力|选择|代价)：/.test(line))

  return (
    <div
      ref={innerRef}
      style={rootStyle}
      role="button"
      tabIndex={0}
      aria-label={`编辑阶段 ${stage.name}`}
      className={cn(
        "group/arc relative min-w-0 cursor-pointer rounded-xl border border-border bg-card px-3.5 py-2.5 transition-colors hover:bg-hover-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        dragging && "opacity-50"
      )}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onEdit()
        }
      }}
    >
      {/* 时间轨节点（位置对齐链条竖线：链容器 pl-5 + 线 center 8px → 节点中心 1.5px） */}
      <span
        aria-hidden
        className={cn(
          "absolute top-[15px] -left-[18.5px] size-[13px] rounded-full border-2",
          SEGMENT_NODE_CLASS[segment]
        )}
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-[14.5px] font-semibold">{stage.name}</span>
        {stage.isDebut && (
          <span className="shrink-0 rounded-[5px] border border-[color-mix(in_srgb,var(--primary)_32%,transparent)] bg-active-wash px-1.5 text-[10.5px] leading-[18px] font-medium tracking-wide text-primary">
            出场
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={`拖拽调整 ${stage.name} 的顺序`}
            title="拖拽调整顺序"
            className="flex size-6 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/arc:opacity-100 group-focus-within/arc:opacity-100 hover:bg-hover-wash hover:text-foreground active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
            {...handleProps}
          >
            <GripVertical className="size-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`${stage.name} 菜单`}
                  title="更多操作"
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/arc:opacity-100 group-focus-within/arc:opacity-100 data-popup-open:opacity-100 hover:bg-active-wash hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              }
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {/* 菜单渲染在 portal 里，onClick 仍会沿 React 树冒泡到卡片（触发打开编辑），逐项拦截 */}
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit() }}>
                <SquarePen aria-hidden="true" />编辑
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={insertDisabled}
                onClick={(e) => { e.stopPropagation(); onInsertAfter() }}
              >
                <Plus aria-hidden="true" />在下方插入新阶段
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isFirst}
                onClick={(e) => { e.stopPropagation(); onMoveUp() }}
              >
                <ArrowUp aria-hidden="true" />上移
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isLast}
                onClick={(e) => { e.stopPropagation(); onMoveDown() }}
              >
                <ArrowDown aria-hidden="true" />下移
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => { e.stopPropagation(); onDelete() }}
              >
                <Trash2 aria-hidden="true" />删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      {stage.markers.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {markers.map((m, i) => (
            <span
              key={`${m.kind}:${m.text}:${i}`}
              className="inline-flex items-center gap-1 rounded-[5px] border border-[color-mix(in_srgb,var(--gold)_30%,transparent)] bg-[color-mix(in_srgb,var(--gold)_10%,transparent)] px-1.5 text-[11px] leading-[19px] font-medium whitespace-nowrap text-gold"
            >
              {markerKindLabel(m.kind) && (
                <span className="font-normal opacity-70">{markerKindLabel(m.kind)}</span>
              )}
              {m.text}
            </span>
          ))}
          {overflow > 0 && (
            <span className="inline-flex items-center rounded-[5px] border border-dashed border-border px-1.5 text-[11px] leading-[19px] text-muted-foreground">
              +{overflow}
            </span>
          )}
        </div>
      )}
      <p
        className={cn(
          "mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground",
          !brief && "opacity-60"
        )}
      >
        {brief || "暂无描述"}
      </p>
      {causalDetails.length > 0 && <dl className="mt-2 space-y-1 text-xs leading-relaxed">
        {causalDetails.map((line, index) => {
          const split = line.indexOf("：")
          return <div key={index} className="flex gap-2"><dt className="shrink-0 text-muted-foreground">{line.slice(0, split)}</dt><dd className="min-w-0 break-words text-foreground">{line.slice(split + 1)}</dd></div>
        })}
      </dl>}
      {!!sources?.length && <div className={cn("mt-1.5 text-xs", sourcesStale ? "text-primary" : "text-muted-foreground")}>
        剧情依据：{sources.map(source => <button key={source.key} type="button" disabled={!source.open} className="mr-2 underline underline-offset-2 hover:text-primary disabled:no-underline" onClick={event => { event.stopPropagation(); source.open?.() }} onKeyDown={event => event.stopPropagation()}>{source.title}</button>)}
        {sourcesStale && <span>来源已变，请核对本阶段</span>}
      </div>}
      {stage.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {stage.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-[5px] border border-[color-mix(in_srgb,var(--ink-blue)_28%,transparent)] bg-[color-mix(in_srgb,var(--ink-blue)_10%,transparent)] px-1.5 text-[11px] leading-[19px] font-medium whitespace-nowrap text-ink-blue"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {chapter && (
        <div
          className={cn(
            "mt-1.5 flex items-center gap-1 text-xs text-muted-foreground",
            chapter.broken && "text-destructive line-through"
          )}
        >
          <BookOpen aria-hidden className="size-3 shrink-0 opacity-80" />
          始自 {chapter.label}
        </div>
      )}
    </div>
  )
}

/** dnd-kit sortable 包装：拖拽手柄在卡片右上角（不抢占卡片点击打开），拖拽中原卡半透明 */
function SortableArcStageCard(props: Omit<ArcStageCardProps, "innerRef" | "rootStyle" | "handleProps" | "dragging">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.stage.id,
  })
  return (
    <ArcStageCard
      {...props}
      innerRef={setNodeRef}
      rootStyle={{ transform: CSS.Transform.toString(transform), transition }}
      handleProps={{ ...attributes, ...listeners }}
      dragging={isDragging}
    />
  )
}

/* ---------------- 链视图 ---------------- */

export function ArcChain({
  novelId,
  stages,
  onChange,
  onEdit,
  onAddStage,
  onInsertAfter,
}: {
  novelId: string
  stages: ArcStage[]
  onChange: (stages: ArcStage[], immediate?: boolean) => void
  onEdit: (id: string) => void
  /** 链尾「＋ 添加阶段」（新建并进入编辑） */
  onAddStage: () => void
  /** ⋯ 菜单「在下方插入新阶段」（新建并进入编辑） */
  onInsertAfter: (index: number) => void
}) {
  const { data } = useOutlineVolumes(novelId)
  const { data: storyData } = useQuery({
    queryKey: ["story-workflow", novelId],
    queryFn: () => apiGet<{ workflow: StoryWorkflowView | null }>(`/api/novels/${novelId}/story-workflow`, "加载剧情依据失败"),
    enabled: stages.some(stage => stage.sources?.length),
  })
  const volumes = useMemo(() => data?.volumes ?? [], [data])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const debut = debutIndex(stages)
  /** 拖拽守卫：手柄按下拖走后松手，click 会落在按下/松开元素的公共祖先（卡片）上，
      不拦截的话一次排序会误触发「打开编辑」。拖拽开始后置位，click 派发完（同帧定时器后）复位 */
  const justDragged = useRef(false)

  const onDragStart = () => {
    justDragged.current = true
  }

  const onDragEnd = (e: DragEndEvent) => {
    setTimeout(() => {
      justDragged.current = false
    }, 0)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = stages.findIndex((s) => s.id === String(active.id))
    const to = stages.findIndex((s) => s.id === String(over.id))
    if (from < 0 || to < 0 || from === to) return
    onChange(arrayMove(stages, from, to), true)
  }

  const onDragCancel = () => {
    setTimeout(() => {
      justDragged.current = false
    }, 0)
  }

  const openEdit = (id: string) => {
    if (justDragged.current) return
    onEdit(id)
  }

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= stages.length) return
    onChange(arrayMove(stages, index, target), true)
  }

  const remove = (stage: ArcStage) => {
    if (!window.confirm(`删除阶段「${stage.name}」？此操作不可撤销。`)) return
    onChange(
      stages.filter((s) => s.id !== stage.id),
      true
    )
  }

  /** 软上限（zod ARC_STAGES_MAX）：到顶禁用添加入口 */
  const atMax = stages.length >= ARC_STAGES_MAX

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          阶段卡片 · <span className="font-mono">{stages.length}</span> 张，按时间先后排列
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={atMax}
          title={atMax ? `最多 ${ARC_STAGES_MAX} 张阶段卡片` : undefined}
          onClick={onAddStage}
        >
          <Plus />
          添加阶段
        </Button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="relative flex flex-col gap-2.5 pl-5">
            <span
              aria-hidden
              className="absolute top-3 bottom-3 left-[7px] w-0.5 rounded-full bg-border"
            />
            {stages.map((stage, i) => {
              const segment: ArcSegment =
                debut === -1 ? "post" : i < debut ? "pre" : i === debut ? "debut" : "post"
              return (
                <SortableArcStageCard
                  key={stage.id}
                  stage={stage}
                  sources={stage.sources?.map(source => {
                    const artifact = storyData?.workflow?.artifacts.find(a => a.key === source.key)
                    return { key: source.key, title: artifact?.title ?? "剧情来源暂不可用", ...(artifact ? { open: () => focusStoryArtifact(novelId, artifact) } : {}) }
                  })}
                  sourcesStale={!!storyData?.workflow && stage.sources?.some(source => storyData.workflow!.artifacts.find(a => a.key === source.key)?.hash !== source.hash)}
                  segment={segment}
                  chapter={
                    stage.startChapter
                      ? // outline 尚未加载时先按快照展示，避免误判失效闪烁
                        data
                        ? resolveStageChapter(stage.startChapter, volumes)
                        : { label: stage.startChapter.label, broken: false }
                      : null
                  }
                  isFirst={i === 0}
                  isLast={i === stages.length - 1}
                  insertDisabled={atMax}
                  onEdit={() => openEdit(stage.id)}
                  onInsertAfter={() => onInsertAfter(i)}
                  onMoveUp={() => move(i, -1)}
                  onMoveDown={() => move(i, 1)}
                  onDelete={() => remove(stage)}
                />
              )
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
