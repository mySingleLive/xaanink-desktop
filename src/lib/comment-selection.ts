import { diffChars } from "diff"
import { anchorContext } from "./comment-anchor"
/** UTF-16 偏移与浏览器 Range / Monaco 一致；消化 Markdown 的删除字符，不猜新增字符。 */
export function renderedTextMap(source: string, visible: string) {
  const changes = diffChars(source, visible, { timeout: 50, maxEditLength: 10000 })
  if (!changes) return null
  const offsets: (number | null)[] = new Array(visible.length).fill(null)
  let raw = 0, shown = 0
  for (const change of changes) {
    if (change.removed) raw += change.value.length
    else if (change.added) shown += change.value.length
    else { for (let i = 0; i < change.value.length; i++) offsets[shown++] = raw++ }
  }
  return offsets
}
export function sourceSelection(source: string, visible: string, start: number, end: number) {
  if (start < 0 || end <= start || end > visible.length) return null
  const map = renderedTextMap(source, visible)
  if (!map || map[start] === null || map[end - 1] === null) return null
  return { start: map[start]!, end: map[end - 1]! + 1 }
}
export function selectionSnapshot(sourceText: string, startOffset: number, endOffset: number) {
  return { sourceText, quote: sourceText.slice(startOffset, endOffset), startOffset, endOffset,
    ...anchorContext(sourceText, startOffset, endOffset) }
}
export function selectionGutterPosition(line: { top: number; height: number }, view: { height: number; contentLeft: number }) {
  if (line.top + line.height <= 0 || line.top >= view.height) return null
  return { top: Math.max(0, Math.min(line.top + (line.height - 26) / 2, view.height - 26)), left: Math.max(0, view.contentLeft - 30) }
}
