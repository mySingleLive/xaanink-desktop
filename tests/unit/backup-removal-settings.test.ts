import {test} from 'node:test'
import assert from 'node:assert/strict'
import {settingsSchema,defaultState,stateSchema} from '../../desktop/core/settings'
test('default and validated settings contain only current general options',()=>{
 assert.deepEqual(defaultState.settings.general,{defaultParent:'',restoreSession:true})
 assert.deepEqual(settingsSchema.parse(defaultState.settings).general,{defaultParent:'',restoreSession:true})
})
test('legacy backup settings are read compatibly but not returned or re-exported',()=>{
 const settings=structuredClone(defaultState.settings)
 const legacy={...settings,general:{defaultParent:'/local/works',restoreSession:false,backupIntervalMinutes:15,backupRetention:10}}
 const parsed=stateSchema.parse({settings:legacy,models:[]})
 assert.deepEqual(parsed.settings.general,{defaultParent:'/local/works',restoreSession:false})
 assert.deepEqual(parsed.settings.user,settings.user)
 assert.deepEqual(parsed.settings.appearance,settings.appearance)
})
test('compatibility does not allow unknown or corrupt legacy options',()=>{
 const general={defaultParent:'',restoreSession:true}
 for(const extra of [{backupIntervalMinutes:0},{backupRetention:Infinity},{unknownSetting:true}])assert.equal(settingsSchema.safeParse({...defaultState.settings,general:{...general,...extra}}).success,false)
})
