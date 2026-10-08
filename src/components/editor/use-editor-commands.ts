"use client"

import { useEffect, useImperativeHandle, useRef, useMemo, type Ref, type RefObject } from "react"
import { readPreviewSelection, selectPreviewBody, samePreviewRange, type PreviewRangeIdentity } from "./preview-selection"
import { useTabsStore } from "@/stores/tabs"
import type { editor } from "monaco-editor"

export type EditorCommand = "selectAll" | "copy" | "cut" | "paste" | "pastePlain"
export type EditorSelectionState = { hasSelection: boolean; canReplace: boolean }
export interface MarkdownEditorHandle {
  captureSelection(): EditorSelectionState
  executeCommand(command: EditorCommand): Promise<void>
}

type Selection = { source: string; start: number; end: number; text: string; canReplace: boolean; range?: PreviewRangeIdentity; all?: boolean; model: editor.ITextModel | null }
type Monaco = editor.IStandaloneCodeEditor

/** Keep all mutations in Monaco's undo stack and its existing onChange/autosave path. */
export function useEditorCommands({ ref, value, readOnly, mode, setMode, editorRef, previewRef, rootRef, editingMode = "edit" }: {
  ref?: Ref<MarkdownEditorHandle>
  value: string
  readOnly?: boolean
  mode: string
  setMode: (mode: "edit" | "split") => void
  editingMode?: "edit" | "split" | null
  editorRef: RefObject<Monaco | null>
  previewRef: RefObject<HTMLDivElement | null>
  rootRef: RefObject<HTMLDivElement | null>
}) {
  const snapshot = useRef<Selection | null>(null)
  const latest = useRef({ value, readOnly, mode, editingMode })
  const alive = useRef(true)
  const request = useRef(0)
  const epoch = useRef(0)
  const pending = useRef<{ run: (instance: Monaco) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; mode: "edit" | "split" } | null>(null)
  const invalidate = () => {
    epoch.current++; request.current++
    const operation = pending.current; pending.current = null
    if (operation) { clearTimeout(operation.timer); operation.reject(new Error("正文视图已变化，请重新操作")) }
  }
  const ownMode = !!pending.current && pending.current.mode === mode && latest.current.value === value && latest.current.readOnly === readOnly
  if (latest.current.value !== value || latest.current.readOnly !== readOnly || latest.current.editingMode !== editingMode || latest.current.mode !== mode && !ownMode) invalidate()
  latest.current = { value, readOnly, mode, editingMode }
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      invalidate()
    }
  }, [])

  useEffect(() => {
    const document = rootRef.current?.ownerDocument
    if (!document) return
    const change = (event: Event) => {
      const target = event.target as Element | null
      if (target?.nodeType === Node.ELEMENT_NODE && target.closest('[role="menu"],[data-desktop-menu-button]')) return
      invalidate()
    }
    document.addEventListener("focusin", change, true); document.addEventListener("pointerdown", change, true)
    const view = document.defaultView
    view?.addEventListener("blur", invalidate)
    const release = useTabsStore.subscribe((state, previous) => { if (state.activeTabId !== previous.activeTabId || state.activationNonce !== previous.activationNonce) invalidate() })
    return () => { document.removeEventListener("focusin", change, true); document.removeEventListener("pointerdown", change, true); view?.removeEventListener("blur", invalidate); release() }
  }, [rootRef])

  const handle = useMemo<MarkdownEditorHandle>(() => ({
    captureSelection() {
      const instance = editorRef.current
      const model = instance?.getModel()
      const range = instance?.getSelection()
      const previous = snapshot.current
      const preview = previewRef.current && readPreviewSelection(previewRef.current, value)
      if (preview && !instance?.hasTextFocus()) snapshot.current = previous?.all && previous.source === value && previous.range && samePreviewRange(previous.range, previewRef.current!) ? previous : { ...preview, model: model ?? null }
      else if ((mode === "edit" || mode === "split") && model && range) {
        snapshot.current = { source: model.getValue(), start: model.getOffsetAt(range.getStartPosition()),
          end: model.getOffsetAt(range.getEndPosition()), text: model.getValueInRange(range), canReplace: true, model }
      } else {
        snapshot.current = { source: value, start: value.length, end: value.length, text: "", canReplace: mode === "edit" || mode === "split", model: model ?? null }
      }
      return { hasSelection: !!snapshot.current.text, canReplace: snapshot.current.canReplace && !readOnly && editingMode !== null }
    },
    async executeCommand(command) {
      if (command === "selectAll" && (mode === "preview" || mode === "review")) {
        if (!alive.current || !previewRef.current?.getClientRects().length) throw new Error("正文预览不可用")
        previewRef.current.focus({ preventScroll: true })
        const selected = selectPreviewBody(previewRef.current, value)
        if (!selected) throw new Error("正文预览尚未就绪")
        snapshot.current = { ...selected, all: true, model: editorRef.current?.getModel() ?? null }
        return
      }
      const selection: Selection | null = command === "selectAll"
        ? { source: value, start: 0, end: value.length, text: value, canReplace: true, model: editorRef.current?.getModel() ?? null }
        : snapshot.current
      if (!selection) throw new Error("请重新打开正文菜单后操作")
      if ((command === "copy" || command === "cut") && !selection.text) throw new Error("请先选中正文文字")
      const changesText = command === "cut" || command === "paste" || command === "pastePlain"
      const ticket = ++request.current, capturedEpoch = epoch.current
      const assertCurrent = (mounted?: Monaco) => {
        const model = editorRef.current?.getModel() ?? null
        if (!alive.current || ticket !== request.current || epoch.current !== capturedEpoch || !rootRef.current?.isConnected || !rootRef.current?.getClientRects().length) throw new Error("正文视图已切换，请重新操作")
        const document = rootRef.current.ownerDocument, active = document.activeElement
        if (!document.hasFocus() || active && active !== document.body && !rootRef.current.contains(active) && !active.closest('[role="menu"],[data-desktop-menu-button]')) throw new Error("正文已失去焦点，请重新操作")
        if (latest.current.value !== selection.source || (model && model.getValue() !== selection.source)) throw new Error("正文已变化，请重新选择后操作")
        const ownNewEditor = !!mounted && !selection.model && mounted.getModel() === model
        if (model !== selection.model && !ownNewEditor) throw new Error("正文模型已切换，请重新选择")
        if (selection.range && !ownNewEditor && (!previewRef.current || !samePreviewRange(selection.range, previewRef.current))) throw new Error("正文选区已变化，请重新选择")
        if (changesText && (latest.current.readOnly || editorRef.current?.getRawOptions().readOnly || latest.current.editingMode === null || !selection.canReplace)) throw new Error("当前选区无法编辑，请切到编辑视图后重试")
      }
      assertCurrent()
      let replacement: string | undefined
      if (command === "copy" || command === "cut") {
        try { if (window.desktop) await window.desktop.writeClipboardText(selection.text); else await navigator.clipboard.writeText(selection.text) }
        catch { throw new Error(window.desktop ? "无法写入本地剪贴板，请重试" : "无法写入剪贴板，请允许浏览器访问剪贴板后重试") }
        assertCurrent()
        if (command === "copy") return
        replacement = ""
      } else if (command === "paste" || command === "pastePlain") {
        try { replacement = window.desktop ? await window.desktop.readClipboardText() : await navigator.clipboard.readText() }
        catch { throw new Error(window.desktop ? "无法读取本地剪贴板，请重试" : "无法读取剪贴板，请允许浏览器访问剪贴板，或在编辑视图使用粘贴快捷键") }
        if (!replacement) return
      }
      assertCurrent()
      const apply = (instance: Monaco) => {
        assertCurrent(instance)
        const model = instance.getModel()
        if (!model) throw new Error("编辑器尚未就绪，请稍后重试")
        const start = model.getPositionAt(selection.start), end = model.getPositionAt(selection.end)
        const range = { startLineNumber: start.lineNumber, startColumn: start.column,
          endLineNumber: end.lineNumber, endColumn: end.column }
        instance.setSelection(range)
        if (replacement !== undefined) {
          instance.pushUndoStop()
          if (!instance.executeEdits("manuscript-menu", [{ range, text: replacement, forceMoveMarkers: true }])) throw new Error("编辑器未接受正文修改，请重新操作")
          instance.pushUndoStop()
        }
        instance.revealRangeInCenterIfOutsideViewport(instance.getSelection() ?? range)
        instance.focus()
      }
      // Wait for the menu to release its focus trap before focusing the editor.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const instance = editorRef.current
      if ((mode === "edit" || mode === "split") && instance?.getModel()) apply(instance)
      else await new Promise<void>((resolve, reject) => {
        assertCurrent()
        if (!editingMode) { reject(new Error("当前正文仅提供预览，不能编辑")); return }
        const previous = pending.current
        if (previous) { clearTimeout(previous.timer); previous.reject(new Error("已切换到新的编辑操作")) }
        const operation = { mode: editingMode, reject, timer: setTimeout(() => { if (pending.current === operation) { pending.current = null; reject(new Error("编辑器尚未就绪，请重试")) } }, 10000),
          run(instance: Monaco) { clearTimeout(operation.timer); try { apply(instance); resolve() } catch (error) { reject(error) } } }
        pending.current = operation
        try { setMode(editingMode) } catch (error) { pending.current = null; clearTimeout(operation.timer); reject(error) }
      })
    },
  }), [value, readOnly, mode, editingMode, setMode, editorRef, previewRef, rootRef])
  useImperativeHandle(ref, () => handle, [handle])

  return Object.assign((instance: Monaco) => {
    const operation = pending.current
    pending.current = null
    if (operation) { clearTimeout(operation.timer); requestAnimationFrame(() => operation.run(instance)) }
  }, { handle })
}
