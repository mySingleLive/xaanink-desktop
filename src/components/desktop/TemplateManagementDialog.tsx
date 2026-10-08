"use client"
import { useLayoutEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { PromptsClient } from "@/components/admin/PromptsClient"
import { apiFetch } from "@/components/admin/shared"
import { WizardTemplatesClient } from "./WizardTemplatesClient"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MAX_TEMPLATE_FILE_BYTES, templateDocumentSchema, type TemplateDocument, type TemplateImportChoice, type TemplateImportPreview } from "@desktop/shared/template-library"
import { downloadManuscript } from "@/lib/manuscript-export"

/** Reuses the Web manager, wizard domain and original Dialog primitives. */
export function TemplateManagementDialog({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}){
 const queryClient=useQueryClient(),file=useRef<HTMLInputElement>(null),epoch=useRef(0),sequence=useRef(0),operation=useRef<AbortController|null>(null),pending=useRef(false)
 const [preview,setPreview]=useState<TemplateImportPreview|null>(null),[choices,setChoices]=useState<TemplateImportChoice[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
 useLayoutEffect(()=>{epoch.current++;sequence.current++;operation.current?.abort();pending.current=false;setBusy(false);setPreview(null);setError(null);return()=>{epoch.current++;sequence.current++;operation.current?.abort();pending.current=false}},[open])
 const begin=()=>{if(!open||pending.current)return null;pending.current=true;setBusy(true);setError(null);const controller=new AbortController();operation.current?.abort();operation.current=controller;return{epoch:epoch.current,sequence:++sequence.current,controller}}
 const active=(job:NonNullable<ReturnType<typeof begin>>)=>job.epoch===epoch.current&&job.sequence===sequence.current&&!job.controller.signal.aborted
 const end=(job:NonNullable<ReturnType<typeof begin>>)=>{if(active(job)){pending.current=false;setBusy(false)}}
 const closePreview=()=>{sequence.current++;operation.current?.abort();pending.current=false;setBusy(false);setPreview(null);setChoices([]);setError(null)}
 const chooseFile=async(selected:File)=>{
  const job=begin();if(!job)return
  try{
   if(selected.size>MAX_TEMPLATE_FILE_BYTES)throw Error("模板文件不能超过4MiB。")
   const text=new TextDecoder("utf-8",{fatal:true}).decode(await selected.arrayBuffer());if(!active(job))return
   let document:TemplateDocument;try{document=templateDocumentSchema.parse(JSON.parse(text))}catch{throw Error("模板文件格式不合法，原模板已保留。")}
   const response=await apiFetch<{preview:TemplateImportPreview}>("/api/templates/import",{method:"POST",body:JSON.stringify({action:"preview",document}),signal:job.controller.signal});if(!active(job))return
   setPreview(response.preview);setChoices(response.preview.entries.map(entry=>({kind:entry.kind,id:entry.id,action:entry.conflict?"keep":"add"})))
  }catch(error){if(active(job))setError(error instanceof Error?error.message:"模板预览失败，请重试。")}finally{end(job)}
 }
 const apply=async()=>{
  if(!preview)return;const job=begin();if(!job)return
  try{await apiFetch("/api/templates/import",{method:"POST",body:JSON.stringify({action:"apply",preview,choices}),signal:job.controller.signal});if(!active(job))return;await Promise.all([queryClient.invalidateQueries({queryKey:["admin","prompts"]}),queryClient.invalidateQueries({queryKey:["desktop","wizard-templates"]})]);if(active(job)){setPreview(null);setChoices([])}}catch(error){if(active(job))setError(error instanceof Error?error.message:"模板导入失败，请重试。")}finally{end(job)}
 }
 const exportFile=async()=>{
  const job=begin();if(!job)return
  try{const result=await apiFetch<{document:TemplateDocument}>("/api/templates/export",{signal:job.controller.signal});if(!active(job))return;const document=templateDocumentSchema.parse(result.document);await downloadManuscript(new Blob([JSON.stringify(document,null,2)+"\n"],{type:"application/json;charset=utf-8"}),"玄印写作模板与提示词.json",{signal:job.controller.signal})}catch(error){if(active(job))setError(error instanceof Error?error.message:"模板导出失败，请重试。")}finally{end(job)}
 }
 const updateChoice=(index:number,patch:Partial<TemplateImportChoice>)=>setChoices(current=>current.map((choice,i)=>i===index?{...choice,...patch}:choice))
 return <>
 <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>模板与提示词</DialogTitle><DialogDescription>管理本地创作模板与提示词，保存修改后生效。</DialogDescription></DialogHeader>
 <div className="flex justify-end gap-2"><input ref={file} type="file" accept=".json,application/json" aria-label="导入模板文件" className="hidden" onChange={event=>{const selected=event.target.files?.[0];event.target.value="";if(selected)void chooseFile(selected)}}/><Button variant="outline" disabled={busy} onClick={()=>file.current?.click()}>导入</Button><Button variant="outline" disabled={busy} onClick={()=>void exportFile()}>导出</Button></div>
 {error&&!preview?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
 <Tabs defaultValue="prompts"><TabsList><TabsTrigger value="prompts">提示词</TabsTrigger><TabsTrigger value="wizard">创作模板</TabsTrigger></TabsList><TabsContent value="prompts"><PromptsClient/></TabsContent><TabsContent value="wizard"><WizardTemplatesClient/></TabsContent></Tabs>
 </DialogContent></Dialog>
 <Dialog open={!!preview&&open} onOpenChange={value=>{if(!value)closePreview()}}><DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>导入模板预览</DialogTitle><DialogDescription>文件读取尚未修改本地模板。选择冲突处理方式，保存导入后生效。</DialogDescription></DialogHeader>
 {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
 <div className="space-y-4">{preview?.entries.map((entry,index)=><div key={`${entry.kind}:${entry.id}`} className="space-y-2 rounded-lg border p-3"><p className="font-medium">{entry.name}</p><p className="font-mono text-xs text-muted-foreground">{entry.id}</p><p className="text-xs text-muted-foreground">{entry.conflict?`当前 v${entry.existingVersion} → 文件 v${entry.incomingVersion}`:`新模板 · 文件 v${entry.incomingVersion}`}</p>
 <Select value={choices[index]?.action??"keep"} onValueChange={value=>value&&updateChoice(index,{action:value as TemplateImportChoice["action"],copyId:undefined})}><SelectTrigger aria-label={`${entry.id} 冲突处理`} disabled={busy}><SelectValue/></SelectTrigger><SelectContent><SelectItem value="keep">{entry.conflict?"保留当前":"不导入"}</SelectItem>{entry.conflict?<><SelectItem value="replace">替换当前</SelectItem><SelectItem value="copy">另存副本</SelectItem></>:<SelectItem value="add">添加模板</SelectItem>}</SelectContent></Select>
 {choices[index]?.action==="copy"?<div className="grid gap-2"><Label>副本唯一标识</Label><Input aria-label={`${entry.id} 副本标识`} disabled={busy} value={choices[index].copyId??""} onChange={event=>updateChoice(index,{copyId:event.target.value})}/></div>:null}
 </div>)}</div><DialogFooter><Button variant="outline" onClick={closePreview}>取消导入</Button><Button disabled={busy||!preview?.entries.length||choices.some(choice=>choice.action==="copy"&&!choice.copyId?.trim())} onClick={()=>void apply()}>保存导入</Button></DialogFooter>
 </DialogContent></Dialog></>
}
