"use client"

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type MouseEvent } from "react"
import type { Tab } from "@/stores/tabs"

type Drag = {
  source: HTMLElement; id: string; pointerId: number; startX: number; startY: number
  x: number; y: number; offsetX: number; offsetY: number; started: boolean
  ghost?: HTMLElement; destination: number; valid: boolean
}

/** Local strip mechanics; reordering never activates or remounts a business panel. */
export function useContentTabStrip(tabs: Tab[], activeId: string | null, moveTab: (id: string, index: number) => void) {
  const viewportRef = useRef<HTMLDivElement>(null), trackRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null), toolsRef = useRef<HTMLDivElement>(null)
  const [hasOverflow, setHasOverflow] = useState(false), [compact, setCompact] = useState(false)
  const [focusedId, setFocusedId] = useState(activeId), [announcement, setAnnouncement] = useState("")
  const drag = useRef<Drag | null>(null), dragFrame = useRef(0), measureFrame = useRef(0), focusFrame = useRef(0)
  const suppressClick = useRef(false), lastActive = useRef(activeId)
  const latest = useRef({ tabs, moveTab }); latest.current = { tabs, moveTab }

  const tabElement = (id: string) => Array.from(trackRef.current?.querySelectorAll<HTMLElement>(".content-tab") ?? []).find(el => el.dataset.tabId === id)
  function reveal(el?: HTMLElement) {
    const viewport = viewportRef.current
    if (!viewport || !el || viewport.clientWidth === 0 || drag.current?.started) return
    const left = el.offsetLeft, right = left + el.offsetWidth
    if (left < viewport.scrollLeft) viewport.scrollLeft = left
    else if (right > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = right - viewport.clientWidth
  }
  function focus(id: string) {
    setFocusedId(id)
    const el = tabElement(id); el?.focus({ preventScroll: true }); reveal(el)
  }
  function reorder(id: string, index: number) {
    const from = latest.current.tabs.findIndex(tab => tab.id === id)
    const to = Math.max(0, Math.min(latest.current.tabs.length - 1, index))
    if (from < 0 || from === to) return
    latest.current.moveTab(id, to); setFocusedId(id)
    setAnnouncement(`已将 ${latest.current.tabs.find(tab => tab.id === id)?.title ?? "标签"} 移至第 ${to + 1} 个，共 ${latest.current.tabs.length} 个标签`)
    cancelAnimationFrame(focusFrame.current)
    focusFrame.current = requestAnimationFrame(() => focus(id))
  }
  function updateDrag() {
    const state = drag.current, viewport = viewportRef.current, track = trackRef.current, marker = markerRef.current
    if (!state?.started || !viewport || !track || !marker) return
    const r = viewport.getBoundingClientRect()
    state.valid = r.width > 0 && state.x >= r.left && state.x <= r.right && state.y >= r.top && state.y <= r.bottom
    const others = Array.from(track.querySelectorAll<HTMLElement>(".content-tab")).filter(el => el !== state.source)
    state.destination = others.findIndex(el => { const bounds = el.getBoundingClientRect(); return state.x < bounds.left + bounds.width / 2 })
    if (state.destination < 0) state.destination = others.length
    const before = others[state.destination], last = others.at(-1)
    const position = before ? before.getBoundingClientRect().left - 3 : last ? last.getBoundingClientRect().right + 3 : r.left + 1
    marker.hidden = !state.valid; marker.style.left = `${viewport.scrollLeft + Math.max(0, Math.min(r.width - 2, position - r.left))}px`
    if (state.ghost) {
      state.ghost.style.left = `${state.x - state.offsetX}px`; state.ghost.style.top = `${state.y - state.offsetY}px`
      state.ghost.style.opacity = state.valid ? ".92" : ".5"
    }
  }
  function scrollDragging() {
    dragFrame.current = 0
    const viewport = viewportRef.current, state = drag.current
    if (!state?.started || !viewport) return
    if (state.valid) {
      const r = viewport.getBoundingClientRect(), scale = Number(getComputedStyle(state.source).getPropertyValue("--content-tab-scale")) || 1
      const edge = Math.min(24 / scale, r.width / 4)
      let delta = 0
      if (edge > 0 && state.x < r.left + edge) delta = -12 / scale * (1 - (state.x - r.left) / edge)
      else if (edge > 0 && state.x > r.right - edge) delta = 12 / scale * (1 - (r.right - state.x) / edge)
      if (delta) { viewport.scrollLeft += delta; updateDrag() }
    }
    dragFrame.current = requestAnimationFrame(scrollDragging)
  }
  function finish(commit = false, announce = true) {
    const state = drag.current
    if (!state) return
    // Clear first: releasePointerCapture can synchronously deliver lostcapture.
    drag.current = null; cancelAnimationFrame(dragFrame.current); dragFrame.current = 0
    state.ghost?.remove(); state.source.classList.remove("content-tab-drag-source")
    if (markerRef.current) markerRef.current.hidden = true
    if (state.source.hasPointerCapture(state.pointerId)) state.source.releasePointerCapture(state.pointerId)
    if (!state.started) return
    suppressClick.current = true
    if (commit && state.valid) reorder(state.id, state.destination)
    else if (announce) { setAnnouncement("已取消标签排序"); state.source.focus({ preventScroll: true }) }
  }
  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.pointerType !== "mouse" || (event.target as Element).closest("button") || drag.current) return
    const source = event.currentTarget, r = source.getBoundingClientRect()
    drag.current = { source, id: source.dataset.tabId!, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, offsetX: event.clientX - r.left, offsetY: event.clientY - r.top, started: false, destination: 0, valid: false }
    source.setPointerCapture(event.pointerId)
  }
  function pointerMove(event: globalThis.PointerEvent) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    state.x = event.clientX; state.y = event.clientY
    const scale = Number(getComputedStyle(state.source).getPropertyValue("--content-tab-scale")) || 1
    if (!state.started && Math.hypot(state.x - state.startX, state.y - state.startY) < 6 / scale) return
    event.preventDefault()
    if (!state.started) {
      state.started = true; state.source.classList.add("content-tab-drag-source")
      const ghost = state.source.cloneNode(true) as HTMLElement, styles = getComputedStyle(state.source)
      ghost.classList.remove("content-tab-drag-source"); ghost.classList.add("content-tab-drag-preview")
      for (const el of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
        for (const attribute of Array.from(el.attributes)) if (attribute.name === "id" || attribute.name === "role" || attribute.name === "title" || attribute.name.startsWith("aria-")) el.removeAttribute(attribute.name)
        el.tabIndex = -1
      }
      ghost.setAttribute("aria-hidden", "true")
      for (const name of ["--content-tab-scale", "--content-tab-selected-bg", "--content-tab-selected-border", "--foreground", "--muted-foreground", "--hover-wash"]) ghost.style.setProperty(name, styles.getPropertyValue(name))
      const r = state.source.getBoundingClientRect()
      Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, minWidth: "0", maxWidth: "none", fontSize: styles.fontSize, lineHeight: styles.lineHeight })
      document.body.append(ghost); state.ghost = ghost; dragFrame.current = requestAnimationFrame(scrollDragging)
    }
    updateDrag()
  }
  function measure() {
    measureFrame.current = 0
    const viewport = viewportRef.current, track = trackRef.current, tools = toolsRef.current
    if (!viewport || !track || !tools) return
    const caption = viewport.parentElement!, style = getComputedStyle(caption), toolStyle = getComputedStyle(tools)
    const available = caption.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const button = tools.querySelector<HTMLElement>("button")
    const size = button ? parseFloat(getComputedStyle(button).width) : 24
    const gap = parseFloat(toolStyle.columnGap) || 0, captionGap = parseFloat(style.columnGap) || 0
    const tight = available < size * 3 + gap * 2 + captionGap
    // Measure against the width before adding the overflow entry. Compact mode
    // always retains the menu, which also exposes the two panel actions.
    const baseWidth = Math.max(0, available - size * 2 - gap - captionGap)
    const overflow = tabs.length > 0 && (tight || track.scrollWidth > baseWidth + 1)
    setCompact(tight); setHasOverflow(overflow)
    viewport.style.setProperty("--content-tabs-viewport-width", `${viewport.clientWidth}px`)
    track.querySelectorAll<HTMLElement>(".content-tab-title").forEach(el => { el.dataset.overflow = String(el.scrollWidth > el.clientWidth + 1) })
    if (drag.current?.started) updateDrag()
    else reveal(document.activeElement?.closest<HTMLElement>(".content-tab")?.closest(".content-tabs-track") === track ? document.activeElement.closest<HTMLElement>(".content-tab")! : track.querySelector<HTMLElement>('[aria-selected="true"]') ?? undefined)
  }
  function scheduleMeasure() { if (!measureFrame.current) measureFrame.current = requestAnimationFrame(measure) }
  useEffect(() => {
    finish(false, false)
    if (lastActive.current !== activeId || !tabs.some(tab => tab.id === focusedId)) setFocusedId(activeId ?? tabs[0]?.id ?? null)
    lastActive.current = activeId
    const viewport = viewportRef.current, track = trackRef.current
    if (!viewport || !track) return
    let previousWidth = viewport.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const width = viewport.getBoundingClientRect().width
      if (Math.abs(previousWidth - width) > .1) finish()
      previousWidth = width; scheduleMeasure()
    })
    for (const el of [viewport, track, viewport.parentElement!, ...track.querySelectorAll(".content-tab-title")]) observer.observe(el)
    const wheel = (event: WheelEvent) => {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0)
      if (!delta) return
      viewport.scrollLeft += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1)
      event.preventDefault()
    }
    viewport.addEventListener("wheel", wheel, { passive: false })
    document.fonts?.addEventListener("loadingdone", scheduleMeasure)
    scheduleMeasure()
    return () => {
      observer.disconnect(); viewport.removeEventListener("wheel", wheel); document.fonts?.removeEventListener("loadingdone", scheduleMeasure)
      cancelAnimationFrame(measureFrame.current); measureFrame.current = 0; finish(false, false)
    }
    // Observers are replaced when labels/order change, without replacing panels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeId])
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => pointerMove(event)
    const up = (event: globalThis.PointerEvent) => { const state = drag.current; if (state?.pointerId === event.pointerId) { state.x = event.clientX; state.y = event.clientY; updateDrag(); finish(true) } }
    const cancel = () => finish(), escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && drag.current) { event.preventDefault(); event.stopPropagation(); finish() } }
    const hidden = () => { if (document.hidden) finish() }, resetClick = () => { suppressClick.current = false }
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up)
    document.addEventListener("pointercancel", cancel); document.addEventListener("lostpointercapture", cancel)
    document.addEventListener("keydown", escape, true); document.addEventListener("pointerdown", resetClick, true)
    document.addEventListener("visibilitychange", hidden); window.addEventListener("blur", cancel)
    return () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up)
      document.removeEventListener("pointercancel", cancel); document.removeEventListener("lostpointercapture", cancel)
      document.removeEventListener("keydown", escape, true); document.removeEventListener("pointerdown", resetClick, true)
      document.removeEventListener("visibilitychange", hidden); window.removeEventListener("blur", cancel)
      finish(false, false); cancelAnimationFrame(focusFrame.current)
    }
    // Event handlers read the live store inputs through latest and DOM refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function onKeyDown(event: KeyboardEvent<HTMLElement>, id: string, activate: (id: string) => void) {
    if ((event.target as Element).closest("button")) return
    const index = tabs.findIndex(tab => tab.id === id)
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); reorder(id, index + (event.key === "ArrowLeft" ? -1 : 1)); return }
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "ArrowRight" ? (index + 1) % tabs.length : -1
    if (next >= 0) { event.preventDefault(); focus(tabs[next].id) }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(id) }
  }
  return { viewportRef, trackRef, markerRef, toolsRef, hasOverflow, compact, focusedId, announcement, onPointerDown, onKeyDown, onFocus: (id: string) => { setFocusedId(id); reveal(tabElement(id)) }, cancel: () => finish(),
    onClickCapture: (event: MouseEvent) => { if (suppressClick.current && event.detail > 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation() } } }
}
