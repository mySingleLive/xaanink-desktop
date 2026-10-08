"use client"
import type { CommandTarget } from "./command-targets"
import { registerDesktopCommandTarget } from "./command-runtime"
import catalog from "@desktop/shared/commands.json"
export type InputControl = HTMLInputElement | HTMLTextAreaElement
export type NativeInputEdit = "text.copy" | "text.cut" | "text.paste" | "text.pastePlain" | "text.undo" | "text.redo"
export interface InputActions { confirm?(): void | Promise<void>; cancel?(): void | Promise<void> }
export interface InputCommandOptions {
  document: Document
  registerTarget?: (target: CommandTarget<HTMLElement | null>) => () => void
  nativeEdit?: (id: NativeInputEdit, control: InputControl) => void | Promise<void>
  acceptControl?: (control: InputControl) => boolean
  actions?: (control: InputControl) => InputActions | undefined
}
// Find widgets and comment ViewZones are ordinary controls even inside an
// editor container. Only the actual editor text surfaces own those commands.
const excluded = ".inputarea,.native-edit-context,.ime-text-area,.chat-composer-editable,[data-desktop-recording]"
const menus = '[role="menu"], [data-desktop-menu-button]'
const inputTypes = new Set(["text", "search", "tel", "url", "password"])
const mutation = new Set(["text.undo", "text.redo", "text.cut", "text.paste", "text.pastePlain", "input.deletePrevious", "input.deleteNext", "input.deleteWordLeft", "input.deleteWordRight", "input.confirm", "input.cancel"])
const nativeEdits: Record<NativeInputEdit, string | null> = { "text.undo": "undo", "text.redo": "redo", "text.copy": "copy", "text.cut": "cut", "text.paste": "paste", "text.pastePlain": null }
const navigation = new Set(["input.left", "input.right", "input.up", "input.down", "input.wordLeft", "input.wordRight", "input.home", "input.end", "input.documentStart", "input.documentEnd", "input.selectLeft", "input.selectRight", "input.selectWordLeft", "input.selectWordRight", "input.selectHome", "input.selectEnd"])

function isControl(target: HTMLElement | null, document: Document): target is InputControl {
  if (!target || target.ownerDocument !== document || !target.isConnected || target.closest(excluded)) return false
  if (target.tagName !== "TEXTAREA" && (target.tagName !== "INPUT" || !inputTypes.has((target as HTMLInputElement).type))) return false
  const control = target as InputControl
  return !control.disabled && !control.matches(":disabled") && typeof control.selectionStart === "number" && typeof control.selectionEnd === "number"
}
function boundaries(value: string, granularity: "grapheme" | "word") {
  return [...new Intl.Segmenter(undefined, { granularity }).segment(value)]
}
function graphemes(value: string) { return [0, ...boundaries(value, "grapheme").map(part => part.index + part.segment.length)] }
function step(value: string, position: number, direction: -1 | 1, word = false) {
  if (word) {
    const words = boundaries(value, "word").filter(part => part.isWordLike)
    if (direction < 0) return words.filter(part => part.index < position).at(-1)?.index ?? 0
    const next = words.find(part => part.index + part.segment.length > position)
    return next ? next.index + next.segment.length : value.length
  }
  const points = graphemes(value)
  return direction < 0 ? points.filter(point => point < position).at(-1) ?? 0 : points.find(point => point > position) ?? value.length
}
function head(control: InputControl) { return control.selectionDirection === "backward" ? control.selectionStart! : control.selectionEnd! }
function anchor(control: InputControl) { return control.selectionDirection === "backward" ? control.selectionEnd! : control.selectionStart! }
function setCaret(control: InputControl, position: number, extend = false) {
  const fixed = extend ? anchor(control) : position
  control.setSelectionRange(Math.min(fixed, position), Math.max(fixed, position), position < fixed ? "backward" : "forward")
}
function line(value: string, position: number) {
  const start = position === 0 ? 0 : value.lastIndexOf("\n", position - 1) + 1
  const next = value.indexOf("\n", position)
  return { start, end: next < 0 ? value.length : next }
}

/** Installed Chromium native history/clipboard still needs real acceptance.
 * This adapter never listens to keydown, replays keys or assigns input.value. */
export function installInputCommands(options: InputCommandOptions): () => void {
  const document = options.document
  let alive = true, accepted: InputControl | null = null
  const composing = new Set<HTMLElement>()
  const vertical = new WeakMap<InputControl, { value: string; position: number; column: number }>()
  const focusAllowed = (control: InputControl) => document.activeElement === control || !!document.activeElement?.closest(menus)
  const eligible = (target: HTMLElement | null): target is InputControl => alive && isControl(target, document) && options.acceptControl?.(target) !== false && focusAllowed(target)
  const compositionActive = () => {
    for (const target of composing) if (!target.isConnected) composing.delete(target)
    return composing.size > 0
  }
  const onStart = (event: Event) => { const target = event.target as HTMLElement | null; if (target?.isConnected) composing.add(target) }
  const onEnd = (event: Event) => { composing.delete(event.target as HTMLElement) }
  document.addEventListener("compositionstart", onStart, true)
  document.addEventListener("compositionend", onEnd, true)
  document.addEventListener("focusout", onEnd, true)

  const enabled = (id: string) => {
    const control = accepted
    if (!control || !eligible(control) || compositionActive()) return false
    if (mutation.has(id) && control.readOnly) return false
    if ((id === "text.copy" || id === "text.cut") && ((control.tagName === "INPUT" && control.type === "password") || control.selectionStart === control.selectionEnd)) return false
    if (id === "input.confirm" || id === "input.cancel") return !!options.actions?.(control)?.[id === "input.confirm" ? "confirm" : "cancel"]
    if (id in nativeEdits) return !!options.nativeEdit || !!nativeEdits[id as NativeInputEdit] && document.queryCommandSupported?.(nativeEdits[id as NativeInputEdit]!) === true
    if (navigation.has(id) || id.startsWith("input.delete")) {
      if (typeof Intl.Segmenter !== "function") return false
      if (id.startsWith("input.delete") && document.queryCommandSupported?.("delete") !== true) return false
    }
    return true
  }
  const native = (control: InputControl, command: string) => {
    if (!document.execCommand(command, false)) throw new Error("当前 Chromium 不支持该原生输入操作")
  }
  const move = (control: InputControl, id: string) => {
    const value = control.value, position = head(control)
    const extend = id.startsWith("input.select")
    const direction: -1 | 1 = id.endsWith("Left") || ["input.left", "input.up", "input.home", "input.documentStart", "input.selectHome"].includes(id) ? -1 : 1
    let destination: number
    if (id === "input.up" || id === "input.down") {
      if (control.tagName === "INPUT") { setCaret(control, direction < 0 ? 0 : value.length); vertical.delete(control); return }
      const current = line(value, position)
      const prior = vertical.get(control)
      const points = graphemes(value.slice(current.start, current.end))
      const column = prior?.value === value && prior.position === position ? prior.column : points.filter(point => point < position - current.start).length
      const target = direction < 0 ? current.start === 0 ? current : line(value, current.start - 1) : current.end === value.length ? current : line(value, current.end + 1)
      const targetPoints = graphemes(value.slice(target.start, target.end))
      destination = target.start + targetPoints[Math.min(column, targetPoints.length - 1)]
      setCaret(control, destination)
      vertical.set(control, { value, position: destination, column })
      return
    }
    vertical.delete(control)
    if (id === "input.documentStart" || id === "input.documentEnd") destination = direction < 0 ? 0 : value.length
    else if (["input.home", "input.end", "input.selectHome", "input.selectEnd"].includes(id)) { const current = line(value, position); destination = direction < 0 ? current.start : current.end }
    else if (!extend && !id.includes("word") && control.selectionStart !== control.selectionEnd) destination = direction < 0 ? control.selectionStart! : control.selectionEnd!
    else destination = step(value, position, direction, /[Ww]ord/.test(id))
    setCaret(control, destination, extend)
  }
  const remove = (control: InputControl, id: string) => {
    const before = { value: control.value, start: control.selectionStart!, end: control.selectionEnd!, direction: control.selectionDirection }
    let start = before.start, end = before.end
    if (start === end) {
      const destination = step(before.value, start, id.endsWith("Left") || id === "input.deletePrevious" ? -1 : 1, id.includes("Word"))
      start = Math.min(start, destination); end = Math.max(end, destination)
    }
    // Round an externally supplied mid-cluster selection outwards. Never
    // split a surrogate pair, combining sequence or ZWJ emoji on deletion.
    const points = graphemes(before.value)
    start = points.filter(point => point <= start).at(-1) ?? 0
    end = points.find(point => point >= end) ?? before.value.length
    if (start === end) return
    control.setSelectionRange(start, end, "forward")
    try { native(control, "delete") }
    catch (error) { if (control.value === before.value) control.setSelectionRange(before.start, before.end, before.direction ?? "none"); throw error }
    vertical.delete(control)
  }
  const run = async (id: string) => {
    const control = accepted
    if (!control || !enabled(id)) throw new Error("输入控件已失去命令所有权")
    control.focus()
    if (!alive || accepted !== control || !eligible(control) || document.activeElement !== control || !enabled(id)) throw new Error("输入控件已失去命令所有权")
    if (id in nativeEdits) { if (options.nativeEdit) await options.nativeEdit(id as NativeInputEdit, control); else native(control, nativeEdits[id as NativeInputEdit]!); return }
    if (id === "text.selectAll") { control.setSelectionRange(0, control.value.length, "forward"); vertical.delete(control); return }
    if (id === "input.confirm" || id === "input.cancel") { await options.actions?.(control)?.[id === "input.confirm" ? "confirm" : "cancel"]?.(); return }
    if (id.startsWith("input.delete")) remove(control, id)
    else move(control, id)
  }
  const commands = Object.fromEntries(catalog.commands.filter(command => command.id.startsWith("input.") || command.id.startsWith("text.")).map(({ id }) => [id, { enabled: () => enabled(id), run: () => run(id) }]))
  const unregister = (options.registerTarget ?? registerDesktopCommandTarget)({ owner: {}, accepts: target => { accepted = eligible(target) ? target : null; return accepted !== null }, commands })
  return () => {
    if (!alive) return
    alive = false; accepted = null; composing.clear(); unregister()
    document.removeEventListener("compositionstart", onStart, true)
    document.removeEventListener("compositionend", onEnd, true)
    document.removeEventListener("focusout", onEnd, true)
  }
}
