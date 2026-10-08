import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {test} from "node:test"
import {transformSync} from "esbuild"
import {AutosaveController} from "../../src/lib/autosave-controller"
import {DesktopSaveCoordinator} from "../../src/lib/desktop/save-coordinator"
const code=transformSync(readFileSync(new URL("../../src/components/content/use-autosave.tsx",import.meta.url),"utf8"),{loader:"tsx",format:"cjs"}).code
function fixture(desktop:boolean){const original=Object.getOwnPropertyDescriptor(globalThis,"window"),coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),effects:Array<()=>void|(()=>void)>=[];Object.defineProperty(globalThis,"window",{configurable:true,value:desktop?{desktop:{}}:{}});const dependencies:Record<string,unknown>={react:{useState(initial:unknown){return[typeof initial==="function"?(initial as ()=>unknown)():initial,()=>{}]},useEffect:(effect:()=>void|(()=>void))=>effects.push(effect),useCallback:(fn:unknown)=>fn},"@/lib/autosave-controller":{AutosaveController},"@/lib/desktop/save-coordinator":{desktopSaveCoordinator:coordinator},"@/stores/staged-changes":{},"lucide-react":{},"react/jsx-runtime":{}};const module={exports:{} as {useAutosave<T>(save:(value:T,attempt:import("../../src/lib/autosave-controller").SaveAttempt<T>)=>Promise<void>,delay?:number):{controller:AutosaveController<T>;schedule(value:T):void}}};new Function("module","exports","require",code)(module,module.exports,(name:string)=>dependencies[name]??{});const saved:string[]=[];const hook=module.exports.useAutosave<string>(async value=>{saved.push(value)},60000),cleanups=effects.map(effect=>effect());return{coordinator,hook,saved,unmount(){for(const cleanup of cleanups)if(typeof cleanup==="function")cleanup()},dispose(){hook.controller.dispose();if(original)Object.defineProperty(globalThis,"window",original);else Reflect.deleteProperty(globalThis,"window")}}}
test("SAVE50-H01: actual desktop hook cleanup retains pending input and its save function until the durable acknowledgement",async()=>{
 const f=fixture(true);f.coordinator.configurePersistence(async()=>{});f.hook.schedule("离开组件仍保存")
 try{f.unmount();await f.coordinator.flushAll();assert.deepEqual(f.saved,["离开组件仍保存"]);assert.equal(f.coordinator.exportSnapshot().autosaves.length,0)}finally{f.dispose()}
})
test("SAVE50-H02: Web cleanup keeps its original stop-timer and no-desktop-registration behavior",async()=>{
 const f=fixture(false);f.hook.schedule("Web原草稿")
 try{f.unmount();await f.hook.controller.flush();assert.deepEqual(f.saved,[]);assert.equal(f.hook.controller.dirty,true);assert.equal(f.coordinator.exportSnapshot().autosaves.length,0)}finally{f.dispose()}
})
