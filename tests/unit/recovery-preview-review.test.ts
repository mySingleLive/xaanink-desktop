import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {recoveryPreview} from '../../src/lib/desktop/recovery-preview'
import {DesktopRecoveryStore,restoreDesktopDraft,type RecoveryItem} from '../../src/lib/desktop/draft-recovery'
import {WorkspaceDraftSource} from '../../src/lib/desktop/workspace-draft-source'
import {chatSessionEntrySchema,emptyChatSession} from '../../src/lib/chat-session'
import {buildTabId} from '../../src/stores/tabs'

function item(source:string,value:unknown,path='source'):RecoveryItem{return{id:randomUUID(),source,path,reason:'WORK_RESTORED',createdAt:'2026-10-08T00:00:00.000Z',value}}
function autosave(value:unknown){const attempt={value,revision:1,operationId:'internal-operation-not-body'};return{revision:1,status:'pending',paused:false,pending:attempt,failed:null,inFlight:null,latest:attempt}}

test('RP82-01 original text setting content is readable in both real autosave and staged body shapes',()=>{
 const value={name:'力量体系',content:{text:'力量来自潮汐，代价是记忆。'}}
 const records=[item('autosaves',autosave(value)),item('staged',{batchKey:'settings',label:'力量体系',changes:[{targetKind:'SETTING',request:{url:'/api/novels/internal/settings/internal',method:'PATCH',body:{...value,operationId:'never-show',expectedVersion:2}}}]})]
 for(const record of records){const before=structuredClone(record);const preview=recoveryPreview(record);assert.match(preview.text,/力量来自潮汐，代价是记忆。/);assert.doesNotMatch(preview.text,/internal|never-show|expectedVersion/);assert.deepEqual(record,before)}
})

test('RP82-02 original CharacterForm prose remains readable when a name is also present',()=>{
 const record=item('autosaves',autosave({name:'舟客',personality:'温和表象下藏着极强戒心',appearance:'灰衣沾着海盐',bio:'幼年漂泊在北岸',dialogueStyle:'回答前总会停顿'})),before=structuredClone(record)
 const preview=recoveryPreview(record)
 for(const value of ['温和表象下藏着极强戒心','灰衣沾着海盐','幼年漂泊在北岸','回答前总会停顿'])assert.ok(preview.text.includes(value),value)
 assert.deepEqual(record,before)
})

test('RP82-03 a single unavailable workspace tab retained by restore is still a readable known record',async()=>{
 const recovery=new DesktopRecoveryStore(),workspace=new WorkspaceDraftSource()
 const tab={id:buildTabId('chapter-content','n',{refId:'ch'}),type:'chapter-content',novelId:'n',refId:'ch',title:'潮声里的第一章'}
 await restoreDesktopDraft({version:1,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],issues:[],sources:{workspace:{version:1,tabs:[tab],activeTabId:tab.id,subTabs:{},layout:null}}},{restoreSession:true,accountId:'owner',storage:null,recovery,workspace,verifyTarget:()=>false})
 const record=recovery.read().items.find(row=>row.source==='workspace'&&row.path===`tab:${tab.id}`);assert.ok(record)
 assert.match(recoveryPreview(record).text,/潮声里的第一章/)
})

test('RP82-04 valid chat queues below the prose limit must not silently stop at 4096 entries',()=>{
 const entry=chatSessionEntrySchema.parse({...emptyChatSession(),queuedMessages:Array.from({length:4097},(_,index)=>({id:String(index),text:index===4096?'最后一条输入':'短句'}))})
 const record=item('chat',{accountId:'owner',active:entry,saved:null}),before=structuredClone(record)
 const preview=recoveryPreview(record)
 assert.match(preview.text,/最后一条输入/);assert.equal(preview.truncated,false);assert.ok(preview.text.length<100000);assert.deepEqual(record,before)
})

test('RP82-05 metadata-only and malformed records stay visible/exportable without displaying internal fields',()=>{
 for(const record of [item('autosaves',{revision:0,status:'saved',paused:false,pending:null,failed:null,inFlight:null,latest:null,request:{content:'do not execute'},endpoint:'private endpoint'}),item('chat',{pendingRequest:{clientRequestId:'private id',body:'{"text":"not a prose field"}'}}),item('scene',{imageRequests:{one:{url:'/do-not-run',operationId:'hidden'}},submissions:{two:{text:'not a known body'}}}),item('extension',{content:'unknown structured data',secret:'hidden'})]){
  const preview=recoveryPreview(record);assert.equal(preview.empty,false);assert.equal(preview.meaningful,false);assert.match(preview.text,/完整内容已保留/);assert.doesNotMatch(preview.text,/private|execute|not a|hidden|unknown structured/)
 }
})

test('RP82-06 original retained reasons are preserved while every newly isolated source uses work restore reason',async()=>{
 const recovery=new DesktopRecoveryStore(),workspace=new WorkspaceDraftSource(),old={...item('chat',{draft:'历史保留稿'}),reason:'RESTORE_DISABLED' as const}
 const original={version:1 as const,revision:2,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[{id:randomUUID(),draft:autosave('正文')}],issues:[],sources:{recovery:{version:1,items:[old]},staged:{batches:{},chips:[]},scene:{drafts:{},imageRequests:{request:{operationId:'not replayed'}}},chat:{accountId:'owner',active:emptyChatSession(),saved:null},workspace:{version:1,tabs:[],activeTabId:null,subTabs:{},layout:null},comments:{accountId:'owner',rows:[]}}},before=structuredClone(original)
 const result=await restoreDesktopDraft(original,{restoreSession:false,disabledReason:'WORK_RESTORED',accountId:'owner',storage:null,recovery,workspace,verifyTarget:()=>{throw new Error('isolation must not verify or run requests')}})
 assert.deepEqual(result.applied,{staged:0,scene:0,chat:0,workspace:0,comments:0});assert.equal(recovery.read().items.find(row=>row.id===old.id)?.reason,'RESTORE_DISABLED')
 assert.ok(recovery.read().items.filter(row=>row.id!==old.id).every(row=>row.reason==='WORK_RESTORED'));assert.deepEqual(original,before)
 const next=new DesktopRecoveryStore();await restoreDesktopDraft({...original,autosaves:[],sources:{recovery:recovery.read()}},{restoreSession:true,accountId:'owner',storage:null,recovery:next,workspace});assert.deepEqual(next.read(),recovery.read())
})
