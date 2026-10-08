"use client"
import { useEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import { splitMarkdownBlocks } from "@/lib/comment-anchor"
import { renderedTextMap, selectionSnapshot } from "@/lib/comment-selection"
import { referenceSegments } from "@/lib/foreshadow-reference"
import { TOUCH_KIND_LABELS } from "@/lib/foreshadow"
import type { TextAnchor } from "@/lib/comment-anchor"
import { openForeshadowTouch, ReferenceInfo, type ReferenceEntry, type ReferenceSelection } from "./references"

export type ResolvedReference = ReferenceEntry & { anchor: TextAnchor | null }
export interface PreviewReferences {
  novelId: string
  entries: ResolvedReference[]
  onSelection: (selection: ReferenceSelection | null) => void
  focus?: object & { referenceId?: string }
}
const FLAG_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 22V3c4-3 8 3 12 0v11c-4 3-8-3-12 0"/></svg>'

function clearMarks(root: HTMLElement) {
  root.querySelectorAll(".foreshadow-inline-flag").forEach(el => el.remove())
  root.querySelectorAll("mark.foreshadow-mark").forEach(mark => {
    mark.replaceWith(...mark.childNodes)
  })
  root.querySelectorAll("[data-block]").forEach(el => el.normalize())
}

/** 不改变块 / 行内格式；评论标记保持独立，伏笔重叠切成不相交段。 */
function highlight(root: HTMLElement, source: string, entries: ResolvedReference[]) {
  clearMarks(root)
  const segments = referenceSegments(entries.map(e => ({ id: e.reference.id, anchor: e.anchor })))
  const blocks = splitMarkdownBlocks(source)
  const lastById = new Map<string, HTMLElement>()
  root.querySelectorAll<HTMLElement>("[data-block]").forEach(el => {
    const block = blocks[Number(el.dataset.block)]
    if (!block) return
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (node.parentElement?.closest("button,pre,code,a,script,style,svg")) continue
      nodes.push(node)
    }
    const map = renderedTextMap(block.text, nodes.map(n => n.data).join(""))
    if (!map) return
    let shown = 0
    for (const node of nodes) {
      const groups: { text: string; ids: string[] }[] = []
      for (const char of node.data.split("")) {
        const local = map[shown++], offset = local == null ? null : block.start + local
        const ids = offset === null ? [] : segments.find(s => s.start <= offset && offset < s.end)?.ids ?? []
        const last = groups.at(-1)
        if (last && last.ids.join(" ") === ids.join(" ")) last.text += char
        else groups.push({ text: char, ids })
      }
      if (!groups.some(g => g.ids.length)) continue
      const fragment = document.createDocumentFragment()
      for (const group of groups) {
        if (!group.ids.length) { fragment.append(document.createTextNode(group.text)); continue }
        const mark = document.createElement("mark")
        mark.className = "foreshadow-mark"; mark.dataset.frefIds = group.ids.join(" ")
        const related = entries.filter(e => group.ids.includes(e.reference.id))
        mark.dataset.kind = related[0].touch.kind
        mark.setAttribute("role", "link")
        mark.setAttribute("aria-label", `伏笔：${related.map(e => `${e.foreshadow.title} · ${TOUCH_KIND_LABELS[e.touch.kind]}`).join("；")}`)
        mark.textContent = group.text; fragment.append(mark)
        for (const id of group.ids) lastById.set(id, mark)
      }
      node.replaceWith(fragment)
    }
  })
  // 各引用均有独立图标；同一末端按顺序并列，SVG 不污染文字映射。
  const tails = new Map<HTMLElement, HTMLElement>()
  for (const entry of entries) {
    const mark = lastById.get(entry.reference.id)
    if (!mark) continue
    const button = document.createElement("button")
    button.type = "button"; button.className = "foreshadow-inline-flag"; button.dataset.kind = entry.touch.kind
    button.dataset.frefIds = entry.reference.id
    button.setAttribute("aria-label", `${entry.foreshadow.title} · ${TOUCH_KIND_LABELS[entry.touch.kind]}`)
    button.innerHTML = FLAG_SVG
    ;(tails.get(mark) ?? mark).after(button); tails.set(mark, button)
  }
}

function snapshotFromDOM(root: HTMLElement, source: string) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0), blocks = splitMarkdownBlocks(source)
  function offset(node: Node, index: number, end: boolean) {
    const blockEl = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-block]")
    if (!blockEl || !root.contains(blockEl)) return null
    const block = blocks[Number(blockEl.dataset.block)]
    if (!block) return null
    const before = document.createRange(); before.selectNodeContents(blockEl); before.setEnd(node, index)
    const shown = before.toString().length
    const map = renderedTextMap(block.text, blockEl.textContent ?? "")
    const mapped = map?.[end ? shown - 1 : shown]
    return mapped == null ? null : block.start + mapped + (end ? 1 : 0)
  }
  const start = offset(range.startContainer, range.startOffset, false), end = offset(range.endContainer, range.endOffset, true)
  return start === null || end === null || end <= start ? null : selectionSnapshot(source, start, end)
}

export function usePreviewReferences(rootRef: RefObject<HTMLDivElement | null>, source: string, config?: PreviewReferences) {
  const [popup, setPopup] = useState<{ entries: ReferenceEntry[]; left: number; top: number; pinned: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const popupRef = useRef<HTMLDivElement>(null)
  const submenuOpen = useRef(false)
  const handledFocus = useRef<object | null>(null)
  const entries = config?.entries
  useEffect(() => {
    const root = rootRef.current
    if (!root || !entries) return
    const active = document.activeElement as HTMLElement | null
    const focusedId = active && root.contains(active) ? active.dataset.frefIds?.split(" ")[0] : undefined
    const focusedTag = active?.tagName.toLowerCase()
    highlight(root, source, entries)
    // 查询刷新重绘标记时保留用户刚跳转到的焦点；不能在依赖清理时先丢失它。
    if (focusedId) {
      const replacement = root.querySelector<HTMLElement>(`${focusedTag}[data-fref-ids~="${CSS.escape(focusedId)}"]`)
      if (replacement) {
        if (replacement.tagName === "MARK") replacement.tabIndex = -1
        replacement.focus({ preventScroll: true })
      }
    }
  }, [rootRef, source, entries])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !config) return
    let selecting = false
    const show = (el: HTMLElement, pinned = false) => {
      clearTimeout(timer.current)
      const ids = el.dataset.frefIds?.split(" ") ?? [], related = config.entries.filter(e => ids.includes(e.reference.id))
      if (!related.length) return
      const rect = el.getBoundingClientRect()
      const update = () => setPopup({ entries: related, left: Math.max(8, Math.min(rect.left, innerWidth - 304)), top: Math.max(8, Math.min(rect.bottom + 8, innerHeight - 330)), pinned })
      if (pinned) update(); else timer.current = setTimeout(update, 240)
    }
    const hit = (e: Event) => (e.target as HTMLElement)?.closest<HTMLElement>("[data-fref-ids]")
    const over = (e: Event) => {
      const el = hit(e)
      // 引用跳转聚焦正文时保持阅读视野；键盘仍可从旁边的小旗打开卡片。
      if (e.type === "focusin" && el?.matches("mark.foreshadow-mark")) return
      if (el && !selecting) show(el)
    }
    const beginSelection = () => {
      // 可聚焦的行内元素会让浏览器把拖选当成控件操作；键盘入口由旁边的小旗提供。
      root.querySelectorAll("mark.foreshadow-mark[tabindex]").forEach(el => el.removeAttribute("tabindex"))
      selecting = true; clearTimeout(timer.current); setPopup(null)
    }
    const endSelection = () => { selecting = false }
    const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!submenuOpen.current) setPopup(p => p?.pinned ? p : null) }, 160) }
    const activate = (e: Event) => {
      const el = hit(e)
      if (!el || (e instanceof KeyboardEvent && !["Enter", " "].includes(e.key))) return
      if (!(e instanceof KeyboardEvent) && !window.getSelection()?.isCollapsed) return
      e.preventDefault(); e.stopPropagation()
      const related = config.entries.filter(r => el.dataset.frefIds?.split(" ").includes(r.reference.id))
      const touches = [...new Set(related.map(r => r.touch.id))]
      if (touches.length === 1) { clearTimeout(timer.current); setPopup(null); openForeshadowTouch(config.novelId, related[0].foreshadow.id, touches[0]) }
      else show(el, true)
    }
    const select = () => config.onSelection(snapshotFromDOM(root, source))
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { clearTimeout(timer.current); submenuOpen.current = false; setPopup(null) } }
    const dismiss = (e: PointerEvent) => {
      if (submenuOpen.current && (e.target as Element)?.closest?.("[data-foreshadow-submenu]")) return
      if (!popupRef.current?.contains(e.target as Node) && !hit(e)) { clearTimeout(timer.current); submenuOpen.current = false; setPopup(null) }
    }
    root.addEventListener("mouseover", over); root.addEventListener("focusin", over); root.addEventListener("mouseout", hide)
    root.addEventListener("pointerdown", beginSelection); document.addEventListener("pointerup", endSelection)
    root.addEventListener("click", activate, true); root.addEventListener("keydown", activate, true)
    root.addEventListener("mouseup", select); root.addEventListener("keyup", select)
    document.addEventListener("keydown", escape); document.addEventListener("pointerdown", dismiss)
    return () => {
      clearTimeout(timer.current)
      root.removeEventListener("mouseover", over); root.removeEventListener("focusin", over); root.removeEventListener("mouseout", hide)
      root.removeEventListener("pointerdown", beginSelection); document.removeEventListener("pointerup", endSelection)
      root.removeEventListener("click", activate, true); root.removeEventListener("keydown", activate, true)
      root.removeEventListener("mouseup", select); root.removeEventListener("keyup", select)
      document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", dismiss)
    }
  }, [rootRef, source, config])

  useEffect(() => {
    if (!config?.focus?.referenceId || handledFocus.current === config.focus) return
    const root = rootRef.current
    const mark = root?.querySelector<HTMLElement>(`[data-fref-ids~="${CSS.escape(config.focus.referenceId)}"]`)
    if (mark) { handledFocus.current = config.focus; mark.tabIndex = -1; mark.scrollIntoView({ block: "center" }); mark.focus({ preventScroll: true }) }
  }, [config?.focus, entries, rootRef])
  useEffect(() => { if (popup?.pinned) popupRef.current?.querySelector("button")?.focus() }, [popup])
  return popup && config ? createPortal(<div ref={popupRef} role={popup.pinned ? "dialog" : undefined} aria-label={popup.pinned ? "选择关联伏笔" : undefined}
    className="fixed z-[110] rounded-xl border border-border bg-popover text-popover-foreground shadow-2" style={{ left: popup.left, top: popup.top }}
    onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={() => { if (!popup.pinned && !submenuOpen.current) setPopup(null) }}>
    <ReferenceInfo entries={popup.entries} novelId={config.novelId} onNavigate={() => { clearTimeout(timer.current); submenuOpen.current = false; setPopup(null) }} onMenuOpenChange={open => {
      submenuOpen.current = open; clearTimeout(timer.current)
      if (!open && !popupRef.current?.matches(":hover") && !popupRef.current?.contains(document.activeElement)) timer.current = setTimeout(() => setPopup(p => p?.pinned ? p : null), 160)
    }} />
    {popup.pinned && <button className="mb-2 ml-4 text-xs text-muted-foreground" onClick={() => setPopup(null)}>关闭</button>}
  </div>, document.body) : null
}
