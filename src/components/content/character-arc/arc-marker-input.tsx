"use client"

/**
 * 阶段定位气泡输入：一个条件一枚气泡（年龄/事件带类别小字，自定义无前缀），
 * 尾部类别下拉 + 裸输入框；回车/逗号添加，×/退格删除，同类别同文本去重。
 * 添加/删除都是离散操作（onChange 由调用方走立即保存）；正在输入的文本失焦不强制成泡，
 * 避免与类别切换的 blur 冲突（留在输入框中，回车/逗号再添加）。
 */
import { useRef, useState } from "react"
import { X } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ARC_STAGE_MARKERS_MAX,
  ARC_STAGE_MARKER_TEXT_MAX,
  type ArcStageMarker,
  type ArcStageMarkerKind,
} from "@/lib/arc-stage"

const MARKER_KINDS: { value: ArcStageMarkerKind; label: string }[] = [
  { value: "age", label: "年龄" },
  { value: "event", label: "事件" },
  { value: "custom", label: "自定义" },
]

/** 气泡/卡片上的类别小字：自定义不带前缀 */
export function markerKindLabel(kind: ArcStageMarkerKind): string {
  if (kind === "age") return "年龄"
  if (kind === "event") return "事件"
  return ""
}

export function ArcMarkerInput({
  value,
  onChange,
}: {
  value: ArcStageMarker[]
  onChange: (next: ArcStageMarker[]) => void
}) {
  const [kind, setKind] = useState<ArcStageMarkerKind>("age")
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const add = () => {
    const t = text.trim().slice(0, ARC_STAGE_MARKER_TEXT_MAX)
    if (!t) return
    if (value.length >= ARC_STAGE_MARKERS_MAX) return
    if (value.some((m) => m.kind === kind && m.text === t)) {
      setText("")
      return
    }
    onChange([...value, { kind, text: t }])
    setText("")
  }

  return (
    <div
      role="group"
      aria-label="阶段定位"
      className="flex cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button,[role=combobox]")) return
        inputRef.current?.focus()
      }}
    >
      {value.map((m, i) => (
        <span
          key={`${m.kind}:${m.text}:${i}`}
          className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--gold)_30%,transparent)] bg-[color-mix(in_srgb,var(--gold)_10%,transparent)] pr-1 pl-2.5 text-xs leading-[22px] font-medium whitespace-nowrap text-gold"
        >
          {markerKindLabel(m.kind) && (
            <span className="text-[11px] font-normal opacity-70">{markerKindLabel(m.kind)}</span>
          )}
          {m.text}
          <button
            type="button"
            aria-label={`移除条件 ${m.text}`}
            className="inline-flex size-4 items-center justify-center rounded-full opacity-60 hover:bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] hover:opacity-100"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <span className="inline-flex min-w-44 flex-1 items-center gap-1.5">
        <Select items={MARKER_KINDS} value={kind} onValueChange={(v) => setKind(v as ArcStageMarkerKind)}>
          <SelectTrigger
            size="sm"
            aria-label="定位类别"
            className="h-6 w-[74px] shrink-0 rounded-none border-0 border-b border-dashed bg-transparent px-1 text-xs text-muted-foreground dark:bg-transparent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARKER_KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === "，") {
              e.preventDefault()
              add()
            } else if (e.key === "Backspace" && !text && value.length > 0) {
              onChange(value.slice(0, -1))
            }
          }}
          placeholder={
            value.length === 0 ? "输入条件，回车添加；如：16 岁 / 练气一层 / 父母被陷害后" : ""
          }
          aria-label="添加定位条件"
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </span>
    </div>
  )
}
