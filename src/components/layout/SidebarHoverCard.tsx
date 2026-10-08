"use client"

/**
 * 侧栏树条目悬停简介卡（2026-09）：鼠标悬停树条目 ≥400ms 在条目右侧弹出，
 * 移出 200ms 隐藏、卡上 hover 取消隐藏、滚动/点击即收；触发逻辑在 TreeNode
 * （hoverCard 惰性渲染函数 prop），本文件是卡片视觉与惰性取数变体。
 * 视觉对齐全站浮层卡片（MentionPopup 等）：bg-popover + border-border +
 * rounded-card + shadow-2 + 图/图标 32px（勿用 --chat-line——仅 .chatpane 作用域，
 * 侧栏解析失败会回退成 currentColor 白边）。
 * 数据统一 HoverCardData（标题/类目行/简介首句/统计行/图或图标）；
 * 惰性变体（小说根/主题/设定类/角色分组头）只在卡片真正挂载时发查询，
 * query key 与各面板一致（["novels", id] / ["characters", id]），缓存共享不重复请求。
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BookOpen, Users, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { firstSentence } from "@/components/chat/use-entity-index"

import { CroppedImage } from "../content/CroppedImage"
import {
  CHARACTER_ROLE_LABELS,
  NOVEL_STAGES,
  SETTING_TYPE_LABELS,
} from "../content/labels"
import {
  normalizeCrop,
  type CharacterRecord,
  type NovelDetail,
  type NovelSummary,
} from "../content/types"
import type { SettingType } from "@/generated/prisma/enums"

/* ------------------------------ 数据形状 ------------------------------ */

export interface HoverCardData {
  title: string
  /** 标题折行显示（默认 truncate 单行截断；会话条目标题可能很长，需显示全） */
  wrapTitle?: boolean
  /** 类目行（如「角色 · 主角」「场景」） */
  subtitle?: string
  /** 简介正文（首句/截断，clamp-3） */
  blurb?: string | null
  /** 底部统计行（11px muted，「 · 」分隔） */
  meta?: string[]
  imageUrl?: string | null
  imageCrop?: unknown
  /** true=圆形裁切（角色头像），false=圆角矩形（封面） */
  roundImage?: boolean
  /** 无图时的回退图标（32px 圆底） */
  icon?: LucideIcon
}

/* ------------------------------ 通用卡片 ------------------------------ */

export function SidebarHoverCard({ data }: { data: HoverCardData }) {
  const Icon = data.icon
  return (
    <div className="flex w-64 flex-col gap-2 rounded-card border border-border bg-popover p-3 shadow-2">
      <div className="flex items-center gap-2">
        {data.imageUrl ? (
          <span
            className={cn(
              "relative size-8 shrink-0 overflow-hidden",
              data.roundImage ? "rounded-full" : "rounded-inner"
            )}
          >
            <CroppedImage
              src={data.imageUrl}
              crop={normalizeCrop(data.imageCrop)}
              alt={data.title}
            />
          </span>
        ) : Icon ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-selected-surface text-primary">
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <div
            className={
              data.wrapTitle
                ? "text-[13px] leading-[1.45] font-semibold break-words text-foreground"
                : "truncate text-[13px] font-semibold text-foreground"
            }
          >
            {data.title}
          </div>
          {data.subtitle && (
            <div className="truncate text-[11px] text-muted-foreground">{data.subtitle}</div>
          )}
        </div>
      </div>
      {data.blurb && (
        <p className="line-clamp-3 text-xs leading-[1.6] text-foreground/85">{data.blurb}</p>
      )}
      {data.meta && data.meta.length > 0 && (
        <div className="text-[11px] text-muted-foreground">{data.meta.join(" · ")}</div>
      )}
    </div>
  )
}

/* ------------------------------ 悬停会话 Provider ------------------------------ */

/**
 * 侧栏级悬停会话（2026-09）：全侧栏共享单一卡片实例，owner 令牌归属——
 * 卡片已打开时横移到另一条目：show() 原位换内容（零延迟、零过渡，无「先收再弹」）；
 * 无卡时首次悬停仍走 400ms 意图延迟（TreeNode 侧计时）；移出 200ms 宽限隐藏、
 * 卡上 hover 取消、滚动/点击/行卸载即收。
 */
interface HoverState {
  owner: symbol
  render: () => React.ReactNode
  x: number
  y: number
}

export interface SidebarHoverCtxValue {
  /** 立即展示；当前卡片属于别的 owner 时原位换内容（瞬时切换） */
  show: (owner: symbol, render: () => React.ReactNode, pos: { x: number; y: number }) => void
  /** 200ms 宽限后隐藏（移到卡片上可取消；owner 已被顶掉时空操作） */
  scheduleHide: (owner: symbol) => void
  /** 立即隐藏（仅当当前卡片属于 owner；行点击/卸载用） */
  hideNow: (owner: symbol) => void
  /** 当前是否有卡片打开（不论归属） */
  isOpen: () => boolean
  /** 当前卡片是否属于本行（已展示自己的卡时不重复调度） */
  ownsCurrent: (owner: symbol) => boolean
}

const SidebarHoverCtx = createContext<SidebarHoverCtxValue | null>(null)

/** TreeNode 取悬停会话；不在 Provider 内（理论上不会）返回 null，hover 特性静默禁用 */
export function useSidebarHover() {
  return useContext(SidebarHoverCtx)
}

/** 卡片尺寸与视口边距（定位钳制用；卡片本体 w-64=256px） */
export const HOVER_CARD_W = 256
export const HOVER_CARD_EST_H = 208
/** 无卡时的首次悬停意图延迟（TreeNode 侧用） */
export const HOVER_SHOW_MS = 400
/** 移出隐藏宽限（给移动到卡片上的余量） */
export const HOVER_HIDE_MS = 200

export function SidebarHoverProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HoverState | null>(null)
  const stateRef = useRef<HoverState | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }
  const setHover = (v: HoverState | null) => {
    stateRef.current = v
    setState(v)
  }

  const value = useMemo<SidebarHoverCtxValue>(
    () => ({
      show: (owner, render, pos) => {
        cancelHide()
        setHover({ owner, render, x: pos.x, y: pos.y })
      },
      scheduleHide: (owner) => {
        cancelHide()
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null
          if (stateRef.current?.owner === owner) setHover(null)
        }, HOVER_HIDE_MS)
      },
      hideNow: (owner) => {
        cancelHide()
        if (stateRef.current?.owner === owner) setHover(null)
      },
      isOpen: () => stateRef.current !== null,
      ownsCurrent: (owner) => stateRef.current?.owner === owner,
    }),
    // cancelHide/setHover 只触碰 ref 与 setState，行为不随渲染变化
    []
  )

  // 卡片 fixed 定位不随行滚动：任何滚动（捕获阶段）即收
  useEffect(() => {
    if (!state) return
    const hide = () => setHover(null)
    window.addEventListener("scroll", hide, true)
    return () => window.removeEventListener("scroll", hide, true)
  })
  // 卸载清计时器
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    },
    []
  )

  return (
    <SidebarHoverCtx.Provider value={value}>
      {children}
      {state && (
        <div
          role="tooltip"
          className="fixed z-[3000]"
          style={{
            left: Math.min(state.x, window.innerWidth - HOVER_CARD_W - 8),
            top: Math.max(8, Math.min(state.y, window.innerHeight - HOVER_CARD_EST_H - 8)),
          }}
          onMouseEnter={cancelHide}
          onMouseLeave={() => value.scheduleHide(state.owner)}
        >
          {state.render()}
        </div>
      )}
    </SidebarHoverCtx.Provider>
  )
}

/** 静态条目卡（组头/固定节点的说明性简介） */
export function staticHoverCard(title: string, icon: LucideIcon, blurb: string, meta?: string[]) {
  function StaticCard() {
    return <SidebarHoverCard data={{ title, icon, blurb, meta }} />
  }
  return StaticCard
}

/* ------------------------------ 取数助手 ------------------------------ */

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 小说详情查询（["novels", id] 与大纲/正文子树、内容区多面板共享缓存） */
export function useNovelDetail(novelId: string) {
  return useQuery<{ novel: NovelDetail }>({
    queryKey: ["novels", novelId],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novelId}`)
      if (!res.ok) throw new Error("加载小说详情失败")
      return res.json()
    },
  })
}

function LoadingCard({ title, icon }: { title: string; icon?: LucideIcon }) {
  return <SidebarHoverCard data={{ title, icon, blurb: null, meta: ["加载中…"] }} />
}

/* ------------------------------ 惰性变体 ------------------------------ */

/** 小说根节点：封面 + 书名 + 阶段 + 主题简介 + 卷/章/角色统计 */
export function NovelHoverCard({ novel }: { novel: NovelSummary }) {
  const { data, isLoading } = useNovelDetail(novel.id)
  if (isLoading || !data) return <LoadingCard title={novel.title} icon={BookOpen} />
  const detail = data.novel
  const chapterCount = detail.volumes.reduce((n, v) => n + v.chapters.length, 0)
  const wordCount = detail.volumes.reduce(
    (n, v) => n + v.chapters.reduce((m, c) => m + c.wordCount, 0),
    0
  )
  const stageLabel = NOVEL_STAGES.find((s) => s.value === detail.currentStage)?.label
  return (
    <SidebarHoverCard
      data={{
        title: detail.title,
        subtitle: stageLabel ? `当前阶段 · ${stageLabel}` : undefined,
        imageUrl: detail.coverUrl,
        imageCrop: null,
        roundImage: false,
        icon: BookOpen,
        blurb: firstSentence(detail.theme?.synopsis),
        meta: [
          `${detail.volumes.length} 卷 · ${chapterCount} 章`,
          `${detail.characters.length} 位角色`,
          ...(wordCount > 0 ? [`共 ${wordCount.toLocaleString()} 字`] : []),
        ],
      }}
    />
  )
}

/** 主题节点：题材/频道/标签/目标受众 + 简介 */
export function ThemeHoverCard({ novel }: { novel: NovelSummary }) {
  const { data, isLoading } = useNovelDetail(novel.id)
  if (isLoading) return <LoadingCard title="主题" />
  const theme = data?.novel.theme
  if (!theme) {
    return <SidebarHoverCard data={{ title: "主题", blurb: "还没有主题，点击开始共建。" }} />
  }
  return (
    <SidebarHoverCard
      data={{
        title: theme.title || "主题",
        subtitle: "主题",
        blurb: firstSentence(theme.synopsis),
        meta: [
          theme.channel,
          theme.genre,
          ...theme.tags.slice(0, 3),
          theme.targetAudience && `受众：${theme.targetAudience}`,
        ].filter((x): x is string => !!x),
      }}
    />
  )
}

/** 设定类节点（金手指/文风设定）：设定名 + 更新时间 */
export function SettingTypeHoverCard({
  novel,
  settingType,
}: {
  novel: NovelSummary
  settingType: SettingType
}) {
  const { data, isLoading } = useNovelDetail(novel.id)
  const label = SETTING_TYPE_LABELS[settingType]
  if (isLoading) return <LoadingCard title={label} />
  const setting = data?.novel.settings.find((s) => s.type === settingType)
  return (
    <SidebarHoverCard
      data={{
        title: label,
        subtitle: setting?.name ?? "未填写",
        blurb: setting ? null : "还没有内容，点击开始填写。",
        meta: setting ? [`更新于 ${fmtDate(setting.updatedAt)}`] : undefined,
      }}
    />
  )
}

/** 角色组头：各档人数统计 */
export function CharactersHeaderHoverCard({ novel }: { novel: NovelSummary }) {
  const { data, isLoading } = useQuery<{ characters: CharacterRecord[] }>({
    queryKey: ["characters", novel.id],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novel.id}/characters`)
      if (!res.ok) throw new Error("加载角色失败")
      return res.json()
    },
  })
  if (isLoading) return <LoadingCard title="角色" icon={Users} />
  const characters = data?.characters ?? []
  const byRole = (Object.keys(CHARACTER_ROLE_LABELS) as (keyof typeof CHARACTER_ROLE_LABELS)[])
    .map((r) => {
      const n = characters.filter((c) => c.roleType === r).length
      return n > 0 ? `${CHARACTER_ROLE_LABELS[r]} ${n}` : null
    })
    .filter((x): x is string => !!x)
  const protagonist = characters.find((c) => c.roleType === "PROTAGONIST")
  return (
    <SidebarHoverCard
      data={{
        title: "角色",
        subtitle: `${characters.length} 位`,
        icon: Users,
        blurb: protagonist ? `主角：${protagonist.name}` : null,
        meta: byRole.length > 0 ? byRole : undefined,
      }}
    />
  )
}
