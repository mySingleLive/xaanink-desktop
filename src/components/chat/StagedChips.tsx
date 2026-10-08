"use client"

/**
 * 三阶段保存 · composer 气泡行（阶段二）。
 * - 位于 contenteditable 之上，独立区域（非 editor 一部分），整行不可输入；
 * - 芯片样式：蓝色淡染底 + 描边，计数 N 用 git 新增绿（--staged-count）；
 * - 悬停出明细卡（位置·字段摘要），右上角 ✕ 悬浮删除（绝对定位不占位，宽度不变）= 撤销该批；
 * - 多个气泡向右并列、可换行。
 * UI 契约：design/staged-save-preview.html；docs/staged-save/prd.md §5.2。
 */

import { PenLine, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useStagedChangesStore, type StagedChip } from "@/stores/staged-changes"
import type { StagedBatchPayload, StagedChangeItem } from "@/lib/staged-save"

/** 悬停卡条目：字段级修改项，op 由外层（batch.changes 或 store change）补充 */
type ChipItem = StagedChangeItem & { op?: "modify" | "delete" | "create" }

/** 芯片视觉 + 悬停明细卡（composer 气泡与历史消息气泡共用的展示层；anchor 控制悬停卡展开方向） */
export function StagedChipView({
  label,
  count,
  items,
  cardNote,
  cardAnchor = "above",
  children,
}: {
  label: string
  count: number
  items: ChipItem[]
  cardNote: string
  /** above=在上方展开（composer 在底部）；below=在下方展开（历史消息气泡上方空间有限时也能完整展示） */
  cardAnchor?: "above" | "below"
  children?: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "group/chip relative inline-flex h-6 items-center gap-1.5 rounded-[7px] border border-staged-tint-border bg-staged-tint px-2.5",
        "text-xs font-medium select-none"
      )}
    >
      <PenLine className="size-3 shrink-0 text-staged-blue" />
      <span className="max-w-40 truncate">{label}</span>
      <span className="text-[11.5px] whitespace-nowrap">
        <span className="font-mono font-bold text-staged-count">{count}</span>
        {" 处修改"}
      </span>
      {children}
      {/* 悬停明细卡（绝对定位；bg-popover/border-border 全局令牌） */}
      <span
        className={cn(
          "invisible absolute left-0 z-30 block w-72 rounded-card border border-border bg-popover p-3 opacity-0 shadow-2 transition-opacity duration-150",
          cardAnchor === "above" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          "group-hover/chip:visible group-hover/chip:opacity-100"
        )}
        role="tooltip"
      >
        <span className="mb-2 block text-xs font-medium text-muted-foreground">{cardNote}</span>
        <span className="grid max-h-56 gap-1.5 overflow-y-auto">
          {items.map(item => (
            <span key={item.key} className="flex items-baseline gap-1.5 text-xs leading-relaxed">
              <span
                className={cn(
                  "shrink-0 text-[11px]",
                  item.op === "delete"
                    ? "font-semibold text-destructive"
                    : item.op === "create"
                      ? "font-semibold text-success"
                      : "text-muted-foreground"
                )}
              >
                {item.op === "delete" ? "删除" : item.op === "create" ? "新增" : item.fieldLabel}
              </span>
              <span className="min-w-0 truncate">{item.summary}</span>
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}

function Chip({ chip }: { chip: StagedChip }) {
  const revert = useStagedChangesStore(s => s.revert)
  return (
    <span data-testid="staged-chip" data-batch-key={chip.batchKey} className="contents">
      <StagedChipView label={chip.label} count={chip.count} items={chip.items} cardNote="本批修改 · 不落库，发送后才生效">
        <button
          type="button"
          aria-label={`删除「${chip.label}」修改气泡（撤销这批修改）`}
          title="删除此气泡（撤销这批修改）"
          onClick={() => revert(chip.batchKey)}
          className={cn(
            "invisible absolute -top-[7px] -right-[7px] z-10 flex size-[15px] items-center justify-center rounded-full",
            "border border-border bg-popover text-[9px] text-muted-foreground shadow-2",
            "group-hover/chip:visible hover:border-destructive/45 hover:text-destructive"
          )}
        >
          <X className="size-2.5" />
        </button>
      </StagedChipView>
    </span>
  )
}

/** 历史用户消息里的暂存批次气泡（只读；数据来自 turn.action 解析，随消息记录下发） */
export function StagedHistoryChips({ batches }: { batches: StagedBatchPayload[] }) {
  if (batches.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1.5" data-testid="staged-history-chips">
      {batches.map(batch => (
        <StagedChipView
          key={batch.batchKey}
          label={batch.label}
          count={batch.changes.reduce((n, c) => n + c.items.length, 0)}
          items={batch.changes.flatMap(c => c.items.map(i => ({ ...i, op: c.op })))}
          cardNote="本批修改 · 已随本条消息发送"
          cardAnchor="below"
        />
      ))}
    </span>
  )
}

export function StagedChips({ novelId }: { novelId: string | null }) {
  const chips = useStagedChangesStore(s => s.chips)
  const visible = chips.filter(c => !novelId || c.novelId === novelId)
  if (visible.length === 0) return null
  return (
    <div data-testid="staged-chip-row" className="flex flex-wrap gap-1.5 px-3.5 pt-2.5">
      {visible.map(chip => (
        <Chip key={chip.batchKey} chip={chip} />
      ))}
    </div>
  )
}
