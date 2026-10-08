"use client"

import {useEffect,useRef,useState} from "react"
import {Button} from "@/components/ui/button"
import {Menu} from "lucide-react"
import type {RootRelocationBridge,RootRelocationCommand,RootRelocationNotice,RootRelocationPhase,RootRelocationState} from "@desktop/shared/root-relocation"

const labels:Record<RootRelocationPhase,string>={checking:"正在检查数据目录…",unavailable:"原数据目录无法访问",picking:"正在选择目录…",confirming:"等待确认原数据目录…",writing:"正在保存目录记录…",cancelled:"定位已取消",complete:"已定位原数据目录",blocked:"需要检查数据目录"}
const notices:Record<Exclude<RootRelocationNotice,null>,string>={
 "root-unavailable":"请找到原来的数据目录。此入口只接受原物理目录，不会创建空数据或恢复副本。",
 "pointer-invalid":"数据目录记录无法验证，请保留原文件并联系维护者。",
 "history-needs-recovery":"历史迁移记录需要检查，请保留原目录和控制文件后联系维护者。",
 "target-not-original":"所选目录不是原物理数据目录，请重新选择原目录。",
 "target-invalid":"所选目录无法验证，请检查目录后重新选择。",
 "confirmation-failed":"目录确认未完成，请重新选择并确认。",
 "write-unconfirmed":"目录记录的持久化尚未确认，请保留所有文件并退出后重新检查。",
 "operation-failed":"定位未完成，请检查原数据目录后重试。",
 "owner-expired":"当前维护窗口已失效，请退出应用后重新检查。",
}
const pathValid=(value:unknown)=>value===null||typeof value==="string"&&value.length<=8192&&!/[\x00-\x1f]/.test(value)
function validState(value:RootRelocationState):boolean{
 return !!value&&value.version===1&&Number.isSafeInteger(value.revision)&&value.revision>=0
  &&Object.hasOwn(labels,value.phase)&&(value.theme==="paper"||value.theme==="ink")
  &&(value.platform===undefined||["darwin","win32","linux"].includes(value.platform))
  &&pathValid(value.sourcePath)&&pathValid(value.targetPath)
  &&(value.notice===null||Object.hasOwn(notices,value.notice))
  &&(value.unreadResultCount===null||Number.isSafeInteger(value.unreadResultCount)&&value.unreadResultCount>=0&&value.unreadResultCount<=256)
  &&typeof value.canChoose==="boolean"&&typeof value.canCancel==="boolean"&&typeof value.canRestart==="boolean"
  &&(!value.canChoose||["unavailable","cancelled"].includes(value.phase))
  &&(!value.canCancel||["picking","confirming","writing"].includes(value.phase))
  &&(!value.canRestart||value.phase==="complete")
}
interface Connection{bridge:RootRelocationBridge;alive:boolean;state:RootRelocationState|null;pending:Set<RootRelocationCommand>}
export function RootRelocationScreen(){
 const [state,setState]=useState<RootRelocationState|null>(null),[error,setError]=useState<string|null>(null)
 const [pending,setPending]=useState<RootRelocationCommand[]>([]),[available,setAvailable]=useState(false)
 const connection=useRef<Connection|null>(null)
 useEffect(()=>{
  const bridge=window.desktopRootRelocation
  if(!bridge){setError("定位状态暂不可用，请重新打开应用。");return}
  setAvailable(true)
  const current:Connection={bridge,alive:true,state:null,pending:new Set()};connection.current=current
  const live=()=>current.alive&&connection.current===current
  const receive=(next:RootRelocationState)=>{
   if(!live())return
   if(!validState(next)){setError("定位状态暂不可用，请重新打开应用。");return}
   if(current.state&&next.revision<=current.state.revision)return
   current.state={...next};setState(current.state);setError(null)
  }
  let unsubscribe:(()=>void)|undefined
  try{unsubscribe=bridge.subscribe(receive);void Promise.resolve(bridge.state()).then(receive,()=>{if(live())setError("暂时无法读取定位状态，请重新打开应用。")})}
  catch{if(live())setError("定位状态暂不可用，请重新打开应用。")}
  return()=>{current.alive=false;if(connection.current===current)connection.current=null;unsubscribe?.()}
 },[])
 const command=async(action:RootRelocationCommand)=>{
  const current=connection.current
  if(!current?.alive||current.pending.has(action)||current.pending.has("quit")||current.pending.has("restart"))return
  if(action==="choose"&&(!current.state?.canChoose||current.pending.size>0))return
  if(action==="cancel"&&!current.state?.canCancel)return
  if(action==="restart"&&(!current.state?.canRestart||current.pending.size>0))return
  // Cancel/quit must remain usable while a native picker/confirmation is open.
  current.pending.add(action);setPending([...current.pending]);setError(null)
  try{await current.bridge.command(action)}catch{if(current.alive&&connection.current===current)setError("操作未完成，请重试。")}
  finally{if(current.alive&&connection.current===current){current.pending.delete(action);setPending([...current.pending])}}
 }
 const exiting=pending.includes("quit")||pending.includes("restart"),cancelling=pending.includes("cancel")
 return <main className={`${state?.theme??"paper"} flex h-dvh min-h-0 flex-col overflow-auto bg-background font-sans text-foreground`}>
  <div className="desktop-drag flex h-11 w-full shrink-0 items-center justify-end pr-[144px]">
   {state?.platform==="win32"&&available&&<Button data-relocation-command="menu" aria-label="应用菜单" size="icon" variant="ghost" disabled={pending.includes("menu")||exiting} onClick={()=>{void command("menu")}}><Menu className="size-4"/></Button>}
  </div>
  <div className="flex flex-1 items-center justify-center px-5 pb-8 pt-3">
   <section aria-labelledby="root-relocation-title" className="w-full min-w-0 max-w-xl rounded-xl border border-border bg-card p-6 sm:p-8">
    <h1 id="root-relocation-title" className="font-heading text-2xl font-semibold">定位原数据目录</h1>
    <div role="status" aria-live="polite" aria-atomic="true" className="mt-6 space-y-2">
     <h2 className="text-base font-medium">{state?labels[state.phase]:labels.checking}</h2>
     {state?.notice&&<p className="text-sm leading-6 text-muted-foreground">{notices[state.notice]}</p>}
     {state?.phase==="complete"&&<p className="text-sm leading-6 text-muted-foreground">目录记录已保存，应用将完整重新启动。</p>}
     {state?.phase==="cancelled"&&<p className="text-sm leading-6 text-muted-foreground">原数据与历史记录保持原样，可重新选择目录。</p>}
    </div>
    {state&&<dl className="mt-5 space-y-3 text-sm">
     <div><dt className="text-xs text-muted-foreground">原数据目录</dt><dd className="mt-1 break-all leading-6">{state.sourcePath??"目录记录尚未确认"}</dd></div>
     {state.targetPath&&<div><dt className="text-xs text-muted-foreground">所选目录</dt><dd className="mt-1 break-all leading-6">{state.targetPath}</dd></div>}
    </dl>}
    {state?.unreadResultCount!==null&&state?.unreadResultCount!==undefined&&state.unreadResultCount>0&&<p className="mt-5 text-sm leading-6 text-muted-foreground">保留 {state.unreadResultCount} 条未读迁移结果，重新打开后仍需明确确认。</p>}
    {error&&<p role="alert" className="mt-5 text-sm leading-6 text-destructive">{error}</p>}
    {available&&(state||error)&&<div className="mt-6 flex flex-wrap justify-end gap-2">
     {state?.canChoose&&<Button data-relocation-command="choose" disabled={pending.length>0} onClick={()=>{void command("choose")}}>定位原数据目录</Button>}
     {(state?.canCancel||cancelling)&&<Button data-relocation-command="cancel" variant="outline" disabled={cancelling||exiting} onClick={()=>{void command("cancel")}}>{cancelling?"正在取消…":"取消定位"}</Button>}
     {state?.canRestart?<Button data-relocation-command="restart" disabled={pending.length>0} onClick={()=>{void command("restart")}}>{pending.includes("restart")?"正在重新打开…":"重新打开应用"}</Button>
      :<Button data-relocation-command="quit" variant="outline" disabled={exiting||cancelling} onClick={()=>{void command("quit")}}>{pending.includes("quit")?"正在退出…":"退出应用"}</Button>}
    </div>}
   </section>
  </div>
 </main>
}
