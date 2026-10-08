"use client"

/**
 * 批量工具归组行（§2.2）：同一助手轮内同类工具的连续调用 ≥4 条归为一行计数摘要——
 * 进行中 shimmer「{组名} × {总数} · 已完成 {N}」（计数实时刷新），完成「{组名} × {N}」；
 * 展开呈现组内单行工具行列表。锚点行同族形态（左类型图标 + mono 13.5px + 右侧 chevron）。
 * 参照 §7.5：归组行属锚点行，进行中用文字高光流动；组内条目仍是 spinner 三态工具行。
 */
import { useState } from "react"
import { ChevronDown, ChevronRight, Wrench } from "lucide-react"

import { Collapse } from "./Collapse"
import { ToolCallCard } from "./ToolCallCard"
import {
  groupToolCalls,
  isToolGroup,
  isInternalToolCall,
  TOOL_ICONS,
  type ToolCallGroup,
  type ToolCallView,
} from "./types"

/** 工具行进入动画 stagger：逐条 30ms；同屏超此数取消 stagger（防长 batch 拖沓，§3.6） */
const STAGGER_LIMIT = 6

/** 同回合内部摩擦失败折叠阈值：达到此数折为一行中性摘要，避免实现名词刷屏（W6） */
const INTERNAL_FOLD_MIN = 2

/** 内部失败是否为可折叠对象（status=error 且命中实现细节码；问题生成失败等业务失败除外） */
export function isFoldableInternalFailure(call: ToolCallView): boolean {
  return call.status === "error" && isInternalToolCall(call.toolName, call.output)
}

/**
 * 内部失败折叠行（W6 降噪）：只说明未完成，不臆测已自动修复，
 * 展开呈现各步骤的工具行（默认行中性文案，技术原文在卡片展开区）。
 */
export function InternalFailuresFold({ calls }: { calls: ToolCallView[] }) {
  const [open, setOpen] = useState(false)
  if (calls.length === 0) return null
  if (calls.length < INTERNAL_FOLD_MIN) {
    return (
      <>
        {calls.map(call => <ToolCallCard key={call.toolCallId} call={call} />)}
      </>
    )
  }
  return (
    <div data-testid="internal-failures-fold">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="group/itf flex w-fit items-center gap-1.5 font-mono text-[13.5px] text-muted-foreground select-none transition-colors hover:text-foreground"
      >
        <Wrench className="size-3.5 shrink-0" />
        <span className="tabular-nums">有 {calls.length} 个内部步骤未完成</span>
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/itf:opacity-100" />
        )}
      </button>
      <Collapse open={open} className="mt-0.5 ml-2 border-l border-border/70 pl-4">
        <div className="flex flex-col gap-1">
          {calls.map(call => <ToolCallCard key={call.toolCallId} call={call} />)}
        </div>
      </Collapse>
    </div>
  )
}

function GroupRow({ group }: { group: ToolCallGroup }) {
  const [open, setOpen] = useState(false)
  const doneCount = group.calls.filter((c) => c.status === "done").length
  const failedCount = group.calls.filter(c => c.status === "error").length
  const unknownCount = group.calls.filter(c => c.status === "unknown").length
  const streaming = group.calls.some(c => c.status === "running")
  const Icon = TOOL_ICONS[group.calls[0]?.toolName ?? ""] ?? Wrench

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/tcg flex w-fit items-center gap-1.5 font-mono text-[13.5px] text-muted-foreground select-none transition-colors hover:text-foreground"
      >
        <Icon className="size-3.5 shrink-0" />
        {streaming ? (
          <span className="text-shimmer tabular-nums">
            {group.groupName} × {group.calls.length} · 成功 {doneCount} / 失败 {failedCount} / 待确认 {unknownCount}
          </span>
        ) : (
          <span className="tabular-nums">
            {group.groupName} × {group.calls.length} · 成功 {doneCount} / 失败 {failedCount} / 待确认 {unknownCount}
          </span>
        )}
        {/* 展开指示在右侧：折叠时仅悬停本行浮现，展开后变向下且常驻（命名组隔离） */}
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/tcg:opacity-100" />
        )}
      </button>
      {!open && group.calls.filter(call => call.status !== "done").map(call => <ToolCallCard key={call.toolCallId} call={call} />)}
      <Collapse open={open} className="mt-0.5 ml-2 border-l border-border/70 pl-4">
        <div className="flex flex-col gap-1">
          {group.calls.map((call, i) => (
            <ToolCallCard
              key={call.toolCallId}
              call={call}
              enterDelay={call.status === "done" && group.calls.length <= STAGGER_LIMIT ? i * 15 : undefined}
            />
          ))}
        </div>
      </Collapse>
    </div>
  )
}

/** work-log 行序列：归组区段渲染为计数摘要行，其余为单行工具行（stagger 仅对首轮 ≤6 条生效）；
    内部摩擦失败 ≥2 条时折为一行中性摘要（W6），业务性失败照常外露 */
export function WorkLogRows({ calls }: { calls: ToolCallView[] }) {
  const internal = calls.filter(isFoldableInternalFailure)
  const rest = internal.length >= INTERNAL_FOLD_MIN ? calls.filter(call => !isFoldableInternalFailure(call)) : calls
  const rows = groupToolCalls(rest)
  const stagger = rest.length <= STAGGER_LIMIT
  return (
    <>
      {rows.map((row, i) =>
        isToolGroup(row) ? (
          <GroupRow key={row.key} group={row} />
        ) : (
          <ToolCallCard
            key={row.toolCallId}
            call={row}
            enterDelay={row.status === "done" && stagger ? i * 15 : undefined}
          />
        )
      )}
      {internal.length >= INTERNAL_FOLD_MIN && <InternalFailuresFold calls={internal} />}
    </>
  )
}
