import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {z} from 'zod'
import {BusinessGate} from '../../desktop/main/business-gate'
import {applicationBackupControlResultSchema} from '../../desktop/shared/application-backup-control'
const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
function create(reply:unknown){let callback='',handler:(event:unknown,input?:unknown)=>Promise<unknown>=async()=>{};const calls:unknown[]=[],gate=new BusinessGate()
 function walk(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='businessHandle'&&node.arguments[0].getText(source)==='"desktop:application-backups"')callback=node.arguments[1].getText(source);ts.forEachChild(node,walk)}walk(source);assert.ok(callback,'actual application backup list IPC exists')
 const declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='businessHandle')!;assert.ok(declaration)
 const deps={applicationBlocked:()=>false,applicationRequests:null,z,applicationBackupControlResultSchema,businessGate:gate,ipcMain:{handle:(_channel:string,fn:typeof handler)=>{handler=fn}},trusted:(event:unknown)=>{if(event!=='trusted')throw Error('untrusted')},service:{call:async(...args:unknown[])=>{calls.push(args);return reply}}}
 new Function(...Object.keys(deps),transformSync(`${declaration.getText(source)}\nbusinessHandle('desktop:application-backups',${callback})`,{loader:'ts'}).code)(...Object.values(deps))
 return{calls,gate,run:(input?:unknown,event:unknown='trusted')=>handler(event,input)}
}
test('application backup list admits only the current frame and no renderer filesystem/operation arguments',async()=>{
 const f=create({type:'list',backups:[]});for(const input of [null,{},'/private',true,{type:'now'},{path:'/private'}])await assert.rejects(f.run(input));await assert.rejects(f.run(undefined,'foreign'));assert.deepEqual(f.calls,[])
 await f.gate.close();await assert.rejects(f.run(),/BUSINESS_CLOSED/);assert.deepEqual(f.calls,[]);f.gate.reopen();assert.deepEqual(await f.run(),[]);assert.deepEqual(f.calls,[['application-backup',{type:'list'}]])
})
test('actual list returns only validated public receipts and never raw paths, manifests or write results',async()=>{
 const row={id:randomUUID(),appId:randomUUID(),createdAt:new Date().toISOString(),bytes:11};assert.deepEqual(await create({type:'list',backups:[row]}).run(),[row])
 for(const reply of [{type:'now',backup:{...row,retained:[],cleanupPending:0}},{type:'list',backups:[{...row,path:'/private'}]},{type:'list',backups:[{...row,bytes:-1}]},{type:'list',backups:[{...row,apiKey:'secret'}]}])await assert.rejects(create(reply).run())
})
test('preload application listing exposes a no-argument semantic call',()=>{
 const file=ts.createSourceFile('preload.ts',readFileSync('desktop/preload/index.ts','utf8'),ts.ScriptTarget.Latest,true);let initializer=''
 for(const item of file.statements)if(ts.isVariableStatement(item))for(const declaration of item.declarationList.declarations)if(declaration.name.getText(file)==='bridge')initializer=declaration.initializer!.getText(file)
 const calls:unknown[]=[],bridge=new Function('ipcRenderer',transformSync(`return ${initializer}`,{loader:'ts'}).code)({invoke:(...args:unknown[])=>calls.push(args)});bridge.applicationBackups({path:'/not-forwarded'});assert.deepEqual(calls,[['desktop:application-backups']])
})
