"use client"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { LoaderCircle, RefreshCw, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { saveDesktopModel, useDesktopStore } from "@/stores/desktop"
import { parseContextWindow, type PublicModel } from "@desktop/core/settings"
import type { ModelDraft } from "@desktop/main/model-repository"
import { presetsFor, type ConfigurationDraft, type ConfigurationProviderId, type CatalogResult, type ConnectionTestResult, type ConfigurationFailure } from "@desktop/shared/model-catalog"
import { ModelChoiceSelect } from "./ModelChoiceSelect"

type Draft = Omit<ModelDraft,"protocol"> & { protocol: ModelDraft["protocol"] | "" }
function Field({ title, children }: { title: string; children: ReactNode }) { return <div className="desktop-model-field"><div className="mb-2 text-sm">{title}</div>{children}</div> }
export function ModelConfigurationDialog({ kind, model, onClose, finalFocus }: { kind: "TEXT" | "IMAGE"; model?: PublicModel; onClose(): void; finalFocus?: () => HTMLElement | null }) {
  const models = useDesktopStore(state => state.bootstrap!.models)
  const initial = presetsFor(kind)[0]
  const [draft,setDraft] = useState<Draft>(() => model ? { ...model, apiKey:"" } : { name:"",provider:initial.id,protocol:initial.protocol!,endpoint:(kind === "TEXT" ? initial.textEndpoint : initial.imageEndpoint)!,modelId:"",kind,contextWindow:0,enabled:true,thinkingLevels:[],defaultThinking:"default",apiKey:"" })
  const [context,setContext] = useState(model?.contextWindow ? String(model.contextWindow) : "")
  const [catalog,setCatalog] = useState<CatalogResult | null>(null)
  const [catalogError,setCatalogError] = useState("")
  const [busy,setBusy] = useState<"" | "test" | "save">("")
  const [discovering,setDiscovering] = useState(false)
  const [error,setError] = useState("")
  const [result,setResult] = useState<ConnectionTestResult | ConfigurationFailure | null>(null)
  const [tested,setTested] = useState<{ provider:string; endpoint:string; modelId:string } | null>(null)
  const operation = useRef<string | null>(null), discovery = useRef<string | null>(null), alive = useRef(true), locking = useRef(false)
  const testButton = useRef<HTMLButtonElement>(null)
  const custom = draft.provider === "custom"
  const scopeMatches = !!model && model.provider === draft.provider && model.protocol === draft.protocol && model.endpoint === draft.endpoint && model.kind === draft.kind
  const hasKey = !!draft.apiKey.trim() || scopeMatches
  function cancelRequests() {
    for (const ref of [operation,discovery]) { const id = ref.current; ref.current = null; if (id) void window.desktop?.cancelModelConfiguration(id).catch(() => {}) }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancelRequests() } }, [])
  function close() { if (busy === "save" || locking.current && !operation.current) return; alive.current = false; cancelRequests(); onClose() }
  function edit(change: Partial<Draft>, clearScope = false) {
    if (locking.current) return
    if (discovery.current) { void window.desktop?.cancelModelConfiguration(discovery.current).catch(() => {}); discovery.current = null }
    setDiscovering(false); setCatalog(null); setCatalogError(""); setError(""); setResult(null)
    setDraft(before => ({...before,...change,...(clearScope ? {apiKey:"",thinkingLevels:[],defaultThinking:"default"} : {})}))
  }
  function configuration(): ConfigurationDraft {
    if (!draft.protocol) throw new Error("请选择协议")
    return { ...(draft.id ? {id:draft.id} : {}),provider:draft.provider as ConfigurationProviderId,kind,protocol:draft.protocol,endpoint:draft.endpoint,apiKey:draft.apiKey,modelId:draft.modelId }
  }
  function savedDraft(): ModelDraft {
    const config = configuration()
    if (!hasKey) throw new Error("请输入 API Key")
    if (!draft.modelId.trim()) throw new Error(custom ? "请输入模型 ID" : "请选择可用模型")
    if (!draft.name.trim()) throw new Error("请输入展示名称")
    if (custom && !draft.providerName?.trim()) throw new Error("请输入供应商名称")
    if (models.some(item => item.id !== draft.id && item.provider === draft.provider && item.endpoint === draft.endpoint && item.kind === kind && item.modelId === draft.modelId.trim())) throw new Error("这个模型已经添加")
    return { ...draft, protocol:config.protocol, contextWindow:custom ? context.trim() ? parseContextWindow(context) : 0 : draft.contextWindow }
  }
  async function discover() {
    if (locking.current || discovery.current || custom || !hasKey || !window.desktop) return
    const id = crypto.randomUUID(); discovery.current = id; setDiscovering(true); setCatalogError("")
    try {
      const response = await window.desktop.discoverModels(id,configuration())
      if (!alive.current || discovery.current !== id) return
      if (response.ok) { setCatalog(response); if (!response.complete) setCatalogError("目录尚不完整，不能据此判断该供应商全部可用模型。") }
      else setCatalogError(response.message)
    } catch { if (alive.current && discovery.current === id) setCatalogError("模型目录读取失败，请重试") }
    finally { if (alive.current && discovery.current === id) { discovery.current = null; setDiscovering(false) } }
  }
  async function save() {
    if (locking.current) return
    try {
      const value = savedDraft(); locking.current = true; setBusy("save"); setError(""); cancelRequests(); setDiscovering(false)
      await saveDesktopModel(value)
      if (alive.current) onClose()
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "模型保存失败") }
    finally { locking.current = false; if (alive.current) setBusy("") }
  }
  async function test() {
    if (locking.current || !window.desktop) return
    try {
      savedDraft(); const value = configuration(); cancelRequests()
      setTested({provider:presetsFor(kind).find(preset => preset.id === draft.provider)?.name ?? draft.provider,endpoint:draft.endpoint,modelId:draft.modelId})
      const id = crypto.randomUUID(); operation.current = id; locking.current = true; setBusy("test"); setDiscovering(false); setError("")
      const response = await window.desktop.testModel(id,value)
      if (alive.current && operation.current === id) setResult(response)
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "测试连接失败") }
    finally { if (alive.current) { operation.current = null; locking.current = false; setBusy("") } }
  }
  const catalogOptions = catalog?.models.map(item => ({id:item.id,label:item.name,provider:draft.provider,hint:item.id,disabled:models.some(existing => existing.id !== draft.id && existing.provider === draft.provider && existing.kind === kind && existing.endpoint === draft.endpoint && existing.modelId === item.id),disabledLabel:"已添加"})) ?? []
  if (draft.modelId && !catalogOptions.some(item => item.id === draft.modelId)) catalogOptions.unshift({id:draft.modelId,label:draft.name || draft.modelId,provider:draft.provider,hint:catalog ? "当前配置未出现在目录中" : draft.modelId,disabled:false,disabledLabel:""})
  return <Dialog open onOpenChange={open => { if (!open) close() }}><DialogContent data-desktop-settings-surface className="desktop-model-editor" showCloseButton={false} finalFocus={finalFocus}>
    <DialogTitle>配置模型</DialogTitle><DialogDescription className="sr-only">配置一个{kind === 'TEXT' ? '文本' : '文生图'}模型，点击保存后生效</DialogDescription>
    <Button variant="ghost" size="icon-sm" className="absolute right-3 top-3" aria-label="关闭配置模型" disabled={busy === 'save'} onClick={close}><X size={16} /></Button>
    <fieldset disabled={!!busy} className="desktop-model-fields">
      <Field title="供应商"><ModelChoiceSelect label="供应商" value={draft.provider} provider disabled={!!busy} options={presetsFor(kind).map(preset => ({id:preset.id,label:preset.name,provider:preset.id}))} onChange={id => { const preset=presetsFor(kind).find(item => item.id === id)!; setContext(""); edit({provider:id,providerName:"",protocol:preset.protocol ?? "",endpoint:(kind === "TEXT" ? preset.textEndpoint : preset.imageEndpoint) ?? "",modelId:"",name:"",contextWindow:0},true) }} /></Field>
      {custom && <><Field title="供应商名称"><Input aria-label="供应商名称" value={draft.providerName ?? ""} onChange={event => edit({providerName:event.target.value})} /></Field><Field title="协议"><select aria-label="协议" value={draft.protocol} onChange={event => edit({protocol:event.target.value as Draft["protocol"]},true)}><option value="" disabled>请选择协议</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></Field><Field title="展示名称"><Input aria-label="展示名称" value={draft.name} onChange={event => edit({name:event.target.value})} /></Field><Field title="Base URL"><Input aria-label="Base URL" value={draft.endpoint} placeholder="https://…" onChange={event => edit({endpoint:event.target.value},true)} /></Field><Field title="模型 ID"><Input aria-label="模型 ID" value={draft.modelId} onChange={event => edit({modelId:event.target.value})} /></Field></>}
      <Field title="API Key"><Input aria-label="API Key" type="password" autoComplete="off" spellCheck={false} value={draft.apiKey} placeholder={scopeMatches ? "已配置，留空保留原密钥" : "请输入 API Key"} onChange={event => edit({apiKey:event.target.value})} /></Field>
      {custom ? <details><summary className="cursor-pointer text-sm text-muted-foreground">高级配置</summary><Field title="上下文上限（可选）"><Input aria-label="上下文上限" value={context} placeholder="例如 128K 或 1M" onChange={event => { setContext(event.target.value); setError("") }} /><small>未配置时采用 16K 输入预算，不表示模型实际容量。</small></Field></details> : <Field title="可用模型"><div className="flex gap-2"><ModelChoiceSelect label="可用模型" value={draft.modelId} options={catalogOptions} disabled={!!busy || !hasKey} placeholder={discovering ? "正在读取模型列表…" : "请选择可用模型"} onOpen={() => { if (!catalog) void discover() }} onChange={id => { const entry=catalog?.models.find(item => item.id === id); if (entry) { setDraft(before => ({...before,modelId:id,name:entry.name,contextWindow:entry.contextWindow ?? 0,thinkingLevels:entry.thinkingLevels ?? [],defaultThinking:entry.defaultThinking ?? "default"})); setError("") } }} /><Button variant="outline" size="icon" aria-label="刷新模型列表" disabled={!!busy || discovering || !hasKey} onClick={() => { void discover() }}>{discovering ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw size={16} />}</Button></div>{catalogError && <small role="status">{catalogError}</small>}{catalog && <small>目录获取于 {new Date(catalog.checkedAt).toLocaleString()}；列出不代表当前 Key 有调用权限。</small>}</Field>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">测试当前模型：{kind === 'TEXT' ? '请求简短回复' : '生成 1 张图片'}，可能产生供应商费用。</p>
    <div className="flex justify-end gap-2"><Button disabled={!!busy} onClick={() => { void save() }}>保存模型</Button><Button ref={testButton} variant="outline" disabled={!!busy} aria-busy={busy === 'test'} onClick={() => { void test() }}>{busy === 'test' && <LoaderCircle className="size-4 animate-spin" />}{busy === 'test' ? '测试中…' : '测试连接'}</Button><Button variant="outline" disabled={busy === 'save'} onClick={close}>取消</Button></div>
    <Dialog open={result !== null} onOpenChange={open => { if (!open) setResult(null) }}><DialogContent data-desktop-settings-surface finalFocus={testButton}><DialogTitle>连接测试结果</DialogTitle><DialogDescription>{result?.ok ? `当前模型连接成功，用时 ${(result.durationMs / 1000).toFixed(1)} 秒。测试未保存模型。` : result?.message}</DialogDescription><div className="break-all text-xs text-muted-foreground"><p>{tested?.provider} · {tested?.modelId}</p><p>{tested?.endpoint}</p></div><Button onClick={() => setResult(null)}>返回配置</Button></DialogContent></Dialog>
  </DialogContent></Dialog>
}
