import assert from "node:assert/strict"
import {test} from "node:test"
import {readFileSync} from "node:fs"
import ts from "typescript"
import {transformSync} from "esbuild"
import {defaultState} from "../../desktop/core/settings"
import type {Bootstrap,SettingsAction,StateSnapshot} from "../../desktop/shared/ipc"
import {updateDesktopSettings,useDesktopStore} from "../../src/stores/desktop"
import {platformCommands} from "../../desktop/shared/command-registry"
import {composerSendPreset,setComposerSendPreset} from "../../src/lib/desktop/composer-shortcuts"

// Actual ChatPanel save callback + actual serialized settings store. Only IPC
// storage acknowledgement is controlled; repository CAS/disk were not rerun.
const text=readFileSync(new URL("../../src/components/layout/ChatPanel.tsx",import.meta.url),"utf8")
const ast=ts.createSourceFile("ChatPanel.tsx",text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const panel=ast.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==="ChatPanel")!
const declaration=panel.body!.statements.filter(ts.isVariableStatement).flatMap(node=>node.declarationList.declarations).find(node=>ts.isIdentifier(node.name)&&node.name.text==="saveSendPreset")!
const code=transformSync(`const save=${declaration.initializer!.getText(ast)}`,{loader:"ts",format:"cjs"}).code
function fixture(overrides:Record<string,string[]>={},fail=false){
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,"window"),oldState=useDesktopStore.getState()
 let resolve!:()=>void
 const gate=new Promise<void>(yes=>{resolve=yes})
 let actual:StateSnapshot={revision:0,settings:structuredClone(defaultState.settings),models:[]}
 actual.settings.shortcuts.darwin=structuredClone(overrides);actual.settings.shortcuts.win32={"ai.send":["Ctrl+Enter"]}
 const calls:SettingsAction[]=[],errors:string[]=[]
 Object.defineProperty(globalThis,"window",{configurable:true,value:{desktop:{
  async settings(action:SettingsAction){calls.push(action);await gate;if(fail)throw new Error("受控磁盘失败");assert.equal(action.type,"update");if(action.type!=="update")throw Error("Unexpected action");assert.equal(action.revision,actual.revision);actual={...actual,revision:actual.revision+1,settings:action.settings};return actual},
  async bootstrap(){return actual},
 }}})
 useDesktopStore.setState({bootstrap:{...actual,platform:"darwin"} as Bootstrap,saving:0,error:null})
 const save=new Function("useDesktopStore","updateDesktopSettings","desktopCommandCatalog","setComposerSendPreset","setEnterToSend","toast",`${code};return save`)(useDesktopStore,updateDesktopSettings,()=>platformCommands("darwin"),setComposerSendPreset,()=>{throw Error("Desktop must not change Web send preference")},{error:(message:string)=>errors.push(message)}) as (value:boolean)=>Promise<void>
 return {calls,errors,resolve,save,current:()=>useDesktopStore.getState().bootstrap!,async tick(){for(let n=0;n<10;n++)await Promise.resolve()},dispose(){useDesktopStore.setState(oldState);if(oldWindow)Object.defineProperty(globalThis,"window",oldWindow);else Reflect.deleteProperty(globalThis,"window")}}
}
test("CMP47-11: preset swaps both commands in one acknowledgement, preserves extra bindings and the other platform",async()=>{
 const f=fixture({"ai.send":["Enter","Cmd+Enter"],"ai.newline":["Shift+Enter"]})
 try{
  const result=f.save(false);await f.tick()
  assert.equal(composerSendPreset(platformCommands("darwin"),f.current().settings.shortcuts.darwin),"enter")
  assert.equal(f.calls.length,1);f.resolve();await result
  assert.deepEqual(f.current().settings.shortcuts.darwin,{"ai.send":["Shift+Enter","Cmd+Enter"],"ai.newline":["Enter"]})
  assert.deepEqual(f.current().settings.shortcuts.win32,{"ai.send":["Ctrl+Enter"]});assert.deepEqual(f.errors,[])
 }finally{f.dispose()}
})
test("CMP47-12: failed storage acknowledgement retains both old bindings and reports the failure",async()=>{
 const f=fixture({},true)
 try{const result=f.save(false);await f.tick();f.resolve();await result;assert.deepEqual(f.current().settings.shortcuts.darwin,{});assert.deepEqual(f.errors,["受控磁盘失败"]);assert.equal(f.current().revision,0)}finally{f.dispose()}
})
test("CMP47-13: a conflicting preset never sends a partial settings mutation",async()=>{
 const f=fixture({"ai.clear":["Shift+Enter"]})
 try{await f.save(false);assert.deepEqual(f.calls,[]);assert.deepEqual(f.current().settings.shortcuts.darwin,{"ai.clear":["Shift+Enter"]});assert.match(f.errors[0],/清空输入草稿/)}finally{f.resolve();f.dispose()}
})
