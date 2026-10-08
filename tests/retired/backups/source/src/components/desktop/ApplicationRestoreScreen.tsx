"use client"

import {useEffect,useRef,useState} from 'react'
import {Menu} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {applicationRestoreEntryStateSchema,type ApplicationRestoreEntryBridge,type ApplicationRestoreEntryCommand,type ApplicationRestoreEntryState} from '@desktop/shared/application-restore-entry'

const labels:Record<ApplicationRestoreEntryState['phase'],string>={selecting:'选择应用备份',prepared:'恢复请求已保存',armed:'等待冷恢复',running:'正在验证恢复副本…',confirming:'等待原生确认…',cancelled:'恢复已取消',complete:'恢复副本已启用',inspection:'需要检查恢复状态',blocked:'恢复状态暂不可用'}
const notices:Record<NonNullable<ApplicationRestoreEntryState['notice']>,string>={
 'choose-backup':'请选择完整应用备份包。原数据与恢复副本会分别保留。',
 'choose-parent':'请选择独立的空目录，应用将在其中创建恢复副本与保留目录。',
 ready:'完整退出旧进程后才开始验证副本，启用前还需在系统对话框确认实际目录。',
 'old-process-active':'旧进程仍在运行。请完整退出旧实例后重新检查。',
 'inspection-required':'本次恢复结果需要检查。请保留原数据、副本和控制文件，检查不会再次执行恢复。',
 'owner-expired':'当前恢复窗口已失效，请退出应用后重新检查。',
 'cancel-pending':'正在等待文件操作和恢复进程实际结束，请保持窗口打开。',
 cancelled:'恢复已取消，原数据与已产生的副本保留。',
 activated:'重新打开后需完成草稿保护检查；保留的旧请求与审批只供查看。',
 failed:'操作未完成。请检查实际恢复状态或安全退出，保留全部文件。',
}
type Action=ApplicationRestoreEntryCommand['type']
interface ViewProps{state:ApplicationRestoreEntryState|null;error:string|null;pending:readonly string[];available:boolean;command(action:Action):void}
export function ApplicationRestoreView({state,error,pending,available,command}:ViewProps){
 const exiting=pending.some(action=>['quit','restart','locate'].includes(action)),cancelling=pending.includes('cancel')
 const action=(type:Action,label:string,allowed:boolean,disabled:boolean,outline=false)=>allowed&&<Button data-restore-command={type} variant={outline?'outline':'default'} disabled={disabled} onClick={()=>command(type)}>{label}</Button>
 return <main className={`${state?.theme??'paper'} flex h-dvh min-h-0 flex-col overflow-auto bg-background font-sans text-foreground`}>
  <div className="desktop-drag flex h-11 w-full shrink-0 items-center justify-end pr-[144px]">
   {available&&state?.platform==='win32'&&<Button data-restore-command="menu" aria-label="应用菜单" variant="ghost" size="icon" disabled={exiting||pending.includes('menu')} onClick={()=>command('menu')}><Menu className="size-4"/></Button>}
  </div>
  <div className="flex flex-1 items-center justify-center px-5 pb-8 pt-3">
   <section aria-labelledby="application-restore-title" className="w-full min-w-0 max-w-xl rounded-xl border border-border bg-card p-6 sm:p-8">
    <h1 id="application-restore-title" className="font-heading text-2xl font-semibold">恢复应用数据</h1>
    <div role="status" aria-live="polite" aria-atomic="true" className="mt-6 space-y-2">
     <h2 className="text-base font-medium">{state?labels[state.phase]:'正在读取恢复状态…'}</h2>
     {state?.notice&&<p className="text-sm leading-6 text-muted-foreground">{notices[state.notice]}</p>}
    </div>
    {state&&<dl className="mt-5 space-y-3 text-sm">
     <div><dt className="text-xs text-muted-foreground">原数据目录</dt><dd className="mt-1 break-all leading-6">{state.sourcePath??'目录记录尚未确认'}</dd></div>
     {state.targetPath&&<div><dt className="text-xs text-muted-foreground">实际恢复目录</dt><dd className="mt-1 break-all leading-6">{state.targetPath}</dd></div>}
     {state.backup&&<div><dt className="text-xs text-muted-foreground">所选应用备份</dt><dd className="mt-1 break-all leading-6">{state.backup.id}<br/>{state.backup.createdAt}</dd></div>}
    </dl>}
    {error&&<p role="alert" className="mt-5 text-sm leading-6 text-destructive">{error}</p>}
    {available&&<div className="mt-6 flex flex-wrap justify-end gap-2">
     {action('choose-backup','选择应用备份',!!state?.canChooseBackup,pending.length>0)}
     {action('choose-parent','选择空恢复目录',!!state?.canChooseParent,pending.length>0)}
     {action('locate','定位原数据目录',!!state?.canLocate,pending.length>0,true)}
     {action('continue',state?.phase==='prepared'?'关闭并继续恢复':'开始冷恢复',!!state?.canContinue,pending.length>0)}
     {action('cancel',cancelling?'正在取消…':'取消恢复',!!state?.canCancel||cancelling,exiting||cancelling,true)}
     {action('inspect','检查恢复状态',!state?.canChooseBackup,pending.length>0,true)}
     {action('restart','重新打开应用',!!state?.canRestart,pending.length>0)}
     {action('quit',pending.includes('quit')?'正在退出…':'退出应用',true,exiting||cancelling,true)}
    </div>}
   </section>
  </div>
 </main>
}
interface Connection{bridge:ApplicationRestoreEntryBridge;alive:boolean;state:ApplicationRestoreEntryState|null;pending:Set<Action>}
export function ApplicationRestoreScreen(){
 const[state,setState]=useState<ApplicationRestoreEntryState|null>(null),[error,setError]=useState<string|null>(null),[pending,setPending]=useState<Action[]>([]),[available,setAvailable]=useState(false),connection=useRef<Connection|null>(null)
 useEffect(()=>{
  const bridge=window.desktopApplicationRestore
  if(!bridge){setError('恢复状态暂不可用，请重新打开应用。');return}
  const current:Connection={bridge,alive:true,state:null,pending:new Set()};connection.current=current;setAvailable(true)
  const live=()=>current.alive&&connection.current===current
  const receive=(input:ApplicationRestoreEntryState)=>{
   if(!live())return;const parsed=applicationRestoreEntryStateSchema.safeParse(input)
   if(!parsed.success){setError('恢复状态无法验证，请退出后重新检查。');return}
   if(current.state&&parsed.data.revision<=current.state.revision)return
   current.state=parsed.data;setState(parsed.data);setError(null)
  }
  let unsubscribe:(()=>void)|undefined
  try{unsubscribe=bridge.subscribe(receive);void bridge.state().then(receive,()=>{if(live())setError('暂时无法读取恢复状态，请重新打开应用。')})}catch{setError('恢复状态暂不可用，请重新打开应用。')}
  return()=>{current.alive=false;if(connection.current===current)connection.current=null;unsubscribe?.()}
 },[])
 const command=async(action:Action)=>{
  const current=connection.current;if(!current?.alive||current.pending.has(action)||[...current.pending].some(value=>['quit','restart','locate'].includes(value)))return
  const selected=current.state
  if(action==='choose-backup'&&(!selected?.canChooseBackup||current.pending.size)||action==='choose-parent'&&(!selected?.canChooseParent||current.pending.size)||action==='continue'&&(!selected?.canContinue||current.pending.size)||action==='cancel'&&!selected?.canCancel||action==='restart'&&(!selected?.canRestart||current.pending.size)||action==='locate'&&(!selected?.canLocate||current.pending.size)||action==='inspect'&&current.pending.size)return
  let input:ApplicationRestoreEntryCommand
  if(action==='continue'||action==='cancel'){if(!selected?.operationId)return;input={type:action,operationId:selected.operationId}}else input={type:action}
  current.pending.add(action);setPending([...current.pending]);setError(null)
  try{await current.bridge.command(input)}catch{if(current.alive&&connection.current===current)setError('操作未完成，请检查实际恢复状态或退出应用。')}
  finally{if(current.alive&&connection.current===current){current.pending.delete(action);setPending([...current.pending])}}
 }
 return <ApplicationRestoreView state={state} error={error} pending={pending} available={available} command={action=>{void command(action)}}/>
}
