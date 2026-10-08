import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'

function fixture(){
 const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
 let listener:ts.Node|undefined
 function walk(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='current.webContents.on'&&node.arguments[0]?.getText(source)==='"did-start-navigation"')listener=node.arguments[1];ts.forEachChild(node,walk)}
 walk(source);assert.ok(listener)
 const code=`let released=0,draftSession={owner:42,id:'original-session',ready:true};const ownerId=42;const releaseOwner=()=>{released++;draftSession=null};const draftJournal={activate:()=>()=>{}};const listener=${listener.getText(source)};return{fire:(...args)=>listener(...args),read:()=>({released,draftSession})}`
 return new Function('randomUUID',transformSync(code,{loader:'ts'}).code)(randomUUID) as {fire(...args:unknown[]):void;read():{released:number;draftSession:null|{id:string;ready:boolean}}}
}
test('same-document hydration and history updates preserve the original task owner and draft session',()=>{
 for(const args of [[{url:'xaanink://app/',isMainFrame:true,isSameDocument:true}],[{},'xaanink://app/',true,true]]){
  const f=fixture();f.fire(...args);assert.deepEqual(f.read(),{released:0,draftSession:{owner:42,id:'original-session',ready:true}})
 }
})
test('an actual new main document revokes old tasks before creating a fresh unready draft session',()=>{
 const f=fixture();f.fire({url:'xaanink://app/',isMainFrame:true,isSameDocument:false})
 assert.equal(f.read().released,1);assert.equal(f.read().draftSession?.ready,false);assert.notEqual(f.read().draftSession?.id,'original-session')
})
test('explicit new-document details override legacy in-place fields, and unknown navigation cannot inherit a task owner',()=>{
 for(const args of [[{url:'xaanink://app/',isMainFrame:true,isSameDocument:false},'xaanink://app/',true,true],[{url:'xaanink://foreign/'}]]){
  const f=fixture();f.fire(...args);assert.equal(f.read().released,1);assert.notEqual(f.read().draftSession?.id,'original-session')
 }
})
