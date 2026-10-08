import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,lstat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {fileExportFailureMessages} from '../../desktop/shared/file-export'
import {FileExports} from '../../desktop/main/file-export'
import {guardFileExportTarget} from '../../desktop/main/file-export-target'
import {validateDraftSnapshot} from '../../desktop/main/draft-journal'
import {atomicWrite} from '../../desktop/core/versioned-store'
import {BusinessGate} from '../../desktop/main/business-gate'
import {ConversationDirectoryAuthorizations} from '../../desktop/main/conversation-directory-authorizations'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
const file=ts.createSourceFile('index.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const fn=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='exportDraftSnapshot')!;
const snapshot=()=>({version:1,revision:2,createdAt:new Date().toISOString(),autosaves:[],sources:{chat:{draft:'恢复草稿，仅供查看',queued:[{pendingRequest:{url:'/api/novels',method:'POST',body:{title:'不能执行'}}}]}},issues:[]})
async function fixture(run:(f:{base:string;data:string;outside:string;session:{owner:number;id:string};save:(input:unknown)=>Promise<boolean>;select:(path:string|null)=>void;exports:FileExports})=>Promise<void>){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-recovery-export-'))),data=join(base,'app'),outside=join(base,'outside');await mkdir(data);await mkdir(outside)
 let selected:string|null=null;const session={owner:8,id:randomUUID()},window={isDestroyed:()=>false,webContents:{id:8}}
 const dialog={showSaveDialog:async()=>selected?{canceled:false,filePath:selected}:{canceled:true}}
 const exports=new FileExports({assertOwner:owner=>{if(owner!==`8:${session.id}`)throw Error('owner')},chooseSave:async()=>selected,guardTarget:path=>guardFileExportTarget(path,{dataRoots:[data],workRoots:[]})})
 const deps={window,draftSession:session,validateDraftSnapshot,dialog,lstat,atomicWrite,recoveryExports:exports,randomUUID,fileExportFailureMessages}
 const save=new Function(...Object.keys(deps),transformSync(`${fn.getText(file)};return exportDraftSnapshot`,{loader:'ts'}).code)(...Object.values(deps))
 try{await run({base,data,outside,session,save,select:path=>{selected=path},exports})}finally{await exports.flush();await rm(base,{recursive:true,force:true})}
}
test('actual recovery export cannot overwrite the application state even when selected by the native picker',()=>fixture(async f=>{
 const target=join(f.data,'state.json');await writeFile(target,'original encrypted settings');f.select(target)
 await assert.rejects(f.save(snapshot()),/内部数据/);assert.equal(await readFile(target,'utf8'),'original encrypted settings')
}))
test('actual recovery export uses the same verified native save service for complete inert JSON, and cancel remains false',()=>fixture(async f=>{
 assert.equal(await f.save(snapshot()),false);const target=join(f.outside,'恢复草稿.json');f.select(target);assert.equal(await f.save(snapshot()),true)
 const data=JSON.parse(await readFile(target,'utf8'));assert.equal(data.format,'xaanink-recovery');assert.deepEqual(data.snapshot.sources,snapshot().sources)
}))

test('recovery envelopes are validated before a chooser opens and executable values are rejected as data',()=>fixture(async f=>{
 const target=join(f.outside,'unsafe.json');f.select(target)
 for(const envelope of [{format:'xuanxiang-recovery',version:2,snapshot:snapshot()},{format:'xuanxiang-recovery',version:1,snapshot:{...snapshot(),revision:-1}},{format:'xuanxiang-recovery',version:1,snapshot:snapshot(),run:true}]){
  const result=await f.exports.save(`8:${f.session.id}`,{id:randomUUID(),format:'recovery',filename:'unsafe.json',bytes:new TextEncoder().encode(JSON.stringify(envelope))});assert.equal(result.status,'failed');if(result.status==='failed')assert.equal(result.code,'EXPORT_INPUT_INVALID')
 }
 await assert.rejects(f.save({...snapshot(),sources:{handler:()=>{throw Error('must not run')}}}),/普通数据/);await assert.rejects(readFile(target),{code:'ENOENT'})
}))
function compile(source:string,deps:Record<string,unknown>){return new Function(...Object.keys(deps),transformSync(`return ${source}`,{loader:'ts'}).code)(...Object.values(deps))}
test('actual recovery save host remains usable during a failed close, with exact window session and protected-root checks',async()=>{
 const factory=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='makeRecoveryExports');assert.ok(factory)
 const session={owner:8,id:randomUUID(),ready:false},window={isDestroyed:()=>false,webContents:{id:8}},calls:unknown[]=[]
 const deps={FileExports:class{constructor(public options:unknown){}},window,draftSession:session,closingFlow:Promise.resolve(),businessGate:{closed:true},dataRoot:'/app',bootstrapPath:'/bootstrap',service:{call:async(name:string)=>{calls.push(name);return['/work']}},guardFileExportTarget:async(...args:unknown[])=>calls.push(args),dialog:{showSaveDialog:async(_window:unknown,options:unknown)=>{calls.push(options);return{canceled:false,filePath:'/selected/recovery.json'}}}}
 const make=new Function(...Object.keys(deps),transformSync(`${factory.getText(file)};return makeRecoveryExports`,{loader:'ts'}).code)(...Object.values(deps)),options=make().options
 options.assertOwner(`8:${session.id}`);assert.throws(()=>options.assertOwner(`8:${session.id}:forged`));assert.throws(()=>options.assertOwner(`80:${session.id}`));session.owner=9;assert.throws(()=>options.assertOwner(`8:${session.id}`));session.owner=8
 assert.equal(await options.chooseSave(),'/selected/recovery.json');await options.guardTarget('/selected/recovery.json');assert.deepEqual(calls.slice(-2),['protected-directories',['/selected/recovery.json',{dataRoots:['/app','/bootstrap'],workRoots:['/work']}]])
})
test('actual main close awaits physical recovery-export IO before closing the database',async()=>{
 let closeData='';function walk(n:ts.Node){if(ts.isNewExpression(n)&&n.expression.getText(file)==='CloseCoordinator'){const obj=n.arguments![0] as ts.ObjectLiteralExpression;closeData=(obj.properties.find(p=>p.name?.getText(file)==='closeData') as ts.PropertyAssignment).initializer.getText(file)}ts.forEachChild(n,walk)}walk(file);assert.ok(closeData)
 const syncing=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-recovery-drain-'))),session=randomUUID(),events:string[]=[]
 const exports=new FileExports({assertOwner(){},chooseSave:async()=>join(base,'recovery.json'),guardTarget:async()=>{},beforeDirectorySync:async()=>{syncing.resolve();await release.promise}})
 const exporting=exports.save(`8:${session}`,{id:randomUUID(),format:'recovery',filename:'recovery.json',bytes:new TextEncoder().encode(JSON.stringify({format:'xuanxiang-recovery',version:1,snapshot:snapshot()}))})
 await syncing.promise
 // A normal close has no application handoff and no directory grants. Use
 // the actual drain services; this fixture cannot mint native authority.
 const conversationDirectories=new ConversationDirectoryAuthorizations({choose:async()=>{throw Error('unexpected directory chooser')},revoke(){}})
 const close=compile(closeData,{applicationBlocked:()=>false,window:{webContents:{id:8}},recoveryExports:exports,fileExports:{cancelWindow(){},flush:async()=>{}},configurationFiles:{cancelWindow(){},flush:async()=>{}},modelConfiguration:{cancelOwner(){}},avatarAssets:{cancelOwner(){}},workBackups:{pause:async()=>{}},businessGate:new BusinessGate(),conversationDirectories,draftSession:null,applicationRequests:null,applicationHandoff:null,ordinaryWorkerExited:false,sessionFlushed:false,applicationMetadata:new ApplicationMetadataGate(),draftJournal:{read:async()=>null},responseOwners:new Map(),repository:{read:async()=>{}},service:{call:async(name:string)=>{events.push(name)}},businessClosed:false,migrationHandoff:null})
 let completed=false;const closing=close().then(()=>{completed=true})
 try{await new Promise<void>(r=>setImmediate(r));assert.equal(completed,false);assert.deepEqual(events,[]);release.resolve();await closing;assert.deepEqual(events,['close']);assert.equal((await exporting).status,'failed')}finally{release.resolve();await exports.flush();await rm(base,{recursive:true,force:true})}
})
