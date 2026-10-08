import assert from "node:assert/strict"
import {test} from "node:test"
import {flushDesktopSettings,useDesktopStore,updateDesktopSettings} from "../../src/stores/desktop"

test("C53-04: rejected settings request before bootstrap is ready must remain a failed close barrier",async()=>{
 const priorWindow=Object.getOwnPropertyDescriptor(globalThis,"window"),state=useDesktopStore.getState()
 Object.defineProperty(globalThis,"window",{configurable:true,value:{desktop:{}}})
 useDesktopStore.setState({bootstrap:null,saving:0,error:null})
 try {
  await assert.rejects(updateDesktopSettings(before=>before),/尚未就绪/)
  assert.equal(useDesktopStore.getState().saving,0)
  await assert.rejects(flushDesktopSettings(),/设置/)
 }finally{
  if(priorWindow)Object.defineProperty(globalThis,"window",priorWindow);else Reflect.deleteProperty(globalThis,"window")
  useDesktopStore.setState(state)
 }
})
