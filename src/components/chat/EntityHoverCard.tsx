"use client"

/**
 * 实体芯片 hover 卡（§4.5 / §4.7）：消息区一切可点击实体芯片 hover ≥400ms 出 popover——
 * - 角色/场景：头像 32px 圆（无图回退 User 图标）+ 名 + 身份一行 + 简介首句（实体索引）；
 * - 物品：32px 圆角方形图标（无图回退 Package 占位）+ 名 + 别名 + 简介首句
 *   + 等级行（金色 chip）与标签行（紧邻两行）；
 * - 设定：类型 + 名 + 简介摘要；等级体系带子概念（等级名）时按 id 精确读取设定，
 *   展示与面板一致的等级卡片正文（共用 level-card-parts 的 LevelHoverBody）；
 * - 世界：名 + 介绍首句；章节：第 N 章 · 标题 + 正文/大纲；
 * - 类目词（主题/大纲/属性/爽点/设定分类）：一行类目说明。
 * 卡片均带「打开 ›」二次动作；数据复用实体索引与共享 query 缓存，无额外遍历请求。
 */
import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BookOpen, Globe, Layers, Package, User } from "lucide-react"

import { apiGet } from "@/components/content/api"
import { LevelHoverBody, type SettingDetail } from "@/components/content/level-card-parts"
import { normalizeContent } from "@/components/content/setting-content"
import type { WorldRecord } from "@/components/content/types"
import { SETTING_TYPE_LABELS } from "@/lib/setting-types"
import { Badge } from "@/components/ui/badge"

import { entityRefFromElement, entityRefTooltip, openEntityRef, type EntityRef } from "./entity-refs"
import { firstSentence, type EntityHoverInfo, type EntityIndex } from "./use-entity-index"

/** hover 意图延迟（防划过误触）与移出隐藏延迟（给移动到卡片上的余量） */
const SHOW_DELAY_MS = 400
const HIDE_DELAY_MS = 200
const CARD_WIDTH = 264

type HoverTarget =
  | { kind: "entity"; info: EntityHoverInfo; ref: Extract<EntityRef, { kind: "character" | "item" | "scene" }> }
  | { kind: "setting"; ref: Extract<EntityRef, { kind: "setting" }> }
  | { kind: "world"; ref: Extract<EntityRef, { kind: "world" }> }
  | { kind: "chapter"; ref: Extract<EntityRef, { kind: "chapter" }> }
  | { kind: "category"; ref: EntityRef }

type HoverState = HoverTarget & { x: number; y: number }

/**
 * 监听消息容器（scrollRef）的芯片悬停并渲染 popover；fixed 定位在芯片下方 8px、
 * left 钳制不超出视口。popover 自身 hover 取消隐藏。
 */
export function EntityHoverCard({
  containerRef,
  index,
  novelId,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  index: EntityIndex
  novelId: string | null
}) {
  const [hover, setHover] = useState<HoverState | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !novelId) return

    const cancelShow = () => {
      if (showTimer.current) {
        clearTimeout(showTimer.current)
        showTimer.current = null
      }
    }
    const cancelHide = () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current)
        hideTimer.current = null
      }
    }
    const scheduleHide = () => {
      cancelHide()
      hideTimer.current = setTimeout(() => setHover(null), HIDE_DELAY_MS)
    }

    const onMouseOver = (e: MouseEvent) => {
      const chip = (e.target as HTMLElement).closest?.(".entity-ref")
      if (!(chip instanceof HTMLElement)) return
      const ref = entityRefFromElement(chip)
      if (!ref) return
      let target: HoverTarget | null = null
      switch (ref.kind) {
        case "character":
        case "item":
        case "scene": {
          const info = index.hoverInfo(ref.kind, ref.id)
          if (!info) return
          target = { kind: "entity", info, ref }
          break
        }
        case "setting":
          target = { kind: "setting", ref }
          break
        case "world":
          target = { kind: "world", ref }
          break
        case "chapter":
          target = { kind: "chapter", ref }
          break
        default:
          target = { kind: "category", ref }
      }
      cancelShow()
      cancelHide()
      showTimer.current = setTimeout(() => {
        const rect = chip.getBoundingClientRect()
        setHover({
          ...target,
          x: Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 20)),
          y: rect.bottom + 8,
        })
      }, SHOW_DELAY_MS)
    }
    const onMouseOut = (e: MouseEvent) => {
      const chip = (e.target as HTMLElement).closest?.(".entity-ref")
      if (!(chip instanceof HTMLElement)) return
      if (chip.contains(e.relatedTarget as Node)) return
      cancelShow()
      scheduleHide()
    }

    container.addEventListener("mouseover", onMouseOver)
    container.addEventListener("mouseout", onMouseOut)
    return () => {
      cancelShow()
      cancelHide()
      container.removeEventListener("mouseover", onMouseOver)
      container.removeEventListener("mouseout", onMouseOut)
    }
  }, [containerRef, index, novelId])

  if (!hover || !novelId) return null

  return (
    <div
      role="tooltip"
      className="fixed z-[3000] flex w-66 flex-col gap-2 rounded-card border border-(--chat-line) bg-popover p-3 shadow-2"
      style={{ left: hover.x, top: hover.y }}
      onMouseEnter={() => {
        if (hideTimer.current) {
          clearTimeout(hideTimer.current)
          hideTimer.current = null
        }
      }}
      onMouseLeave={() => {
        hideTimer.current = setTimeout(() => setHover(null), HIDE_DELAY_MS)
      }}
    >
      {hover.kind === "entity" && <EntityBody hover={hover} novelId={novelId} onClose={() => setHover(null)} />}
      {hover.kind === "setting" && <SettingBody hover={hover} novelId={novelId} onClose={() => setHover(null)} />}
      {hover.kind === "world" && <WorldBody hover={hover} novelId={novelId} onClose={() => setHover(null)} />}
      {hover.kind === "chapter" && <ChapterBody hover={hover} index={index} novelId={novelId} onClose={() => setHover(null)} />}
      {hover.kind === "category" && (
        <p className="text-xs text-muted-foreground">{entityRefTooltip(hover.ref)} · 点击打开面板</p>
      )}
    </div>
  )
}

/** 跳转链接（各类型卡共用的二次动作） */
function OpenLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="w-fit text-[11.5px] text-primary transition-colors hover:underline"
      onClick={onClick}
    >
      {children} ›
    </button>
  )
}

/** 角色/物品/场景悬停体分发：物品走专属卡（别名/等级/标签），角色与场景共用简版 */
function EntityBody({
  hover,
  novelId,
  onClose,
}: {
  hover: Extract<HoverTarget, { kind: "entity" }>
  novelId: string
  onClose: () => void
}) {
  if (hover.ref.kind === "item") {
    return (
      <ItemHoverBody
        info={hover.info}
        onOpen={() => {
          onClose()
          openEntityRef(hover.ref, novelId)
        }}
      />
    )
  }
  const kindLabel = hover.ref.kind === "character" ? "角色" : "场景"
  return (
    <>
      <div className="flex items-center gap-2">
        {hover.info.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 本地头像缩略图
          <img
            src={hover.info.avatarUrl}
            alt={hover.info.name}
            className="size-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-selected-surface text-primary">
            <User className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">
            {hover.info.name}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{hover.info.role}</div>
        </div>
      </div>
      {hover.info.blurb && (
        <p className="line-clamp-2 text-xs leading-[1.6] text-foreground/85">{hover.info.blurb}</p>
      )}
      <OpenLink
        onClick={() => {
          onClose()
          openEntityRef(hover.ref, novelId)
        }}
      >
        打开{kindLabel}卡
      </OpenLink>
    </>
  )
}

/**
 * 物品悬停体（与 composer 芯片悬停卡共用）：圆角方形图标（无图 Package 占位）+ 名 + 身份
 * + 别名行 + 简介首句 + 等级行（金色 chip，≤2 + 溢出 +N）与标签行（≤3 + +N）紧邻两行 + 跳转。
 */
export function ItemHoverBody({ info, onOpen }: { info: EntityHoverInfo; onOpen: () => void }) {
  const aliases = info.aliases ?? []
  const levels = info.levels ?? []
  const tags = info.tags ?? []
  return (
    <>
      <div className="flex items-center gap-2">
        {info.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 本地图标缩略图
          <img
            src={info.avatarUrl}
            alt={info.name}
            className="size-8 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-accent text-muted-foreground">
            <Package className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">{info.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{info.role}</div>
        </div>
      </div>
      {aliases.length > 0 && (
        <p className="truncate text-[11.5px] text-muted-foreground">{aliases.join(" / ")}</p>
      )}
      {info.blurb && (
        <p className="line-clamp-2 text-xs leading-[1.6] text-foreground/85">{info.blurb}</p>
      )}
      {(levels.length > 0 || tags.length > 0) && (
        <div className="flex flex-col gap-1">
          {levels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {levels.slice(0, 2).map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-[11px] text-gold"
                >
                  {label}
                </span>
              ))}
              {levels.length > 2 && (
                <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  +{levels.length - 2}
                </span>
              )}
            </div>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="px-2 py-0.5 text-[11px] font-normal">
                  {tag}
                </Badge>
              ))}
              {tags.length > 3 && (
                <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  +{tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      <OpenLink onClick={onOpen}>打开物品卡</OpenLink>
    </>
  )
}

/** 设定：等级体系带子概念 → 等级卡片正文（与面板一致）；其余设定 → 类型 + 名 + 简介摘要 */
function SettingBody({
  hover,
  novelId,
  onClose,
}: {
  hover: Extract<HoverTarget, { kind: "setting" }>
  novelId: string
  onClose: () => void
}) {
  const { data } = useQuery({
    queryKey: ["setting-detail", novelId, hover.ref.id],
    queryFn: () =>
      apiGet<{ setting: SettingDetail }>(
        `/api/novels/${novelId}/settings/${hover.ref.id}`,
        "加载设定失败"
      ),
    staleTime: 60_000,
  })
  const setting = data?.setting
  const isLevelConcept = hover.ref.settingType === "LEVEL_SYSTEM" && !!hover.ref.concept

  return (
    <>
      {isLevelConcept ? (
        <LevelHoverBody setting={setting} levelName={hover.ref.concept!} />
      ) : (
        <SettingBrief
          setting={setting}
          fallbackName={hover.ref.name}
          typeLabel={SETTING_TYPE_LABELS[hover.ref.settingType]}
          concept={hover.ref.concept}
        />
      )}
      <OpenLink
        onClick={() => {
          onClose()
          openEntityRef(hover.ref, novelId)
        }}
      >
        打开设定卡
      </OpenLink>
    </>
  )
}

/** 非等级引用的设定简介：图标 + 名 + 类型（+ 子概念）+ description/rules/text 首句 */
function SettingBrief({
  setting,
  fallbackName,
  typeLabel,
  concept,
}: {
  setting: SettingDetail | undefined
  fallbackName: string
  typeLabel: string
  concept?: string
}) {
  const content = setting ? (normalizeContent(setting.type, setting.content) as unknown as Record<string, unknown>) : null
  const blurbSource =
    (typeof content?.description === "string" && content.description) ||
    (typeof content?.rules === "string" && content.rules) ||
    (typeof content?.text === "string" && content.text) ||
    null
  const blurb = firstSentence(blurbSource)
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-selected-surface text-primary">
          <Layers className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">{setting?.name ?? fallbackName}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {typeLabel}{concept ? ` · ${concept}` : ""}
          </div>
        </div>
      </div>
      {!setting ? (
        <p className="text-xs text-muted-foreground">正在读取…</p>
      ) : blurb ? (
        <p className="line-clamp-2 text-xs leading-[1.6] text-foreground/85">{blurb}</p>
      ) : null}
    </>
  )
}

/** 世界：图标 + 名 + 介绍首句（worlds 列表与面板共享缓存，命中零额外请求） */
function WorldBody({
  hover,
  novelId,
  onClose,
}: {
  hover: Extract<HoverTarget, { kind: "world" }>
  novelId: string
  onClose: () => void
}) {
  const { data } = useQuery({
    queryKey: ["worlds", novelId],
    queryFn: () => apiGet<{ worlds: WorldRecord[] }>(`/api/novels/${novelId}/worlds`, "加载世界失败"),
    staleTime: 60_000,
  })
  const world = data?.worlds.find((w) => w.id === hover.ref.id)
  const blurb = firstSentence(world?.description)
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-selected-surface text-primary">
          <Globe className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">{hover.ref.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">世界</div>
        </div>
      </div>
      {blurb && <p className="line-clamp-2 text-xs leading-[1.6] text-foreground/85">{blurb}</p>}
      <OpenLink
        onClick={() => {
          onClose()
          openEntityRef(hover.ref, novelId)
        }}
      >
        打开世界
      </OpenLink>
    </>
  )
}

/** 章节：第 N 章 · 标题 + 正文/大纲 */
function ChapterBody({
  hover,
  index,
  novelId,
  onClose,
}: {
  hover: Extract<HoverTarget, { kind: "chapter" }>
  index: EntityIndex
  novelId: string
  onClose: () => void
}) {
  const label = index.chapterLabelById(hover.ref.id) ?? hover.ref.name
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-selected-surface text-primary">
          <BookOpen className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">{label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{hover.ref.view === "outline" ? "大纲" : "正文"} · 章节</div>
        </div>
      </div>
      <OpenLink
        onClick={() => {
          onClose()
          openEntityRef(hover.ref, novelId)
        }}
      >
        打开{hover.ref.view === "outline" ? "大纲" : "正文"}
      </OpenLink>
    </>
  )
}

