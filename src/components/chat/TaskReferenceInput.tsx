"use client"
import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, X } from "lucide-react"
import type { NavigationEntity } from "@/lib/story-task"

/** Searchable multi-value input. The popup floats outside the scrolling decision panel. */
export function TaskReferenceInput({ label, options, value, onChange }: { label: string; options: NavigationEntity[]; value: string[]; onChange: (keys: string[]) => void }) {
  const id = useId(), root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState(""), [open, setOpen] = useState(false), [active, setActive] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 })
  const filtered = options.filter(o => o.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const place = () => {
    const box = root.current?.getBoundingClientRect()
    if (box) setPosition({ left: box.left, width: box.width, top: window.innerHeight - box.bottom < 205 ? Math.max(8, box.top - 205) : box.bottom + 4 })
  }
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener("pointerdown", close); window.addEventListener("resize", place); window.addEventListener("scroll", place, true)
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true) }
  }, [open])
  const toggle = (key: string) => { onChange(value.includes(key) ? value.filter(k => k !== key) : [...value, key]); input.current?.focus() }
  return <div className="space-y-2">
    <label htmlFor={id} className="text-xs font-medium">{label} <span className="text-muted-foreground">可多选</span></label>
    <div ref={root} className="flex min-h-10 cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input bg-editor p-2 focus-within:border-ring" onClick={() => input.current?.focus()}>
      {value.map(key => <button key={key} type="button" aria-label={`移除${options.find(o => o.key === key)?.title ?? "失效引用"}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs break-words" onClick={event => { event.stopPropagation(); toggle(key) }}>{options.find(o => o.key === key)?.title ?? "引用已失效，请移除"}<X className="size-3 shrink-0" /></button>)}
      <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && filtered[active] ? `${id}-option-${active}` : undefined} value={query} placeholder="搜索或选择…" className="min-w-20 flex-1 bg-transparent text-xs outline-none" onFocus={() => { place(); setOpen(true) }} onBlur={event => { if (!popup.current?.contains(event.relatedTarget)) setOpen(false) }} onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true) }} onKeyDown={event => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); place(); setOpen(true); setActive(i => Math.max(0, Math.min(filtered.length - 1, i + (event.key === "ArrowDown" ? 1 : -1)))) }
        if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (open && filtered[active] && !event.nativeEvent.isComposing) toggle(filtered[active].key) }
      }} />
    </div>
    {open && createPortal(<div ref={popup} style={position} className="fixed z-[100] max-h-[200px] overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md" role="listbox" id={`${id}-list`} aria-label={`${label}候选`} aria-multiselectable="true" onMouseDown={event => event.preventDefault()}>
      {filtered.map((option, index) => <div key={option.key} id={`${id}-option-${index}`} role="option" aria-selected={value.includes(option.key)} className={`flex cursor-pointer items-center gap-2 rounded p-2 text-xs ${index === active ? "bg-accent" : "hover:bg-accent"}`} onMouseMove={() => setActive(index)} onClick={() => toggle(option.key)}><span className="flex size-4 shrink-0 items-center justify-center rounded border">{value.includes(option.key) && <Check className="size-3" />}</span>{option.title}</div>)}
      {!filtered.length && <p className="p-2 text-xs text-muted-foreground">没有匹配内容</p>}
    </div>, document.body)}
  </div>
}
