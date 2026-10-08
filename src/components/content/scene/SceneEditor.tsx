"use client"
/* eslint-disable @next/next/no-img-element -- 同源私有资产沿用用户鉴权，展示原始比例。 */
import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowRight, ImageIcon, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useRegisterCommentSave } from "@/components/comments/comment-save-coordinator"
import { DraftConflictTools } from "../DraftConflictTools"
import { EntityAttributesEditor } from "../EntityAttributesEditor"
import { SaveStatusIndicator, useAutosave } from "../use-autosave"
import { apiGet, apiSend } from "../api"
import { normalizeEntityAttributes, type SceneRecord } from "../types"
import { buildTabId, useTabsStore } from "@/stores/tabs"
import { registerSceneLeaveGuard, useSceneUiStore } from "@/stores/scene-ui"
import { useChatStore } from "@/stores/chat"
import { useStagedChangesStore } from "@/stores/staged-changes"
import { sceneForest } from "@/lib/scene-tree"
import { sceneFactionLabel } from "@/lib/scene-context"
import { useScenes, useSceneFactions } from "./use-scenes"
import { sceneChip } from "./SceneTree"
const fields = ["name", "parentId", "description", "coordinates", "attributes", "backstory", "entryMethod", "exteriorDescription", "interiorDescription", "factionSettingId", "factionId"] as const
function patch(row: SceneRecord) {return Object.fromEntries(fields.map(key => [key, key === "attributes" ? normalizeEntityAttributes(row.attributes) : row[key]]))}
const longFields = [["description", "介绍"], ["backstory", "背景故事"], ["entryMethod", "进入方式"], ["exteriorDescription", "外部描写"], ["interiorDescription", "内部描写"]] as const
export function SceneEditor({scene, base, rows, onCreate, onBrowse, onAll}: {scene: SceneRecord; base: SceneRecord; rows: SceneRecord[]; onCreate: (id: string) => void; onBrowse: (id: string) => void; onAll: () => void}) {
 const novelId = scene.novelId, id = scene.id
 const account = useChatStore(s => s.accountId); const key = `${account}:${novelId}:draft:${id}`
 const stored = useSceneUiStore.getState().drafts[key]
 const [form, setForm] = useState(() => stored?.value ?? scene); const current = useRef(form)
 const baseline = useRef(stored?.baseline ?? base.version); const lastVersion = useRef(base.version)
 const initialRecovery = useRef(!!stored); const requests = useRef(new Map<string, number>())
 const [error, setError] = useState(""); const [conflict, setConflict] = useState(!!stored && stored.baseline !== base.version)
 const [factionSearch, setFactionSearch] = useState("")
 const [dialog, setDialog] = useState<"move" | "delete" | null>(null); const [parent, setParent] = useState<string | null>(scene.parentId); const [busy, setBusy] = useState(false)
 const client = useQueryClient(); const draftStore = useSceneUiStore
 const {changes} = useScenes(novelId)
 const commitError = draftStore(s => s.commitErrors[key])
 const staged = changes.some(c => c.targetKind === "SCENE" && c.targetId === id)
 const pendingDelete = changes.some(c => c.targetKind === "SCENE" && c.targetId === id && c.op === "delete")
 const {data: factionData} = useSceneFactions(novelId)
 const factions = factionData?.factions ?? []; const factionGroups = [...new Set(factions.map(f => f.path ?? "作品势力"))]; const tree = sceneForest(rows)
 const tabId = buildTabId("scene", novelId, {refId: id})
 const autosave = useAutosave<SceneRecord>(async (value, attempt) => {
   if (conflict) throw new Error("场景已有新修订，请比较后保存；本地草稿已保留")
   const version = requests.current.get(attempt.operationId) ?? baseline.current; requests.current.set(attempt.operationId, version)
   draftStore.getState().setDraft(key, {value, baseline: version, operationId: attempt.operationId})
   try { const result = await apiSend<{scene: SceneRecord}>(`/api/novels/${novelId}/scenes/${id}`, "PATCH", {...patch(value), expectedVersion: version, operationId: attempt.operationId}, "保存场景失败")
     const isStaged = Object.values(useStagedChangesStore.getState().batches).flatMap(b => b.changes).some(c => c.targetId === id && c.targetKind === "SCENE")
     if (!isStaged) {baseline.current = result.scene.version; draftStore.getState().setDraft(key, null); client.setQueryData<{scenes: SceneRecord[]}>(["scenes", novelId], old => ({scenes: (old?.scenes ?? []).map(row => row.id === id ? result.scene : row)}))}
     else draftStore.getState().setDraft(key, {value, baseline: version, operationId: attempt.operationId, saved: true})
     setError("")
   } catch (err) {setError(err instanceof Error ? err.message : "保存失败"); throw err}
 })
 useEffect(() => {
   if (initialRecovery.current) {initialRecovery.current = false; if (!conflict && !staged && JSON.stringify(patch(form)) !== JSON.stringify(patch(base))) autosave.schedule(form)}
 }, [autosave, base, conflict, form, staged])
 useEffect(() => {
   if (lastVersion.current === base.version) return
   lastVersion.current = base.version
   const equal = JSON.stringify(patch(current.current)) === JSON.stringify(patch(base))
   if (equal || !draftStore.getState().drafts[key]) {baseline.current = base.version; setForm(base); current.current = base; draftStore.getState().setDraft(key, null); autosave.controller.confirmExternal(autosave.controller.revision); setConflict(false); setError("")}
   else {setConflict(true); autosave.controller.pause()}
 }, [base, key, autosave.controller, draftStore])
 useEffect(() => registerSceneLeaveGuard(tabId, async () => {if (conflict) throw new Error("请先比较新修订，或明确放弃本地草稿"); if (!current.current.name.trim()) throw new Error("请填写场景名称，草稿已保留"); await autosave.flush()}), [tabId, autosave, conflict])
 const update = (data: Partial<SceneRecord>) => {const next = {...current.current, ...data}; current.current = next; setForm(next); draftStore.getState().setDraft(key, {value: next, baseline: baseline.current}); if (next.name.trim()) autosave.schedule(next)}
 useRegisterCommentSave(novelId, "SCENE", id, {
   identity: autosave.controller, flush: async () => {await autosave.flush(); if (Object.values(useStagedChangesStore.getState().batches).some(b => b.novelId === novelId && b.changes.some(c => c.targetId === id)) || Object.values(draftStore.getState().submissions).some(sub => sub.accountId === account && sub.batch.novelId === novelId && sub.batch.changes.some(c => c.targetId === id))) throw new Error("请先提交场景的待保存资料，再采用评论修改")}, revision: () => autosave.controller.revision,
   read: () => ({text: current.current.description, version: baseline.current, updatedAt: base.updatedAt}),
   pause: () => autosave.controller.pause(), conflict: message => {autosave.controller.pause(); setConflict(true); setError(message)},
   receive: (receipt, text, revision) => {if (!autosave.controller.confirmExternal(revision)) {setConflict(true); setError("评论保存期间有新输入，请比较当前稿"); return}; const next = {...current.current, description: text, version: receipt.version!, updatedAt: receipt.updatedAt}; current.current = next; setForm(next); baseline.current = receipt.version!; draftStore.getState().setDraft(key, null); autosave.controller.resume(); setConflict(false); setError(""); void client.invalidateQueries({queryKey: ["scenes", novelId]})},
 })
 useEffect(() => {
  const handle = () => {const action = useSceneUiStore.getState().action; if (useTabsStore.getState().activeTabId !== tabId || !action || action.novelId !== novelId || action.sceneId !== id || action.type === "create") return; useSceneUiStore.getState().clearAction(); setParent(current.current.parentId); setDialog(action.type)}
  const unsubscribe = useSceneUiStore.subscribe(handle), tabUnsubscribe = useTabsStore.subscribe(handle); queueMicrotask(handle); return () => {unsubscribe(); tabUnsubscribe()}
 }, [id, novelId, tabId])
 const hasSent = () => Object.values(draftStore.getState().submissions).some(sub => sub.accountId === account && sub.batch.novelId === novelId && sub.batch.changes.some(c => c.targetId === id))
 const readCurrent = async () => {const {scene: latest} = await apiGet<{scene: SceneRecord}>(`/api/novels/${novelId}/scenes/${id}`); return {title: `场景 v${latest.version}`, text: "```json\n" + JSON.stringify(patch(latest), null, 2) + "\n```", data: latest}}
 const adopt = (row: SceneRecord) => {if (hasSent()) throw new Error("场景已发送，须先核对落库结果再放弃"); useStagedChangesStore.getState().discardTarget(novelId, id); draftStore.getState().setCommitError(key, null); baseline.current = row.version; lastVersion.current = row.version; current.current = row; setForm(row); draftStore.getState().setDraft(key, null); autosave.controller.confirmExternal(autosave.controller.revision); setConflict(false); setError("")}
 const mutate = async () => {setBusy(true); setError(""); try {
   await autosave.flush()
   if (dialog === "move") {const next = {...current.current, parentId: parent}; update(next); await autosave.flush(); toast.success("场景移动待保存")}
   else {await apiSend(`/api/novels/${novelId}/scenes/${id}`, "DELETE", {expectedVersion: baseline.current, operationId: crypto.randomUUID()}, "删除场景失败"); if (!Object.values(useStagedChangesStore.getState().batches).flatMap(b => b.changes).some(c => c.targetId === id && c.op === "delete")) {draftStore.getState().setDraft(key, null); useTabsStore.getState().closeTab(tabId); await client.invalidateQueries({queryKey: ["scenes", novelId]})} else toast.success("删除请求待保存，提交时会核对引用")}
   setDialog(null)
 } catch (err) {setError(err instanceof Error ? err.message : "操作失败")} finally {setBusy(false)} }
 const openImage = (kind: "exterior" | "interior") => useTabsStore.getState().openTab({id: buildTabId("scene-image", novelId, {refId: id, sceneImageKind: kind}), novelId, type: "scene-image", refId: id, sceneImageKind: kind, title: `${kind === "exterior" ? "外部" : "内部"}示意图 · ${form.name}`})
 return <>
 <header className="scene-heading"><div className="flex min-w-0 flex-wrap items-center gap-2"><h2 tabIndex={-1} data-scene-heading className="mr-auto truncate text-xl font-medium">{form.name}</h2><SaveStatusIndicator status={staged ? "pending" : autosave.status}/><Button size="sm" variant="ghost" onMouseDown={e => e.preventDefault()} onClick={() => draftStore.getState().quote(novelId, sceneChip(form, novelId))}>引用</Button><Button size="icon" variant="ghost" aria-label="移动场景" onClick={() => {setParent(form.parentId); setDialog("move")}}><ArrowRight/></Button><Button size="icon" variant="ghost" aria-label="删除场景" onClick={() => setDialog("delete")}><Trash2/></Button></div>
 <nav aria-label="场景路径" className="mt-2 flex flex-wrap gap-1 text-xs text-muted-foreground"><button onClick={onAll}>全部场景</button><span> / </span>{(tree.paths.get(id) ?? []).map((row, i) => <span key={row.id}>{i > 0 && " / "}<button onClick={() => onBrowse(row.id)}>{row.name}</button></span>)}</nav></header>
 <div className="scene-detail">
 {(error || commitError || conflict || pendingDelete) && <div role="alert" className="rounded-card border border-destructive/40 bg-destructive/5 p-3 text-sm">{conflict ? "服务器已有新修订。本地草稿已保留，请比较后选择。" : commitError || error || "该场景有待提交的删除请求；提交成功后才会删除。"}<div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void autosave.retry().catch(err => setError(err.message))}>重试原保存</Button><DraftConflictTools readLocal={() => ({title: "本地全部资料", text: "```json\n" + JSON.stringify(patch(current.current), null, 2) + "\n```", data: current.current})} readCurrent={readCurrent} revision={() => autosave.controller.revision} pause={() => autosave.controller.pause()} adoptCurrent={current => adopt(current.data)} saveLocal={async (latest, local, operationId, revision) => {if (revision !== autosave.controller.revision) throw new Error("比较期间又有编辑"); if (hasSent()) throw new Error("场景已发送，须先核对落库结果"); useStagedChangesStore.getState().discardTarget(novelId, id); baseline.current = latest.data.version; current.current = local.data; setForm(local.data); setConflict(false); autosave.controller.confirmExternal(revision); draftStore.getState().setDraft(key, {value: local.data, baseline: latest.data.version, operationId}); await apiSend(`/api/novels/${novelId}/scenes/${id}`, "PATCH", {...patch(local.data), expectedVersion: latest.data.version, operationId}); setError("")}}/><Button size="sm" variant="ghost" onClick={() => {if (window.confirm("放弃本地草稿并载入当前稿？")) void readCurrent().then(current => adopt(current.data)).catch(err => setError(err.message))}}>放弃本地草稿</Button></div></div>}
 <div className="scene-grid">{(["exterior", "interior"] as const).map(kind => {const url = scene[`${kind}ImageUrl`]; return <section key={kind}><button type="button" onClick={() => openImage(kind)} aria-label={`打开场景${kind === "exterior" ? "外部" : "内部"}示意图生成面板`} className="scene-image-slot">{url ? <img src={url} alt={`${form.name}${kind === "exterior" ? "外部" : "内部"}示意图`}/> : <span className="flex flex-col items-center gap-2"><ImageIcon className="size-6"/><span>添加{kind === "exterior" ? "外部" : "内部"}示意图</span></span>}</button><p className="mt-2 text-xs text-muted-foreground">场景{kind === "exterior" ? "外部" : "内部"}示意图 · 点击进入图片工作台</p></section>})}</div>
 <div className="scene-grid"><div className="grid gap-2"><Label htmlFor={`scene-name-${id}`}>名称</Label><Input id={`scene-name-${id}`} value={form.name} maxLength={50} onChange={e => update({name: e.target.value})} onBlur={() => autosave.saveNow()}/></div><div className="grid gap-2"><Label htmlFor={`scene-coordinates-${id}`}>坐标（位置）</Label><Input id={`scene-coordinates-${id}`} value={form.coordinates} maxLength={200} onChange={e => update({coordinates: e.target.value})} onBlur={() => autosave.saveNow()}/></div></div>
 <section className="grid gap-2"><Label htmlFor={`scene-faction-${id}`}>所属势力</Label><Input aria-label="搜索所属势力" placeholder="搜索势力名称或世界路径" value={factionSearch} onChange={e => setFactionSearch(e.target.value)}/><select id={`scene-faction-${id}`} className="h-9 rounded-md border bg-background px-3 text-sm" value={form.factionId ? `${form.factionSettingId}:${form.factionId}` : ""} onChange={e => {const selected = factions.find(f => `${f.settingId}:${f.id}` === e.target.value); update({factionSettingId: selected?.settingId ?? null, factionId: selected?.id ?? null, factionNameSnapshot: selected?.name ?? null})}}><option value="">未指定</option>{form.factionId && !factions.some(f => f.id === form.factionId && f.settingId === form.factionSettingId) && <option value={`${form.factionSettingId}:${form.factionId}`}>{form.factionNameSnapshot}（已失效）</option>}{factionGroups.map(path => <optgroup key={path} label={path}>{factions.filter(f => (f.path ?? "作品势力") === path && (!factionSearch || `${f.path} ${f.name}`.toLowerCase().includes(factionSearch.toLowerCase()) || f.id === form.factionId && f.settingId === form.factionSettingId)).map(f => <option key={`${f.settingId}:${f.id}`} value={`${f.settingId}:${f.id}`}>{f.name}</option>)}</optgroup>)}</select><div className="flex items-center gap-2 text-xs text-muted-foreground"><span>{sceneFactionLabel(form, factions)}</span>{form.factionSettingId && <Button size="sm" variant="ghost" onClick={() => {const faction = factions.find(f => f.settingId === form.factionSettingId && f.id === form.factionId); const tab = faction?.worldId ? buildTabId("world", novelId, {refId: faction.worldId}) : buildTabId("setting", novelId, {settingType: "FACTION"}); useTabsStore.getState().openTab(faction?.worldId ? {id: tab, novelId, type: "world", refId: faction.worldId, title: faction.path ?? "世界观"} : {id: tab, novelId, type: "setting", settingType: "FACTION", title: "势力分布"}); useTabsStore.getState().requestPanelFocus(tab, form.factionSettingId!, form.factionId ? `faction-id:${form.factionId}` : undefined)} }>查看势力来源</Button>}{!factions.length && "请先在世界观的势力分布中创建具体势力"}</div></section>
 {longFields.map(([field, label]) => <section key={field} aria-label={label} className="grid min-w-0 gap-2">
   <Label htmlFor={`scene-${field}-${id}`}>{label}</Label>
   <Textarea id={`scene-${field}-${id}`} value={form[field]} onChange={e => update({[field]: e.target.value})} onBlur={() => autosave.saveNow()} className="min-w-0 resize-none rounded-card bg-editor dark:bg-editor" placeholder={`补充${label}…`}/>
 </section>)}
 <section className="grid gap-2"><Label>属性</Label><EntityAttributesEditor novelId={novelId} target="SCENE" value={normalizeEntityAttributes(form.attributes)} onChange={attributes => update({attributes})} onBlurSave={() => autosave.saveNow()}/></section>
 <section className="rounded-card border p-4"><div className="flex items-center justify-between"><h3 className="font-medium">子场景 · {tree.children.get(id)?.length ?? 0}</h3><Button variant="outline" size="sm" onClick={() => onCreate(id)}><Plus/>子场景</Button></div>{(tree.children.get(id) ?? []).map(child => <Button key={child.id} variant="ghost" onClick={() => onBrowse(child.id)}>{child.name}</Button>)}</section>
 </div>
 <Dialog open={dialog !== null} onOpenChange={open => {if (!busy && !open) setDialog(null)}}><DialogContent><DialogHeader><DialogTitle>{dialog === "move" ? "移动场景" : "删除场景"}</DialogTitle><DialogDescription>{dialog === "move" ? "子场景随父级一起移动。提交时会重新校验包含关系与同级重名。" : "有子场景或现行引用时不能删除，提交失败会列出来源。"}</DialogDescription></DialogHeader>{dialog === "move" && <select aria-label="新的上级场景" value={parent ?? ""} onChange={e => setParent(e.target.value || null)} className="h-9 w-full rounded-md border bg-background"><option value="">根场景</option>{tree.ordered.filter(row => row.id !== id && !tree.descendants(id).has(row.id)).map(row => <option key={row.id} value={row.id}>{tree.path(row.id)}</option>)}</select>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>取消</Button><Button disabled={busy} onClick={() => void mutate()}>{dialog === "move" ? "确认移动" : "确认删除"}</Button></DialogFooter></DialogContent></Dialog>
 </>
}
