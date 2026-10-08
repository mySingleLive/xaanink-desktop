"use client"
import {useEffect,useRef,useState} from 'react'
import {Loader2} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
export function DataRootMigrationButton(){
 const [busy,setBusy]=useState(false),active=useRef(false),mounted=useRef(false)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 const migrate=async()=>{
  if(active.current||!window.desktop)return
  active.current=true;setBusy(true)
  try{await window.desktop.migrateRoot('start')}
  catch(error){if(mounted.current)toast.error(error instanceof Error?error.message:'迁移未能开始，请检查所选目录后重试。')}
  finally{active.current=false;if(mounted.current)setBusy(false)}
 }
 return <Button variant="outline" disabled={busy} onClick={()=>void migrate()}>{busy&&<Loader2 className="size-4 animate-spin" aria-hidden/>}迁移</Button>
}
