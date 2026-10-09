import test from "node:test"
import assert from "node:assert/strict"
import {nativeTextEdits} from "../../src/lib/desktop/native-text-edits"
function setup(){
 let release!:(text:string)=>void
 const text=new Promise<string>(resolve=>{release=resolve})
 const doc=Object.assign(new EventTarget(),{activeElement:null as unknown,calls:[] as unknown[],execCommand(command:string,ui:boolean,value?:string){this.calls.push([command,value]);return true}})
 const input={isConnected:true,disabled:false,readOnly:false,ownerDocument:doc,value:"原稿",selectionStart:1,selectionEnd:2,selectionDirection:"forward",matches:()=>false}
 doc.activeElement=input
 const adapter=nativeTextEdits(doc as unknown as Document,()=>text)
 return {doc,input,adapter,release,run:(id:Parameters<typeof adapter.run>[0])=>adapter.run(id,input as unknown as HTMLInputElement)}
}
test("ordinary text edits execute synchronously against the validated control and preserve Chromium undo",async()=>{
 const f=setup();try{const pending=f.run("text.cut");assert.deepEqual(f.doc.calls,[["cut",undefined]]);await pending;await f.run("text.undo");assert.deepEqual(f.doc.calls.at(-1),["undo",undefined])}finally{f.adapter.dispose()}
})
test("paste applies only the returned plain text with insertText after retaining focus and selection",async()=>{
 const f=setup();try{const pending=f.run("text.paste");assert.deepEqual(f.doc.calls,[]);f.release("测试内容");await pending;assert.deepEqual(f.doc.calls,[["insertText","测试内容"]])}finally{f.adapter.dispose()}
})
for(const change of ["focus","selection","text","composition","dispose","readonly"] as const)test(`a pending paste cannot cross ${change} ownership changes`,async()=>{
 const f=setup();try{
  const pending=f.run("text.pastePlain"),rejected=assert.rejects(pending,/输入目标|内容过长/)
  if(change==="focus"){f.doc.dispatchEvent(new Event("focusin"));f.doc.activeElement={};f.doc.dispatchEvent(new Event("focusin"));f.doc.activeElement=f.input}
  if(change==="selection")f.input.selectionStart=0
  if(change==="text")f.input.value="新稿"
  if(change==="composition")f.doc.dispatchEvent(new Event("compositionstart"))
  if(change==="dispose")f.adapter.dispose()
  if(change==="readonly")f.input.readOnly=true
  f.release("迟到内容");await rejected;assert.deepEqual(f.doc.calls,[])
 }finally{f.adapter.dispose()}
})

function keyFixture(options:{fail?:boolean;delayed?:boolean}={}){
 const f=setup(),writes:string[]=[];let release!:()=>void
 const pending=new Promise<void>(resolve=>{release=resolve})
 const input=Object.assign(f.input,{tagName:"INPUT",type:"password",getAttribute:(name:string)=>name==="data-desktop-clipboard"?"api-key":null})
 Object.assign(f.doc,{defaultView:Object.assign(new EventTarget(),{desktop:{async writeClipboardText(text:string){if(options.fail)throw Error("private error");writes.push(text);if(options.delayed)await pending}}})})
 return {...f,input,writes,releaseWrite:release}
}
test("K01/K04: API Key exports only its selected substring then deletes natively after successful write",async()=>{
 const f=keyFixture()
 try{await f.run("text.copy");assert.deepEqual(f.writes,["稿"]);assert.deepEqual(f.doc.calls,[]);await f.run("text.cut");assert.deepEqual(f.doc.calls,[["delete",undefined]]);assert.equal(f.input.type,"password")}finally{f.adapter.dispose()}
})
test("K06/K08: a failed API Key clipboard write never deletes or exposes the native error",async()=>{
 const f=keyFixture({fail:true})
 try{await assert.rejects(f.run("text.cut"),error=>error instanceof Error&&/无法写入/.test(error.message)&&!error.message.includes("private error"));assert.deepEqual(f.doc.calls,[])}finally{f.adapter.dispose()}
})
for(const change of ["focus-return","selection","text","composition","dispose","readonly","new-operation","marker"] as const)test(`K06: pending API Key cut cannot cross ${change}`,async()=>{
 const f=keyFixture({delayed:true})
 try{
  const pending=f.run("text.cut"),rejected=assert.rejects(pending,/输入目标/)
  if(change==="focus-return"){f.doc.activeElement={};f.doc.dispatchEvent(new Event("focusin"));f.doc.activeElement=f.input;f.doc.dispatchEvent(new Event("focusin"))}
  if(change==="selection")f.input.selectionStart=0
  if(change==="text")f.input.value="changed"
  if(change==="composition")f.doc.dispatchEvent(new Event("compositionstart"))
  if(change==="dispose")f.adapter.dispose()
  if(change==="readonly")f.input.readOnly=true
  if(change==="new-operation")await f.run("text.undo")
  if(change==="marker")f.input.getAttribute=()=>null
  f.releaseWrite();await rejected;assert.ok(!f.doc.calls.some(call=>(call as string[])[0]==="delete"))
 }finally{f.adapter.dispose()}
})
