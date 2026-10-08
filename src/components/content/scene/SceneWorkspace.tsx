"use client"
/* eslint-disable @next/next/no-img-element -- 同源私有资产沿用用户鉴权，展示原始比例。 */
import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, MapPin, PanelLeftClose, PanelLeftOpen, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { sceneFactionLabel } from "@/lib/scene-context"
import { sceneForest } from "@/lib/scene-tree"
import { startChipDrag } from "@/components/chat/chip-drag"
import { buildTabId, useTabsStore } from "@/stores/tabs"
import { useSceneUiStore } from "@/stores/scene-ui"
import { useChatStore } from "@/stores/chat"
import { apiSend } from "../api"
import type { SceneRecord } from "../types"
import { SceneEditor } from "./SceneEditor"
import { SceneTree, sceneChip } from "./SceneTree"
import { useScenes, useSceneFactions } from "./use-scenes"
import "./scene.css"
export function openSceneTab(novelId: string, row: Pick<SceneRecord, "id" | "name">) {useTabsStore.getState().openTab({id: buildTabId("scene", novelId, {refId: row.id}), type: "scene", novelId, refId: row.id, title: row.name})}
export function openAllScenes(novelId: string) {const account = useChatStore.getState().accountId; useSceneUiStore.getState().setPref(`${account}:${novelId}:workspace`, {scope: null, search: ""}); useTabsStore.getState().openTab({id: buildTabId("scenes", novelId), type: "scenes", novelId, title: "场景"})}
export function SceneWorkspace({novelId, selected}: {novelId: string; selected?: string}) {
 const ownTabId = buildTabId(selected ? "scene" : "scenes", novelId, {refId: selected})
 const active = useTabsStore(s => s.activeTabId === ownTabId)
 const account = useChatStore(s => s.accountId); const prefKey = `${account}:${novelId}:workspace`
 const pref = useSceneUiStore(s => s.prefs[prefKey]); const setPref = useSceneUiStore(s => s.setPref); const quote = useSceneUiStore(s => s.quote)
 const {data: factionData} = useSceneFactions(novelId)
 const query = useScenes(novelId); const tree = sceneForest(query.rows)
 const root = useRef<HTMLDivElement>(null), restoreButton = useRef<HTMLButtonElement>(null)
 const [narrow, setNarrow] = useState(false), [drawer, setDrawer] = useState(false)
 const [create, setCreate] = useState<{parentId: string | null} | null>(null), [name, setName] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false)
 const client = useQueryClient(); const search = pref?.search ?? "", scope = pref?.scope ?? null
 useEffect(() => {const el = root.current; if (!el) return; const measure = () => setNarrow(el.getBoundingClientRect().width <= 560); measure(); const observer = new ResizeObserver(measure); observer.observe(el); return () => observer.disconnect()}, [query.isLoading, query.isError])
 useEffect(() => {
  if (!active || !drawer) return
  const listener = (event: KeyboardEvent) => {
   // Inspect the top layer before document listeners can unmount its menu/dialog.
   if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"], [role="menu"]')) {setDrawer(false); restoreButton.current?.focus()}
  }
  window.addEventListener("keydown", listener, true)
  return () => window.removeEventListener("keydown", listener, true)
 }, [active, drawer])
 const startCreate = (parentId: string | null) => {setName(""); setError(""); setCreate({parentId})}
 useEffect(() => {
  const handle = () => {const action = useSceneUiStore.getState().action; if (useTabsStore.getState().activeTabId !== ownTabId || !action || action.novelId !== novelId || action.type !== "create") return; useSceneUiStore.getState().clearAction(); startCreate(action.sceneId)}
  const unsubscribe = useSceneUiStore.subscribe(handle), tabUnsubscribe = useTabsStore.subscribe(handle); queueMicrotask(handle); return () => {unsubscribe(); tabUnsubscribe()}
 }, [novelId, ownTabId])
 const actionFor = (row: SceneRecord, action: "create" | "move" | "delete") => {if (action === "create") startCreate(row.id); else {useSceneUiStore.getState().requestAction(novelId, row.id, action); openSceneTab(novelId, row)}}
 const submitCreate = async () => {if (!create) return; setBusy(true); setError(""); try {const {scene} = await apiSend<{scene: SceneRecord}>(`/api/novels/${novelId}/scenes`, "POST", {name, parentId: create.parentId}); await client.invalidateQueries({queryKey: ["scenes", novelId]}); setCreate(null); openSceneTab(novelId, scene)} catch (err) {setError(err instanceof Error ? err.message : "创建失败")} finally {setBusy(false)}}
 const choose = (row: SceneRecord) => {openSceneTab(novelId, row); if (narrow) {setDrawer(false); setPref(prefKey, {focusHeading: buildTabId("scene", novelId, {refId: row.id})})}}
 useEffect(() => {if (active && pref?.focusHeading === ownTabId) {const frame = requestAnimationFrame(() => {root.current?.querySelector<HTMLElement>("[data-scene-heading]")?.focus(); setPref(prefKey, {focusHeading: undefined})}); return () => cancelAnimationFrame(frame)}}, [active, pref?.focusHeading, ownTabId, prefKey, setPref, query.isLoading])
 const browse = (id: string) => {setPref(prefKey, {scope: id, search: ""}); useTabsStore.getState().openTab({id: buildTabId("scenes", novelId), novelId, type: "scenes", title: "场景"})}
 if (query.isLoading) return <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin"/></div>
 if (query.isError) return <div className="flex h-full flex-col items-center justify-center gap-3"><p role="alert">场景加载失败，草稿已保留</p><Button onClick={() => void query.refetch()}>重新加载</Button></div>
 const scene = query.rows.find(s => s.id === selected), base = query.baseRows.find(s => s.id === selected)
 const visibleCards = search.trim() ? tree.cards.filter(row => `${row.name} ${row.coordinates} ${tree.path(row.id)}`.toLowerCase().includes(search.toLowerCase())) : scope ? tree.children.get(scope) ?? [] : tree.cards
 const showDirectory = narrow ? drawer : !pref?.hidden
 return <div ref={root} className="scene-workspace" data-testid="scene-workspace">
 {narrow && drawer && <button type="button" aria-label="关闭场景目录" className="scene-directory-backdrop" onClick={() => {setDrawer(false); restoreButton.current?.focus()}}/>}
 {showDirectory && <aside className={`scene-directory ${narrow ? "scene-directory-overlay" : ""}`} aria-label="场景目录"><div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 text-xs"><strong className="mr-auto">场景目录</strong><span className="text-muted-foreground">{query.rows.length}</span><Button variant="ghost" size="icon" className="size-6" aria-label="创建根场景" onClick={() => startCreate(null)}><Plus className="size-3.5"/></Button><Button variant="ghost" size="icon" className="size-6" aria-label="收起场景目录" onClick={() => {if (narrow) setDrawer(false); else setPref(prefKey, {hidden: true}); requestAnimationFrame(() => restoreButton.current?.focus())}}><PanelLeftClose className="size-3.5"/></Button></div><div className="scene-directory-body"><button type="button" className={`m-2 w-[calc(100%-16px)] rounded-md px-3 py-2 text-left text-xs ${!selected && !scope ? "bg-accent text-primary" : "hover:bg-accent/60"}`} onClick={() => {openAllScenes(novelId); if (narrow) setDrawer(false)}}>全部场景</button><SceneTree rows={query.rows} novelId={novelId} selected={selected ?? scope ?? undefined} instance="internal" onSelect={choose} onCreate={startCreate} onAction={actionFor} overlay={narrow} active={active}/></div></aside>}
 <main className="scene-content"><div className="flex items-center border-b px-3 py-1"><Button ref={restoreButton} size="sm" variant="ghost" aria-label="展开场景目录" aria-expanded={showDirectory} onClick={() => {if (narrow) setDrawer(v => !v); else setPref(prefKey, {hidden: !pref?.hidden})}}><PanelLeftOpen className="size-3.5"/>场景目录</Button></div>
 {selected ? scene && base ? <SceneEditor key={scene.id} scene={scene} base={base} rows={query.rows} onCreate={startCreate} onBrowse={browse} onAll={() => openAllScenes(novelId)}/> : <div className="p-8 text-muted-foreground">该场景已删除或不属于当前作品。<Button variant="ghost" onClick={() => openAllScenes(novelId)}>全部场景</Button></div> : <><header className="scene-heading"><nav aria-label="场景路径" className="mb-2 flex flex-wrap gap-1 text-xs text-muted-foreground"><button onClick={() => openAllScenes(novelId)}>全部场景</button>{scope && (tree.paths.get(scope) ?? []).map(row => <span key={row.id}> / <button onClick={() => browse(row.id)}>{row.name}</button></span>)}</nav><div className="flex items-center justify-between"><h2 tabIndex={-1} data-scene-heading className="text-2xl font-medium">{scope ? tree.byId.get(scope)?.name : "场景"}</h2><Button size="sm" onClick={() => startCreate(scope)}><Plus/>{scope ? "子场景" : "根场景"}</Button></div><p className="mt-3 text-xs text-muted-foreground">由大到小组织空间，所有层级都可以引用到创作对话。</p></header><div className="scene-overview"><div className="flex items-center gap-2"><Input aria-label="搜索全部场景" placeholder="搜索场景名称、位置或路径" value={search} onChange={e => setPref(prefKey, {search: e.target.value})}/>{search && <Button variant="ghost" size="icon" aria-label="清空场景搜索" onClick={() => setPref(prefKey, {search: ""})}><X/></Button>}<Button variant="outline" size="sm" onClick={() => setPref(prefKey, {scope: null, search: ""})}>全部场景</Button></div><p className="text-xs text-muted-foreground">{tree.roots.length} 个根场景 · 共 {query.rows.length} 个场景{search || scope ? ` · 当前 ${visibleCards.length} 个` : ""}</p>
 {!query.rows.length && <div className="py-12 text-center"><MapPin className="mx-auto mb-3 size-9 text-muted-foreground"/><p className="text-sm">还没有场景，从一个根场景开始构建。</p></div>}
 {query.rows.length > 0 && !visibleCards.length && <p className="py-8 text-center text-sm text-muted-foreground">{search ? "没有匹配的场景" : "暂无直接子场景"}</p>}
 <div className="scene-grid" data-testid="scene-cards">{visibleCards.map(row => <article key={row.id} className="scene-card" role="button" tabIndex={0} aria-label={`打开场景 ${tree.path(row.id)}`} draggable onDragStart={e => {if ((e.target as HTMLElement).closest("button")) {e.preventDefault(); return}; startChipDrag(e, sceneChip(row, novelId))}} onClick={() => choose(row)} onKeyDown={e => {if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {e.preventDefault(); choose(row)}}}><div className="scene-card-cover">{row.exteriorImageUrl ? <img src={row.exteriorImageUrl} alt={`${row.name}外景`}/> : <MapPin className="size-6 opacity-40"/>}</div><div className="grid gap-2 p-4"><h3 className="text-sm font-medium">{row.name}</h3><p className="text-xs text-muted-foreground">{sceneFactionLabel(row, factionData?.factions ?? [])}</p><p className="truncate text-[10px] text-muted-foreground" title={tree.path(row.id)}>{tree.path(row.id)}</p>{row.coordinates && <p className="truncate text-xs text-muted-foreground">{row.coordinates}</p>}<p className="line-clamp-2 text-xs text-muted-foreground">{row.description || "暂无介绍"}</p></div><footer className="flex items-center justify-between border-t p-2"><Button size="sm" variant="ghost" onClick={e => {e.stopPropagation(); browse(row.id)}}>{tree.children.get(row.id)?.length ?? 0} 个子场景 ↗</Button><Button size="sm" variant="ghost" className="text-primary" onMouseDown={e => e.preventDefault()} onClick={e => {e.stopPropagation(); quote(novelId, sceneChip(row, novelId))}}>引用</Button></footer></article>)}</div></div></>}
 </main>
 <Dialog open={!!create} onOpenChange={open => {if (!open && !busy) setCreate(null)}}><DialogContent><DialogHeader><DialogTitle>{create?.parentId ? "创建子场景" : "创建根场景"}</DialogTitle><DialogDescription>{create?.parentId ? `上级：${tree.path(create.parentId)}` : "根场景可包含任意层级的子场景"}</DialogDescription></DialogHeader><Label htmlFor="new-scene-name">场景名称</Label><Input id="new-scene-name" autoFocus value={name} maxLength={50} onChange={e => setName(e.target.value)} onKeyDown={e => {if (e.key === "Enter" && name.trim()) void submitCreate()}}/>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setCreate(null)}>取消</Button><Button disabled={busy || !name.trim()} onClick={() => void submitCreate()}>创建场景</Button></DialogFooter></DialogContent></Dialog>
 </div>
}
export function GlobalSceneTree({novelId}: {novelId: string}) {const query = useScenes(novelId); const active = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId)); return <SceneTree rows={query.rows} novelId={novelId} selected={active?.type === "scene" && active.novelId === novelId ? active.refId : undefined} instance="global" onSelect={row => openSceneTab(novelId, row)} onAction={(row, action) => {useSceneUiStore.getState().requestAction(novelId, row.id, action); if (action === "create") openAllScenes(novelId); else openSceneTab(novelId, row)}}/>}
