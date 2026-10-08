"use client"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Combobox } from "@base-ui/react/combobox"
import { Check, ChevronDown } from "lucide-react"
import { ProviderLogo } from "@/components/chat/provider-logos"
export interface ModelChoiceOption { id: string; label: string; provider?: string; hint?: string; disabled?: boolean; disabledLabel?: string }
export function ModelChoiceSelect({ label, value, options, onChange, onOpen, disabled, provider = false, placeholder = "请选择" }: { label: string; value: string | null; options: ModelChoiceOption[]; onChange(value: string): void; onOpen?(): void; disabled?: boolean; provider?: boolean; placeholder?: string }) {
  const selected = options.find(option => option.id === value) ?? null
  const [open,setOpen] = useState(false)
  const highlighted = useRef<ModelChoiceOption | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const dismissMenu = (event: KeyboardEvent) => {
    if (!open || event.key !== "Escape" || event.nativeEvent.isComposing) return
    event.preventDefault(); event.stopPropagation()
    highlighted.current = null; setOpen(false); trigger.current?.focus()
  }
  useEffect(() => { if (disabled) { setOpen(false); highlighted.current = null } },[disabled])
  return <Combobox.Root<ModelChoiceOption> items={options} value={selected} open={open && !disabled} disabled={disabled} multiple={false} onOpenChange={value => { setOpen(value); highlighted.current = null; if (value && !disabled) onOpen?.() }} onItemHighlighted={(option,details) => { highlighted.current = details.reason === "keyboard" && option ? option : null }} onInputValueChange={() => { highlighted.current = null }} isItemEqualToValue={(a,b) => a.id === b.id} itemToStringLabel={option => option.label} filter={(option,query) => `${option.label} ${option.id} ${option.hint ?? ""}`.toLowerCase().includes(query.toLowerCase())} onValueChange={option => { if (option && !option.disabled) onChange(option.id) }}>
    <Combobox.Trigger ref={trigger} className="desktop-choice-trigger" aria-label={label} onKeyDownCapture={dismissMenu}>
      {selected?.provider && <ProviderLogo provider={selected.provider} variant={provider ? "provider" : "model"} className="size-5" />}
      <span className="min-w-0 flex-1 truncate text-left">{selected?.label ?? placeholder}{selected?.disabled && `（${selected.disabledLabel ?? "不可用"}）`}</span><ChevronDown size={15} />
    </Combobox.Trigger>
    <Combobox.Portal><Combobox.Positioner sideOffset={5} align="start" className="z-50"><Combobox.Popup data-desktop-settings-surface className="desktop-choice-popup" onKeyDownCapture={dismissMenu}>
      <Combobox.Input aria-label={`搜索${label}`} placeholder={`搜索${label}…`} className="desktop-choice-search" onKeyDown={event => { if (event.key === " " && !event.nativeEvent.isComposing && highlighted.current && !highlighted.current.disabled) { event.preventDefault(); onChange(highlighted.current.id); highlighted.current = null; setOpen(false) } }} />
      <Combobox.Empty className="p-4 text-sm text-muted-foreground">没有匹配项</Combobox.Empty>
      <Combobox.List aria-label={label} className="desktop-choice-list">{(option: ModelChoiceOption) => <Combobox.Item key={option.id} value={option} disabled={option.disabled} className="desktop-choice-item">
        {option.provider && <ProviderLogo provider={option.provider} variant={provider ? "provider" : "model"} className="size-5" />}
        <span className="min-w-0 flex-1"><span className="block truncate">{option.label}</span>{option.hint && <small className="block truncate text-muted-foreground">{option.hint}</small>}</span>
        {option.disabled && <small>{option.disabledLabel ?? "不可用"}</small>}<Combobox.ItemIndicator><Check size={14} /></Combobox.ItemIndicator>
      </Combobox.Item>}</Combobox.List>
    </Combobox.Popup></Combobox.Positioner></Combobox.Portal>
  </Combobox.Root>
}
