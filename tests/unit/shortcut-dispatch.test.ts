import assert from "node:assert/strict"
import {test} from "node:test"
import {ShortcutDispatcher, type ShortcutContext} from "../../desktop/core/shortcut-dispatch"
import type {ShortcutCommand} from "../../desktop/core/shortcuts"
const command=(id:string,scope:ShortcutCommand["scope"],defaults:string[]):ShortcutCommand=>({id,label:id,scope,defaults,locked:false})
const commands=[command("save","global",["Cmd+S"]),command("bold","markdown",["Cmd+B"]),command("send","composer",["Enter"]),command("confirm","input",["Enter"])]
const context=(scope:ShortcutContext["scope"]="markdown",overrides:Record<string,string[]>={}):ShortcutContext=>({commands,overrides,scope,platform:"darwin",focus:"editor-1"})
const key=(key:string,code:string,modifiers:Partial<KeyboardEvent>={})=>({key,code,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,isComposing:false,repeat:false,keyCode:0,defaultPrevented:false,...modifiers})
test("every binding executes the same command, deleted bindings do not silently regain their native default",()=>{
 const engine=new ShortcutDispatcher()
 const state=context("markdown",{save:["Cmd+Alt+S","Ctrl+S"],bold:[]})
 assert.deepEqual(engine.key(key("s","KeyS",{metaKey:true,altKey:true}),state),{kind:"run",id:"save"})
 assert.deepEqual(engine.key(key("s","KeyS",{ctrlKey:true}),state),{kind:"run",id:"save"})
 assert.equal(engine.key(key("s","KeyS",{metaKey:true}),state).kind,"blocked")
 assert.equal(engine.key(key("b","KeyB",{metaKey:true}),state).kind,"blocked")
})
test("mutually exclusive inputs may reuse keys, modal and IME consumption never sends an AI task",()=>{
 const engine=new ShortcutDispatcher()
 assert.deepEqual(engine.key(key("Enter","Enter"),context("composer")),{kind:"run",id:"send"})
 assert.deepEqual(engine.key(key("Enter","Enter"),context("input")),{kind:"run",id:"confirm"})
 assert.equal(engine.key(key("Enter","Enter",{isComposing:true}),context("composer")).kind,"none")
 assert.equal(engine.key(key("Enter","Enter",{keyCode:229}),context("composer")).kind,"none")
 assert.equal(engine.key(key("Enter","Enter",{defaultPrevented:true}),context("composer")).kind,"none")
 assert.equal(engine.key(key("s","KeyS",{metaKey:true}),{...context(),modal:true}).kind,"none")
 assert.equal(engine.key(key("Enter","Enter"),{...context("composer"),recording:true}).kind,"none")
})
test("chords respect focus, confirmed-settings changes, timeout and mismatching second strokes",()=>{
 let now=0;const engine=new ShortcutDispatcher(()=>now)
 const state=context("markdown",{bold:["Cmd+K Cmd+B"]})
 assert.equal(engine.key(key("k","KeyK",{metaKey:true}),state).kind,"prefix")
 assert.deepEqual(engine.key(key("b","KeyB",{metaKey:true}),state),{kind:"run",id:"bold"})
 engine.key(key("k","KeyK",{metaKey:true}),state)
 assert.equal(engine.key(key("b","KeyB",{metaKey:true}),{...state,focus:"editor-2"}).kind,"blocked")
 engine.key(key("k","KeyK",{metaKey:true}),state);now=3000
 assert.equal(engine.key(key("b","KeyB",{metaKey:true}),state).kind,"blocked")
 engine.key(key("k","KeyK",{metaKey:true}),state)
 assert.deepEqual(engine.key(key("s","KeyS",{metaKey:true}),state),{kind:"run",id:"save"})
 engine.key(key("k","KeyK",{metaKey:true}),state)
 assert.equal(engine.key(key("b","KeyB",{metaKey:true}),{...state,overrides:{bold:[]}}).kind,"blocked")
})
test("ambiguous or unavailable commands never choose an arbitrary handler, and held send does not repeat",()=>{
 const engine=new ShortcutDispatcher()
 const state=context("composer")
 assert.equal(engine.key(key("Enter","Enter",{repeat:true}),state).kind,"blocked")
 assert.equal(engine.key(key("s","KeyS",{metaKey:true}),{...state,enabled:()=>false}).kind,"blocked")
 const duplicate={...state,commands:[...commands,command("other","global",["Enter"])]}
 assert.equal(engine.key(key("Enter","Enter"),duplicate).kind,"blocked")
})
test("removing a multi-stroke default blocks its initial native prefix",()=>{
 const engine=new ShortcutDispatcher()
 const state={...context(),commands:[command("fold","markdown",["Cmd+K Cmd+0"])],overrides:{fold:[]}}
 assert.equal(engine.key(key("k","KeyK",{metaKey:true}),state).kind,"blocked")
})
test("when only one contextual action is enabled, disabled alternatives cannot swallow its key",()=>{
 const engine=new ShortcutDispatcher()
 const state={...context(),commands:[command("fold","markdown",["Escape"]),command("dismiss","markdown",["Escape"])],enabled:(id:string)=>id==="dismiss"}
 assert.deepEqual(engine.key(key("Escape","Escape"),state),{kind:"run",id:"dismiss"})
})
test("pending-chord queries expire before native delegation when configuration, owner, scope or deadline changes",()=>{
 let now=0;const engine=new ShortcutDispatcher(()=>now),state=context("markdown",{bold:["Cmd+B","Cmd+K Cmd+B"]})
 const start=()=>{engine.key(key("k","KeyK",{metaKey:true}),state);assert.equal(engine.waitingFor(state),true)}
 start();assert.equal(engine.waitingFor({...state,overrides:{bold:["Cmd+B"]}}),false)
 start();assert.equal(engine.waitingFor({...state,focus:"other"}),false)
 start();assert.equal(engine.waitingFor({...state,scope:"input"}),false)
 start();now=2100;assert.equal(engine.waitingFor(state),false)
})
