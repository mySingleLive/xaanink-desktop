import assert from 'node:assert/strict'
import {test} from 'node:test'
import {defaultState} from '../../desktop/core/settings'
import {onboardingStartup, modelOnboardingNeeded, onboardingCanShow} from '../../src/lib/desktop/onboarding-flow'
import type {StateSnapshot,ModelRequiredNotice} from '../../desktop/shared/ipc'
const state=(progress?:object,models:StateSnapshot['models']=[])=>({revision:0,settings:structuredClone(defaultState.settings),models,onboarding:progress??null}) as StateSnapshot
const completed={version:1,completed:true,step:'welcome',textModelId:null,imageModelId:null,receipt:null}
test('ONB-01/06: legacy and incomplete full resume, completion gates zero TEXT independently of IMAGE/enabled',()=>{
 assert.deepEqual(onboardingStartup(state()),{flow:'full',step:'theme'})
 assert.deepEqual(onboardingStartup(state({...completed,completed:false,step:'profile'})),{flow:'full',step:'profile'})
 assert.deepEqual(onboardingStartup(state(completed)),{flow:'models',step:'entry'})
 const text={id:crypto.randomUUID(),kind:'TEXT',enabled:false} as StateSnapshot['models'][number]
 const image={...text,kind:'IMAGE'} as StateSnapshot['models'][number]
 assert.equal(onboardingStartup(state(completed,[text])),null)
 assert.deepEqual(onboardingStartup(state(completed,[image])),{flow:'models',step:'entry'})
 assert.equal(onboardingStartup(state({...completed,step:'image-choice'},[text])),null)
})
test('ONB-06/09: missing TEXT routes to short configuration, other precise repairs remain, no retry side effects',()=>{
 const notice:ModelRequiredNotice={type:'model-required',role:'text',code:'MODEL_NOT_CONFIGURED'}
 assert.equal(modelOnboardingNeeded(state(completed),notice),true)
 assert.equal(modelOnboardingNeeded(state(completed),{...notice,role:'image'}),false)
 assert.equal(modelOnboardingNeeded(state(completed),{...notice,code:'MODEL_DISABLED'}),false)
 assert.equal(modelOnboardingNeeded(state(completed,[{kind:'TEXT',enabled:false} as StateSnapshot['models'][number]]),notice),false)
})
test('ONB-01b/10: bootstrap and all high priority dialogs inhibit onboarding',()=>{
 const ready={ready:true,closing:false,migration:false,lease:false,recovery:false}
 assert.equal(onboardingCanShow(ready),true)
 for(const field of ['closing','migration','lease','recovery'] as const)assert.equal(onboardingCanShow({...ready,[field]:true}),false)
 assert.equal(onboardingCanShow({...ready,ready:false}),false)
})
