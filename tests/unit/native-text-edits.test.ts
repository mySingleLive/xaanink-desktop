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
