import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {BusinessGate} from '../../desktop/main/business-gate'
import {localImageRequest} from '../../desktop/shared/local-images'
import {CloseCoordinator,type CloseServices} from '../../desktop/main/close-coordinator'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
import {ConversationDirectoryAuthorizations} from '../../desktop/main/conversation-directory-authorizations'
import {nativeWindowAppearance} from '../../desktop/main/window-appearance'

// Execute actual main callbacks. Native IO and worker responses are controlled;
// no string assertions substitute for the side effects of the current source.
const main=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
function declaration(name:string){const value=main.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text===name);assert.ok(value,`main ${name}`);return value.getText(main)}
function expression(match:(node:ts.Node)=>node is ts.CallExpression){let found:ts.Expression|undefined;const visit=(node:ts.Node)=>{if(match(node))found=node.arguments[1];ts.forEachChild(node,visit)};visit(main);assert.ok(found);return found.getText(main)}
function evaluate<T>(code:string,dependencies:Record<string,unknown>):T{const normal={applicationBlocked:()=>false,applicationHandoff:null,ordinaryWorkerExited:false,sessionFlushed:false,applicationRequests:null,draftJournal:{read:async()=>null},applicationMetadata:new ApplicationMetadataGate(),conversationDirectories:new ConversationDirectoryAuthorizations({choose:async()=>{throw Error('no normal-fixture native authority')},revoke(){}}),...dependencies};return new Function(...Object.keys(normal),transformSync(code,{loader:'ts'}).code)(...Object.values(normal)) as T}
function closeRig(overrides:Record<string,unknown>={}){
 let servicesCode='';const visit=(node:ts.Node)=>{if(ts.isNewExpression(node)&&node.expression.getText(main)==='CloseCoordinator')servicesCode=node.arguments![0].getText(main);ts.forEachChild(node,visit)};visit(main);assert.ok(servicesCode)
 const calls:string[]=[],gate=new BusinessGate(),owner={owner:71,id:randomUUID(),ready:true}
 const dependencies={workLease:null,workRestore:null,workBackups:undefined,resumeWorkBackups:async()=>{},CloseCoordinator,businessGate:gate,window:{webContents:{id:71},close(){calls.push('window-close')}},draftSession:owner,
  modelService:{activeCount:0,close:async()=>{calls.push('models-stop')},resume:()=>calls.push('models-resume')},modelConfiguration:{activeCount:0,cancelOwner:()=>calls.push('model-config-cancel')},avatarAssets:{cancelOwner:()=>calls.push('avatar-cancel')},
  recoveryExports:{cancelWindow(){},flush:async()=>{}},fileExports:{cancelWindow(){},flush:async()=>{}},configurationFiles:{cancelWindow:()=>calls.push('configuration-cancel'),flush:async()=>{calls.push('configuration-flush')}},repository:{read:async()=>{calls.push('repository-read')}},
  service:{call:async(method:string)=>{calls.push(`worker:${method}`);return{active:0}}},responseOwners:new Map(),
  flushDraftForClose:async()=>{calls.push('draft-flush')},closeChannel:{cancel:()=>calls.push('channel-cancel')},migrationHandoff:null,
  send:(event:{type:string})=>calls.push(`event:${event.type}`),worker:{terminate:async()=>{calls.push('worker-terminate')}},app:{quit:()=>calls.push('app-quit')},dialog:{showMessageBox:async()=>({response:2})},...overrides,
 }
 const rig=evaluate<{services:CloseServices;begin(intent:'window'|'quit'):Promise<boolean>|null;retry():Promise<void>;state():{businessClosed:boolean;closeCommitted:boolean;quitting:boolean;closing:boolean}}>(`
 let businessClosed=false,closeCommitted=false,quitting=false,closingFlow=null;const closePermits=new WeakSet();
 ${declaration('restoreBusiness')}\n${declaration('retryMigrationCancellation')}\n${declaration('beginClose')}
 const services=${servicesCode};const closeCoordinator=new CloseCoordinator(services);
 return{services,begin(intent){beginClose(intent);return closingFlow},retry:retryMigrationCancellation,state(){return{businessClosed,closeCommitted,quitting,closing:!!closingFlow}}}
 `,dependencies)
 return{...rig,calls,gate}
}

test('M71-01: native file-open cannot bypass the closed business gate after a migration cancellation remains pending',async()=>{
 const gate=new BusinessGate();await gate.close();const calls:string[]=[]
 const run=evaluate<(id:string)=>Promise<void>>(`${declaration('executeCommand')}\nreturn executeCommand`,{
  businessGate:gate,businessClosed:true,closingFlow:null,window:{webContents:{id:71}},commands:{commands:[{id:'file.open'}]},
  chooseDirectory:async()=>{calls.push('picker');return{id:'grant'}},authority:{consume:async()=>{calls.push('consume');return{path:'/test-selected'}}},
  service:{call:async()=>{calls.push('open-work')}},send:()=>calls.push('event'),
 })
 await run('file.open').catch(()=>{})
 assert.deepEqual(calls,[],'all direct main menu business paths must obey the retained cancellation barrier')
})

test('M71-02: image protocol reads belong to the same drain and cannot reopen a worker database after close',async()=>{
 const gate=new BusinessGate(),release=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();let drained=false,rpcs=0
 const code=expression((node):node is ts.CallExpression=>ts.isCallExpression(node)&&node.expression.getText(main)==='protocol.handle'&&node.arguments[0]?.getText(main)==='"xaanink"')
 const read=evaluate<(request:Request)=>Promise<Response>>(`return ${code}`,{
  businessGate:gate,businessClosed:false,localImageRequest,service:{async call(){rpcs++;entered.resolve();await release.promise;return{bytes:new Uint8Array([137,80,78,71]),mime:'image/png'}}},
  avatarAssets:{readAsset:async()=>{throw Error('not a global avatar')}},staticUiResponse:async()=>new Response(null,{status:404}),
 })
 const request=()=>new Request(`xaanink://app/_desktop/assets/${randomUUID()}/${randomUUID()}.png`)
 const work=read(request());await entered.promise;const close=gate.close();void close.then(()=>{drained=true})
 try{
  await new Promise(setImmediate);assert.equal(drained,false,'an admitted asset RPC must finish before the source is declared drained')
  const late=await read(request());assert.ok(late.status>=400,'new asset RPC after close must be denied');assert.equal(rpcs,1)
 }finally{release.resolve();await work;await close}
})

test('M71-03: asynchronous release remains part of the single close flight and never becomes an early close acknowledgement',async()=>{
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),calls:string[]=[]
 const services:CloseServices={current:()=>({owner:71,sessionId:'controlled-current-session'}),busy:async()=>false,confirmStop:async()=>true,stopTasks:async()=>{},flush:async()=>{throw Error('retain draft')},closeData:async()=>{calls.push('data')},failed:async()=> 'cancel',exportDraft:async()=>{},commit:()=>{calls.push('commit')},release:async()=>{calls.push('release');entered.resolve();await release.promise;calls.push('cancel-ack')}}
 const coordinator=new CloseCoordinator(services),first=coordinator.request('window');await entered.promise
 let settled=false;void first.then(()=>{settled=true});const second=coordinator.request('quit')
 assert.equal(first,second);await new Promise(setImmediate);assert.equal(settled,false);assert.deepEqual(calls,['release'])
 release.resolve();assert.equal(await first,false);assert.deepEqual(calls,['release','cancel-ack'])
})

test('M71-04: actual main close waits for draft ACK, admitted work, configuration, worker close and arm ACK before relaunch/quit',async()=>{
 const flushEntered=Promise.withResolvers<void>(),flushDone=Promise.withResolvers<void>(),admittedDone=Promise.withResolvers<void>(),responseDone=Promise.withResolvers<void>(),workerEntered=Promise.withResolvers<void>(),workerDone=Promise.withResolvers<void>(),armEntered=Promise.withResolvers<void>(),armDone=Promise.withResolvers<void>();const trace:string[]=[]
 const r=closeRig({flushDraftForClose:async()=>{trace.push('flush-entered');flushEntered.resolve();await flushDone.promise;trace.push('flush-ack')},
  responseOwners:new Map([['response',{cancel:async()=>{trace.push('cancel-response');await responseDone.promise}}]]),
  service:{call:async(method:string)=>{trace.push(`worker:${method}`);if(method==='close'){workerEntered.resolve();await workerDone.promise;trace.push('worker:closed')}return{active:0}}},
  migrationHandoff:{armClosed:async()=>{trace.push('arm');armEntered.resolve();await armDone.promise;trace.push('arm-ack')},commit:()=>{trace.push('relaunch');return true}},
 })
 const admitted=r.gate.run(async()=>{await admittedDone.promise;trace.push('admitted-finished')});const close=r.begin('quit');assert.ok(close)
 try{
  await flushEntered.promise;assert.equal(r.gate.closed,false);assert.deepEqual(trace,['worker:task-status','worker:stop-tasks','flush-entered']);assert.ok(!r.calls.includes('app-quit'))
  flushDone.resolve();await new Promise(setImmediate);assert.equal(r.gate.closed,true);assert.ok(trace.includes('cancel-response'));assert.ok(!r.calls.includes('configuration-flush'))
  admittedDone.resolve();await admitted;await new Promise(setImmediate);assert.ok(!r.calls.includes('configuration-flush'),'response cancellation also remains a required wait')
  responseDone.resolve();await workerEntered.promise;assert.ok(r.calls.includes('configuration-flush'));assert.ok(r.calls.includes('repository-read'));assert.equal(r.state().businessClosed,false);assert.ok(!trace.includes('arm'))
  workerDone.resolve();await armEntered.promise;assert.equal(r.state().businessClosed,true);assert.ok(!trace.includes('relaunch'));assert.ok(!r.calls.includes('app-quit'))
  armDone.resolve();assert.equal(await close,true);assert.deepEqual(trace.slice(-4),['worker:closed','arm','arm-ack','relaunch']);assert.ok(r.calls.includes('worker-terminate'));assert.ok(r.calls.includes('app-quit'));assert.equal(r.state().closeCommitted,true)
 }finally{flushDone.resolve();admittedDone.resolve();responseDone.resolve();workerDone.resolve();armDone.resolve();await Promise.allSettled([admitted,close])}
})

test('M71-05: actual main release keeps gate and model paused on uncertain cancel, then explicit retry restores business only after ACK',async()=>{
 const cancelEntered=Promise.withResolvers<void>(),cancelDone=Promise.withResolvers<void>();let cancelling=0,fail=true
 const r=closeRig({migrationHandoff:{pending:true,armClosed:async()=>{throw Error('unconfirmed arm')},commit:()=>{throw Error('must not restart')},cancelPrepared:async()=>{cancelling++;cancelEntered.resolve();await cancelDone.promise;if(fail)throw Error('unconfirmed cancellation')}}})
 const close=r.begin('quit');assert.ok(close);await cancelEntered.promise
 assert.equal(r.gate.closed,true);assert.equal(r.state().businessClosed,true);assert.equal(r.state().closing,true);assert.ok(!r.calls.includes('models-resume'));assert.equal(r.begin('window'),close)
 cancelDone.resolve();assert.equal(await close,false);await new Promise(setImmediate)
 assert.equal(r.gate.closed,true);assert.equal(r.state().closing,false);assert.ok(r.calls.includes('event:migration-cancel-pending'));assert.ok(!r.calls.includes('app-quit'));assert.ok(!r.calls.includes('models-resume'))
 await r.retry().then(()=>assert.fail('cancel failure must reject'),()=>{});assert.equal(r.gate.closed,true)
 fail=false;await r.retry();assert.equal(cancelling,3);assert.equal(r.gate.closed,false);assert.equal(r.state().businessClosed,false);assert.equal(r.calls.filter(value=>value==='models-resume').length,1);assert.equal(r.calls.at(-1),'event:close-cancelled')
})

test('M71-06: cancellation persistence failure after declined task-stop still closes admission before the pending-cancel UI is announced',async()=>{
 const r=closeRig({service:{call:async()=>({active:1})},dialog:{showMessageBox:async()=>({response:0})},migrationHandoff:{pending:true,cancelPrepared:async()=>{throw Error('prepared cancellation not durable')},armClosed:async()=>{throw Error('must not close resources after declined stop')},commit:()=>{throw Error('must not restart')}}})
 const work=r.begin('quit');assert.ok(work);assert.equal(await work,false);await new Promise(setImmediate)
 assert.ok(r.calls.includes('event:migration-cancel-pending'));assert.ok(!r.calls.includes('models-stop'));assert.ok(!r.calls.includes('app-quit'))
 assert.equal(r.gate.closed,true,'pending-cancellation barrier must also cover cancellation before closeData was reached')
 await assert.rejects(r.gate.run(async()=> 'new mutation'),/BUSINESS_CLOSED/)
})

test('M71-07: successful early cancellation retry waits for admitted work before reopening, without claiming resources were closed',async()=>{
 const taskDone=Promise.withResolvers<void>(),cancelEntered=Promise.withResolvers<void>();let fail=true,restored=false
 const r=closeRig({service:{call:async()=>({active:1})},dialog:{showMessageBox:async()=>({response:0})},migrationHandoff:{pending:true,cancelPrepared:async()=>{cancelEntered.resolve();if(fail)throw Error('cancel is not durable')}}})
 const accepted=r.gate.run(async()=>taskDone.promise),work=r.begin('quit');assert.ok(work);await cancelEntered.promise;assert.equal(await work,false);await new Promise(setImmediate)
 assert.equal(r.state().businessClosed,false,'declined stop is never a source-closed proof');assert.equal(r.gate.closed,true);fail=false;const retry=r.retry();void retry.then(()=>{restored=true})
 try{
  await new Promise(setImmediate);assert.equal(restored,false);assert.equal(r.gate.closed,true);assert.ok(!r.calls.includes('models-resume'));assert.ok(!r.calls.includes('configuration-flush'));assert.ok(!r.calls.includes('models-stop'));await assert.rejects(r.gate.run(async()=>{}),/BUSINESS_CLOSED/)
 }finally{taskDone.resolve();await accepted;await retry}
 assert.equal(r.gate.closed,false);assert.equal(r.state().businessClosed,false);assert.equal(r.calls.at(-1),'event:close-cancelled')
})

test('M71-08: actual bootstrap registration cannot read root state after the business gate closes',async()=>{
 let registration='';const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.arguments[0]?.getText(main)==='"desktop:bootstrap"')registration=node.getText(main);ts.forEachChild(node,visit)};visit(main);assert.ok(registration)
 const gate=new BusinessGate();await gate.close();let reads=0;const handlers=new Map<string,(...args:unknown[])=>Promise<unknown>>()
 evaluate(`${declaration('businessHandle')}\n${registration}`,{businessGate:gate,ipcMain:{handle:(name:string,callback:(...args:unknown[])=>Promise<unknown>)=>handlers.set(name,callback)},trusted(){},draftSession:{owner:71,id:randomUUID()},repository:{read:async()=>{reads++;return{}}},app:{getVersion:()=> 'test'},dataRoot:'/test/source',nativeTheme:{shouldUseDarkColors:false}})
 await assert.rejects(handlers.get('desktop:bootstrap')!({sender:{id:71}}),/BUSINESS_CLOSED/);assert.equal(reads,0)
})

test('M71-09: an already-open native file picker is drained but its late selection cannot mutate after admission closes',async()=>{
 const gate=new BusinessGate(),entered=Promise.withResolvers<void>(),picked=Promise.withResolvers<{id:string}>(),calls:string[]=[]
 const run=evaluate<(id:string)=>Promise<void>>(`${declaration('executeCommand')}\nreturn executeCommand`,{
  businessGate:gate,businessClosed:false,closingFlow:null,window:{webContents:{id:71},isDestroyed:()=>false},commands:{commands:[{id:'file.open'}]},
  chooseDirectory:async()=>{entered.resolve();return picked.promise},authority:{consume:async()=>{calls.push('consume');return{path:'/test-selected'}}},service:{call:async()=>calls.push('open-work')},send:()=>calls.push('event'),
 })
 const work=run('file.open');await entered.promise;let drained=false;const close=gate.close();void close.then(()=>{drained=true});await new Promise(setImmediate);assert.equal(drained,false)
 picked.resolve({id:'late-grant'});await assert.rejects(work,/正在关闭/);await close;assert.deepEqual(calls,[])
})

async function reopenRig(overrides:Record<string,unknown>={}){
 const gate=new BusinessGate();await gate.close();let created=0,loads=0
 class Window{
  webContents={id:71,setZoomFactor(){},setIgnoreMenuShortcuts(){},setWindowOpenHandler(){},on(){}};constructor(_options:unknown){created++}
  on(){}once(){}setMenu(){}show(){}async loadURL(){loads++}
 }
 const run=evaluate<()=>Promise<{closed:boolean;businessClosed:boolean}>>(`let window=null,businessClosed=true;
 ${declaration('restoreBusiness')}\n${declaration('createWindow')}
 return async()=>{await createWindow();return{closed:businessGate.closed,businessClosed}}
 `,{workLease:null,workRestore:null,workBackups:undefined,resumeWorkBackups:async()=>{},businessGate:gate,modelService:{resume(){}},repository:{read:async()=>({settings:{appearance:{theme:'paper',zoom:1}}})},nativeTheme:{shouldUseDarkColors:false},nativeWindowAppearance,BrowserWindow:Window,join:(...args:string[])=>args.join('/'),__dirname:'/bundle/main',refreshMenus(){},send(){},
  closeChannel:{cancel(){}},recoveryExports:{cancelWindow(){},flush:async()=>{}},fileExports:{cancelWindow(){},flush:async()=>{}},configurationFiles:{cancelWindow(){}},authority:{revokeOwner(){}},modelConfiguration:{cancelOwner(){}},avatarAssets:{cancelOwner(){}},responseOwners:new Map(),draftSession:null,closePermits:new WeakSet(),quitting:false,closingFlow:null,migrationHandoff:null,beginClose(){},draftJournal:{activate:()=>()=>{}},randomUUID,...overrides,
 })
 return{run,gate,counts:()=>({created,loads})}
}

test('M71-10: reopening the normal macOS workbench after a committed window-only close restores the business gate for its new bootstrap',async()=>{
 const r=await reopenRig();assert.deepEqual(await r.run(),{closed:false,businessClosed:false},'activate must not leave the new bootstrap trapped behind the gate from the previously committed window close');assert.deepEqual(r.counts(),{created:1,loads:1})
})

test('M71-11: reopening cannot bypass an active close, retained pending migration, or committed process quit',async()=>{
 for(const barrier of [{closingFlow:Promise.resolve(false)},{migrationHandoff:{pending:true}},{quitting:true}]){
  const r=await reopenRig(barrier);await assert.rejects(r.run());assert.equal(r.gate.closed,true);assert.deepEqual(r.counts(),{created:0,loads:0})
 }
})
