import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {z} from 'zod'
import {BusinessGate} from '../../desktop/main/business-gate'
import {applicationBackupControlResultSchema} from '../../desktop/shared/application-backup-control'

// Original trusted/businessHandle/IPC callback, not a reconstructed guard.
const ast=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const declaration=(name:string)=>{const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node);return node.getText(ast)}
let callback='';function find(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='businessHandle'&&node.arguments[0]?.getText(ast)==='"desktop:application-backups"')callback=node.arguments[1].getText(ast);ts.forEachChild(node,find)}find(ast);assert.ok(callback)
function fixture(){
 const gate=new BusinessGate(),frame={url:'xaanink://app/'},contents={mainFrame:frame},window={webContents:contents},event={sender:contents,senderFrame:frame},reply=Promise.withResolvers<unknown>(),entered=Promise.withResolvers<void>(),calls:unknown[][]=[]
 let handler:(event:unknown,input?:unknown)=>Promise<unknown>=async()=>{throw Error('missing actual IPC')}
 const deps={z,applicationBackupControlResultSchema,businessGate:gate,initialWindow:window,ipcMain:{handle:(_channel:string,fn:typeof handler)=>{handler=fn}},service:{call:async(...args:unknown[])=>{calls.push(args);entered.resolve();return reply.promise}}}
 const api=new Function(...Object.keys(deps),transformSync(`let window=initialWindow;${declaration('trusted')}\n${declaration('businessHandle')}\nbusinessHandle('desktop:application-backups',${callback});return{replace(value){window=value}}`,{loader:'ts'}).code)(...Object.values(deps)) as{replace(value:unknown):void}
 return{run:(input?:unknown,origin:unknown=event)=>handler(origin,input),gate,frame,contents,window,event,calls,reply,entered:entered.promise,...api}
}
const row=()=>({id:randomUUID(),appId:randomUUID(),createdAt:'2026-10-08T04:00:00.000Z',bytes:1234})

test('ABL97-M01 actual trusted owner/frame is rechecked after worker await before returning any summary',async()=>{
 for(const change of ['window-replaced','window-closed','frame-replaced','foreign-url'] as const){const r=fixture(),flight=r.run();await r.entered
  if(change==='window-replaced')r.replace({webContents:{mainFrame:{url:'xaanink://app/'}}});if(change==='window-closed')r.replace(null);if(change==='frame-replaced')r.contents.mainFrame={url:'xaanink://app/'};if(change==='foreign-url')r.frame.url='https://foreign.invalid/'
  r.reply.resolve({type:'list',backups:[row()]});await assert.rejects(flight,/不受信/);assert.deepEqual(r.calls,[['application-backup',{type:'list'}]])
 }
})

test('ABL97-M02 gate closes admission immediately but waits the actual pending read before its drain ACK',{timeout:5000},async()=>{
 const r=fixture(),flight=r.run();await r.entered;let drained=false;const close=r.gate.close().then(()=>{drained=true});await new Promise(setImmediate)
 assert.equal(drained,false);await assert.rejects(r.run(),/BUSINESS_CLOSED/);assert.equal(r.calls.length,1)
 const value=row();r.reply.resolve({type:'list',backups:[value]});assert.deepEqual(await flight,[value]);await close;assert.equal(drained,true)
})

test('ABL97-M03 invalid list arguments and foreign initial frames cannot reach storage; bad or write receipts cannot cross the public IPC',async()=>{
 const r=fixture();for(const input of [null,{},new Uint8Array([1]),{type:'list'},'/private/data',{path:'/private/data'},false])await assert.rejects(r.run(input));await assert.rejects(r.run(undefined,{sender:r.contents,senderFrame:{url:'xaanink://app/'}}),/不受信/);assert.equal(r.calls.length,0)
 for(const value of [{type:'now',backup:{...row(),retained:[],cleanupPending:0}},{type:'list',backups:[{...row(),ciphertext:'private-value'}]},{type:'list',backups:[{...row(),bytes:2**40}]},{type:'list',backups:[{...row(),createdAt:'not-a-date'}]}]){const f=fixture(),flight=f.run();await f.entered;f.reply.resolve(value);await assert.rejects(flight)}
})

test('ABL97-M04 actual preload semantic method never forwards caller arguments, and a rejected worker read drains rather than leaving the gate stuck',async()=>{
 const preload=ts.createSourceFile('preload.ts',readFileSync('desktop/preload/index.ts','utf8'),ts.ScriptTarget.Latest,true);let bridge=''
 for(const item of preload.statements)if(ts.isVariableStatement(item))for(const node of item.declarationList.declarations)if(node.name.getText(preload)==='bridge')bridge=node.initializer!.getText(preload)
 assert.ok(bridge);const calls:unknown[][]=[],api=new Function('ipcRenderer',transformSync(`return ${bridge}`,{loader:'ts'}).code)({invoke:(...args:unknown[])=>{calls.push(args)}})
 api.applicationBackups({type:'now',path:'/private/root'},'second-extra-argument');assert.deepEqual(calls,[['desktop:application-backups']])
 const r=fixture(),flight=r.run();await r.entered;const close=r.gate.close();r.reply.reject(Error('APPLICATION_BACKUP_FAILED'));await assert.rejects(flight,/APPLICATION_BACKUP_FAILED/);await close;r.gate.reopen();assert.equal(r.gate.closed,false)
})
