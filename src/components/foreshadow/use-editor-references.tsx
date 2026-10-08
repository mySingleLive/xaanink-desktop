"use client"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { editor as Monaco } from "monaco-editor"
import { selectionSnapshot } from "@/lib/comment-selection"
import { referenceSegments } from "@/lib/foreshadow-reference"
import { TOUCH_KIND_LABELS } from "@/lib/foreshadow"
import { openForeshadowTouch, ReferenceInfo } from "./references"
import type { PreviewReferences } from "./preview-references"

export function useEditorReferences(editor: Monaco.IStandaloneCodeEditor | null, value: string, config?: PreviewReferences) {
  const [choice, setChoice] = useState<{ ids: string[]; x: number; y: number } | null>(null)
  const handledFocus = useRef<object | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const submenuOpen = useRef(false)
  useEffect(() => {
    if (!choice) return
    popupRef.current?.querySelector("button")?.focus()
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setChoice(null) }
    const outside = (event: PointerEvent) => {
      if (submenuOpen.current && (event.target as Element)?.closest?.("[data-foreshadow-submenu]")) return
      if (!popupRef.current?.contains(event.target as Node)) setChoice(null)
    }
    document.addEventListener("keydown", escape); document.addEventListener("pointerdown", outside)
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside) }
  }, [choice])
  useEffect(() => {
    if (!editor || !config) return
    const model = editor.getModel()
    if (!model) return
    const range = (start: number, end: number) => {
      const a = model.getPositionAt(start), b = model.getPositionAt(end)
      return { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column }
    }
    const segments = referenceSegments(config.entries.map(e => ({ id: e.reference.id, anchor: e.anchor })))
    const decorations = editor.createDecorationsCollection(segments.map(s => {
      const related = config.entries.filter(e => s.ids.includes(e.reference.id))
      return { range: range(s.start, s.end), options: {
        inlineClassName: `foreshadow-monaco-mark foreshadow-kind-${related[0].touch.kind}`,
        afterContentClassName: "foreshadow-monaco-flag",
        hoverMessage: related.map(e => ({ value: `${e.foreshadow.title} · ${TOUCH_KIND_LABELS[e.touch.kind]}\n\n${e.touch.summary}\n\n${e.touch.references.length} 处引用 · 点击打开触点${e.reference.anchorSource === "evidence" || e.reference.anchorSource === "summary" ? "\n\n根据触点内容定位 · 可框选调整" : ""}`, isTrusted: false })),
      } }
    }))
    const select = () => {
      const selection = editor.getSelection()
      if (!selection || selection.isEmpty()) { config.onSelection(null); return }
      config.onSelection(selectionSnapshot(model.getValue(), model.getOffsetAt(selection.getStartPosition()), model.getOffsetAt(selection.getEndPosition())))
    }
    const selectionListener = editor.onDidChangeCursorSelection(select)
    const mouse = editor.onMouseUp(e => {
      const selection = editor.getSelection()
      if (!e.target.position || (selection && !selection.isEmpty())) return
      const offset = model.getOffsetAt(e.target.position)
      const related = config.entries.filter(entry => entry.anchor && offset >= entry.anchor.start && offset <= entry.anchor.end)
      const ids = [...new Set(related.map(r => r.touch.id))]
      if (ids.length === 1) openForeshadowTouch(config.novelId, related[0].foreshadow.id, ids[0])
      else if (ids.length > 1) setChoice({ ids, x: e.event.posx, y: e.event.posy })
    })
    return () => { decorations.clear(); selectionListener.dispose(); mouse.dispose() }
  }, [editor, value, config])
  useEffect(() => {
    if (!config?.focus || handledFocus.current === config.focus) return
    const entry = config.entries.find(e => e.reference.id === config.focus?.referenceId)
    const model = editor?.getModel()
    if (!editor || !model || !entry?.anchor) return
    const start = model.getPositionAt(entry.anchor.start), end = model.getPositionAt(entry.anchor.end)
    const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }
    handledFocus.current = config.focus
    editor.setSelection(range); editor.revealRangeInCenter(range); editor.focus()
  }, [editor, config?.focus, config?.entries])
  return choice && config ? createPortal(<div ref={popupRef} role="dialog" aria-label="选择关联伏笔" className="fixed z-[110] rounded-xl border border-border bg-popover text-popover-foreground shadow-2"
    style={{ left: Math.max(8, Math.min(choice.x, innerWidth - 304)), top: Math.max(8, Math.min(choice.y, innerHeight - 350)) }}>
    <ReferenceInfo novelId={config.novelId} entries={config.entries.filter(e => choice.ids.includes(e.touch.id))} onNavigate={() => { submenuOpen.current = false; setChoice(null) }} onMenuOpenChange={open => { submenuOpen.current = open }} />
    <button className="m-3 text-xs" onClick={() => setChoice(null)}>关闭</button>
  </div>, document.body) : null
}
