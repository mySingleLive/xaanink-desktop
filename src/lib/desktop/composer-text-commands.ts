import {registerDesktopCommandTarget} from "./command-runtime"
import type {NativeInputEdit} from "./input-commands"
export function installComposerTextCommands(document:Document,edit:(id:NativeInputEdit,control:HTMLElement)=>Promise<void>){
 let target:HTMLElement|null=null,alive=true,composing=false
 const start=()=>{composing=true},end=()=>{composing=false}
 document.addEventListener("compositionstart",start,true);document.addEventListener("compositionend",end,true);document.addEventListener("focusout",end,true)
 const accepted=(element:HTMLElement|null)=>{
  const root=element?.closest<HTMLElement>(".chat-composer-editable")??null
  return root?.isConnected&&root.isContentEditable&&(root===document.activeElement||!!document.activeElement?.closest('[role="menu"],[data-desktop-menu-button]'))?root:null
 }
 const enabled=(id:string)=>{
  if(!alive||!target||accepted(target)!==target||composing)return false
  if(id==="text.copy"||id==="text.cut"){
   const selection=document.getSelection()
   return !!selection&&!selection.isCollapsed&&!!selection.anchorNode&&!!selection.focusNode&&target.contains(selection.anchorNode)&&target.contains(selection.focusNode)
  }
  return true
 }
 const remove=registerDesktopCommandTarget({owner:{},accepts:element=>{target=accepted(element);return!!target},commands:Object.fromEntries(["text.undo","text.redo","text.cut","text.copy","text.paste","text.pastePlain","text.selectAll"].map(id=>[id,{enabled:()=>enabled(id),run:async()=>{
  if(!enabled(id)||!target)throw new Error("输入目标已变化")
  const control=target;control.focus()
  if(!enabled(id)||target!==control)throw new Error("输入目标已变化")
  if(id==="text.selectAll")document.getSelection()?.selectAllChildren(control)
  else await edit(id as NativeInputEdit,control)
 }}]))})
 return()=>{alive=false;target=null;remove();document.removeEventListener("compositionstart",start,true);document.removeEventListener("compositionend",end,true);document.removeEventListener("focusout",end,true)}
}
