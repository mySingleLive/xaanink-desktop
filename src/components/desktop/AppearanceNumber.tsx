"use client"
import { useEffect, useId, useRef, useState } from "react"
import { Input } from "@/components/ui/input"

export function AppearanceNumber({ label, value, min, max, step = 1, onValue }: { label: string; value: number; min: number; max: number; step?: number; onValue(value: number): Promise<unknown> }) {
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState("")
  const dirty = useRef(false), edit = useRef(0)
  const errorId = useId()
  const valid = (text: string) => text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max && (step !== 1 || Number.isInteger(Number(text)))
  useEffect(() => { if (!dirty.current) setDraft(String(value)) }, [value])
  return <div className="flex flex-col items-end gap-1">
    <Input aria-label={label} type="number" value={draft} min={min} max={max} step={step} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
      onBlur={() => { if (!valid(draft)) setError(`请输入 ${min}–${max} ${step === 1 ? '之间的整数' : '之间的数值'}`) }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); edit.current++; dirty.current = false; setDraft(String(value)); setError("") } }}
      onChange={event => {
        const text = event.target.value, revision = ++edit.current
        setDraft(text); setError(""); dirty.current = true
        if (!valid(text)) return
        void onValue(Number(text)).then(() => { if (revision === edit.current) dirty.current = false }, cause => { if (revision === edit.current) setError(cause instanceof Error ? cause.message : "保存失败，请重新输入重试") })
      }} />
    {error && <span id={errorId} role="alert" className="text-xs text-destructive">{error}</span>}
  </div>
}
