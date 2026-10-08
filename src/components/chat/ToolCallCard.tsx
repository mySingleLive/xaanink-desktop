"use client"

import { useState } from "react"
import { Check, ChevronDown, ChevronRight, Copy, Loader2, CircleHelp, Wrench, X } from "lucide-react"

import { cn } from "@/lib/utils"

import { summarizeOutput, TOOL_ICONS, fieldLabel, isInternalToolCall, toolLabel, type ToolCallView } from "./types"

/** 详情字段值的人话呈现（§3.11 字段化：不展示结构语法） */
function FieldValue({ value }: { value: unknown }) {
  if (value == null) return <span className="text-muted-foreground">（空）</span>
  if (typeof value === "string") {
    if (value.length > 120) {
      // 长文本（正文/大纲内容）：截断预览块，展示自然文本
      return (
        <span className="mt-0.5 line-clamp-3 block rounded-inner bg-hover-wash px-2 py-1 whitespace-pre-wrap">
          {value}
        </span>
      )
    }
    return <span className="whitespace-pre-wrap">{value}</span>
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="tabular-nums">{String(value)}</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">（空）</span>
    if (value.every((v) => v == null || ["string", "number", "boolean"].includes(typeof v))) {
      return <span>{value.map((v) => String(v)).join(" → ")}</span>
    }
    return <span className="text-muted-foreground">{value.length} 项</span>
  }
  // 嵌套对象：给键名清单，不展开结构
  return <span className="text-muted-foreground">{Object.keys(value).join("、") || "（空）"}</span>
}

/** 字段化详情行：label 等宽 11px 灰、定宽 64px；value 12px；字段名经 fieldLabel 中文化 */
function KV({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex gap-2.5 py-[1.5px] text-xs">
      <span className="w-16 shrink-0 font-mono text-[11px] leading-[1.7] text-muted-foreground">
        {fieldLabel(label)}
      </span>
      <span className="min-w-0 flex-1 leading-[1.7] text-foreground">
        {/* 引述类字段（行内评论 quote）走 §4.8 稿纸引用块，不用普通文本 */}
        {label === "quote" && typeof value === "string" ? (
          <span className="quote-block mt-0.5 mb-0 block">{value}</span>
        ) : (
          <FieldValue value={value} />
        )}
      </span>
    </div>
  )
}

/** 把工具返回整理成字段行：ToolOutcome → 结果 + 附加字段；数组 → 条数；对象 → 逐字段 */
function outputFields(output: unknown): { label: string; value: unknown }[] {
  if (output && typeof output === "object" && !Array.isArray(output) && "ok" in output) {
    const rest = { ...(output as Record<string, unknown>) }
    delete rest.ok
    const message = rest.message
    delete rest.message
    const fields = [{ label: "结果", value: message }]
    for (const [k, v] of Object.entries(rest)) fields.push({ label: k, value: v })
    return fields
  }
  if (Array.isArray(output)) return [{ label: "返回", value: `${output.length} 条` }]
  if (output && typeof output === "object") {
    return Object.entries(output as Record<string, unknown>).map(([k, v]) => ({
      label: k,
      value: v,
    }))
  }
  return [{ label: "返回", value: output }]
}

/** SDK 参数解析失败时 input 是原始字符串，不能按字符展开为数万行。 */
export function toolInputFields(input: unknown): { label: string; value: unknown }[] {
  if (input == null) return []
  if (typeof input === "object" && !Array.isArray(input)) return Object.entries(input).map(([label, value]) => ({ label, value }))
  const value = typeof input === "string" && input.length > 2000 ? `${input.slice(0, 2000)}…（完整内容可复制原始数据查看）` : input
  return [{ label: "参数", value }]
}

/** zcode 风工具调用行：类别图标 + 等宽工具名 + 摘要 + 右侧三态；展开为字段化详情（原始 JSON 退为复制出口） */
export function ToolCallCard({ call, enterDelay }: { call: ToolCallView; enterDelay?: number }) {
  const [expanded, setExpanded] = useState(false)
  const [rawCopied, setRawCopied] = useState(false)
  const { ok, summary } =
    call.status === "unknown" ? { ok: false, summary: "结果待确认" } : call.status === "running"
      ? { ok: true, summary: "执行中" }
      : summarizeOutput(call.toolName, call.input, call.output)
  const failed = call.status === "error" || (call.status === "done" && !ok)
  // W6 受众分级：内部摩擦失败（参数已自动修正等）用中性呈现，不亮 destructive 信号
  const internal = failed && isInternalToolCall(call.toolName, call.output)
  const Icon = TOOL_ICONS[call.toolName] ?? Wrench

  return (
    <div
      className="chat-enter"
      style={enterDelay ? { animationDelay: `${enterDelay}ms` } : undefined}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group/tc flex w-full items-center gap-1.5 rounded-inner text-left font-mono text-[13.5px] text-muted-foreground select-none transition-colors hover:text-foreground"
      >
        <Icon className="size-3.5 shrink-0" />
        {call.status === "running" ? (
          <span className="min-w-0 flex-1">
            <span className="text-shimmer">{toolLabel(call.toolName)} · {summary}</span>
          </span>
        ) : (
          <>
            <span className="shrink-0">{toolLabel(call.toolName)}</span>
            <span
              className={cn(
                "min-w-0 flex-1",
                failed && !internal
                  ? "line-clamp-2 text-destructive"
                  : "line-clamp-1 text-muted-foreground"
              )}
            >
              {summary}
            </span>
          </>
        )}
        {call.status === "running" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : call.status === "unknown" ? (
          <CircleHelp className="size-3.5 shrink-0 text-muted-foreground" />
        ) : failed ? (
          <X className={cn("size-3.5 shrink-0", internal ? "text-muted-foreground" : "text-destructive")} />
        ) : (
          <Check className="size-3.5 shrink-0 text-success" />
        )}
        {/* 展开指示在最右：折叠时仅悬停本行显示（命名组隔离），展开后变向下且常驻 */}
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/tc:opacity-100" />
        )}
      </button>
      {expanded && (
        <div className="surface-plain relative mt-0.5 mb-1 ml-6 rounded-inner border border-(--chat-line) bg-popover px-2.5 py-1.5">
          <button
            type="button"
            title="复制原始数据"
            aria-label="复制原始数据"
            onClick={async (e) => {
              e.stopPropagation()
              await navigator.clipboard.writeText(
                JSON.stringify({ input: call.input, output: call.output }, null, 2)
              )
              setRawCopied(true)
              setTimeout(() => setRawCopied(false), 1200)
            }}
            className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
          >
            {rawCopied ? (
              <Check className="size-3 text-success" />
            ) : (
              <Copy className="size-3" />
            )}
          </button>
          {toolInputFields(call.input).map(({ label, value }) => (
            <KV key={label} label={label} value={value} />
          ))}
          {call.status !== "running" &&
            outputFields(call.output).map((f) => <KV key={f.label} label={f.label} value={f.value} />)}
        </div>
      )}
    </div>
  )
}
