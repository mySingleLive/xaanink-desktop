import { splitMarkdownBlocks } from "@/lib/comment-anchor"
import { renderedTextMap } from "@/lib/comment-selection"
export interface PreviewRangeIdentity { start: Node; startOffset: number; end: Node; endOffset: number }
export interface PreviewSelection { source: string; start: number; end: number; text: string; canReplace: boolean; range: PreviewRangeIdentity }
const ui = "button,input,textarea,select,svg,script,style,[contenteditable=true],[data-comment-composer],.text-comment-add-btn,.text-comment-anchor-toggle,.foreshadow-inline-flag"
export function previewBodyRoots(container: HTMLElement): HTMLElement[] {
  const blocks = [...container.querySelectorAll<HTMLElement>("[data-block]")]
  if (blocks.length) return blocks
  const plain = container.querySelector<HTMLElement>(".markdown-body > div")
  return plain ? [plain] : []
}
function clean(fragment: DocumentFragment) { fragment.querySelectorAll(ui).forEach(node => node.remove()); return fragment.textContent ?? "" }
function identity(range: Range): PreviewRangeIdentity { return { start: range.startContainer, startOffset: range.startOffset, end: range.endContainer, endOffset: range.endOffset } }
export function samePreviewRange(saved: PreviewRangeIdentity, container: HTMLElement) {
  const selection = container.ownerDocument.getSelection()
  if (!saved.start.isConnected || !saved.end.isConnected || selection?.rangeCount !== 1) return false
  const range = selection.getRangeAt(0)
  return range.startContainer === saved.start && range.startOffset === saved.startOffset && range.endContainer === saved.end && range.endOffset === saved.endOffset
}
function selectedText(range: Range, roots: HTMLElement[]) {
  return roots.flatMap(root => {
    if (!range.intersectsNode(root)) return []
    const part = root.ownerDocument.createRange(); part.selectNodeContents(root)
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset)
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset)
    const text = clean(part.cloneContents())
    return text ? [text] : []
  }).join("\n\n")
}
/** Maps only body blocks. Bubbles between blocks and inline buttons are UI. */
export function readPreviewSelection(container: HTMLElement, source: string): PreviewSelection | null {
  const selection = container.ownerDocument.getSelection()
  if (selection?.rangeCount !== 1) return null
  const range = selection.getRangeAt(0), roots = previewBodyRoots(container), blocks = splitMarkdownBlocks(source)
  const offset = (node: Node, at: number, end: boolean) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
    if (element?.closest(ui)) return null
    const root = roots.find(root => root.contains(node))
    if (!root) return null
    const before = container.ownerDocument.createRange(); before.selectNodeContents(root); before.setEnd(node, at)
    const shown = clean(before.cloneContents()).length, full = container.ownerDocument.createRange(); full.selectNodeContents(root)
    const block = root.hasAttribute("data-block") ? blocks[Number(root.dataset.block)] : { text: source, start: 0 }
    if (!block) return null
    const map = renderedTextMap(block.text, clean(full.cloneContents()))
    if (!map) return null
    if (shown === 0 && map.length === 0) return block.start
    const previous = end || shown === map.length
    const position = map[previous ? shown - 1 : shown]
    return position == null ? null : block.start + position + (previous ? 1 : 0)
  }
  if (!roots.some(root => root.contains(range.startContainer)) || !roots.some(root => root.contains(range.endContainer))) return null
  const start = offset(range.startContainer, range.startOffset, false), end = offset(range.endContainer, range.endOffset, !range.collapsed)
  return { source, start: start ?? source.length, end: end ?? source.length, text: selectedText(range, roots), canReplace: start !== null && end !== null && end >= start, range: identity(range) }
}
export function selectPreviewBody(container: HTMLElement, source: string): PreviewSelection | null {
  const roots = previewBodyRoots(container)
  if (!roots.length) return null
  const document = container.ownerDocument, range = document.createRange()
  range.setStart(roots[0], 0); range.setEnd(roots.at(-1)!, roots.at(-1)!.childNodes.length)
  document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range)
  return { source, start: 0, end: source.length, text: selectedText(range, roots), canReplace: true, range: identity(range) }
}
export function isPreviewBodyTarget(container: HTMLElement, target: HTMLElement) {
  if (!container.contains(target) || target.closest(ui)) return false
  return target === container || previewBodyRoots(container).some(root => root === target || root.contains(target))
}
