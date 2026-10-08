import assert from "node:assert/strict"
import {test} from "node:test"
import {installComposerTextCommands} from "../../src/lib/desktop/composer-text-commands"
import {desktopCommandTargets} from "../../src/lib/desktop/command-runtime"
import {consumeDesktopComposerPaste,nativeTextEdits} from "../../src/lib/desktop/native-text-edits"

// Real composer registration + native edit guard, controlled document/selection.
// This cannot establish actual Chromium chip hydration or OS clipboard behavior.
function fixture(){
 let release!:(text:string)=>void
 const pending=new Promise<string>(resolve=>{release=resolve})
 const node={},selection={anchorNode:node,anchorOffset:0,focusNode:node,focusOffset:0,isCollapsed:true,selectAllChildren(){this.isCollapsed=false}}
 class DataTransfer {
  private data=new Map<string,string>()
  setData(type:string,value:string){this.data.set(type,value)}
  getData(type:string){return this.data.get(type)??""}
  get types(){return [...this.data.keys()]}
 }
 class ClipboardEvent extends Event {
  readonly clipboardData:DataTransfer|null
  constructor(type:string,init:EventInit&{clipboardData?:DataTransfer}={}){super(type,init);this.clipboardData=init.clipboardData??null}
 }
 const document=Object.assign(new EventTarget(),{
  defaultView:Object.assign(new EventTarget(),{ClipboardEvent,DataTransfer}),focused:true,activeElement:null as unknown,calls:[] as Array<[string,string|undefined]>,
  hasFocus(){return this.focused},getSelection(){return selection},execCommand(command:string,_ui=false,text?:string){this.calls.push([command,text]);return true},
 })
 const composer=Object.assign(new EventTarget(),{ownerDocument:document,isConnected:true,isContentEditable:true,innerHTML:"existing draft",contains:(value:unknown)=>value===node,
  closest:(selector:string)=>selector.includes(".chat-composer-editable")?composer:null,
  focus(){document.activeElement=composer;document.dispatchEvent(new Event("focusin"))},
 })
 const pastes:Array<{text:string;types:string[];acknowledged:boolean}>=[]
 composer.addEventListener("paste",event=>{
  const data=(event as ClipboardEvent).clipboardData
  const acknowledged=consumeDesktopComposerPaste(event,text=>{pastes.push({text,types:data?.types??[],acknowledged:true})})
  if(!acknowledged) pastes.push({text:data?.getData("text/plain")??"",types:data?.types??[],acknowledged:false})
 })
 document.activeElement=composer
 const native=nativeTextEdits(document as unknown as Document,()=>pending)
 const remove=installComposerTextCommands(document as unknown as Document,native.run)
 return {document,composer,selection,release,pastes,
  run:(id:string)=>desktopCommandTargets.execute(id,composer as unknown as HTMLElement),
  enabled:(id:string)=>desktopCommandTargets.enabled(id,composer as unknown as HTMLElement),
  dispose(){remove();native.dispose()},
 }
}
test("CMP47-07: menu paste refocuses the captured composer and acknowledges one plain ClipboardEvent after the validated read",async()=>{
 const f=fixture()
 try{
  f.document.activeElement={closest:(selector:string)=>selector.includes('role="menu"')?{}:null}
  const result=f.run("text.paste")
  assert.equal(f.document.activeElement,f.composer);assert.deepEqual(f.document.calls,[])
  f.release("plain text");assert.equal(await result,true)
  assert.deepEqual(f.pastes,[{text:"plain text",types:["text/plain"],acknowledged:true}])
  assert.deepEqual(f.document.calls,[],"composer insertion belongs to its acknowledged onPaste path, never an insertText fallback")
 }finally{f.dispose()}
})
for(const change of ["focus-and-return","selection","html","composition","readonly","disconnect","dispose","window-blur-return"] as const)test(`CMP47-08-${change}: delayed paste cannot revive across a ${change} change`,async()=>{
 const f=fixture()
 try{
  const result=f.run("text.pastePlain"),rejection=assert.rejects(result,/输入目标|选区/)
  if(change==="focus-and-return"){f.document.activeElement={};f.document.dispatchEvent(new Event("focusin"));f.composer.focus()}
  if(change==="selection")f.selection.anchorOffset=1
  if(change==="html")f.composer.innerHTML="new draft"
  if(change==="composition")f.document.dispatchEvent(new Event("compositionstart"))
  if(change==="readonly")f.composer.isContentEditable=false
  if(change==="disconnect")f.composer.isConnected=false
  if(change==="dispose")f.dispose()
  if(change==="window-blur-return"){f.document.focused=false;f.document.defaultView.dispatchEvent(new Event("blur"));f.document.focused=true}
  f.release("late clipboard");await rejection;assert.deepEqual(f.document.calls,[])
 }finally{f.dispose()}
})
test("CMP47-09: IME blocks composer text commands and foreign selections cannot be copied or cut",async()=>{
 const f=fixture()
 try{
  f.selection.isCollapsed=false
  assert(f.enabled("text.copy"));assert(f.enabled("text.cut"))
  f.document.dispatchEvent(new Event("compositionstart"));assert.equal(f.enabled("text.copy"),false);assert.equal(await f.run("text.undo"),false)
  f.document.dispatchEvent(new Event("compositionend"));f.selection.focusNode={}
  assert.equal(f.enabled("text.copy"),false);assert.equal(f.enabled("text.cut"),false);assert.deepEqual(f.document.calls,[])
 }finally{f.dispose()}
})
test("CMP47-10: a read-only composer rejects all writing commands without touching native history",async()=>{
 const f=fixture()
 try{f.composer.isContentEditable=false;for(const id of ["text.cut","text.paste","text.pastePlain","text.undo","text.redo"])assert.equal(await f.run(id),false);assert.deepEqual(f.document.calls,[])}finally{f.dispose()}
})
