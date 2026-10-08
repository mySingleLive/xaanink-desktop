import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {z} from 'zod'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
const file=ts.createSourceFile('index.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true),handlers=new Map<string,string>();let factory='',closeData='',release=''
function walk(node:ts.Node){
 if(ts.isCallExpression(node)&&['businessHandle','ipcMain.handle'].includes(node.expression.getText(file))&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))handlers.set(node.arguments[0].text,node.arguments[1].getText(file))
 if(ts.isNewExpression(node)&&node.expression.getText(file)==='FileExports')factory=node.arguments![0].getText(file)
 if(ts.isNewExpression(node)&&node.expression.getText(file)==='CloseCoordinator'){const obj=node.arguments![0];if(ts.isObjectLiteralExpression(obj)){const prop=obj.properties.find(p=>p.name?.getText(file)==='closeData') as ts.PropertyAssignment;closeData=prop.initializer.getText(file)}}
 if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='releaseOwner')release=node.initializer!.getText(file)
 ts.forEachChild(node,walk)
}walk(file)
function compile(source:string,deps:Record<string,unknown>){assert.ok(source,'actual main handler/options required');return new Function(...Object.keys(deps),transformSync(`return ${source}`,{loader:'ts'}).code)(...Object.values(deps))}
function rig(){const id=randomUUID(),calls:unknown[]=[],sender={id:6},session={owner:6,id,ready:true},deps:any={trusted:(event:any)=>{if(event.sender!==sender)throw Error('untrusted')},draftSession:session,closingFlow:null,window:{isDestroyed:()=>false,webContents:sender},businessGate:{closed:false},recoveryExports:{cancelWindow(){},flush:async()=>{}},fileExports:{save:async(...args:unknown[])=>{calls.push(['save',...args]);return{status:'cancelled'}},cancel:(...args:unknown[])=>calls.push(['cancel',...args])},z};return{deps,id,calls,event:{sender}}}
test('actual IPC binds exports/cancellation to current ready window session, never a renderer owner or path',async()=>{
 const r=rig(),save=compile(handlers.get('desktop:file-export')??'',r.deps),cancel=compile(handlers.get('desktop:file-export-cancel')??'',r.deps),request={id:randomUUID(),format:'txt',filename:'正文.txt',bytes:new Uint8Array([65])}
 await save(r.event,request);await cancel(r.event,request.id);assert.deepEqual(r.calls,[['save',`6:${r.id}`,request],['cancel',`6:${r.id}`,request.id]])
 await assert.rejects(save({sender:{id:6}},request),/untrusted/);await assert.rejects(cancel(r.event,'../bad'));assert.equal(r.calls.length,2)
 for(const patch of [{draftSession:null},{draftSession:{owner:8,id:r.id,ready:true}},{draftSession:{owner:6,id:r.id,ready:false}},{closingFlow:Promise.resolve()}])await assert.rejects(compile(handlers.get('desktop:file-export')!,{...r.deps,...patch})(r.event,request))
})
test('actual FileExports host checks closing and exact session ownership; chooser and protected roots originate only in main',async()=>{
 const r=rig(),paths:unknown[]=[],options=compile(factory,{...r.deps,dataRoot:'/local/root',bootstrapPath:'/local/bootstrap',service:{call:async(name:string)=>{assert.equal(name,'protected-directories');return['/local/work']}},guardFileExportTarget:async(...args:unknown[])=>paths.push(args),dialog:{showSaveDialog:async(win:unknown,value:unknown)=>{paths.push([win,value]);return{canceled:false,filePath:'/chosen/正文.txt'}}}})
 options.assertOwner(`6:${r.id}`);assert.throws(()=>options.assertOwner(`6:${r.id}:forged`));assert.throws(()=>options.assertOwner(`7:${r.id}`))
 assert.equal(await options.chooseSave(`6:${r.id}`,{filename:'正文.txt',format:'txt',extension:'txt'}),'/chosen/正文.txt');await options.guardTarget('/chosen/正文.txt');assert.deepEqual(paths[1],['/chosen/正文.txt',{dataRoots:['/local/root','/local/bootstrap'],workRoots:['/local/work']}])
 for(const patch of [{closingFlow:Promise.resolve()},{businessGate:{closed:true}},{draftSession:{...r.deps.draftSession,ready:false}}])assert.throws(()=>compile(factory,{...r.deps,...patch}).assertOwner(`6:${r.id}`))
})
test('actual close cancels and drains file writes before worker close; window release cancels its exports',async()=>{
 const events:string[]=[],deps:any={applicationHandoff:null,ordinaryWorkerExited:false,sessionFlushed:false,applicationMetadata:new ApplicationMetadataGate(),draftJournal:{read:async()=>null},applicationRequests:null,draftSession:null,conversationDirectories:{revokeAll(){},revokeOwner(){},flush:async()=>{}},window:{webContents:{id:6}},configurationFiles:{cancelWindow:()=>{},flush:async()=>{}},recoveryExports:{cancelWindow(){},flush:async()=>{}},fileExports:{cancelWindow:(prefix:string)=>events.push('cancel:'+prefix),flush:async()=>{events.push('exports-flushed')}},modelConfiguration:{cancelOwner:()=>{}},avatarAssets:{cancelOwner:()=>{}},workBackups:{pause:async()=>{}},businessGate:{close:async()=>{events.push('gate-closed')}},responseOwners:new Map(),repository:{read:async()=>{}},service:{call:async(name:string)=>{events.push(name)}},businessClosed:false,migrationHandoff:null}
 await compile(closeData,{...deps,applicationBlocked:()=>false})();assert.ok(events.indexOf('cancel:6:')<events.indexOf('gate-closed'));assert.ok(events.indexOf('exports-flushed')<events.indexOf('close'))
 compile(release,{...deps,ownerId:6,closeChannel:{cancel:()=>{}},draftSession:null,authority:{revokeOwner:()=>{}}})();assert.equal(events.filter(e=>e==='cancel:6:').length,2)
})
test('preload exposes exactly semantic export payload and cancellation UUID channels',()=>{
 const source=readFileSync('desktop/preload/index.ts','utf8'),calls:unknown[][]=[];const body=source.slice(source.indexOf('const bridge:'),source.indexOf('\nipcRenderer.on("desktop:response-port"'))
 const bridge=new Function('ipcRenderer',transformSync(`${body};return bridge`,{loader:'ts'}).code)({invoke:(...args:unknown[])=>calls.push(args)})
 bridge.exportFile({id:'request'});bridge.cancelFileExport('request');assert.deepEqual(calls,[['desktop:file-export',{id:'request'}],['desktop:file-export-cancel','request']])
})
