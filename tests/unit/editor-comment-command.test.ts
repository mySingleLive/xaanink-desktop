import test from "node:test"
import assert from "node:assert/strict"
import type {editor} from "monaco-editor"
import {CommandTargets} from "../../src/lib/desktop/command-targets"
import {editorCommentCommand} from "../../src/lib/desktop/editor-comment-command"
test("comment command opens the existing composer from a current selection snapshot without changing text",async()=>{
 let value="第一段\n第二段",enabled=true
 const target={closest:(selector:string)=>selector==='.monaco-editor'?{}:null} as HTMLElement,opened:unknown[]=[]
 const instance={getDomNode:()=>({isConnected:true,getClientRects:()=>[{}],contains:(node:unknown)=>node===target}),getRawOptions:()=>({readOnly:false}),getSelection:()=>({isEmpty:()=>false,getStartPosition:()=>({lineNumber:2,column:1}),getEndPosition:()=>({lineNumber:2,column:4})}),getModel:()=>({getValue:()=>value,getOffsetAt:(p:{column:number})=>4+p.column-1})}
 const commands=new CommandTargets<HTMLElement|null>();commands.register(editorCommentCommand(instance as unknown as editor.IStandaloneCodeEditor,()=>enabled,snapshot=>opened.push(snapshot)))
 assert.equal(await commands.execute("md.comment",target),true)
 assert.equal((opened[0] as {quote:string}).quote,"第二段");assert.equal(value,"第一段\n第二段")
 enabled=false;assert.equal(await commands.execute("md.comment",target),false)
 assert.equal(await commands.execute("md.comment",{closest:()=>null} as unknown as HTMLElement),false)
 value="第一段\n   ";enabled=true;assert.equal(await commands.execute("md.comment",target),false);assert.equal(opened.length,1)
})
