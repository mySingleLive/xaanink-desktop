import { isAPIKeyControl, type InputControl, type NativeInputEdit } from "./input-commands"
import { selectedEditorText, deleteDraftSelection } from "@/components/chat/composer-editor"

export type TextEditControl = InputControl | HTMLElement
const isInput = (control: TextEditControl): control is InputControl => "selectionStart" in control && "value" in control
const isComposer = (control: TextEditControl) => !isInput(control) && control.closest?.(".chat-composer-editable") === control
interface ComposerPaste { text: string; handled: boolean; failed: boolean; error?: unknown }
const pendingPastes = new WeakMap<Event, ComposerPaste>()

/** Only our validated request can use this synchronous acknowledgment. A normal
 * browser paste continues through the original handler's plain-text path. */
export function consumeDesktopComposerPaste(event: Event, consume: (text: string) => void): boolean {
  const request = pendingPastes.get(event)
  if (!request) return false
  event.preventDefault()
  if (!request.handled) {
    request.handled = true
    try { consume(request.text) } catch (error) { request.failed = true; request.error = error }
  }
  return true
}

function pasteComposer(document: Document, control: HTMLElement, text: string) {
  const view = document.defaultView
  if (!view?.ClipboardEvent || !view.DataTransfer) throw new Error("消息输入框无法处理粘贴，请重试")
  const data = new view.DataTransfer()
  data.setData("text/plain", text)
  const event = new view.ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data })
  const request: ComposerPaste = { text, handled: false, failed: false }
  pendingPastes.set(event, request)
  try {
    control.dispatchEvent(event)
    if (!request.handled) throw new Error("消息输入框尚未就绪，未粘贴内容")
    if (request.failed) throw request.error instanceof Error ? request.error : new Error("消息输入框无法粘贴，请重试")
  } finally { pendingPastes.delete(event) }
}

export function nativeTextEdits(document: Document, readText: () => Promise<string>) {
  let alive = true, epoch = 0, operation = 0
  const monitors = new Set<() => void>()
  const changed = () => { epoch++ }
  const events = ["focusin", "pointerdown", "keydown", "input", "compositionstart"]
  for (const event of events) document.addEventListener(event, changed, true)
  document.defaultView?.addEventListener("blur", changed)
  const available = (control: TextEditControl, id: NativeInputEdit) => alive && document.hasFocus?.() !== false && control.ownerDocument === document && control.isConnected && document.activeElement === control && (isInput(control) ? !control.disabled && !control.matches(":disabled") && (id === "text.copy" || !control.readOnly) && (!(["text.copy","text.cut"].includes(id) && control.tagName === "INPUT" && control.type === "password") || isAPIKeyControl(control)) : control.isContentEditable)
  const snapshot = (control: TextEditControl) => {
    if (isInput(control)) {
      const before = JSON.stringify([control.value, control.selectionStart, control.selectionEnd, control.selectionDirection])
      return () => before === JSON.stringify([control.value, control.selectionStart, control.selectionEnd, control.selectionDirection])
    }
    const html = control.innerHTML, selection = document.getSelection()
    if (!selection?.anchorNode || !selection.focusNode || !control.contains(selection.anchorNode) || !control.contains(selection.focusNode)) throw new Error("输入目标选区已变化")
    const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
    return () => { const current = document.getSelection(); return control.innerHTML === html && current?.anchorNode === anchorNode && current.anchorOffset === anchorOffset && current.focusNode === focusNode && current.focusOffset === focusOffset }
  }
  const monitor = (control: TextEditControl) => {
    const matches = snapshot(control)
    let dirty = false
    const observer = !isInput(control) && document.defaultView?.MutationObserver
      ? new document.defaultView.MutationObserver(() => { dirty = true }) : null
    // All attributes of this editing host can affect its serialized draft or
    // selection identity (notably a chip's data-insert). Observe only this
    // control's subtree so an attribute A→B→A cannot revive a pending edit.
    observer?.observe(control, { subtree: true, childList: true, characterData: true, attributes: true })
    const stop = () => { dirty = true; observer?.disconnect(); monitors.delete(stop) }
    monitors.add(stop)
    return { matches: () => { if (observer?.takeRecords().length) dirty = true; return !dirty && matches() }, stop }
  }
  return {
    async run(id: NativeInputEdit, control: TextEditControl) {
      if (!available(control, id)) throw new Error("输入目标已变化，请重新执行")
      const ticket = ++operation
      for (const stop of monitors) stop()
      if (id === "text.paste" || id === "text.pastePlain" || (isComposer(control) || isAPIKeyControl(control)) && (id === "text.copy" || id === "text.cut")) {
        const before = monitor(control), revision = epoch
        const assertCurrent = () => {
          if (!available(control, id) || ticket !== operation || epoch !== revision || !before.matches()) throw new Error("输入目标已变化，未应用迟到剪贴板内容")
        }
        try {
          if (id === "text.copy" || id === "text.cut") {
            const text = isInput(control) ? control.value.slice(control.selectionStart!,control.selectionEnd!) : selectedEditorText(control)
            if (!text || text.length > 1024 * 1024) throw new Error("选区不可复制或内容过长")
            const bridge = document.defaultView?.desktop
            if (!bridge) throw new Error("本地剪贴板尚未就绪")
            try { await bridge.writeClipboardText(text) } catch { throw new Error("无法写入本地剪贴板，请重试") }
            assertCurrent()
            if (id === "text.cut") {
              if (isInput(control)) { if (!document.execCommand("delete",false)) throw new Error("当前输入框无法剪切") }
              else deleteDraftSelection(control)
            }
          } else {
            let text: string
            try { text = await readText() } catch { throw new Error("无法读取本地剪贴板，请重试") }
            assertCurrent()
            if (typeof text !== "string" || text.length > 1024 * 1024) throw new Error("剪贴板内容过长")
            if (text) {
              if (isComposer(control)) pasteComposer(document, control, text)
              else if (!document.execCommand("insertText", false, text)) throw new Error("当前输入框无法粘贴")
            }
          }
        } finally { before.stop() }
      } else {
        const command = { "text.copy": "copy", "text.cut": "cut", "text.undo": "undo", "text.redo": "redo" }[id]
        if (!document.execCommand(command, false)) throw new Error("当前输入框无法执行此操作")
      }
    },
    dispose() { if (!alive) return; alive = false; epoch++; operation++; for (const stop of monitors) stop(); for (const event of events) document.removeEventListener(event, changed, true); document.defaultView?.removeEventListener("blur", changed) },
  }
}
