"use client"

/**
 * @ 提及自动补全弹窗：分组陈列候选资源，支持键盘（↑/↓/Enter/Tab/Esc）
 * 与鼠标（hover/点击）选择。受控组件，状态机由 ChatPanel 持有。
 * 定位在 composer 卡片正上方（父容器需 relative）。
 */
import { useEffect, useRef } from "react"
import {
  BookOpen,
  FileText,
  Globe,
  ListTree,
  Map as MapIcon,
  MapPin,
  User,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

import type { MentionGroup, MentionItem } from "./use-mention-candidates"

/** 提及分组类目图标：角色/世界观/设定/大纲/正文（「+」菜单二级类目用） */
export const MENTION_GROUP_ICONS: Record<string, LucideIcon> = {
  scene: MapPin,
  character: User,
  world: Globe,
  setting: BookOpen,
  outline: ListTree,
  content: FileText,
}

/** 条目左侧视觉：角色有头像用头像，其余按类别出图标（与 composer 芯片图标集一致） */
export function MentionItemVisual({ item }: { item: MentionItem }) {
  if (item.kind === "character" && item.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 头像缩略图，无需优化管线
      <img
        src={item.avatarUrl}
        alt=""
        data-testid="mention-item-avatar"
        className="size-[18px] shrink-0 rounded-full object-cover"
      />
    )
  }
  const Icon =
    item.kind === "scene"
      ? MapPin
      : item.kind === "character"
      ? User
      : item.kind === "world"
        ? Globe
        : item.kind === "setting"
          ? item.settingType === "MAP"
            ? MapIcon
            : BookOpen
          : item.kind === "outline"
            ? ListTree
            : FileText
  return (
    // 与头像同宽的槽位，保证各行名称左对齐
    <span className="flex size-[18px] shrink-0 items-center justify-center">
      <Icon
        data-testid="mention-item-icon"
        className="size-[13.5px] text-muted-foreground"
        aria-hidden="true"
      />
    </span>
  )
}

interface MentionPopupProps {
  /** 已按当前 query 过滤后的分组（可能为空数组） */
  groups: MentionGroup[]
  /** 跨组扁平化后的高亮下标 */
  activeIndex: number
  onActiveChange: (index: number) => void
  onSelect: (item: MentionItem) => void
}

export function MentionPopup({
  groups,
  activeIndex,
  onActiveChange,
  onSelect,
}: MentionPopupProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  // 键盘导航时保证高亮项可见
  useEffect(() => {
    rootRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  let flat = -1
  return (
    <div
      ref={rootRef}
      role="listbox"
      aria-label="引用资源"
      data-testid="mention-popup"
      className="absolute right-0 bottom-full left-0 z-50 mb-2 max-h-[280px] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-[0_8px_24px_-8px_var(--shadow-color)]"
    >
      {groups.length === 0 ? (
        <div className="px-2.5 py-2 text-[12px] text-muted-foreground">无匹配资源</div>
      ) : (
        groups.map((g) => (
          <div key={g.key} data-testid="mention-group" data-group={g.label}>
            <div className="px-2.5 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground">
              {g.label}
            </div>
            {g.items.map((item) => {
              flat += 1
              const idx = flat
              return (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={idx === activeIndex}
                  data-testid="mention-item"
                  // mousedown + preventDefault：选中发生在 textarea blur 之前且不丢焦点
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onSelect(item)
                  }}
                  onMouseEnter={() => onActiveChange(idx)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
                    idx === activeIndex
                      ? "bg-hover-wash text-foreground"
                      : "text-foreground/90"
                  )}
                >
                  <MentionItemVisual item={item} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {item.detail && (
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">
                      {item.detail}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
