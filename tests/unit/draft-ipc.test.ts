import {mainFunction} from "../helpers/main-function"
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {z} from 'zod'
const source=readFileSync(new URL('../../desktop/main/index.ts',import.meta.url),'utf8'),syntax=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true)
const body=['trusted','registerIpc'].map(name=>{const node=syntax.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node);return node.getText(syntax)}).join('\n')
function fixture(){
 const handlers=new Map<string,(...args:unknown[])=>Promise<unknown>>(),writes:unknown[]=[],frame={url:'xaanink://app/'},contents={id:1,mainFrame:frame},event={sender:contents,senderFrame:frame}
 const draftSession={owner:1,id:randomUUID(),ready:true},draftJournal={persist:async(...args:unknown[])=>{writes.push(args);return{revision:1,digest:'f'.repeat(64),clientRevision:2}},read:async()=>({version:1})}
 mainFunction('ipcMain','window','z','draftSession','draftJournal',transformSync(body,{loader:'ts'}).code+'\nregisterIpc()')({handle:(id:string,fn:(...args:unknown[])=>Promise<unknown>)=>handlers.set(id,fn),on(){}},{webContents:contents},z,draftSession,draftJournal)
 return{handlers,writes,event,draftSession,call:(id:string,nonce=draftSession.id,value:unknown={revision:2})=>{const handler=handlers.get(id);assert.ok(handler,`registered ${id}`);return handler(event,nonce,value)}}
}
test('draft persistence requires the current trusted renderer lifetime nonce',async()=>{const f=fixture(),nonce=f.draftSession.id;const receipt=await f.call('desktop:draft-persist') as {revision:number};assert.equal(receipt.revision,1);assert.equal(f.writes.length,1);f.draftSession.id=randomUUID();await assert.rejects(f.call('desktop:draft-persist',nonce),/窗口/);await assert.rejects(f.handlers.get('desktop:draft-persist')!({sender:{id:1},senderFrame:f.event.senderFrame},f.draftSession.id,{revision:2}),/不受信/);assert.equal(f.writes.length,1)})
test('draft read also rejects subframes and stale sessions without returning manuscript data',async()=>{const f=fixture(),nonce=f.draftSession.id;assert.deepEqual(await f.call('desktop:draft-read'),{version:1});await assert.rejects(f.handlers.get('desktop:draft-read')!({sender:f.event.sender,senderFrame:{url:'xaanink://app/'}},nonce),/不受信/);f.draftSession.id=randomUUID();await assert.rejects(f.call('desktop:draft-read',nonce),/窗口/)})
