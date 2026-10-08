"use client"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { LockKeyhole, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDesktopStore, updateDesktopSettings } from "@/stores/desktop"
import { bindingConflicts, bindingsFor, capturedKey, editBinding, type BindingConflict, type ShortcutCommand } from "@desktop/core/shortcuts"
import { desktopCommandCatalog, desktopCatalogStatus, subscribeDesktopCommands } from "@/lib/desktop/command-runtime"
interface Draft { id: string; index?: number; original?: string; binding: string }
export function ShortcutSettings() {
  const bootstrap = useDesktopStore(state => state.bootstrap)!
  const platform = bootstrap.platform
  const commands = useSyncExternalStore(subscribeDesktopCommands,()=>desktopCommandCatalog(platform),()=>desktopCommandCatalog(platform))
  const catalogStatus=useSyncExternalStore(subscribeDesktopCommands,()=>desktopCatalogStatus(platform),()=>desktopCatalogStatus(platform))
  const overrides = bootstrap.settings.shortcuts[platform]
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [recording, setRecording] = useState(false)
  const [append, setAppend] = useState(false)
  const [error, setError] = useState("")
  const [conflicts, setConflicts] = useState<BindingConflict[]>([])
  const [restore, setRestore] = useState(false)
  const [saving, setSaving] = useState(false)
  const pendingWrite = useRef(false)
  const search = useRef<HTMLInputElement>(null)
  const restoreButton = useRef<HTMLButtonElement>(null)
  const returnTarget = useRef<{ id: string; index?: number } | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const saveButton = useRef<HTMLButtonElement>(null)
  const selected = commands.find(command => command.id === draft?.id)
  const filtered = commands.filter(command => [command.label, command.id, command.group, command.scope, ...command.defaults, ...bindingsFor(command, overrides)].join(" ").toLowerCase().includes(query.trim().toLowerCase()))
  function recordBinding(event: KeyboardEvent) {
    const binding = capturedKey(event, platform)
    if (!binding) return
    setDraft(before => before ? { ...before, binding: append && before.binding ? before.binding + " " + binding : binding } : null)
    setRecording(false); setAppend(false); setError(""); queueMicrotask(() => saveButton.current?.focus())
  }
  // Capture before dialog dismissal/default button activation, including when focus
  // has moved from the recording field to Save or to the nested conflict dialog.
  useEffect(() => {
    if (!draft) return
    const consumeRepeat = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.keyCode === 229 || event.key === "Dead") {
        event.preventDefault(); event.stopImmediatePropagation()
      } else if (recording && !pendingWrite.current && !conflicts.length) {
        event.preventDefault(); event.stopImmediatePropagation(); recordBinding(event)
      }
    }
    window.addEventListener("keydown", consumeRepeat, true)
    return () => window.removeEventListener("keydown", consumeRepeat, true)
  }, [draft !== null, recording, append, platform, conflicts.length])
  function focusTarget() {
    const target = returnTarget.current
    const row = target && document.getElementById(`shortcut-${target.id}`)
    if (!row) return search.current
    const bindings = row.querySelectorAll<HTMLButtonElement>("[data-edit-binding]")
    return target.index === undefined ? row.querySelector<HTMLButtonElement>("[data-add-binding]") : bindings[Math.min(target.index, bindings.length - 1)] ?? row.querySelector<HTMLButtonElement>("[data-add-binding]")
  }
  const restoreListFocus = () => requestAnimationFrame(() => focusTarget()?.focus())
  const open = (command: ShortcutCommand, index?: number) => {
    if (pendingWrite.current) return
    returnTarget.current = { id: command.id, index }
    const binding = index === undefined ? "" : bindingsFor(command, overrides)[index]
    setDraft({ id: command.id, index, original: index === undefined ? undefined : binding, binding }); setError(""); setConflicts([]); setRecording(true); setAppend(false)
  }
  const close = () => { if (pendingWrite.current) return; setDraft(null); setConflicts([]); setRecording(false) }
  async function save(transfer = false) {
    if (!draft || !selected || pendingWrite.current) return
    setError("")
    try {
      editBinding(commands, overrides, draft.id, draft.binding, draft.index, transfer)
      pendingWrite.current = true
      setSaving(true)
      await updateDesktopSettings(before => {
        const current = before.shortcuts[platform]
        if (draft.index !== undefined && bindingsFor(selected, current)[draft.index] !== draft.original) throw new Error("此快捷键已变化，请重新打开编辑")
        const next = editBinding(commands, current, draft.id, draft.binding, draft.index, transfer)
        return { ...before, shortcuts: { ...before.shortcuts, [platform]: next } }
      })
      setDraft(null); setConflicts([]); setRecording(false)
    } catch (cause) {
      const message = (cause as Error).message
      const found = bindingConflicts(commands, overrides, draft.id, draft.binding, draft.index)
      if (!transfer && found.length && !found.some(row => row.command.locked || row.command.id === draft.id) && !message.includes("系统保留")) setConflicts(found)
      else setError(message)
    } finally { pendingWrite.current = false; setSaving(false) }
  }
  async function remove(command: ShortcutCommand, index: number, original: string) {
    if (pendingWrite.current) return
    pendingWrite.current = true; setSaving(true)
    returnTarget.current = { id: command.id, index }
    try {
      await updateDesktopSettings(before => {
        const bindings = bindingsFor(command, before.shortcuts[platform])
        if (bindings[index] !== original) throw new Error("快捷键已变化，请重新读取后操作")
        return { ...before, shortcuts: { ...before.shortcuts, [platform]: { ...before.shortcuts[platform], [command.id]: bindings.filter((_, at) => at !== index) } } }
      })
      restoreListFocus()
    } catch (cause) { toast.error((cause as Error).message) }
    finally { pendingWrite.current = false; setSaving(false) }
  }
  const resumeRecording = (continuous: boolean) => { if (pendingWrite.current) return; setAppend(continuous); setRecording(true); queueMicrotask(() => field.current?.focus()) }
  const jump = (id: string) => { if (pendingWrite.current) return; returnTarget.current = { id }; setQuery(id); close() }
  return <>
    {catalogStatus!=="ready"&&<p role="status" className="mb-3 text-sm text-muted-foreground">{catalogStatus==="loading"?"正在读取正文编辑器命令…":"正文编辑器命令目录暂不可用，请重新打开应用。当前列表不包含完整的编辑器命令。"}</p>}
    <div className="desktop-shortcut-search">
      <Input ref={search} aria-label="快捷键搜索" placeholder="搜索命令、快捷键或作用域" value={query} onChange={event => setQuery(event.target.value)} />
      <Button ref={restoreButton} variant="outline" disabled={saving} onClick={() => setRestore(true)}>恢复默认</Button>
    </div>
    <div className="desktop-shortcut-list">{filtered.map(command => <div className="desktop-shortcut-row" key={command.id} tabIndex={-1} id={`shortcut-${command.id}`}>
      <div className="min-w-0"><strong>{command.label}</strong><small>{command.group} · {command.id}</small></div>
      <div className="desktop-shortcut-bindings">{bindingsFor(command, overrides).map((binding,index) => <span className="desktop-key-binding" key={binding}>
        <button data-edit-binding disabled={command.locked || saving} aria-label={`编辑 ${command.label} 的 ${binding}`} onClick={() => open(command,index)}><kbd>{binding}</kbd>{!command.locked && <Pencil size={11} />}</button>
        {!command.locked && <button disabled={saving} aria-label={`删除 ${command.label} 的 ${binding}`} onClick={() => { void remove(command,index,binding) }}><Trash2 size={12} /></button>}
      </span>)}
      {!bindingsFor(command,overrides).length && <span className="text-xs text-muted-foreground">未设置</span>}
      {command.locked ? <LockKeyhole size={14} aria-label="系统保留" /> : <Button data-add-binding variant="ghost" size="icon" disabled={saving} aria-label={`添加 ${command.label} 的快捷键`} onClick={() => open(command)}><Plus size={14} /></Button>}
      </div>
    </div>)}{!filtered.length && <p className="py-8 text-center text-muted-foreground">没有匹配的命令</p>}</div>
    <Dialog open={draft !== null} onOpenChange={value => { if (!value) close() }}>
      <DialogContent data-desktop-settings-surface className="desktop-shortcut-editor" initialFocus={field} finalFocus={focusTarget} showCloseButton={!saving}>
        <DialogTitle>{draft?.index === undefined ? '添加快捷键' : '编辑快捷键'}</DialogTitle><DialogDescription>{selected?.label}</DialogDescription>
        <Input ref={field} aria-label="录制快捷键" readOnly disabled={saving} value={draft?.binding ?? ""} placeholder="请按下按键或组合键" onClick={() => { if (!pendingWrite.current) setRecording(true) }} data-desktop-recording={recording ? "true" : undefined} onKeyDownCapture={event => {
          if (pendingWrite.current || !recording) return
          event.preventDefault(); event.stopPropagation()
          recordBinding(event.nativeEvent)
        }} />
        <div className="flex gap-2">
          <Button variant="outline" disabled={saving} onClick={() => resumeRecording(false)}>重新录制</Button>
          <Button variant="outline" disabled={saving || !draft?.binding || draft.binding.split(' ').length >= 3} onClick={() => resumeRecording(true)}>追加连续组合</Button>
        </div>
        {error && !conflicts.length && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={close}>取消</Button><Button ref={saveButton} disabled={!draft?.binding || saving} onClick={() => { void save() }}>保存</Button></div>
        <Dialog open={conflicts.length > 0} onOpenChange={value => { if (!value && !pendingWrite.current) setConflicts([]) }}>
          <DialogContent data-desktop-settings-surface className="desktop-shortcut-conflict" showCloseButton={!saving} finalFocus={() => draft ? saveButton.current : focusTarget()}>
            <DialogTitle>快捷键冲突</DialogTitle><DialogDescription>此组合已被以下命令占用。</DialogDescription>
            <ul>{conflicts.map(conflict => <li key={conflict.command.id + ':' + conflict.index}>{conflict.command.label} · <kbd>{conflict.binding}</kbd></li>)}</ul>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-col gap-2">
              <Button variant="outline" disabled={saving} onClick={() => { if (!pendingWrite.current) setConflicts([]) }}>取消</Button>
              <Button className="h-auto min-h-9 whitespace-normal break-words" disabled={saving} onClick={() => { void save(true) }}>删除 {Array.from(new Set(conflicts.map(row => row.command.label))).join('、')} 命令的按键绑定再保存</Button>
              {Array.from(new Map(conflicts.map(row => [row.command.id,row.command])).values()).map(command => <Button className="h-auto min-h-9 whitespace-normal break-words" variant="outline" disabled={saving} key={command.id} onClick={() => jump(command.id)}>跳转到 {command.label} 命令查看</Button>)}
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
    <Dialog open={restore} onOpenChange={value => { if (!pendingWrite.current) setRestore(value) }}>
      <DialogContent data-desktop-settings-surface finalFocus={restoreButton} showCloseButton={!saving}><DialogTitle>恢复默认快捷键</DialogTitle><DialogDescription>将清除当前操作系统的全部自定义绑定。</DialogDescription>
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => setRestore(false)}>取消</Button>
          <Button disabled={saving} onClick={async () => {
            if (pendingWrite.current) return
            pendingWrite.current = true; setSaving(true)
            try { await updateDesktopSettings(before => ({ ...before, shortcuts: { ...before.shortcuts, [platform]: {} } })); setRestore(false) }
            catch (cause) { toast.error((cause as Error).message) }
            finally { pendingWrite.current = false; setSaving(false) }
          }}>恢复默认</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>
}
