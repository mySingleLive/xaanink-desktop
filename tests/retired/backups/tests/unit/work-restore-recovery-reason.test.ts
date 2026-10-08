import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {DesktopRecoveryStore,restoreDesktopDraft} from '../../src/lib/desktop/draft-recovery'
import {WorkspaceDraftSource} from '../../src/lib/desktop/workspace-draft-source'
import {emptyChatSession,chatSessionKey} from '../../src/lib/chat-session'
test('work restore isolation preserves user setting semantics, source bytes and cache until checkpoint; new reason survives another launch',async()=>{
 const recovery=new DesktopRecoveryStore(),workspace=new WorkspaceDraftSource(),active={...emptyChatSession(),draft:'备份恢复前的对话'},raw=JSON.stringify({version:1,activeKey:active.draftId,drafts:{[active.draftId]:active}}),cache=new Map([[chatSessionKey('owner'),raw]])
 const storage={getItem:(key:string)=>cache.get(key)??null,setItem:(key:string,value:string)=>{cache.set(key,value)},removeItem:(key:string)=>{cache.delete(key)}}
 const snapshot={version:1 as const,revision:1,createdAt:'2026-10-08T00:00:00Z',autosaves:[{id:randomUUID(),draft:{pending:{value:'保留正文'}}}],sources:{chat:{accountId:'owner',active,saved:null}},issues:[]},original=structuredClone(snapshot)
 const summary=await restoreDesktopDraft(snapshot,{restoreSession:false,disabledReason:'WORK_RESTORED',accountId:'owner',storage,recovery,workspace})
 assert.equal(summary.applied.chat,0);assert.ok(recovery.read().items.length>=3);assert.ok(recovery.read().items.every(item=>item.reason==='WORK_RESTORED'));assert.deepEqual(snapshot,original);assert.equal(cache.get(chatSessionKey('owner')),raw)
 summary.afterCheckpoint?.();assert.notEqual(cache.get(chatSessionKey('owner')),raw)
 const next=new DesktopRecoveryStore();await restoreDesktopDraft({...snapshot,autosaves:[],sources:{recovery:recovery.read()}},{restoreSession:true,accountId:'owner',storage,recovery:next,workspace})
 assert.deepEqual(next.read(),recovery.read())
})
test('the actual bootstrap supplies the work-restore reason for every durable barrier outcome',async()=>{
 const file=ts.createSourceFile('DesktopApp.tsx',readFileSync('src/components/desktop/DesktopApp.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let call=''
 function walk(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(file)==='restoreDesktopDraft')call=node.getText(file);ts.forEachChild(node,walk)}walk(file);assert.ok(call)
 const invoke=new Function('state','snapshot','storage','signal','createRecoveryVerifier','window','restoreDesktopDraft',transformSync(`return ${call}`,{loader:'ts'}).code)
 for(const status of ['pending','activated','failed']){const result=await invoke({restoreBarrier:{outcome:{status}},settings:{general:{restoreSession:true}}},null,null,new AbortController().signal,()=>null,{fetch:()=>{}},async(_snapshot:unknown,options:unknown)=>options);assert.equal(result.restoreSession,false);assert.equal(result.disabledReason,'WORK_RESTORED')}
 const normal=await invoke({restoreBarrier:null,settings:{general:{restoreSession:false}}},null,null,new AbortController().signal,()=>null,{fetch:()=>{}},async(_snapshot:unknown,options:unknown)=>options);assert.equal(normal.disabledReason,undefined)
})
