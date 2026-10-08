"use client"
import {useEffect,useRef,useState} from "react"
import {Loader2} from "lucide-react"
import {Button} from "@/components/ui/button"
import {Dialog,DialogContent,DialogDescription,DialogTitle} from "@/components/ui/dialog"

// The worker has already closed at this barrier. No dismissal or cancelled
// reply may put the old renderer back into an editable workspace.
export function WorkLeasePendingDialog({open}:{open:boolean}){
 const [retrying,setRetrying]=useState(false),[restarting,setRestarting]=useState(false),[error,setError]=useState<string|null>(null)
 const alive=useRef(false),flight=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const retry=async()=>{
  if(flight.current||restarting)return
  const bridge=window.desktop
  if(!bridge?.repairWorkLease){setError("当前无法重试锁恢复，请重新启动应用。原文件已保留。");return}
  flight.current=true;setRetrying(true);setError(null)
  try{
   const result=await bridge.repairWorkLease({type:"retry"})
   if(!alive.current)return
   if(result==="restarting")setRestarting(true)
   else if(result!=="pending")setError("修复交接仍未完成，原文件已保留。请重试。")
  }catch{if(alive.current)setError("修复交接仍未完成，请检查目录权限后重试。原文件已保留。")}
  finally{flight.current=false;if(alive.current)setRetrying(false)}
 }
 return <Dialog open={open} onOpenChange={()=>{}}><DialogContent showCloseButton={false}>
  <DialogTitle>{restarting?"正在重新启动工作台":"作品锁修复交接尚未完成"}</DialogTitle>
  <DialogDescription>{restarting?"正在重新打开本地数据，请保留窗口。":"作品文件与草稿已保留。工作台已进入关闭流程，请重试完成交接；完成或取消锁恢复后，应用都会重新启动。"}</DialogDescription>
  {error&&<p role="alert" className="break-words text-sm text-destructive">{error}</p>}
  {restarting?<Loader2 aria-label="正在重新启动" className="size-5 animate-spin"/>:<Button disabled={retrying} onClick={()=>{void retry()}}>{retrying?"正在重试…":"重试完成修复"}</Button>}
 </DialogContent></Dialog>
}
