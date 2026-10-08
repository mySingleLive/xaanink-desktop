"use client"
import {useEffect,useMemo,useState} from "react"
import {toast} from "sonner"
import {Dialog,DialogContent,DialogTitle,DialogDescription} from "@/components/ui/dialog"
import {Button} from "@/components/ui/button"
import {desktopRecoveryStore,type RecoveryReason} from "@/lib/desktop/draft-recovery"
import {desktopSaveCoordinator} from "@/lib/desktop/save-coordinator"
import {draftSnapshotSchema} from "@desktop/shared/drafts"
import {useDesktopStore} from "@/stores/desktop"
import {recoveryPreview} from "@/lib/desktop/recovery-preview"
const sources:Record<string,string>={autosaves:"编辑草稿",staged:"待确认修改",scene:"场景草稿",chat:"对话草稿",workspace:"工作台记录",comments:"评论草稿",recovery:"保留记录",application:"应用草稿"}
const reasons:Record<RecoveryReason,string>={RESTORE_DISABLED:"已关闭自动恢复",WORK_RESTORED:"作品保留的草稿",APPLICATION_RESTORED:"应用保留的草稿",AUTOSAVE_UNMATCHED:"保留的编辑副本",EXECUTION_METADATA:"执行前需要确认",INVALID_DATA:"记录需要核对",TARGET_UNAVAILABLE:"原作品或内容暂不可用",ACCOUNT_MISMATCH:"作者信息不匹配",STORAGE_UNAVAILABLE:"暂存位置不可用",UNKNOWN_SOURCE:"暂不支持自动恢复",SOURCE_UNREADABLE:"部分记录无法读取",CURRENT_DRAFT_CONFLICT:"已保留当前较新的输入"}
export function RecoveryDialog({open,onOpenChange}:{open:boolean;onOpenChange(open:boolean):void}){
 const [snapshot,setSnapshot]=useState(()=>desktopRecoveryStore.read()),[selected,setSelected]=useState<string|null>(null),[exporting,setExporting]=useState(false)
 useEffect(()=>desktopRecoveryStore.subscribe(()=>setSnapshot(desktopRecoveryStore.read())),[])
 const visible=useMemo(()=>snapshot.items.map(item=>({item,preview:recoveryPreview(item)})).filter(row=>!row.preview.empty).sort((a,b)=>Number(b.preview.meaningful)-Number(a.preview.meaningful)),[snapshot])
 const current=visible.find(row=>row.item.id===selected)??visible[0],item=current?.item,preview=current?.preview,text=preview?.text??""
 const exportAll=async()=>{
  const sessionId=useDesktopStore.getState().bootstrap?.draftSessionId
  if(!sessionId||!window.desktop)return
  setExporting(true)
  try{if(await window.desktop.exportDraft(sessionId,draftSnapshotSchema.parse(desktopSaveCoordinator.exportSnapshot())))toast.success("草稿已导出")}
  catch{toast.error("导出失败，原草稿仍保留在本机")}
  finally{setExporting(false)}
 }
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
  <DialogTitle>保留的草稿</DialogTitle><DialogDescription>保留的草稿可查看、复制或导出。原任务和待批准修改不会自动执行。</DialogDescription>
  <h3 className="text-sm font-medium">保留的草稿</h3>
  {visible.length?<div className="grid h-[min(30vh,300px)] min-h-0 grid-cols-[minmax(130px,1fr)_3fr] gap-3">
   <nav aria-label="保留的草稿列表" className="space-y-1 overflow-auto rounded-lg border p-1">{visible.map(({item:row},index)=><button key={row.id} aria-current={row.id===item?.id?"true":undefined} onClick={()=>setSelected(row.id)} className="w-full rounded-md p-2 text-left text-sm hover:bg-accent aria-current:bg-accent"><span>{sources[row.source]??"保留的内容"} {index+1}</span><small className="mt-1 block text-muted-foreground">{reasons[row.reason]}</small></button>)}</nav>
   <textarea aria-label="保留的草稿内容" readOnly value={text} className="min-h-0 resize-none rounded-lg border bg-editor p-3 text-sm leading-relaxed" />
  </div>:<p className="py-8 text-center text-muted-foreground">没有需要核对的保留草稿。</p>}
  {preview?.truncated&&<p className="text-xs text-muted-foreground" role="status">预览仅显示前 100,000 个字符，完整内容可导出查看。</p>}
  <div className="flex justify-end gap-2"><Button variant="outline" disabled={!preview?.meaningful} onClick={()=>{void window.desktop?.writeClipboardText(text).then(()=>toast.success(preview?.truncated?"已复制预览":"已复制草稿")).catch(()=>toast.error("复制失败，请重试"))}}>{preview?.truncated?"复制预览":"复制内容"}</Button><Button disabled={exporting||!snapshot.items.length} onClick={()=>{void exportAll()}}>{exporting?"正在导出…":"导出草稿"}</Button></div>
 </DialogContent></Dialog>
}
