"use client"

/**
 * composer 引用芯片悬停卡：鼠标悬停 ≥400ms 弹出 popover，复用 EntityHoverCard 的
 * 延迟与定位惯例。按芯片 data-kind 分发：
 * - setting（@[设定·名/{settingId}·{等级名}]）：按 settingId 精确读取设定
 *   （列表接口 worldId 默认为 null 查不到世界级设定，必须走单条路由），再按
 *   等级名/别名反查节点；内容与面板等级卡片一致（共用 level-card-parts）；
 * - character（@[角色/{name}]）：经实体索引 characterByName 解析 id 后取
 *   hoverInfo（头像/身份/简介首句），渲染与消息区 EntityHoverCard 一致的卡片；
 * - item（@[物品/{name}]）：经 itemByName 解析后取 hoverInfo，渲染 EntityHoverCard
 *   的物品悬停体（共用 ItemHoverBody：图标/别名/简介/等级行/标签行）。
 */
import { parseSceneIdentity } from "@/lib/scene-context"
import { splitMentionToken } from "@/lib/mention-token"
import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { User } from "lucide-react"

import { apiGet } from "@/components/content/api"
import {
  LevelHoverBody,
  type SettingDetail,
} from "@/components/content/level-card-parts"
import { ItemHoverBody } from "./EntityHoverCard"
import { openEntityRef } from "./entity-refs"
import type { EntityIndex } from "./use-entity-index"

const SHOW_DELAY_MS = 400
const HIDE_DELAY_MS = 200
const CARD_WIDTH = 264

interface LevelRef {
  settingId: string
  levelName: string
}

/** 按名解析的实体芯片引用（角色/物品同构） */
interface NamedEntityRef {
  id: string
  name: string
}

type HoverState = {
  x: number
  y: number
} & (
  | { kind: "level"; ref: LevelRef }
  | { kind: "character"; ref: NamedEntityRef }
  | { kind: "item"; ref: NamedEntityRef }
  | { kind: "scene"; ref: NamedEntityRef }
)

/** 芯片 insert 序列反查等级引用：`@[设定·序列阶梯/{settingId}·{等级名}]`，无法解析返回 null */
function parseLevelRef(insert: string | undefined): LevelRef | null {
  if (!insert || !insert.startsWith("@[设定·") || !insert.endsWith("]")) return null
  const inner = insert.slice(2, -1)
  const slash = inner.indexOf("/")
  if (slash < 0) return null
  const rest = inner.slice(slash + 1)
  const sep = rest.indexOf("·")
  if (sep < 0) return null
  const settingId = rest.slice(0, sep)
  const levelName = rest.slice(sep + 1).trim()
  if (!settingId || !levelName) return null
  return { settingId, levelName }
}

/** 芯片 insert 序列反查角色引用：`@[角色/{name}]`，无法解析返回 null */
function parseCharacterName(insert: string | undefined): string | null {
  if (!insert || !insert.startsWith("@[角色/") || !insert.endsWith("]")) return null
  const name = insert.slice(5, -1).trim()
  return name || null
}

/** 芯片 insert 序列反查物品引用：`@[物品/{name}]`，无法解析返回 null */
function parseItemName(insert: string | undefined): string | null {
  if (!insert || !insert.startsWith("@[物品/") || !insert.endsWith("]")) return null
  const name = insert.slice(5, -1).trim()
  return name || null
}

export function ComposerChipHoverCard({
  containerRef,
  novelId,
  index,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  novelId: string | null
  /** 实体索引（角色/物品芯片解析用；等级芯片按 id 查询不依赖索引） */
  index?: EntityIndex
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
      const chip = (e.target as HTMLElement).closest?.(".composer-chip")
      if (!(chip instanceof HTMLElement)) return
      const insert = chip.getAttribute("data-insert") ?? undefined
      const kind = chip.getAttribute("data-kind")
      let target: HoverState | null = null
      if (kind === "setting") {
        const ref = parseLevelRef(insert)
        if (!ref) return
        target = { kind: "level", ref, x: 0, y: 0 }
      } else if (kind === "character" && index) {
        const name = parseCharacterName(insert)
        const ref = name ? index.characterByName(name) : undefined
        if (!ref || ref.kind !== "character") return
        target = { kind: "character", ref: { id: ref.id, name: ref.name }, x: 0, y: 0 }
      } else if (kind === "scene" && index) {
        const identity = parseSceneIdentity(splitMentionToken(insert ?? "").payload)
        const ref = identity && identity.novelId === novelId ? index.sceneById(identity.sceneId) : undefined
        target = {kind: "scene", ref: {id: ref && ref.kind === "scene" ? ref.id : "", name: ref && ref.kind === "scene" ? ref.name : "场景已删除或引用失效"}, x: 0, y: 0}
      } else if (kind === "item" && index) {
        const name = parseItemName(insert)
        const ref = name ? index.itemByName(name) : undefined
        if (!ref || ref.kind !== "item") return
        target = { kind: "item", ref: { id: ref.id, name: ref.name }, x: 0, y: 0 }
      } else {
        return
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
      const chip = (e.target as HTMLElement).closest?.(".composer-chip")
      if (!(chip instanceof HTMLElement)) return
      if (chip.contains(e.relatedTarget as Node)) return
      cancelShow()
      scheduleHide()
    }

    const onClick = (event: MouseEvent) => {
      const chip = (event.target as HTMLElement).closest?.(".composer-chip[data-kind=scene]")
      if (!(chip instanceof HTMLElement) || !index) return
      const identity = parseSceneIdentity(splitMentionToken(chip.dataset.insert ?? "").payload)
      const ref = identity && identity.novelId === novelId ? index.sceneById(identity.sceneId) : undefined
      if (ref && novelId) openEntityRef(ref, novelId)
    }
    container.addEventListener("click", onClick)
    container.addEventListener("mouseover", onMouseOver)
    container.addEventListener("mouseout", onMouseOut)
    return () => {
      cancelShow()
      cancelHide()
      container.removeEventListener("click", onClick)
      container.removeEventListener("mouseover", onMouseOver)
      container.removeEventListener("mouseout", onMouseOut)
    }
  }, [containerRef, novelId, index])

  const { data } = useQuery({
    queryKey: ["setting-detail", novelId, hover?.kind === "level" ? hover.ref.settingId : null],
    queryFn: () =>
      apiGet<{ setting: SettingDetail }>(
        `/api/novels/${novelId}/settings/${hover?.kind === "level" ? hover.ref.settingId : ""}`,
        "加载设定失败"
      ),
    enabled: !!novelId && hover?.kind === "level",
    staleTime: 60_000,
  })

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
      {hover.kind === "level"
        ? <LevelHoverBody setting={data?.setting} levelName={hover.ref.levelName} />
        : hover.kind === "scene"
          ? <SceneChipHoverBody hover={hover} index={index} novelId={novelId} onClose={() => setHover(null)}/>
        : hover.kind === "item"
          ? <ItemChipHoverBody hover={hover} index={index} novelId={novelId} onClose={() => setHover(null)} />
          : <CharacterHoverBody hover={hover} index={index} novelId={novelId} onClose={() => setHover(null)} />}
    </div>
  )
}

/** 角色悬停内容：与消息区 EntityHoverCard 一致（头像 + 名 + 身份 + 简介首句 + 跳转） */
function CharacterHoverBody({
  hover,
  index,
  novelId,
  onClose,
}: {
  hover: Extract<HoverState, { kind: "character" }>
  index: EntityIndex | undefined
  novelId: string
  onClose: () => void
}) {
  const info = index?.hoverInfo("character", hover.ref.id)
  if (!info) {
    return <p className="text-xs text-muted-foreground">未找到该角色（可能已重命名或删除）</p>
  }
  return (
    <>
      <div className="flex items-center gap-2">
        {info.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 本地头像缩略图
          <img src={info.avatarUrl} alt={info.name} className="size-8 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-selected-surface text-primary">
            <User className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">{info.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{info.role}</div>
        </div>
      </div>
      {info.blurb && <p className="line-clamp-2 text-xs leading-[1.6] text-foreground/85">{info.blurb}</p>}
      <button
        type="button"
        className="w-fit text-[11.5px] text-primary transition-colors hover:underline"
        onClick={() => {
          onClose()
          openEntityRef({ kind: "character", id: hover.ref.id, name: hover.ref.name }, novelId)
        }}
      >
        打开角色卡 ›
      </button>
    </>
  )
}

/** 物品悬停内容：经索引取 hoverInfo 后交给 EntityHoverCard 共用的 ItemHoverBody 渲染 */
function ItemChipHoverBody({
  hover,
  index,
  novelId,
  onClose,
}: {
  hover: Extract<HoverState, { kind: "item" }>
  index: EntityIndex | undefined
  novelId: string
  onClose: () => void
}) {
  const info = index?.hoverInfo("item", hover.ref.id)
  if (!info) {
    return <p className="text-xs text-muted-foreground">未找到该物品（可能已重命名或删除）</p>
  }
  return (
    <ItemHoverBody
      info={info}
      onOpen={() => {
        onClose()
        openEntityRef({ kind: "item", id: hover.ref.id, name: hover.ref.name }, novelId)
      }}
    />
  )
}

function SceneChipHoverBody({hover, index, novelId, onClose}: {hover: Extract<HoverState, {kind: "scene"}>; index?: EntityIndex; novelId: string; onClose: () => void}) {
 const info = index?.hoverInfo("scene", hover.ref.id)
 if (!info) return <p className="text-xs text-muted-foreground">场景已删除或不属于当前作品</p>
 return <><strong className="text-sm">{info.name}</strong><p className="text-xs text-muted-foreground">{info.role}</p><p className="text-xs">{info.blurb}</p><button className="text-left text-xs text-primary" onClick={() => {openEntityRef({kind: "scene", id: hover.ref.id, name: info.name}, novelId); onClose()}}>查看场景 →</button></>
}
