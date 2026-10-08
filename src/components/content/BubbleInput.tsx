"use client"

/**
 * 多气泡输入：Badge 气泡列表 + 尾部裸输入框（Enter/失焦添加、trim、去重、限量、× 删除）。
 * 抽取自 CharacterPanel 别名/性格标签两处内联实现；角色别名、性格标签、物品别名/标签
 * 共用，限量与单长常量由调用方按字段传入。超限量/重复/超长（截断后为空）静默忽略，
 * 与 CharacterPanel 现状一致。
 */
import { useState } from "react"
import { X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface BubbleInputProps {
  value: string[]
  onChange: (next: string[]) => void
  /** 失焦保存钩子（接 useAutosave.saveNow）；在失焦添加之外兜底 */
  onBlur?: () => void
  /** 气泡数量上限（达到后新输入静默忽略） */
  max: number
  /** 单个气泡最大长度（超出截断） */
  itemMaxLength: number
  /** 仅在气泡列表为空时展示 */
  placeholder?: string
  /** 字段名，用于删除按钮 aria-label：「移除{ariaLabel} xxx」 */
  ariaLabel: string
  /**
   * 容器外观：boxed（默认）带边框盒（独立表单字段）；bare 无边框无内边距
   * （嵌入 FieldCard 等已有容器时保持其原貌，如角色性格标签）
   */
  variant?: "boxed" | "bare"
}

export function BubbleInput({
  value,
  onChange,
  onBlur,
  max,
  itemMaxLength,
  placeholder,
  ariaLabel,
  variant = "boxed",
}: BubbleInputProps) {
  const [input, setInput] = useState("")

  const add = () => {
    const text = input.trim().slice(0, itemMaxLength)
    setInput("")
    if (!text || value.includes(text)) return
    if (value.length >= max) return
    onChange([...value, text])
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        variant === "boxed" && "min-h-9 rounded-lg border border-input px-2.5 py-1.5"
      )}
    >
      {value.map((item) => (
        <Badge key={item} variant="secondary" className="gap-1">
          {item}
          <button
            type="button"
            aria-label={`移除${ariaLabel} ${item}`}
            onClick={() => onChange(value.filter((v) => v !== item))}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            add()
          }
        }}
        onBlur={() => {
          add()
          onBlur?.()
        }}
        placeholder={value.length === 0 ? placeholder : ""}
        className="min-w-32 flex-1 bg-transparent text-sm outline-none"
      />
    </div>
  )
}
