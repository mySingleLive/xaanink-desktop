"use client"
import { useRef, useState } from "react"
import { Pencil, Plus, Power, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ProviderLogo } from "@/components/chat/provider-logos"
import { removeDesktopModel, saveDesktopModel, useDesktopStore } from "@/stores/desktop"
import type { PublicModel } from "@desktop/core/settings"
import { PROVIDER_PRESETS } from "@desktop/shared/model-catalog"
import { ModelConfigurationDialog } from "./ModelConfigurationDialog"
export function ModelSettings() {
  const models = useDesktopStore(state => state.bootstrap!.models)
  const [editing,setEditing] = useState<{ kind:"TEXT" | "IMAGE"; model?:PublicModel } | null>(null)
  const [removing,setRemoving] = useState<PublicModel | null>(null)
  const [disabling,setDisabling] = useState<PublicModel | null>(null)
  const [busy,setBusy] = useState(false), [error,setError] = useState("")
  const locked = useRef(false)
  async function toggle(model: PublicModel) {
    if (locked.current) return
    locked.current = true; setBusy(true)
    try { await saveDesktopModel({...model,apiKey:"",enabled:!model.enabled}); setDisabling(null) }
    catch(cause) { const message = cause instanceof Error ? cause.message : "模型更新失败"; setError(message); toast.error(message) }
    finally { locked.current = false; setBusy(false) }
  }
  async function remove() {
    if (!removing || locked.current) return
    locked.current = true; setBusy(true); setError("")
    try { await removeDesktopModel(removing.id); setRemoving(null) }
    catch(cause) { setError(cause instanceof Error ? cause.message : "模型删除失败") }
    finally { locked.current = false; setBusy(false) }
  }
  return <>{(['TEXT','IMAGE'] as const).map(kind => <section className="desktop-settings-group" key={kind} aria-label={kind === 'TEXT' ? '文本模型' : '文生图模型'}>
    <header className="mb-3 flex items-center justify-between gap-3"><h3 className="mb-0!">{kind === 'TEXT' ? '文本模型' : '文生图模型'} <span>{models.filter(model => model.kind === kind).length}</span></h3><Button variant="outline" aria-label={kind === 'TEXT' ? '添加文本模型' : '添加文生图模型'} onClick={() => setEditing({kind})}><Plus size={14} />添加模型</Button></header>
    <div>{models.filter(model => model.kind === kind).map(model => <div className="desktop-model-card" key={model.id}>
      <ProviderLogo provider={model.provider} className="size-7" /><div className="min-w-0 flex-1"><strong className="block truncate">{model.name}</strong><p className="truncate">{model.providerName || PROVIDER_PRESETS.find(preset => preset.id === model.provider)?.name || model.provider} · {model.modelId}</p></div>
      <span className="text-xs text-muted-foreground">{model.enabled ? '已添加' : '已停用'}</span><div className="flex shrink-0"><Button variant="ghost" size="icon-sm" aria-label={`编辑模型 ${model.name}`} disabled={busy} onClick={() => setEditing({kind,model})}><Pencil size={15} /></Button><Button variant="ghost" size="icon-sm" aria-label={`${model.enabled ? '停用' : '启用'}模型 ${model.name}`} disabled={busy} onClick={() => { setError(""); if (model.enabled) setDisabling(model); else void toggle(model) }}><Power size={15} /></Button><Button variant="ghost" size="icon-sm" aria-label={`删除模型 ${model.name}`} disabled={busy} onClick={() => {setError("");setRemoving(model)}}><Trash2 size={15} /></Button></div>
    </div>)}{!models.some(model => model.kind === kind) && <div className="p-5 text-sm text-muted-foreground"><p>尚未添加{kind === 'TEXT' ? '文本' : '文生图'}模型</p>{kind==='TEXT'&&<Button variant="outline" className="mt-3" onClick={()=>window.dispatchEvent(new CustomEvent('desktop:onboarding',{detail:'models'}))}>开始模型引导</Button>}</div>}</div>
  </section>)}
    {editing && <ModelConfigurationDialog key={editing.model?.id ?? editing.kind} {...editing} onClose={() => setEditing(null)} />}
    <Dialog open={!!disabling} onOpenChange={open => { if (!open && !locked.current) setDisabling(null) }}><DialogContent data-desktop-settings-surface><DialogTitle>停用模型</DialogTitle><DialogDescription>停用「{disabling?.name}」会停止其正在进行的请求。默认配置会保留并标记为不可用，作品与历史记录不受影响。</DialogDescription>{error && <p role="alert" className="text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDisabling(null)}>取消</Button><Button disabled={busy} onClick={() => { if (disabling) void toggle(disabling) }}>停用模型</Button></div></DialogContent></Dialog>
    <Dialog open={!!removing} onOpenChange={open => { if (!open && !locked.current) setRemoving(null) }}><DialogContent data-desktop-settings-surface><DialogTitle>删除模型</DialogTitle><DialogDescription>删除「{removing?.name}」后，其默认用途将清空，正在使用该模型的请求会停止。已保存的作品与历史记录保留。</DialogDescription>{error && <p role="alert" className="text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>取消</Button><Button disabled={busy} onClick={() => {void remove()}}>删除模型</Button></div></DialogContent></Dialog>
  </>
}
