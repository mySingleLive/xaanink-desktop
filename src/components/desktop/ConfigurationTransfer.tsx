"use client"
import {useEffect,useRef,useState} from "react"
import {Loader2} from "lucide-react"
import {toast} from "sonner"
import {Button} from "@/components/ui/button"
import {Checkbox} from "@/components/ui/checkbox"
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog"
import {ModelChoiceSelect} from "./ModelChoiceSelect"
import {flushDesktopSettings,receiveDesktopState,useDesktopStore} from "@/stores/desktop"
import {desktopCommandCatalog} from "@/lib/desktop/command-runtime"
import type {ConfigurationPreview} from "@desktop/shared/configuration"
import type {ConfigurationImportChoices,ModelSelectionPath} from "@desktop/core/configuration-transfer"

const labels:Record<string,string>={
 "/general/restoreSession":"启动时恢复上次工作台",
 "/user/penName":"笔名","/user/email":"邮箱","/agent/textModelId":"默认模型","/agent/mode":"默认模式","/agent/thinking":"默认思考强度","/agent/reviewModelId":"默认审核模型","/agent/imageModelId":"默认文生图模型",
 "/appearance/theme":"主题","/appearance/uiFont":"界面字体","/appearance/uiFontSize":"界面字号","/appearance/zoom":"界面缩放","/appearance/bodyFont":"正文字体","/appearance/bodyFontSize":"正文字号","/appearance/lineHeight":"正文行距","/appearance/lineNumbers":"显示正文行号","/appearance/wordWrap":"正文自动换行",
}
const modelPaths:ModelSelectionPath[]=["/agent/textModelId","/agent/reviewModelId","/agent/imageModelId"]
const choices:Record<string,string>={paper:"宣纸",ink:"玄墨",system:"跟随系统",standard:"标准模式",plan:"计划模式",default:"模型默认"}
const errorText=(error:unknown)=>error instanceof Error?error.message:"配置操作未完成，请重试"

/** Mounted only while General settings are visible; leaving cancels pending native selections. */
export function ConfigurationImportButton(){
 const state=useDesktopStore(value=>value.bootstrap)!
 const [preview,setPreview]=useState<ConfigurationPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("")
 const [selected,setSelected]=useState<string[]>([]),[bindings,setBindings]=useState<NonNullable<ConfigurationImportChoices["modelBindings"]>>({}),[thinking,setThinking]=useState<string|undefined>()
 const current=useRef<string|null>(null),mounted=useRef(true)
 const cancel=()=>{const id=current.current;current.current=null;if(id)void window.desktop?.configuration({type:"cancel",sessionId:id}).catch(()=>{});setPreview(null);setBusy(false)}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;const id=current.current;current.current=null;if(id)void window.desktop?.configuration({type:"cancel",sessionId:id}).catch(()=>{})}},[])
 async function choose(){
  cancel();const sessionId=crypto.randomUUID();current.current=sessionId;setBusy(true);setError("")
  try{
   await flushDesktopSettings();if(current.current!==sessionId)return
   const result=await window.desktop?.configuration({type:"preview",sessionId})
   if(!mounted.current||current.current!==sessionId)return
   if(result&&typeof result==="object"&&"plan" in result){
    setPreview(result);setSelected(result.plan.changes.filter(change=>!modelPaths.includes(change.path as ModelSelectionPath)||change.incoming===null).filter(change=>!result.plan.issues.some(issue=>issue.path===change.path&&["CATALOG_UNAVAILABLE","COMMAND_UNKNOWN"].includes(issue.code))).map(change=>change.path));setBindings({});setThinking(undefined)
   }
  }catch(error){if(mounted.current&&current.current===sessionId)setError(errorText(error))}
  finally{if(mounted.current&&current.current===sessionId)setBusy(false)}
 }
 function name(path:string){if(labels[path])return labels[path];const parts=path.split("/").map(part=>part.replace(/~1/g,"/").replace(/~0/g,"~"));if(parts[1]==="shortcuts"){const platform=parts[2]==="darwin"?"darwin":"win32",command=desktopCommandCatalog(platform).find(row=>row.id===parts[3]);return `${platform==="darwin"?"macOS":"Windows"} · ${command?.label??parts[3]}`}return path}
 function value(path:string,input:unknown){if(input==null)return "未设置";if(modelPaths.includes(path as ModelSelectionPath)){const model=state.models.find(row=>row.id===input)??preview?.plan.modelReferences.find(row=>row.id===input);return model?`${model.name} · ${model.modelId}`:"未映射模型"}if(typeof input==="boolean")return input?"开启":"关闭";if(Array.isArray(input))return input.length?input.join("、"):"未设置";return choices[String(input)]??(String(input)||"未设置")}
 async function apply(){
  const sessionId=current.current;if(!preview||!sessionId)return;setBusy(true);setError("")
  const modelBindings=Object.fromEntries(Object.entries(bindings).filter(([path])=>selected.includes(path))) as ConfigurationImportChoices["modelBindings"]
  try{
   await flushDesktopSettings();if(current.current!==sessionId)return
   const result=await window.desktop?.configuration({type:"apply",sessionId,token:preview.token,choices:{selectedPaths:selected,modelBindings,...(thinking!==undefined&&(selected.includes("/agent/textModelId")||selected.includes("/agent/thinking"))?{thinkingOverride:thinking}:{})}})
   if(!mounted.current||current.current!==sessionId)return
   if(result&&typeof result==="object"&&"revision" in result)receiveDesktopState(result)
   if(mounted.current&&current.current===sessionId){cancel();toast.success("所选配置已导入")}
  }catch(error){if(mounted.current&&current.current===sessionId)setError(errorText(error))}
  finally{if(mounted.current&&current.current===sessionId)setBusy(false)}
 }
 const textId=selected.includes("/agent/textModelId")?bindings["/agent/textModelId"]:state.settings.agent.textModelId
 const levels=state.models.find(model=>model.id===textId)?.thinkingLevels??[]
 return <><Button variant="outline" disabled={busy} onClick={()=>void choose()}>{busy&&!preview&&<Loader2 className="animate-spin"/>}导入配置</Button>{error&&!preview&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  <Dialog open={!!preview} onOpenChange={open=>{if(!open)cancel()}}><DialogContent data-desktop-settings-surface className="flex max-h-[85vh] flex-col sm:max-w-2xl" showCloseButton={!busy}>
   <DialogHeader><DialogTitle>导入配置</DialogTitle><DialogDescription>检查差异并选择要应用的项目。密钥、数据目录和头像不会随配置转移。</DialogDescription></DialogHeader>
   <div className="min-h-0 space-y-3 overflow-y-auto">
    {!preview?.plan.changes.length&&<p className="py-6 text-center text-muted-foreground">配置与当前设置一致。</p>}
    {preview?.plan.changes.map(change=>{const checked=selected.includes(change.path),isModel=modelPaths.includes(change.path as ModelSelectionPath),issues=preview.plan.issues.filter(issue=>issue.path===change.path);return <div key={change.path} className="rounded-lg border p-3">
     <div className="flex items-center gap-2"><Checkbox aria-label={`导入 ${name(change.path)}`} checked={checked} disabled={busy} onCheckedChange={checked=>setSelected(before=>checked?[...before,change.path]:before.filter(path=>path!==change.path))}/><span className="text-sm font-medium">{name(change.path)}</span></div>
     <div className="mt-2 grid grid-cols-2 gap-3 break-words text-xs"><div><span className="text-muted-foreground">当前</span><p>{value(change.path,change.before)}</p></div><div><span className="text-muted-foreground">导入</span><p>{value(change.path,change.incoming)}</p></div></div>
     {issues.map(issue=><p key={issue.code} className="mt-2 text-xs text-muted-foreground">{issue.message}</p>)}
     {checked&&isModel&&change.incoming!==null&&<div className="mt-3"><ModelChoiceSelect label={`映射${name(change.path)}`} disabled={busy} value={Object.hasOwn(bindings,change.path)?bindings[change.path as ModelSelectionPath]??"__clear__":null} placeholder="选择本机模型或清除此默认值" options={[{id:"__clear__",label:"清除此默认模型"},...state.models.filter(model=>model.enabled&&model.kind===(change.path==="/agent/imageModelId"?"IMAGE":"TEXT")).map(model=>({id:model.id,label:model.name,provider:model.provider,hint:model.modelId}))]} onChange={id=>setBindings(before=>({...before,[change.path]:id==="__clear__"?null:id}))}/></div>}
    </div>})}
    {(selected.includes("/agent/textModelId")||selected.includes("/agent/thinking"))&&<label className="grid gap-2 text-sm">导入后的思考强度<select aria-label="导入后的思考强度" className="h-9 rounded-md border bg-background px-2" disabled={busy} value={thinking??"__unchanged__"} onChange={event=>setThinking(event.target.value==="__unchanged__"?undefined:event.target.value)}><option value="__unchanged__">使用所选配置（须模型支持）</option><option value="default">模型默认</option>{levels.filter(level=>level!=="default").map(level=><option key={level} value={level}>{level}</option>)}</select></label>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
   </div><DialogFooter><Button variant="ghost" disabled={busy} onClick={()=>void choose()}>重新选择文件</Button><Button variant="outline" disabled={busy} onClick={cancel}>取消</Button><Button disabled={busy||!selected.length} onClick={()=>void apply()}>{busy&&<Loader2 className="animate-spin"/>}应用所选配置</Button></DialogFooter>
  </DialogContent></Dialog></>
}
export function ConfigurationExportButton(){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");const current=useRef<string|null>(null)
 useEffect(()=>()=>{const id=current.current;current.current=null;if(id)void window.desktop?.configuration({type:"cancel",sessionId:id}).catch(()=>{})},[])
 async function save(){const sessionId=crypto.randomUUID();current.current=sessionId;setBusy(true);setError("");try{await flushDesktopSettings();if(current.current!==sessionId)return;const saved=await window.desktop?.configuration({type:"export",sessionId});if(current.current===sessionId&&saved===true)toast.success("配置已导出")}catch(error){if(current.current===sessionId)setError(errorText(error))}finally{if(current.current===sessionId){current.current=null;setBusy(false)}}}
 return <><Button variant="outline" disabled={busy} onClick={()=>void save()}>{busy&&<Loader2 className="animate-spin"/>}导出配置</Button>{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}</>
}
