"use client"
import {useEffect,useRef,useState} from 'react'
import {Loader2,RefreshCw} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {applicationBackupControlResultSchema,type ApplicationBackupSummary} from '@desktop/shared/application-backup-control'
import {applicationRestoreHandoffStateSchema,type ApplicationRestoreHandoffState,type ApplicationRestoreHandoffCommand} from '@desktop/shared/application-restore-handoff'
const pageSize=20
function size(bytes:number){return bytes<1024?`${bytes} B`:bytes<1024**2?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1024**2).toFixed(1)} MB`}
export function ApplicationBackupsPanel(){
 const [backups,setBackups]=useState<ApplicationBackupSummary[]|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[page,setPage]=useState(0)
 const mounted=useRef(false),flight=useRef<symbol|null>(null)
 const [restoration,setRestoration]=useState<ApplicationRestoreHandoffState|null>(null),[restoring,setRestoring]=useState(false)
 const restoreFlight=useRef<symbol|null>(null)
 const restore=async(action:ApplicationRestoreHandoffCommand)=>{
  if(restoreFlight.current)return
  const token=Symbol();restoreFlight.current=token;setRestoring(true);setError('')
  try{
   if(!window.desktop?.restoreApplication)throw Error('应用恢复暂不可用')
   const result=applicationRestoreHandoffStateSchema.parse(await window.desktop.restoreApplication(action))
   if(mounted.current&&restoreFlight.current===token)setRestoration(result)
  }catch{if(mounted.current&&restoreFlight.current===token)setError('恢复操作未完成，原数据已保留。请检查目录和当前任务；若交接状态不确定，请退出后重新打开应用检查。')}
  finally{if(mounted.current&&restoreFlight.current===token){restoreFlight.current=null;setRestoring(false)}}
 }
 const load=async()=>{
  if(flight.current)return
  const token=Symbol();flight.current=token;setBusy(true);setError('')
  try{
   if(!window.desktop?.applicationBackups)throw Error('应用数据备份暂不可用')
   const result=applicationBackupControlResultSchema.parse({type:'list',backups:await window.desktop.applicationBackups()})
   if(result.type!=='list')throw Error('应用备份列表回执无效')
   if(mounted.current&&flight.current===token){setBackups([...result.backups].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)));setPage(0)}
  }catch(error){if(mounted.current&&flight.current===token)setError(error instanceof Error&&error.message?error.message:'应用备份读取失败，请重试')}
  finally{if(mounted.current&&flight.current===token){flight.current=null;setBusy(false)}}
 }
 useEffect(()=>{mounted.current=true;void load();if(window.desktop?.restoreApplication)void restore({type:'status'});return()=>{mounted.current=false;flight.current=null;restoreFlight.current=null}},[])
 const total=backups?.length??0,pages=Math.max(1,Math.ceil(total/pageSize)),current=Math.min(page,pages-1)
 return <section aria-label="应用数据备份" className="space-y-3 border-t pt-4">
  <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">应用数据备份</h3><Button variant="outline" size="sm" disabled={busy} onClick={()=>void load()} aria-label="刷新应用备份">{busy?<Loader2 className="size-4 animate-spin" aria-hidden/>:<RefreshCw className="size-4" aria-hidden/>}刷新</Button></div>
  {busy&&<p role="status" className="text-xs text-muted-foreground">正在读取应用备份…</p>}
  {error&&<p role="alert" className="break-words text-sm text-destructive">{error}</p>}
  {restoring&&<p role="status" className="text-xs text-muted-foreground">正在处理恢复请求，请完成系统对话框中的选择…</p>}
  {restoration?.phase==='prepared'&&<div className="space-y-2 rounded-lg border p-3"><p role="status" className="text-sm">继续恢复将保存当前输入、停止任务并完整退出。重新启动后会验证副本，并再次确认启用。</p><p className="break-all text-xs text-muted-foreground">恢复目录：{restoration.targetPath}</p><div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={restoring} onClick={()=>void restore({type:'cancel',operationId:restoration.operationId!})}>取消恢复</Button><Button size="sm" disabled={restoring} onClick={()=>void restore({type:'start',operationId:restoration.operationId!})}>继续恢复</Button></div></div>}
  {restoration?.phase==='inspection'&&<p role="status" className="text-sm text-muted-foreground">恢复交接需要检查。原数据和已生成的副本保留，请退出后重新打开应用。</p>}
  {restoration?.phase==='closing'&&<div className="flex items-center justify-between gap-3 rounded-lg border p-3"><p role="status" className="text-sm">数据已停止接受修改，恢复交接尚未完成。</p><Button size="sm" disabled={restoring} onClick={()=>void restore({type:'start',operationId:restoration.operationId!})}>重试完成交接</Button></div>}
  {!busy&&!error&&backups?.length===0&&<p className="py-3 text-sm text-muted-foreground">暂无应用数据备份。</p>}
  {total>0&&<><ul aria-label="应用数据备份列表" className="divide-y rounded-lg border">{backups!.slice(current*pageSize,(current+1)*pageSize).map(backup=><li key={backup.id} className="flex items-center justify-between gap-4 px-3 py-4"><time dateTime={backup.createdAt} className="text-sm">{new Date(backup.createdAt).toLocaleString('zh-CN')}</time><div className="flex shrink-0 items-center gap-3"><span className="text-xs text-muted-foreground">{size(backup.bytes)}</span><Button size="sm" variant="outline" aria-label="恢复此应用备份" disabled={busy||restoring||!!restoration&&restoration.phase!=='idle'} onClick={()=>void restore({type:'select',backupId:backup.id})}>恢复</Button></div></li>)}</ul>
   {pages>1&&<div className="flex items-center justify-end gap-2"><span className="text-xs text-muted-foreground">共 {total} 份 · {current+1} / {pages}</span><Button variant="outline" size="sm" disabled={current===0||busy} aria-label="上一页应用备份" onClick={()=>setPage(current-1)}>上一页</Button><Button variant="outline" size="sm" disabled={current===pages-1||busy} aria-label="下一页应用备份" onClick={()=>setPage(current+1)}>下一页</Button></div>}</>}
 </section>
}
