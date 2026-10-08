import assert from "node:assert/strict"
import {test} from "node:test"
import {flushDesktopSettings,useDesktopStore,updateDesktopSettings} from "../../src/stores/desktop"
import {defaultState} from "../../desktop/core/settings"
import type {Bootstrap,SettingsAction,StateSnapshot} from "../../desktop/shared/ipc"
function rig(save:(action:SettingsAction)=>Promise<StateSnapshot>){const before=Object.getOwnPropertyDescriptor(globalThis,"window"),state=useDesktopStore.getState(),bootstrap={revision:0,settings:structuredClone(defaultState.settings),models:[],platform:"darwin",version:"0.1.0",dataRoot:"/isolated",draftSessionId:crypto.randomUUID(),systemDark:false} satisfies Bootstrap;Object.defineProperty(globalThis,"window",{configurable:true,value:{desktop:{settings:save,bootstrap:async()=>bootstrap}}});useDesktopStore.setState({bootstrap,saving:0,error:null});return{bootstrap,done(){if(before)Object.defineProperty(globalThis,"window",before);else Reflect.deleteProperty(globalThis,"window");useDesktopStore.setState(state)}}}
test("close settings barrier waits for all pending atomic settings acknowledgements",async()=>{
 const gate=Promise.withResolvers<void>(),r=rig(async action=>{await gate.promise;if(action.type!=="update")throw Error();return{revision:action.revision+1,settings:action.settings,models:[]}})
 const update=updateDesktopSettings(before=>({...before,appearance:{...before.appearance,theme:"ink"}}));let finished=false;const barrier=flushDesktopSettings().then(()=>{finished=true})
 try{await new Promise(setImmediate);assert.equal(finished,false);gate.resolve();await update;await barrier;assert.equal(finished,true);assert.equal(useDesktopStore.getState().saving,0)}finally{gate.resolve();await Promise.allSettled([update,barrier]);r.done()}
})
test("a failed settings acknowledgement blocks close until the user resolves the settings error",async()=>{
 const r=rig(async()=>{throw Error("isolated settings failure")})
 try{await assert.rejects(updateDesktopSettings(before=>({...before,general:{...before.general,restoreSession:false}})));await assert.rejects(flushDesktopSettings(),/设置/);assert.equal(useDesktopStore.getState().bootstrap?.settings.general.restoreSession,true)}finally{r.done()}
})
