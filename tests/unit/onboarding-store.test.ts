import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createDesktopOnboardingCommit,flushDesktopSettings,useDesktopStore,updateDesktopSettings} from '../../src/stores/desktop'
import {defaultState} from '../../desktop/core/settings'
import type {Bootstrap} from '../../desktop/shared/ipc'
test('ONB-08/09: onboarding uses close write queue, freezes first envelope and only advances on acknowledgement',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window'),old=useDesktopStore.getState()
 const snapshot:Bootstrap={revision:0,settings:structuredClone(defaultState.settings),models:[],platform:'win32',version:'fixture',dataRoot:'isolated',draftSessionId:crypto.randomUUID(),systemDark:false}
 const gate=Promise.withResolvers<void>(),calls:unknown[]=[];let fail=true
 Object.defineProperty(globalThis,'window',{configurable:true,value:{desktop:{
  settings:async(action:any)=>{await gate.promise;snapshot.revision++;snapshot.settings=action.settings;return structuredClone(snapshot)},
  onboarding:async(action:any)=>{calls.push(structuredClone(action));if(fail){snapshot.revision++;throw Error('保存未确认')}snapshot.revision++;return structuredClone(snapshot)},
  bootstrap:async()=>structuredClone(snapshot)
 }}})
 useDesktopStore.setState({bootstrap:structuredClone(snapshot),saving:0,error:null})
 const op=crypto.randomUUID(),commit=createDesktopOnboardingCommit({type:'next-theme',flow:'full',operationId:op})
 const first=updateDesktopSettings(before=>({...before,appearance:{...before.appearance,theme:'ink'}}))
 const confirming=commit(),rejection=assert.rejects(confirming),barrier=flushDesktopSettings(),barrierReject=assert.rejects(barrier)
 try{
  await new Promise(setImmediate);assert.equal(calls.length,0)
  gate.resolve();await first;await rejection;await barrierReject
  assert.equal((calls[0] as any).revision,1);assert.equal(useDesktopStore.getState().bootstrap?.revision,2)
  fail=false;await commit();assert.deepEqual(calls[1],calls[0]);await flushDesktopSettings();assert.equal(useDesktopStore.getState().saving,0)
 }finally{gate.resolve();await Promise.allSettled([first,confirming,barrier]);if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');useDesktopStore.setState(old)}
})
