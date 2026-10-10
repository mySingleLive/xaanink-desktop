"use client"
import {useEffect} from "react"
import {toast} from "sonner"
import {useDesktopStore,updateDesktopSettings} from "@/stores/desktop"
import {useTabsStore} from "@/stores/tabs"
import {ShortcutDispatcher} from "@desktop/core/shortcut-dispatch"
import {bindingsFor,canonicalKey,capturedKey} from "@desktop/core/shortcuts"
import {desktopCommandCatalog,desktopCommandTargets,desktopCommandTarget,desktopEditorTarget,rememberDesktopCommandTarget} from "@/lib/desktop/command-runtime"
import {useDesktopCommands} from "@/lib/desktop/use-command-target"
import {installInputCommands,installInputContextMenu,isAPIKeyControl} from "@/lib/desktop/input-commands"
import {nativeTextEdits} from "@/lib/desktop/native-text-edits"
import {installComposerTextCommands} from "@/lib/desktop/composer-text-commands"
import {commandScope as scope} from "@/lib/desktop/command-scope"

const nativeCommands=["app.settings","app.about","app.quit","app.hide","app.hideOthers","app.showAll","window.close","window.minimize","window.maximize","window.front","view.fullscreen","file.open","file.templates","file.chat","help.feedback","menu.file","menu.edit","menu.view","menu.window","menu.help","menu.app"]
const editorCommand=(id:string)=>["view.edit","view.preview","view.split","editor.focus","file.save","file.export"].includes(id)
// Base UI traps focus and makes the background inert without requiring an
// aria-modal attribute. Both dialog roles are an application command barrier.
const dialogSelector='[role="dialog"],[role="alertdialog"]'
export function DesktopCommandController(){
 useDesktopCommands({
  ...Object.fromEntries(nativeCommands.map(id=>[id,async()=>{await window.desktop?.command(id)}])),
  "file.close":{enabled:()=>!!useTabsStore.getState().activeTabId,run:()=>{const state=useTabsStore.getState();if(state.activeTabId)state.closeTab(state.activeTabId)}},
  "view.lineNumbers":async()=>{await updateDesktopSettings(before=>({...before,appearance:{...before.appearance,lineNumbers:!before.appearance.lineNumbers}}))},
  "view.wrap":async()=>{await updateDesktopSettings(before=>({...before,appearance:{...before.appearance,wordWrap:!before.appearance.wordWrap}}))},
  "view.zoomIn":async()=>{await updateDesktopSettings(before=>({...before,appearance:{...before.appearance,zoom:Math.min(2,Math.round((before.appearance.zoom+.1)*100)/100)}}))},
  "view.zoomOut":async()=>{await updateDesktopSettings(before=>({...before,appearance:{...before.appearance,zoom:Math.max(.75,Math.round((before.appearance.zoom-.1)*100)/100)}}))},
  "view.zoomReset":async()=>{await updateDesktopSettings(before=>({...before,appearance:{...before.appearance,zoom:1}}))},
 })
 useEffect(()=>{
  const textEdits=nativeTextEdits(document,()=>{if(!window.desktop)throw new Error("本地剪贴板尚未就绪");return window.desktop.readClipboardText()})
  const disposeInputs=installInputCommands({document,nativeEdit:textEdits.run})
  const disposeInputMenu=installInputContextMenu({document,show:state=>{if(!window.desktop)throw Error("本地菜单尚未就绪");return window.desktop.showInputContextMenu(state)},onError:()=>toast.error("输入菜单操作未完成，请重试")})
  const disposeComposer=installComposerTextCommands(document,textEdits.run)
  const dispatcher=new ShortcutDispatcher()
  const nativeFirst=new WeakSet<KeyboardEvent>()
  const focus=(event:Event)=>{if(event.target instanceof HTMLElement)rememberDesktopCommandTarget(event.target);dispatcher.reset()}
  const run=(id:string,target:HTMLElement|null)=>{void desktopCommandTargets.execute(id,editorCommand(id)?desktopEditorTarget():target).then(done=>{if(!done)toast.info("此命令在当前视图不可用")}).catch(error=>toast.error(error instanceof Error?error.message:"命令执行失败"))}
  const command=(event:Event)=>{
   dispatcher.reset()
   const id=(event as CustomEvent<string>).detail,target=desktopCommandTarget()
   if(document.querySelector('[data-desktop-recording="true"]'))return
   // Native menus retain the prior editor target. A modal barrier must also
   // apply here, otherwise a menu click edits content behind the dialog.
   if(document.querySelector(dialogSelector)&&(!id.startsWith("text.")||!target?.closest(dialogSelector)))return
   if((id.startsWith("md.")||id.startsWith("monaco."))&&!["markdown","preview"].includes(scope(target)))return
   run(id,target)
  }
  const keydown=(event:KeyboardEvent,afterNative=false)=>{
   const bootstrap=useDesktopStore.getState().bootstrap
   if(!bootstrap||event.defaultPrevented||event.isComposing||event.keyCode===229){dispatcher.reset();return}
   const target=event.target instanceof HTMLElement?event.target:desktopCommandTarget()
   if(target?.closest('[role="menu"],[role="listbox"],[data-slot="select-content"]')){dispatcher.reset();return}
   const recording=!!document.querySelector('[data-desktop-recording="true"]')
   if(recording){dispatcher.reset();return}
   // A focused content tab owns Alt+arrows before global navigation capture.
   if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&["ArrowLeft","ArrowRight"].includes(event.key)&&target===document.activeElement&&target?.matches('.content-tabs-track .content-tab[role="tab"]')){dispatcher.reset();return}
   // Escape cancels an in-progress tab drag before any global stop binding.
   if(event.key==="Escape"&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&document.querySelector('.content-tabs-track .content-tab-drag-source')){dispatcher.reset();return}
   // Escape belongs to the top dialog/menu (including its nested widgets),
   // even when an ordinary input's cancel binding was removed or rebound.
   if(document.querySelector(dialogSelector)&&event.key==="Escape"&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey){dispatcher.reset();return}
   const currentScope=scope(target),commands=desktopCommandCatalog(bootstrap.platform),overrides=bootstrap.settings.shortcuts[bootstrap.platform]
   const stroke=capturedKey({...event,key:event.key,code:event.code,metaKey:event.metaKey,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,isComposing:event.isComposing,repeat:false,keyCode:event.keyCode},bootstrap.platform)
   if(!stroke){if(!["Control","Shift","Alt","Meta","AltGraph"].includes(event.key))dispatcher.reset();return}
   const normalized=canonicalKey(stroke)
   const modal=!!document.querySelector(dialogSelector)
   const pending=dispatcher.waitingFor({commands,overrides,platform:bootstrap.platform,scope:currentScope,focus:target,modal})
   const matchesStroke=(binding:string)=>{const strokes=canonicalKey(binding).split(" ");return strokes[0]===normalized||pending&&strokes.includes(normalized)}
   const active=commands.filter(command=>command.scope==="global"&&!modal||command.scope===currentScope||command.scope==="markdown"&&currentScope==="preview"||command.scope==="text"&&currentScope!=="none")
   const globalMatch=active.some(command=>command.scope==="global"&&bindingsFor(command,overrides).some(matchesStroke))
   const customized=active.some(command=>{
    if(!Object.hasOwn(overrides,command.id))return false
    const defaults=command.defaults.map(canonicalKey),confirmed=bindingsFor(command,overrides).map(canonicalKey)
    return [...defaults.filter(binding=>!confirmed.includes(binding)),...confirmed.filter(binding=>!defaults.includes(binding))].some(matchesStroke)
   })
   const composerMatch=currentScope==="composer"&&active.some(command=>command.scope==="composer"&&desktopCommandTargets.enabled(command.id,target)&&bindingsFor(command,overrides).some(matchesStroke))
   const previewMatch=currentScope==="preview"&&active.some(command=>command.scope==="text"&&desktopCommandTargets.enabled(command.id,target)&&bindingsFor(command,overrides).some(matchesStroke))
   const keyClipboardMatch=isAPIKeyControl(target)&&active.some(command=>["text.copy","text.cut","text.paste","text.pastePlain"].includes(command.id)&&bindingsFor(command,overrides).some(matchesStroke))
   const markdownMatch=(currentScope==="markdown"||currentScope==="preview")&&active.some(command=>command.scope==="markdown"&&command.id.startsWith("md.")&&!(command as {monacoBindings?:unknown[]}).monacoBindings?.length&&desktopCommandTargets.enabled(command.id,target)&&bindingsFor(command,overrides).some(matchesStroke))
   // Chromium/Monaco retain native movement, IME, when-expressions and undo
   // for untouched local bindings. Only custom/removed keys need interception.
   if(currentScope!=="none"&&!globalMatch&&!customized&&!composerMatch&&!markdownMatch&&!previewMatch&&!keyClipboardMatch){dispatcher.reset();return}
   // Monaco resolves its own untouched chords/when clauses first. A global
   // fallback may run at bubble time only if the editor did not consume it.
   if(currentScope==="markdown"&&globalMatch&&!customized&&!markdownMatch&&!pending&&!afterNative){dispatcher.reset();nativeFirst.add(event);return}
   // The macOS system owns the menu-bar focus shortcut.
   if(bootstrap.platform==="darwin"&&normalized===canonicalKey("Ctrl+F2")){dispatcher.reset();return}
   const result=dispatcher.key(event,{commands:afterNative?commands.filter(command=>command.scope==="global"):commands,overrides,platform:bootstrap.platform,scope:currentScope,focus:target,modal,
    enabled:id=>desktopCommandTargets.enabled(id,editorCommand(id)?desktopEditorTarget():target),repeatable:id=>id.startsWith("input.")||/^md\.(move|duplicate|indent|outdent|delete|findNext|findPrevious)/.test(id)})
   if(result.kind==="none")return
   event.preventDefault();event.stopImmediatePropagation()
   if(result.kind==="run")run(result.id,target)
  }
  const clear=()=>dispatcher.reset()
  const bubble=(event:KeyboardEvent)=>{if(nativeFirst.delete(event))keydown(event,true)}
  document.addEventListener("focusin",focus,true);document.addEventListener("pointerdown",focus,true)
  window.addEventListener("keydown",keydown,true);window.addEventListener("keydown",bubble);window.addEventListener("blur",clear)
  window.addEventListener("desktop:command",command)
  return()=>{disposeInputMenu();disposeInputs();disposeComposer();textEdits.dispose();document.removeEventListener("focusin",focus,true);document.removeEventListener("pointerdown",focus,true);window.removeEventListener("keydown",keydown,true);window.removeEventListener("keydown",bubble);window.removeEventListener("blur",clear);window.removeEventListener("desktop:command",command)}
 },[])
 return null
}
