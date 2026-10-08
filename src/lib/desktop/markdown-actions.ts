import type { editor, IRange, IPosition } from "monaco-editor"
// The same class exported as public monaco.Selection, without loading the DOM
// editor assembly in the pure edit planner's unit tests. The binding adapter
// verifies Monaco 0.56.0 before installing any actions.
// @ts-expect-error Internal Monaco JavaScript has no published declarations.
import { Selection } from "monaco-editor/editor/common/core/selection.js"
const NativeSelection = Selection as typeof import("monaco-editor").Selection

export const markdownFormats: readonly (readonly [string, string])[] = [
  ["md.bold", "加粗"], ["md.italic", "斜体"], ["md.strikethrough", "删除线"], ["md.link", "插入链接"], ["md.image", "插入图片"],
  ["md.quote", "块引用"], ["md.orderedList", "有序列表"], ["md.unorderedList", "无序列表"], ["md.taskList", "任务列表"],
  ["md.inlineCode", "行内代码"], ["md.codeBlock", "代码块"], ["md.table", "插入表格"], ["md.horizontalRule", "分隔线"], ["md.escapeMarkup", "转义 Markdown 标记"],
  ...Array.from({ length: 6 }, (_, i): readonly [string, string] => [`md.heading${i + 1}`, `标题 ${i + 1}`]),
]
export interface MarkdownFormatEdit { range: IRange; text: string; forceMoveMarkers: true; selectionOffset: number; selectionLength: number; startOffset: number; endOffset: number }
const formatIds = new Set(markdownFormats.map(([id]) => id))
export interface MarkdownTextModel { getValue(): string; getOffsetAt(position: IPosition): number; getPositionAt(offset: number): IPosition }
export function markdownFormatEdits(model: MarkdownTextModel, selections: readonly IRange[], id: string): MarkdownFormatEdit[] {
  if (!formatIds.has(id)) throw new Error("MARKDOWN_COMMAND_UNAVAILABLE")
  const source = model.getValue(), eol = source.includes("\r\n") ? "\r\n" : "\n"
  const block = /^(?:md\.(?:quote|orderedList|unorderedList|taskList|codeBlock)|md\.heading[1-6])$/.test(id)
  const ranges = selections.map(range => {
    let start = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn })
    let end = model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn })
    if (block) {
      start = start === 0 ? 0 : source.lastIndexOf("\n", start - 1) + 1
      if (range.endColumn === 1 && range.endLineNumber > range.startLineNumber) end--
      const next = source.indexOf("\n", end)
      end = next < 0 ? source.length : next
      if (source[end - 1] === "\r") end--
    }
    return { start, end }
  }).sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: typeof ranges = []
  for (const next of ranges) {
    const previous = merged.at(-1)
    if (previous && block && next.start <= previous.end + eol.length) previous.end = Math.max(previous.end, next.end)
    else if (previous && (next.start < previous.end || next.start === previous.start)) throw new Error("MARKDOWN_SELECTION_OVERLAP")
    else merged.push({ ...next })
  }
  return merged.map(({ start, end }) => {
    const original = source.slice(start, end), value = original || "文字"
    let text = value, selectionOffset = 0, selectionLength = value.length
    const wrap = (left: string, right = left) => {
      if (original.startsWith(left) && original.endsWith(right) && original.length >= left.length + right.length) { text = original.slice(left.length, -right.length); selectionLength = text.length }
      else { text = left + value + right; selectionOffset = left.length }
    }
    if (id === "md.bold") wrap("**")
    else if (id === "md.italic") {
      // An even asterisk run is strong, not an italic wrapper. Adding one
      // keeps the existing strong span; removing one from *** keeps **.
      const opening = original.match(/^\*+/)?.[0].length ?? 0
      const closing = original.match(/\*+$/)?.[0].length ?? 0
      if (opening && closing && opening % 2 === 1 && closing % 2 === 1) wrap("*")
      else { text = "*" + value + "*"; selectionOffset = 1 }
    }
    else if (id === "md.strikethrough") wrap("~~")
    else if (id === "md.link") wrap("[", "](https://example.com)")
    else if (id === "md.image") wrap("![", "](图片地址)")
    else if (id === "md.inlineCode") {
      const ticks = Math.max(0, ...[...value.matchAll(/`+/g)].map(match => match[0].length)) + 1
      const opening = original.match(/^`+/)?.[0], closing = original.match(/`+$/)?.[0]
      const body = opening && closing && opening === closing && original.length > opening.length + closing.length ? original.slice(opening.length, -closing.length) : null
      // Delimiters are entire runs: contiguous ticks alone, or an earlier
      // matching run inside the body, do not form one enclosing code span.
      const enclosing = body !== null && ![...body.matchAll(/`+/g)].some(match => match[0].length === opening!.length)
      if (enclosing) {
        text = body!
        if (text.startsWith(" ") && text.endsWith(" ") && !/^ +$/.test(text)) text = text.slice(1, -1)
        selectionLength = text.length
      } else {
        // CommonMark removes one paired syntax space unless all characters
        // are spaces. Pad edge ticks and paired author spaces accordingly.
        const padding = value.startsWith("`") || value.endsWith("`") || value.startsWith(" ") && value.endsWith(" ") && !/^ +$/.test(value) ? " " : ""
        const delimiter = "`".repeat(ticks)
        text = delimiter + padding + value + padding + delimiter
        selectionOffset = delimiter.length + padding.length
      }
    } else if (id === "md.codeBlock") {
      const existing = original.match(/^(`{3,}|~{3,})[^\r\n]*\r?\n([\s\S]*?)\r?\n\1$/)
      if (existing) { text = existing[2]; selectionLength = text.length }
      else {
        const fence = "`".repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map(match => match[0].length + 1)))
        wrap(fence + eol, eol + fence)
      }
    } else if (id === "md.table") {
      const cell = value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|")
      const prefix = `| 列 1 | 列 2 |${eol}| --- | --- |${eol}| `
      text = prefix + cell + " | 内容 |"; selectionOffset = prefix.length; selectionLength = cell.length
    } else if (id === "md.horizontalRule") { text = original + eol + eol + "---" + eol; selectionOffset = text.length; selectionLength = 0 }
    else if (id === "md.escapeMarkup") { text = original.replace(/([\\`*_{}\[\]()#+\-.!>~|])/g, "\\$1"); selectionLength = text.length }
    else {
      const lines = value.split(eol)
      if (id.startsWith("md.heading")) text = lines.map(line => "#".repeat(Number(id.at(-1))) + " " + line.replace(/^#{1,6}\s+/, "")).join(eol)
      else {
        const markers: Record<string, { pattern: RegExp; prefix(index: number): string }> = {
          "md.quote": { pattern: /^>\s?/, prefix: () => "> " },
          "md.orderedList": { pattern: /^\d+\.\s+/, prefix: index => `${index + 1}. ` },
          "md.unorderedList": { pattern: /^[-*+]\s+(?!\[)/, prefix: () => "- " },
          "md.taskList": { pattern: /^[-*+]\s+\[[ xX]\]\s+/, prefix: () => "- [ ] " },
        }
        const marker = markers[id]
        const toggleOff = lines.every(line => !line || marker.pattern.test(line))
        text = lines.map((line, index) => !line ? line : toggleOff ? line.replace(marker.pattern, "") : marker.prefix(index) + line.replace(/^(?:>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, "")).join(eol)
      }
      selectionLength = text.length
    }
    const startPosition = model.getPositionAt(start), endPosition = model.getPositionAt(end)
    return { range: { startLineNumber: startPosition.lineNumber, startColumn: startPosition.column, endLineNumber: endPosition.lineNumber, endColumn: endPosition.column }, text, forceMoveMarkers: true as const, selectionOffset, selectionLength, startOffset: start, endOffset: end }
  }).filter(edit => edit.text !== source.slice(edit.startOffset, edit.endOffset))
}
/** These are public native editor actions. A single executeEdits preserves the
 * existing model/onChange path; stop boundaries group all selections as one edit. */
export function installMarkdownActions(instance: editor.IStandaloneCodeEditor): () => void {
  const actions: { dispose(): void }[] = []
  const binding: Record<string, number> = { "md.bold": 2048 | 32, "md.italic": 2048 | 39 } // Monaco KeyMod.CtrlCmd + public KeyCode.KeyB/KeyI.
  try {
    for (const [id, label] of markdownFormats) {
      if (instance.getAction?.(id)) continue
      actions.push(instance.addAction({ id, label, precondition: id === "md.escapeMarkup" ? "!editorReadonly && editorHasSelection" : "!editorReadonly", ...(binding[id] ? { keybindings: [binding[id]] } : {}),
        run: current => {
          if (current.getRawOptions().readOnly) return
          const model = current.getModel(), selections = current.getSelections()
          if (!model || !selections?.length) return
          const edits = markdownFormatEdits(model, selections, id)
          if (!edits.length) return
          current.pushUndoStop()
          try {
            current.executeEdits("desktop-markdown-format", edits, () => {
              let delta = 0
              return edits.map(edit => {
                const start = model.getPositionAt(edit.startOffset + delta + edit.selectionOffset)
                const end = model.getPositionAt(edit.startOffset + delta + edit.selectionOffset + edit.selectionLength)
                delta += edit.text.length - (edit.endOffset - edit.startOffset)
                return new NativeSelection(start.lineNumber, start.column, end.lineNumber, end.column)
              })
            })
          } finally { current.pushUndoStop() }
        },
      }))
    }
    let closed = false
    return () => { if (closed) return; closed = true; for (const action of actions) action.dispose() }
  } catch (error) { for (const action of actions) action.dispose(); throw error }
}
