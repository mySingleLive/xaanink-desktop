import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {workRestoreRequestSchema,restoreDraftAckSchema} from '../../desktop/shared/work-restore'
import {WorkRestoreDraftBarrier} from '../../desktop/main/work-restore-draft-barrier'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {allowedManagedFile} from '../../desktop/core/root-ownership'
const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
function callback(channel:string){let code='';const scan=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='ipcMain.handle'&&node.arguments[0].getText(source)===JSON.stringify(channel))code=node.arguments[1].getText(source);ts.forEachChild(node,scan)};scan(source);assert.ok(code,channel);return code}
function compile(channel:string,deps:Record<string,unknown>){return new Function(...Object.keys(deps),transformSync(`return ${callback(channel)}`,{loader:'ts'}).code)(...Object.values(deps)) as (...args:unknown[])=>Promise<unknown>}
test('actual restore IPC rejects paths, bypass activation, unavailable sessions and concurrent maintenance',async()=>{
 const calls:unknown[]=[];const deps={applicationBlocked:()=>false,applicationRequests:null,applicationHandoff:null,trusted:(event:unknown)=>{if(event!=='trusted')throw Error('untrusted')},workRestoreRequestSchema,closingFlow:null,migrationHandoff:null,workLease:null,workRestore:null,window:{},draftSession:{ready:false},restoreDraftBarrier:{inspect:async()=>null},businessGate:{closed:false},service:{call:async(...a:unknown[])=>calls.push(a)}}
 const run=compile('desktop:work-restore',deps)
 await assert.rejects(run('foreign',{type:'start',workId:randomUUID(),backupId:randomUUID()}),/untrusted/)
 await assert.rejects(run('trusted',{type:'activate',candidateId:randomUUID()}))
 await assert.rejects(run('trusted',{type:'start',workId:randomUUID(),backupId:randomUUID(),path:'/foreign'}))
 await assert.rejects(run('trusted',{type:'start',workId:randomUUID(),backupId:randomUUID()}),/加载/)
 assert.deepEqual(calls,[])
})
test('actual ACK clears the barrier only for the bootstrapped owner and exact current durable journal receipt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xx-restore-main-'))
 try{
  const restoreDraftBarrier=new WorkRestoreDraftBarrier(root),draftJournal=new DraftJournal(root),owner={id:4},window={webContents:owner},draftSession={owner:4,id:randomUUID(),ready:true,restoreToken:''}
  draftJournal.activate('4');const barrier=await restoreDraftBarrier.begin({workId:randomUUID(),candidateId:randomUUID()},async()=>{});draftSession.restoreToken=barrier.token
  const receipt=await draftJournal.persist('4',{version:1,revision:1,createdAt:new Date().toISOString(),autosaves:[],sources:{recovery:{items:[{content:'retained old text'}]}},issues:[]})
  const event={sender:owner},run=compile('desktop:restore-draft-ack',{applicationBlocked:()=>false,trusted:(input:unknown)=>{if(input!==event)throw Error('untrusted')},restoreDraftAckSchema,draftSession,window,restoreDraftBarrier,draftJournal})
  await assert.rejects(run(event,{sessionId:draftSession.id,token:randomUUID(),receipt}))
  await assert.rejects(run(event,{sessionId:draftSession.id,token:barrier.token,receipt:{...receipt,digest:'f'.repeat(64)}}))
  assert.equal((await restoreDraftBarrier.inspect())?.token,barrier.token)
  await run(event,{sessionId:draftSession.id,token:barrier.token,receipt});assert.equal(await restoreDraftBarrier.inspect(),null);assert.equal(draftSession.restoreToken,undefined)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('restore barrier belongs to migration inventory, and preload only sends semantic IDs plus journal ACK',()=>{
 assert.equal(allowedManagedFile('restore-draft-barrier.json'),true);assert.equal(allowedManagedFile('restore-draft-barrier.other'),false)
 const preload=ts.createSourceFile('preload.ts',readFileSync('desktop/preload/index.ts','utf8'),ts.ScriptTarget.Latest,true);let bridge='';for(const statement of preload.statements)if(ts.isVariableStatement(statement))for(const entry of statement.declarationList.declarations)if(entry.name.getText(preload)==='bridge')bridge=entry.initializer!.getText(preload)
 const calls:unknown[]=[];const api=new Function('ipcRenderer',transformSync(`return ${bridge}`,{loader:'ts'}).code)({invoke:(...args:unknown[])=>calls.push(args)})
 const action={type:'start',workId:randomUUID(),backupId:randomUUID()},receipt={revision:2,clientRevision:3,digest:'a'.repeat(64)},sessionId=randomUUID(),token=randomUUID()
 api.restoreWork(action);api.acknowledgeWorkRestore({sessionId,token,receipt})
 assert.deepEqual(calls,[['desktop:work-restore',action],['desktop:restore-draft-ack',{sessionId,token,receipt}]])
})
