"use client"
import {useEffect,useRef,useState} from "react"
import {Loader2,ArchiveRestore,Wrench} from "lucide-react"
import {Button} from "@/components/ui/button"
import type {BackupReceipt} from "@desktop/core/work-backups"
export function WorkBackupsPanel(){
 const [works,setWorks]=useState<Array<{id:string;title:string}>>([]),[workId,setWorkId]=useState("")
 const [backups,setBackups]=useState<BackupReceipt[]>([]),[loading,setLoading]=useState(true),[restoring,setRestoring]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[status,setStatus]=useState<string|null>(null)
 const [repairing,setRepairing]=useState(false),[blocked,setBlocked]=useState(false)
 const mounted=useRef(false),active=useRef(false)
 useEffect(()=>{let alive=true;mounted.current=true
  void window.desktop?.workBackup({type:"works"}).then(result=>{if(!alive)return;if(result.type!=="works")throw Error("作品列表回执无效");setWorks(result.works);setWorkId(result.works[0]?.id??"");if(!result.works.length)setLoading(false)}).catch(error=>{if(alive){setError(error instanceof Error?error.message:"作品列表未能读取");setLoading(false)}})
  return()=>{alive=false;mounted.current=false}
 },[])
 useEffect(()=>{if(!workId)return;let alive=true;setLoading(true);setError(null);setStatus(null);setBackups([])
  void window.desktop?.workBackup({type:"list",workId}).then(result=>{if(!alive)return;if(result.type!=="list")throw Error("备份列表回执无效");setBackups(result.backups)}).catch(error=>{if(alive)setError(error instanceof Error?error.message:"备份列表未能读取")}).finally(()=>{if(alive)setLoading(false)})
  return()=>{alive=false}
 },[workId])
 const restore=async(backup:BackupReceipt)=>{
  if(active.current||!window.desktop)return
  active.current=true;setRestoring(backup.id);setError(null);setStatus(null)
  let retainBarrier=false
  try{const result=await window.desktop.restoreWork({type:"start",workId,backupId:backup.id});retainBarrier=result==="pending"||result==="restarting";if(mounted.current){setBlocked(retainBarrier);setStatus(result==="restarting"?"正在重新启动工作台…":result==="pending"?"恢复交接待完成，请在提示中重试":"已取消恢复，当前作品保持原状")}}
  catch(error){if(mounted.current)setError(error instanceof Error?error.message:"恢复未完成，原文件已保留")}
  finally{active.current=retainBarrier;if(mounted.current)setRestoring(null)}
 }
 const repair=async()=>{
  if(active.current||!workId)return
  const bridge=window.desktop
  if(!bridge?.repairWorkLease){setError("当前无法发起锁恢复，请重新打开桌面应用。");return}
  active.current=true;setRepairing(true);setError(null);setStatus(null)
  let retainBarrier=false
  try{
   const result=await bridge.repairWorkLease({type:"start",workId})
   if(result!=="pending"&&result!=="restarting"&&result!=="cancelled")throw Error("INVALID_REPAIR_REPLY")
   retainBarrier=result!=="cancelled"
   if(mounted.current){setBlocked(retainBarrier);setStatus(result==="restarting"?"正在重新启动工作台…":result==="pending"?"作品锁修复交接待完成，请在提示中重试。":"已取消锁恢复，作品文件保持原状。")}
  }catch{if(mounted.current)setError("修复交接未完成，作品文件已保留。请重试。")}
  finally{active.current=retainBarrier;if(mounted.current)setRepairing(false)}
 }
 const busy=restoring!==null||repairing||blocked
 return <section aria-label="本地作品备份" className="space-y-3 border-t pt-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">本地作品备份</h3>{works.length>0&&<select aria-label="备份所属作品" value={workId} disabled={busy} onChange={event=>setWorkId(event.target.value)} className="h-9 max-w-full rounded-md border bg-background px-3 text-sm">{works.map(work=><option key={work.id} value={work.id}>{work.title}</option>)}</select>}</div>
  {error&&<p role="alert" className="break-words text-sm text-destructive">{error}</p>}
  {status&&<p role="status" className="text-sm text-muted-foreground">{status}</p>}
  {loading?<p role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>正在读取备份…</p>:!works.length?<p className="py-3 text-sm text-muted-foreground">尚无本地作品可恢复。</p>:!backups.length&&!error?<p className="py-3 text-sm text-muted-foreground">此作品还没有备份。</p>:<ul className="max-h-60 space-y-2 overflow-y-auto">{backups.map(backup=><li key={backup.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
   <ArchiveRestore aria-hidden className="size-5 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{backup.title}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(backup.createdAt).toLocaleString()} · {backup.bytes<1024*1024?`${Math.ceil(backup.bytes/1024)} KB`:`${(backup.bytes/1024/1024).toFixed(1)} MB`}</p></div><Button variant="outline" disabled={busy} onClick={()=>{void restore(backup)}}>{restoring===backup.id?<><Loader2 className="size-4 animate-spin"/>正在校验备份…</>:"校验并恢复"}</Button>
  </li>)}</ul>}
  {workId&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"><p className="min-w-0 flex-1 text-sm text-muted-foreground">异常退出后无法打开作品？确认原进程已退出后，可修复遗留的作品锁。操作需要保存并关闭工作台。</p><Button variant="outline" disabled={busy} onClick={()=>{void repair()}}>{repairing?<><Loader2 aria-hidden className="size-4 animate-spin"/>正在交接修复…</>:<><Wrench aria-hidden className="size-4"/>修复异常退出锁</>}</Button></div>}
 </section>
}
