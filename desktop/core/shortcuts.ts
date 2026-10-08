import {commandContextsOverlap} from "./shortcut-context"
export type ShortcutScope = "global" | "text" | "markdown" | "composer" | "input"
export interface ShortcutCommand { id: string; label: string; scope: ShortcutScope; locked: boolean; defaults: string[]; contexts?: Record<string, boolean> }
export interface BindingConflict { command: ShortcutCommand; index: number; binding: string }
export function canonicalKey(key: string): string {
  return key.replace(/⌘/g, "Cmd").replace(/⇧/g, "Shift").replace(/Command|Meta/ig, "Cmd").replace(/Control/ig, "Ctrl").replace(/Option/ig, "Alt").replace(/Super/ig, "Win").trim().split(/\s+/).map(chord => {
    const parts = chord.toLowerCase().split("+")
    const plus = parts.indexOf("plus")
    if (plus >= 0) { parts[plus] = "equal"; if (!parts.includes("shift")) parts.push("shift") }
    return parts.sort().join("+")
  }).join(" ")
}
export function validShortcut(key: string): boolean {
  if (key.length > 160) return false
  const chords = key.trim().split(/\s+/)
  return chords.length <= 3 && chords.every(chord => {
    if (!/^(?:(?:Cmd|Ctrl|Alt|Shift|Meta|Command|Control|Option|Win|Super)\+)*(?:[a-z0-9,.;`]|F(?:[1-9]|1[0-9]|2[0-4])|Enter|Escape|Tab|Space|Backspace|Delete|Home|End|Arrow(?:Left|Right|Up|Down)|PageUp|PageDown|Plus|Minus|Slash|Equal|BracketLeft|BracketRight|Backslash|Quote|IntlBackslash|Insert|CapsLock|NumLock|ScrollLock|PrintScreen|Pause|ContextMenu|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma))$/i.test(chord)) return false
    const parts = canonicalKey(chord).split("+")
    return new Set(parts).size === parts.length
  })
}
export function capturedKey(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing" | "repeat" | "keyCode">, platform: "darwin" | "win32" = "darwin"): string | null {
  if (event.isComposing || event.keyCode === 229 || event.repeat || !event.key || ["Control", "Shift", "Alt", "Meta", "AltGraph", "Dead", "Unidentified"].includes(event.key)) return null
  const punctuation: Record<string,string> = { Comma: ",", Period: ".", Semicolon: ";", Backquote: "`", Minus: "Minus", Slash: "Slash", Space: "Space" }
  const code = event.code ?? ""
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit[0-9]$/.test(code) ? code.slice(5) : punctuation[code] ?? (/^(Equal|BracketLeft|BracketRight|Backslash|Quote|IntlBackslash|Numpad.+)$/.test(code) ? code : event.key === " " ? "Space" : event.key === "+" ? "Plus" : event.key)
  const binding = [event.metaKey && (platform === "darwin" ? "Cmd" : "Win"), event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+")
  return validShortcut(binding) ? binding : null
}
export function bindingsFor(command: ShortcutCommand, overrides: Record<string, string[]>) { return overrides[command.id] ?? command.defaults }
export function shortcutConflicts(a: string, b: string) {
  const x = canonicalKey(a), y = canonicalKey(b)
  return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " "))
}
function overlapping(a: ShortcutScope, b: ShortcutScope) { return a === b || a === "global" || b === "global" || a === "text" || b === "text" }
function compatibleContexts(a: ShortcutCommand, b: ShortcutCommand) {
  return commandContextsOverlap(a,b)
}
const reserved = new Set(["Cmd+Tab", "Cmd+Shift+Tab", "Cmd+Space", "Cmd+Alt+Escape", "Ctrl+Space", "Alt+Tab", "Alt+Shift+Tab", "Ctrl+Alt+Delete", "Win+L", "Win+D", "Win+Tab", "Win+Space", "Win+R", "Win+E", "Cmd+Shift+3", "Cmd+Shift+4", "Cmd+Shift+5"].map(canonicalKey))
export function bindingConflicts(commands: ShortcutCommand[], overrides: Record<string, string[]>, id: string, binding: string, index?: number): BindingConflict[] {
  const target = commands.find(command => command.id === id)
  if (!target) throw new Error("命令不存在")
  return commands.flatMap(command => overlapping(command.scope, target.scope) && compatibleContexts(command, target) ? bindingsFor(command, overrides).flatMap((other, at) => command.id === id && at === index || !shortcutConflicts(binding, other) ? [] : [{ command, index: at, binding: other }]) : [])
}
export function editBinding(commands: ShortcutCommand[], overrides: Record<string, string[]>, id: string, binding: string, index?: number, transfer = false): Record<string, string[]> {
  const target = commands.find(command => command.id === id)
  if (!target) throw new Error("命令不存在")
  const lockedBindings = commands.filter(command => command.locked).flatMap(command => command.defaults)
  if (target.locked || binding.trim().split(/\s+/).some(chord => reserved.has(canonicalKey(chord)) || lockedBindings.some(locked => shortcutConflicts(chord, locked)))) throw new Error("系统保留快捷键不可覆盖")
  if (!validShortcut(binding)) throw new Error("请录制有效快捷键")
  const current = bindingsFor(target, overrides)
  if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= current.length)) throw new Error("该快捷键已变化，请重新打开编辑")
  if (index === undefined && current.length >= 12) throw new Error("每个命令最多绑定12个快捷键")
  const conflicts = bindingConflicts(commands, overrides, id, binding, index)
  if (conflicts.some(item => item.command.id === id)) throw new Error("此命令已有重复快捷键")
  if (conflicts.some(item => item.command.locked)) throw new Error("与系统保留快捷键冲突，不能覆盖")
  if (conflicts.length && !transfer) throw new Error("快捷键与其他命令冲突")
  const next = structuredClone(overrides)
  for (const command of commands) {
    const indices = new Set(conflicts.filter(item => item.command.id === command.id).map(item => item.index))
    if (indices.size) next[command.id] = bindingsFor(command, overrides).filter((_, at) => !indices.has(at))
  }
  next[id] = index === undefined ? [...current, binding] : current.map((key, at) => at === index ? binding : key)
  return next
}
