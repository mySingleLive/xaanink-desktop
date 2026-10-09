import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import type { BrowserWindow, Menu, MenuItemConstructorOptions } from "electron"
import { InputContextMenus } from "../../desktop/main/input-context-menu"
import { inputContextStateSchema, inputContextCommands, type InputContextCommand, type InputContextState } from "../../desktop/shared/input-context-menu"
import { installInputContextMenu } from "../../src/lib/desktop/input-commands"
const state=Object.fromEntries(inputContextCommands.map(({id})=>[id,true])) as InputContextState
test("K07: native input menu protocol accepts only the exact boolean capabilities",()=>{
 assert.deepEqual(inputContextStateSchema.parse(state),state)
 for(const value of [null,{}, {...state,"text.copy":"yes"},{...state,apiKey:"public-fixture"},{...state,"app.quit":true}])assert.equal(inputContextStateSchema.safeParse(value).success,false)
})
for(const event of ["cancel","closed","blur","replace","throw"] as const)test(`K06: main native menu ${event} releases its promise and lifecycle listeners`,async()=>{
 const owner=Object.assign(new EventEmitter(),{isDestroyed:()=>false,isFocused:()=>true}) as unknown as BrowserWindow
 let popup!:{callback:()=>void};let closes=0,template:MenuItemConstructorOptions[]=[]
 const menus=new InputContextMenus(items=>{template=items;return {popup:(options:typeof popup)=>{popup=options;if(event==="throw")throw Error("native failed")},closePopup:()=>{closes++}} as unknown as Menu})
 const pending=menus.open(owner,{...state,"text.cut":false})
 assert.equal(template.find(row=>row.id==="text.cut")?.enabled,false);assert.ok(template.every(row=>row.role===undefined))
 if(event==="cancel")popup.callback()
 if(event==="closed"||event==="blur")owner.emit(event)
 if(event==="replace"){const next=menus.open(owner,state);popup.callback();assert.equal(await next,null)}
 assert.equal(await pending,null);assert.ok(closes>0);assert.equal(owner.listenerCount("closed"),0);assert.equal(owner.listenerCount("blur"),0)
})
function fixture(){
 let resolve!:(id:InputContextCommand|null)=>void,capabilities:InputContextState|undefined
 const calls:Array<{id:string;target:unknown}>=[]
 const document=Object.assign(new EventTarget(),{activeElement:null as unknown,defaultView:new EventTarget(),hasFocus:()=>true})
 const control={tagName:"INPUT",type:"password",getAttribute:()=>"api-key",isConnected:true,disabled:false,readOnly:false,ownerDocument:document,value:"public-fixture",selectionStart:0,selectionEnd:6,selectionDirection:"forward",matches:()=>false,focus(){document.activeElement=this}}
 control.focus()
 const dispose=installInputContextMenu({document:document as unknown as Document,show:async state=>{capabilities=state;return await new Promise<InputContextCommand|null>(yes=>{resolve=yes})},commands:{enabled:()=>true,execute:async(id,target)=>{calls.push({id,target});return true}}})
 const fire=(type="contextmenu",extras:Record<string,unknown>={})=>{const event=new Event(type,{cancelable:true});Object.defineProperties(event,Object.fromEntries(Object.entries({target:control,...extras}).map(([key,value])=>[key,{value}])));document.dispatchEvent(event);return event}
 return {document,control,calls,dispose,fire,get capabilities(){return capabilities},async choose(id:InputContextCommand|null){resolve(id);for(let n=0;n<8;n++)await Promise.resolve()}}
}
test("K03: contextmenu and keyboard menu use the original masked control and only command capabilities",async()=>{
 for(const extras of [null,{key:"F10",shiftKey:true},{key:"ContextMenu"}]){
  const f=fixture();try{assert.equal(f.fire(extras?"keydown":"contextmenu",extras??{}).defaultPrevented,true);assert.deepEqual(f.capabilities,state);await f.choose("text.copy");assert.deepEqual(f.calls,[{id:"text.copy",target:f.control}])}finally{f.dispose()}
 }
})
for(const change of ["focus-return","selection","value","composition","input","keydown","dispose","disconnect","cancel","marker"] as const)test(`K06: late native menu choice cannot cross ${change}`,async()=>{
 const f=fixture()
 try{
  f.fire()
  if(change==="focus-return"){f.document.activeElement={};f.document.dispatchEvent(new Event("focusin"));f.control.focus();f.document.dispatchEvent(new Event("focusin"))}
  if(change==="selection")f.control.selectionEnd=1
  if(change==="value")f.control.value="changed"
  if(change==="composition")f.document.dispatchEvent(new Event("compositionstart"))
  if(change==="input"||change==="keydown")f.document.dispatchEvent(new Event(change))
  if(change==="dispose")f.dispose()
  if(change==="disconnect")f.control.isConnected=false
  if(change==="marker")f.control.getAttribute=()=>""
  await f.choose(change==="cancel"?null:"text.cut");assert.deepEqual(f.calls,[])
 }finally{f.dispose()}
})
