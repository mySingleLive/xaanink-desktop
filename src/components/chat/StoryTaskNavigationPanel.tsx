"use client"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, ChevronRight, MessageCircleQuestion } from "lucide-react"
import { MarkdownEditor } from "@/components/editor/MarkdownEditor"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/stores/chat"
import { WORLD_SETTING_TYPES, SETTING_TYPE_LABELS } from "@/lib/setting-types"
import { TASK_CATALOG, TASK_TEMPLATES, meaningfulRequirements } from "@/lib/story-navigation"
import { pendingQuestionSchema } from "@/lib/chat-protocol"
import { taskScopeSchema, materialChapterReferenceOptions, type NavigationEntity, type StorySelection, type TaskScope } from "@/lib/story-task"
import type { PendingQuestion } from "./types"
import { ModelPicker } from "./ModelPicker"
import { formatCostEstimate } from "./cost-estimate"
import { TaskReferenceInput } from "./TaskReferenceInput"

type CatalogTask = Extract<StorySelection, { kind: "catalog" }>["taskId"]
type Draft = { scope: TaskScope; text: string }
function parentPath(path: string[]) {
  return path.slice(0, -1)
}
const inputStyle = "w-full min-w-0 rounded-md border border-input bg-editor px-3 py-2 text-xs outline-none focus:border-ring"
function EntitySelect({ label, value, options, onChange, required }: { label: string; value?: string; options: { key: string; title: string }[]; onChange: (key: string) => void; required?: boolean }) {
  return <label className="grid min-w-0 gap-2 text-xs font-medium">{label}{required ? "（必选）" : ""}<select className={inputStyle} value={value ?? ""} onChange={event => onChange(event.target.value)}><option value="">{required ? "请选择…" : "由 AI 结合上下文确定"}</option>{value && !options.some(o => o.key === value) && <option value={value}>引用已失效，请重新选择</option>}{options.map(o => <option key={o.key} value={o.key}>{o.title}</option>)}</select></label>
}
export function StoryTaskNavigationPanel({ pending, onSubmit, onCancel }: { pending: PendingQuestion; onSubmit: (text: string, selection?: StorySelection) => void | Promise<void>; onCancel: () => void }) {
  const navigation = pending.storyNavigation!
  const entities = navigation.entities ?? []
  const catalogEntities = entities.filter(entity => entity.kind !== "chapter-content")
  const account = useChatStore(s => s.accountId), conversation = useChatStore(s => s.conversationId)
  const storageKey = `story-navigation:${account}:${conversation}:${pending.interaction?.id ?? "draft"}`
  const [path, setPath] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    try { const raw: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}"); if (!raw || typeof raw !== "object") return {}; return Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => { const draft = value as Draft; const scope = taskScopeSchema.safeParse(draft?.scope); return scope.success && typeof draft.text === "string" ? [[key, { scope: scope.data, text: draft.text }]] : [] })) } catch { return {} }
  })
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), guard = useRef(false)
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(drafts)) } catch { /* In-memory drafts still survive navigation. */ } }, [drafts, storageKey])
  const task = (path.find(p => p !== "catalog" && p !== "form") ?? "") as CatalogTask
  const atCatalog = path.at(-1) === "catalog"
  const home = !path.length
  const back = () => { setPath(parentPath); setError("") }
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !busy) { event.preventDefault(); if (path.length) setPath(parentPath); else onCancel() } }
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key)
  }, [path.length, onCancel, busy])
  const focus = catalogEntities.find(e => e.key === navigation.targets[0].key)
  const narratives = entities.filter(e => e.kind === "narrative")
  const worldlines = entities.filter(e => e.kind === "worldline")
  // 卷章大纲的来源：已有实际讲述卡片的主叙事线（与世界线/叙事线任务同一口径）
  const outlineSources = narratives.filter(e => (e.tellingCardCount ?? 0) > 0)
  const catalog = TASK_CATALOG.filter(entry => entry.task !== "outline" || outlineSources.length > 0)
  const worlds = entities.filter(e => e.kind === "world")
  const defaultPlot = focus?.kind === "narrative" || focus?.kind === "worldline" ? focus.key : outlineSources.find(e => e.primary)?.key ?? (narratives.length === 1 ? narratives[0].key : undefined) ?? (worldlines.length === 1 ? worldlines[0].key : undefined)
  const defaultWorld = focus?.kind === "world" ? focus.key : focus?.worldId ? `world:${focus.worldId}` : worlds.length === 1 ? worlds[0].key : undefined
  const defaultDraft = (selected: CatalogTask): Draft => ({ text: TASK_TEMPLATES[selected], scope: { targetKeys: selected === "revise" && focus ? [focus.key] : selected === "arc" && focus?.kind === "character" ? [focus.key] : [], sourceKeys: selected === "outline" ? (outlineSources.some(e => e.key === defaultPlot) ? [defaultPlot!] : outlineSources.length === 1 ? [outlineSources[0].key] : []) : ["plot", "arc", "scene"].includes(selected) && defaultPlot ? [defaultPlot] : [], ...(["world", "scene", "item"].includes(selected) ? { worldKey: defaultWorld } : {}), ...(selected === "arc" ? { arcMode: focus?.stages?.length ? "append" as const : "create" as const } : {}) } })
  const draft = task ? drafts[task] ?? defaultDraft(task) : undefined
  const update = (patch: Partial<Draft>) => setDrafts(current => ({ ...current, [task]: { ...(current[task] ?? defaultDraft(task)), ...patch } }))
  const scope = (patch: Partial<TaskScope>) => update({ scope: { ...draft!.scope, ...patch } })
  const openTask = (selected: CatalogTask) => { setPath(p => [...p, selected]); setError("") }
  const send = async (label: string, selection: StorySelection) => {
    if (guard.current) return
    guard.current = true; setBusy(true); setError("")
    try { await onSubmit(`【回答问题】「${navigation.title}」接下来做什么？\n我的回答：${label}`.slice(0, 4000), selection) }
    catch (e) { setError(e instanceof Error ? e.message : "提交失败，草稿已保留") }
    finally { guard.current = false; setBusy(false) }
  }
  const refresh = async () => {
    const interaction = pending.interaction
    if (!interaction || guard.current) return
    guard.current = true; setBusy(true); setError("")
    try {
      const response = await fetch(`/api/chat/turns/${interaction.turnId}/navigation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: interaction.id, revision: interaction.revision }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "重新核对失败")
      const payload = pendingQuestionSchema.parse(data.payload)
      if (useChatStore.getState().conversationId === conversation && useChatStore.getState().pendingQuestion?.interaction?.id === interaction.id) useChatStore.setState({ pendingQuestion: { ...payload, interaction: { ...interaction, revision: data.revision } } })
    } catch (e) { setError(e instanceof Error ? e.message : "重新核对失败") }
    finally { guard.current = false; setBusy(false) }
  }
  const refs = (label: string, options: NavigationEntity[]) => {
    const belongsToField = (key: string) => options.some(o => o.key === key) || !entities.some(e => e.key === key)
    return <TaskReferenceInput label={label} options={options} value={draft!.scope.sourceKeys.filter(belongsToField)} onChange={keys => scope({ sourceKeys: [...draft!.scope.sourceKeys.filter(key => !belongsToField(key)), ...keys] })} />
  }
  const target = entities.find(e => e.key === draft?.scope.targetKeys[0])
  const startTask = () => {
    if (!draft) return
    if (task === "arc" && !target || task === "revise" && !target) { setError("请选择具体对象"); return }
    if (task === "arc" && draft.scope.arcMode === "replace" && !draft.scope.stageIds?.length) { setError("请选择要调整的阶段"); return }
    if (["custom", "revise"].includes(task) && !meaningfulRequirements(task, draft.text)) { setError("请填写具体目标或修改要求"); return }
    if (task === "outline" && draft.scope.sourceKeys.some(key => !outlineSources.some(e => e.key === key))) { setError("请选择已有实际讲述卡片的叙事线"); return }
    const label = TASK_CATALOG.find(t => t.task === task)!.label
    const names = [...draft.scope.targetKeys, ...draft.scope.sourceKeys].map(key => entities.find(e => e.key === key)?.title).filter(Boolean)
    void send(`${label}${names.length ? `（${names.join("、")}）` : ""}\n${draft.text}`, { kind: "catalog", taskId: task, scope: draft.scope, requirements: draft.text })
  }
  return <section data-testid="story-task-navigation" aria-label="创作下一步" className="mx-auto max-h-[min(80dvh,820px)] w-full max-w-[960px] overflow-auto rounded-composer border border-(--chat-line-strong) bg-chat-surface text-foreground">
    <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5"><MessageCircleQuestion className="size-4 shrink-0 text-primary" /><span className="flex-1 text-[12.5px] font-medium">{navigation.accepted ? "接下来做什么？" : "这一版如何继续？"}</span><ModelPicker /></header>
    <div className="space-y-1 border-b border-border p-3.5 text-xs"><div className="text-[11px] text-muted-foreground">当前内容</div><strong>{navigation.title}</strong><span className="ml-2 text-muted-foreground">{navigation.accepted ? "已认可当前版" : navigation.score !== null ? `${navigation.score} 分 · 合格线 ${navigation.threshold} 分` : navigation.structureChecked ? "结构检查通过 · 未做 AI 质量评分" : "当前版本待核对"}</span><p className="text-muted-foreground">{navigation.accepted ? "选择一项继续，当前版无需重复认可。" : "“认可并…”仅接受此处当前版本，并开始所写任务。"}</p></div>
    {pending.costEstimate && <p className="border-b border-border px-3.5 py-2 text-xs text-muted-foreground">本章正文预计消耗 {formatCostEstimate(pending.costEstimate)} 墨滴</p>}
    {home ? <>
      <div className="p-2" aria-label="推荐任务">{navigation.choices.map((choice, index) => <button key={choice.id} disabled={busy} type="button" className={`flex min-h-14 w-full items-start gap-2 rounded-md p-2 text-left hover:bg-accent disabled:opacity-50 ${index === 0 ? "bg-muted/40" : ""}`} onClick={() => void send(choice.label, { kind: "choice", choiceId: choice.id! })}><span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] text-muted-foreground">{String.fromCharCode(65 + index)}</span><span className="min-w-0 flex-1"><span className="text-[13px] font-medium">{choice.label}</span><small className="mt-1 block text-xs text-muted-foreground">{choice.description}</small></span><ChevronRight className="mt-1 size-3 shrink-0" /></button>)}{!navigation.choices.length && <p className="p-2 text-xs text-muted-foreground">当前没有已确认的待办，可选择其他任务。</p>}</div>
      <details className="px-3.5 pb-3 text-xs text-muted-foreground"><summary className="cursor-pointer">已核对进度 · {navigation.verifiedProgress?.length ?? 0} 项依据</summary><ul className="mt-2 space-y-1">{navigation.verifiedProgress?.map((line, i) => <li key={i}>{line}</li>)}</ul></details>
      <div className="flex gap-4 border-t border-border px-3.5 py-2 text-xs"><button disabled={busy} onClick={() => openTask("revise")}>修改要求</button><button disabled={busy} onClick={() => setPath(["catalog"])}>其他任务 +</button><button disabled={busy} className="ml-auto text-muted-foreground" onClick={refresh}>重新核对</button></div>
    </> : <div className="border-b border-border px-3.5 py-2"><button disabled={busy} className="flex items-center gap-1 text-xs" onClick={back}><ArrowLeft className="size-3.5" />返回</button></div>}
    {atCatalog && <div className="max-h-[340px] overflow-auto p-2" aria-label="其他任务目录"><h3 className="px-2 py-1 text-xs font-medium">选择其他方向</h3><p className="px-2 py-1 text-[11px] text-muted-foreground">可主动拓展新的内容，选择后填写具体范围。</p>{catalog.map((entry, index) => <div key={entry.task}>{index === 0 || catalog[index - 1].group !== entry.group ? <p className="mb-1 mt-3 pl-9 text-[11px] text-muted-foreground">{entry.group}</p> : null}<button disabled={busy} className="flex min-h-12 w-full items-center gap-2 rounded-md p-2 text-left text-[13px] hover:bg-accent" onClick={() => openTask(entry.task)}><span className="flex size-5 items-center justify-center rounded-full border text-[11px] text-muted-foreground">{String.fromCharCode(68 + index)}</span><span className="flex-1">{entry.label}</span><ChevronRight className="size-3" /></button></div>)}</div>}
    {task && draft && <div className="space-y-4 p-3.5" aria-label={TASK_CATALOG.find(t => t.task === task)?.label}>
      <div><h3 className="text-sm font-medium">{TASK_CATALOG.find(t => t.task === task)?.label}</h3><p className="mt-2 text-xs text-muted-foreground">{["custom", "revise"].includes(task) ? "填写具体目标或修改要求，AI 将结合所选内容与当前故事继续处理。" : "按需填写，留空的细节由 AI 结合当前设定、剧情和世界观补全。"}</p></div>
      <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2">
        {task === "arc" && <><EntitySelect label="设计对象" required options={entities.filter(e => e.kind === "character")} value={draft.scope.targetKeys[0]} onChange={key => scope({ targetKeys: key ? [key] : [], stageIds: undefined, arcMode: entities.find(e => e.key === key)?.stages?.length ? "append" : "create" })} /><EntitySelect label="设计方式" required value={draft.scope.arcMode} options={target?.stages?.length ? [{ key: "append", title: "补充后续阶段" }, { key: "replace", title: "调整已有阶段" }] : [{ key: "create", title: "首次设计弧线" }]} onChange={key => scope({ arcMode: key as TaskScope["arcMode"], stageIds: undefined })} /></>}
        {["world", "scene", "item"].includes(task) && <EntitySelect label="所属世界" options={worlds} value={draft.scope.worldKey} onChange={key => scope({ worldKey: key || undefined })} />}
        {task === "world" && <EntitySelect label="设定类别" options={WORLD_SETTING_TYPES.map(key => ({ key, title: SETTING_TYPE_LABELS[key] }))} value={draft.scope.category} onChange={key => scope({ category: key || undefined })} />}
        {task === "outline" && <><EntitySelect label="卷章范围" options={entities.filter(e => e.kind === "volume")} value={draft.scope.volumeKey} onChange={key => scope({ volumeKey: key || undefined })} /><EntitySelect label="组织方式" options={[{ key: "按事件顺序", title: "按事件顺序" }, { key: "按主要冲突", title: "按主要冲突" }]} value={draft.scope.structure} onChange={key => scope({ structure: key || undefined })} /></>}
        {task === "revise" && <EntitySelect label="修改对象" required options={catalogEntities} value={draft.scope.targetKeys[0]} onChange={key => scope({ targetKeys: key ? [key] : [] })} />}
      </div>
      {task === "arc" && draft.scope.arcMode === "replace" && <TaskReferenceInput label="调整阶段" options={(target?.stages ?? []).map(s => ({ key: s.id, title: s.name, kind: "stage", hash: "" }))} value={draft.scope.stageIds ?? []} onChange={stageIds => scope({ stageIds })} />}
      {["arc", "plot", "outline", "scene"].includes(task) && refs(task === "outline" ? "卷章来源叙事线" : "参考叙事线/世界线", task === "outline" ? outlineSources : task === "plot" ? [...narratives, ...worldlines] : narratives)}
      {task === "world" && refs("参考已有设定", entities.filter(e => e.kind === "setting"))}
      {["scene", "item"].includes(task) && refs("相关角色", entities.filter(e => e.kind === "character"))}
      {["scene", "item"].includes(task) && refs("参考章纲/已采用正文", materialChapterReferenceOptions(entities))}
      {task === "custom" && refs("参考内容", catalogEntities)}
      <div onKeyDownCapture={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !(event.target as Element).closest('[role="combobox"]')) { event.preventDefault(); event.stopPropagation(); startTask() } }}><div className="mb-2 text-xs">{task === "character" ? "角色创建提示词" : "创作要求"} <span className="text-muted-foreground">{["custom", "revise"].includes(task) ? "请填写具体要求" : "选填 · 留空由 AI 补全"}</span></div><MarkdownEditor value={draft.text} onChange={text => update({ text })} readOnly={busy} className="h-[210px]" /><p className="mt-1 text-[11px] text-muted-foreground">Enter 开始任务 · Shift+Enter 换行</p></div>
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3"><span className="text-[11px] text-muted-foreground">不自动认可当前版。</span><Button size="sm" disabled={busy} onClick={startTask}>{task === "character" ? "开始创建角色" : task === "outline" ? "开始整理大纲" : task === "arc" ? "开始设计弧线" : "开始任务"}<ArrowRight className="size-3" /></Button></div>
    </div>}
    {error && <p role="alert" className="px-3.5 py-2 text-xs text-destructive">{error}</p>}
    <footer className="flex flex-wrap items-center gap-4 border-t border-border px-3.5 py-3 text-xs">{navigation.shortcuts.filter(c => c.task !== "choose").map(c => <button disabled={busy} key={c.id} className="text-primary" onClick={() => void send(c.label, { kind: "choice", choiceId: c.id! })}>{c.label}</button>)}<button disabled={busy} onClick={() => setPath(["catalog"])}>暂存并换任务</button><button disabled={busy} onClick={onCancel}>暂停</button></footer>
  </section>
}
