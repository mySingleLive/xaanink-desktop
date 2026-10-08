"use client"
import {useEffect,useRef,useState} from 'react'
import {Loader2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {applicationBackupCompletion} from '@desktop/shared/work-backup'
export function WorkBackupButton(){
 const active=useRef(false),mounted=useRef(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 const backup=async()=>{
  if(active.current||!window.desktop)return
  active.current=true;setBusy(true);setMessage('');setError(false)
  try{
   const result=await window.desktop.workBackup({type:'now'});if(result.type!=='now')throw Error('备份回执无效')
   const failures=[...(result.application?.status==='failed'?[result.application.message||'应用数据备份未完成']:[]),...(result.workError!==undefined?[result.workError||'作品备份未完成']:[]),...result.failed.map(row=>`${row.title}：${row.message}`)]
   if(failures.length)throw Error([applicationBackupCompletion(result.application),...failures].filter(Boolean).join('；'))
   const works=result.saved.length?`已完成 ${result.saved.length} 部作品备份`:''
   const application=applicationBackupCompletion(result.application)
   if(mounted.current)setMessage([application,works].filter(Boolean).join('；')||'尚无作品可备份')
  }
  catch(error){if(mounted.current){setError(true);setMessage(error instanceof Error?error.message:'备份未完成，请重试')}}
  finally{active.current=false;if(mounted.current)setBusy(false)}
 }
 return <div className="flex flex-col items-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>void backup()}>{busy&&<Loader2 className="size-4 animate-spin" aria-hidden/>}{busy?'正在备份…':'立即备份'}</Button>{message&&<p role={error?'alert':'status'} className={`max-w-full break-words text-xs ${error?'text-destructive':'text-muted-foreground'}`}>{message}</p>}</div>
}
