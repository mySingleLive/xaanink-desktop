"use client"
import { useEffect, useMemo, useRef } from "react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { ChevronDown, ChevronRight, MapPin, Plus, MoreHorizontal } from "lucide-react"
import { sceneForest } from "@/lib/scene-tree"
import { sceneMention } from "@/lib/scene-context"
import { startChipDrag } from "@/components/chat/chip-drag"
import { useSceneUiStore } from "@/stores/scene-ui"
import { buildTabId, useTabsStore } from "@/stores/tabs"
import { useChatStore } from "@/stores/chat"
import type { SceneRecord } from "../types"
export function sceneChip(scene: SceneRecord, novelId: string) {return {kind: "scene" as const, groupLabel: "场景", label: scene.name, insertText: sceneMention(scene, novelId)}}
export function SceneTree({rows, novelId, instance, selected, onSelect, onCreate, onAction, overlay = false, active = true}: {rows: SceneRecord[]; novelId: string; instance: string; selected?: string; onSelect: (row: SceneRecord) => void; onCreate?: (parentId: string) => void; onAction?: (row: SceneRecord, action: "create" | "move" | "delete") => void; overlay?: boolean; active?: boolean}) {
 const activeTabId = useTabsStore(s => s.activeTabId)
 const account = useChatStore(s => s.accountId); const key = `${account}:${novelId}:tree:${instance}`
 const pref = useSceneUiStore(s => s.prefs[key]); const setPref = useSceneUiStore(s => s.setPref)
 const quote = useSceneUiStore(s => s.quote)
 const tree = useMemo(() => sceneForest(rows), [rows]); const expanded = new Set(pref?.expanded ?? [])
 const visible = tree.visible(expanded); const focus = visible.some(row => row.id === pref?.focus) ? pref!.focus! : visible[0]?.id
 const refs = useRef(new Map<string, HTMLDivElement>())
 useEffect(() => {if (!selected) return; const parents = (tree.paths.get(selected) ?? []).slice(0, -1).map(row => row.id); if (parents.some(id => !expanded.has(id))) setPref(key, {expanded: [...new Set([...expanded, ...parents])]})}, [selected, key, tree, setPref]) // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(() => {
   if (!pref?.keyboardOpen || pref.keyboardTab !== activeTabId || !active || !focus || overlay) return
   const frame = requestAnimationFrame(() => {refs.current.get(focus)?.focus(); setPref(key, {keyboardOpen: false, keyboardTab: undefined})})
   return () => cancelAnimationFrame(frame)
 }, [pref?.keyboardOpen, pref?.keyboardTab, activeTabId, active, focus, overlay, key, setPref])
 useEffect(() => {if (overlay && active) {const frame = requestAnimationFrame(() => focus && refs.current.get(focus)?.focus()); return () => cancelAnimationFrame(frame)}}, [overlay, active, key, focus])

 const go = (id: string) => {setPref(key, {focus: id}); refs.current.get(id)?.focus()}
 const toggle = (id: string) => {const next = new Set(expanded); if (next.has(id)) {next.delete(id); if (focus && tree.descendants(id).has(focus)) go(id)} else next.add(id); setPref(key, {expanded: [...next]})}
 if (!rows.length) return <p className="px-4 py-3 text-xs text-muted-foreground">暂无场景</p>
 return <div role="tree" aria-label={instance === "global" ? "作品场景树" : "场景目录树"} className="min-w-0 py-2">
 {visible.map(row => {const children = tree.children.get(row.id) ?? []; const depth = tree.depths.get(row.id) ?? 0; return <div key={row.id} ref={el => {if (el) refs.current.set(row.id, el); else refs.current.delete(row.id)}} role="treeitem" aria-level={depth + 1} aria-selected={row.id === selected} aria-expanded={children.length ? expanded.has(row.id) : undefined} tabIndex={focus === row.id ? 0 : -1} data-scene-id={row.id} title={tree.path(row.id)} draggable onDragStart={e => {if ((e.target as HTMLElement).closest("button")) {e.preventDefault(); return}; startChipDrag(e, sceneChip(row, novelId))}} onFocus={() => setPref(key, {focus: row.id})} onClick={() => onSelect(row)} onKeyDown={e => {
 if ((e.target as HTMLElement).closest("button")) return
 const index = visible.findIndex(s => s.id === row.id); let next: string | undefined
 if (e.key === "ArrowDown") next = visible[Math.min(index + 1, visible.length - 1)]?.id
 else if (e.key === "ArrowUp") next = visible[Math.max(0, index - 1)]?.id
 else if (e.key === "Home") next = visible[0]?.id
 else if (e.key === "End") next = visible.at(-1)?.id
 else if (e.key === "ArrowRight") {if (children.length && !expanded.has(row.id)) toggle(row.id); else next = children[0]?.id}
 else if (e.key === "ArrowLeft") {if (children.length && expanded.has(row.id)) toggle(row.id); else next = row.parentId ?? undefined}
 else if (e.key === "Enter" || e.key === " ") {if (!overlay) setPref(key, {keyboardOpen: true, keyboardTab: buildTabId("scene", novelId, {refId: row.id})}); onSelect(row); if (!overlay) requestAnimationFrame(() => refs.current.get(row.id)?.focus())}
 else return
 e.preventDefault(); if (next) go(next)
 }} className={`group flex min-w-0 cursor-pointer items-center gap-1 rounded-md py-1.5 pr-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${row.id === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`} style={{paddingLeft: 8 + depth * 14}}>
 <button type="button" tabIndex={-1} draggable={false} aria-label={`${expanded.has(row.id) ? "折叠" : "展开"}${row.name}`} disabled={!children.length} onMouseDown={e => e.preventDefault()} onClick={e => {e.stopPropagation(); toggle(row.id)}} className="flex size-5 shrink-0 items-center justify-center">{children.length ? expanded.has(row.id) ? <ChevronDown className="size-3"/> : <ChevronRight className="size-3"/> : null}</button><MapPin className="size-3 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1 truncate">{row.name}{tree.anomalies.has(row.id) ? " · 层级异常" : ""}</span>{children.length > 0 && <span className="text-[10px] text-muted-foreground">{children.length}</span>}
 {onCreate && <button type="button" draggable={false} tabIndex={-1} aria-label={`在${row.name}下创建子场景`} onClick={e => {e.stopPropagation(); onCreate(row.id)}} className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"><Plus className="size-3"/></button>}
 {onAction && <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}><DropdownMenu><DropdownMenuTrigger aria-label={`场景${row.name}菜单`} tabIndex={-1} className="flex size-5 items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" draggable={false}><MoreHorizontal className="size-3"/></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onClick={() => onAction(row, "create")}>创建子场景</DropdownMenuItem><DropdownMenuItem onClick={() => quote(novelId, sceneChip(row, novelId))}>引用到对话</DropdownMenuItem><DropdownMenuItem onClick={() => onAction(row, "move")}>移动场景</DropdownMenuItem><DropdownMenuItem onClick={() => onAction(row, "delete")}>删除场景</DropdownMenuItem></DropdownMenuContent></DropdownMenu></span>}
 </div>})}
 </div>
}
