"use client"
import { useRef, useState } from "react"
import { updateDesktopSettings, useDesktopStore } from "@/stores/desktop"
import type { Settings } from "@desktop/core/settings"
import { ModelChoiceSelect } from "./ModelChoiceSelect"
import { thinkingEffortOptionsFor } from "@/lib/ai/thinking-effort"
type AgentKey = keyof Settings["agent"]
type PendingChange = { value: string | null; token: number; busy: boolean; error?: string }
export function AgentSettings() {
  const state = useDesktopStore(value => value.bootstrap)!
  const latest = useRef(state); latest.current = state
  const [pending,setPending] = useState<Partial<Record<AgentKey,PendingChange>>>({})
  const sequence = useRef(0)
  const defaults = { ...state.settings.agent }
  for (const key of Object.keys(pending) as AgentKey[]) Object.assign(defaults,{[key]:pending[key]!.value})
  const textModel = state.models.find(model => model.id === defaults.textModelId)
  const efforts = textModel ? thinkingEffortOptionsFor(textModel.provider === "zai" ? "zhipu" : textModel.provider, textModel.modelId) : []
  function change(key: AgentKey, value: string | null) {
    const token = ++sequence.current
    setPending(before => ({...before,[key]:{value,token,busy:true}}))
    void updateDesktopSettings(before => {
      if (key.endsWith("ModelId") && value) {
        const kind = key === "imageModelId" ? "IMAGE" : "TEXT"
        if (!latest.current.models.some(model => model.id === value && model.kind === kind && model.enabled)) throw new Error("此模型已不可用，请重新选择后重试")
      }
      if (key === "thinking" && value !== "default") {
        const model = latest.current.models.find(model => model.id === before.agent.textModelId && model.enabled)
        if (!model?.thinkingLevels.includes(value!)) throw new Error("当前默认模型不支持此思考强度，请重新选择")
      }
      return {...before,agent:{...before.agent,[key]:value}}
    }).then(() => setPending(before => { if (before[key]?.token !== token) return before; const next = {...before}; delete next[key]; return next }))
      .catch(error => setPending(before => before[key]?.token === token ? {...before,[key]:{value,token,busy:false,error:error instanceof Error ? error.message : "保存失败"}} : before))
  }
  return <section className="desktop-settings-group"><h3>智能体默认配置</h3><div>
    {([['textModelId','默认模型','TEXT'],['mode','默认模式',''],['thinking','默认思考强度',''],['reviewModelId','默认审核模型','TEXT'],['imageModelId','默认文生图模型','IMAGE']] as const).map(([key,label,kind]) => <div className="desktop-setting-row" key={key}><label><span>{label}</span></label><div className="desktop-setting-control">
      {kind ? <ModelChoiceSelect label={label} disabled={pending[key]?.busy} value={defaults[key]} options={[{id:"",label:"未设置"}, ...state.models.filter(model => model.kind === kind && (model.enabled || model.id === defaults[key])).map(model => ({ id:model.id,label:model.name,provider:model.provider,hint:model.modelId,disabled:!model.enabled,disabledLabel:"已停用" }))]} onChange={id => change(key,id || null)} placeholder={defaults[key] ? "模型已失效" : "未设置"} /> : key === 'mode' ? <select aria-label={label} disabled={pending[key]?.busy} value={defaults.mode} onChange={event => change(key,event.target.value)}><option value="standard">标准模式</option><option value="plan">计划模式</option></select> : <select aria-label={label} disabled={!textModel?.enabled || !!pending.textModelId || pending[key]?.busy} value={defaults.thinking} onChange={event => change(key,event.target.value)}><option value="default">模型默认</option>{textModel?.thinkingLevels.filter(level => level !== 'default').map(level => <option key={level} value={level}>{efforts.find(option => option.value === level)?.label ?? level}</option>)}</select>}
      {pending[key]?.busy && <small role="status">正在保存…</small>}
      {pending[key]?.error && <div className="text-xs"><p role="alert">更改尚未保存：{pending[key]!.error}</p><button className="mt-1 text-primary underline" aria-label={`重试${label}`} onClick={() => change(key,pending[key]!.value)}>重试</button></div>}
    </div></div>)}
  </div></section>
}
