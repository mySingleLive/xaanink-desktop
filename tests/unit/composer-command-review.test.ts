import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {test} from "node:test"
import ts from "typescript"
import {transformSync} from "esbuild"
import {ComposerHistory} from "../../src/lib/desktop/composer-history"
import {CommandTargets,type CommandHandler} from "../../src/lib/desktop/command-targets"
import {ShortcutDispatcher} from "../../desktop/core/shortcut-dispatch"
import * as shortcutKeys from "../../desktop/core/shortcuts"
import {platformCommands} from "../../desktop/shared/command-registry"
import {desktopCommandCatalog,publishDesktopCommands} from "../../src/lib/desktop/command-runtime"
import {commandScope} from "../../src/lib/desktop/command-scope"

// Execute actual ChatPanel callbacks and the real Controller capture listener.
// The DOM/hooks are bounded fixtures; this does not claim native event proof.
const panelSource=readFileSync(new URL("../../src/components/layout/ChatPanel.tsx",import.meta.url),"utf8")
const ast=ts.createSourceFile("ChatPanel.tsx",panelSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const panel=ast.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==="ChatPanel")!
function panelCalls(name:string){
 const found:ts.CallExpression[]=[]
 const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text===name)found.push(node);ts.forEachChild(node,visit)}
 ts.forEachChild(panel.body!,visit);return found
}
function historyEffect(conversationId:string,messages:Array<{role:string;content:string}>,history:ComposerHistory,recoveryStatus:string,isLoadingConversation=recoveryStatus!=="ready"){
 const effect=panelCalls("useEffect").find(node=>node.getText(ast).includes("inputHistory.seed"))!
 assert(effect,"the actual history effect must remain available")
 const callback=transformSync(`const callback=${effect.arguments[0].getText(ast)}`,{loader:"ts",format:"cjs"}).code
 const store={getState:()=>({conversationId,recoveryStatus,accountId:"local"})}
 new Function("conversationId","messages","inputHistory","recoveryStatus","isLoadingConversation","useChatStore","userId",`${callback};callback()`)(conversationId,messages,history,recoveryStatus,isLoadingConversation,store,"local")
}
test("CMP47-01: restored conversation history is seeded after hydration, not by the initial empty list",()=>{
 const history=new ComposerHistory()
 historyEffect("restored-a",[],history,"restoring")
 historyEffect("restored-a",[{role:"user",content:"已保存的本会话输入"},{role:"assistant",content:"回答"}],history,"ready")
 assert.equal(history.move("restored-a",-1,"尚未发送的草稿"),"已保存的本会话输入")
 assert.equal(history.move("restored-a",1,"已保存的本会话输入"),"尚未发送的草稿")
})
test("CMP47-02: conversation switching cannot seed the new owner from the previous conversation's messages",()=>{
 const history=new ComposerHistory()
 historyEffect("a",[{role:"user",content:"A 的历史"}],history,"ready")
 historyEffect("b",[{role:"user",content:"A 的历史"}],history,"restoring")
 historyEffect("b",[{role:"user",content:"B 的历史"}],history,"ready")
 assert.equal(history.move("b",-1,"B 草稿"),"B 的历史")
 assert.equal(history.move("a",-1,"A 草稿"),"A 的历史")
})

class ElementFixture extends EventTarget {
 isConnected=true;inDialog=false
 constructor(readonly kind:"composer"|"button"|"editor"){super()}
 closest(selector:string){return this.inDialog&&selector.includes('role="dialog"')||this.kind==="composer"&&selector.includes(".chat-composer-editable")||this.kind==="editor"&&(selector.includes(".monaco-editor")||selector.includes(".desktop-markdown-editor"))?this:null}
 matches(){return false}
 getClientRects(){return [0]}
}
class DocumentFixture extends EventTarget {modal=false;querySelector(selector:string){return this.modal&&selector.includes('role="dialog"')?{}:null}}
function controller(overrides:Record<string,string[]>={},mention:object|null=null){
 const document=new DocumentFixture(),window=new EventTarget(),composer=new ElementFixture("composer"),button=new ElementFixture("button"),editor=new ElementFixture("editor")
 const bus=new CommandTargets<ElementFixture|null>(),calls:string[]=[],cleanup:Array<()=>void>=[]
 let remembered:ElementFixture|null=composer
 const bootstrap={platform:"darwin",settings:{shortcuts:{darwin:overrides,win32:{}}}}
 const store={getState:()=>({bootstrap})}
 const register=(commands:Record<string,CommandHandler>,ref?:{current:ElementFixture})=>cleanup.push(bus.register({owner:{},accepts:target=>!ref||target===ref.current,commands}))
 const registrations=panelCalls("useDesktopCommands").map(node=>node.getText(ast)).join(";\n")
 new Function("useDesktopCommands","textareaRef","canSend","isGenerating","mention","stop","handleSend","historyInput","flatMentionItems","setMentionIndex","selectMention","mentionIndex","mentionDismissedRef","setMention","insertToken","dispatchChatUiEvent","CHAT_OPEN_MODEL_PICKER_EVENT","useChatStore","setSearchOpen","document","syncFromEditor",registrations)(register,{current:composer},true,true,mention,()=>calls.push("stop"),()=>calls.push("send"),()=>{},[{}],()=>{},()=>calls.push("mention"),0,{current:null},()=>calls.push("close"),()=>{},()=>{},"models",{getState:()=>({requestChatFocus(){}})},()=>{},document,()=>{})
 const dependencies:Record<string,unknown>={
  react:{useEffect(effect:()=>()=>void){cleanup.push(effect())}},sonner:{toast:{info(){},error(){}}},
  "@/stores/desktop":{useDesktopStore:store,updateDesktopSettings:async()=>{}},"@/stores/tabs":{useTabsStore:{getState:()=>({activeTabId:null})}},
  "@desktop/core/shortcut-dispatch":{ShortcutDispatcher},"@desktop/core/shortcuts":shortcutKeys,
  "@/lib/desktop/input-commands":{installInputCommands:()=>()=>{},installInputContextMenu:()=>()=>{},isAPIKeyControl:()=>false},"@/lib/desktop/native-text-edits":{nativeTextEdits:()=>({run(){},dispose(){}})},
  "@/lib/desktop/composer-text-commands":{installComposerTextCommands:()=>()=>{}},
  "@/lib/desktop/command-scope":{commandScope},
  "@/lib/desktop/command-runtime":{desktopCommandCatalog:()=>platformCommands("darwin"),desktopCommandTargets:bus,desktopCommandTarget:()=>remembered,desktopEditorTarget:()=>editor,rememberDesktopCommandTarget:(next:ElementFixture)=>{remembered=next}},
  "@/lib/desktop/use-command-target":{useDesktopCommands:register},
 }
 const originals=["window","document","HTMLElement"].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const)
 for(const [name,value] of Object.entries({window,document,HTMLElement:ElementFixture}))Object.defineProperty(globalThis,name,{configurable:true,value})
 const module={exports:{} as {DesktopCommandController:()=>null}}
 const source=transformSync(readFileSync(new URL("../../src/components/desktop/DesktopCommandController.tsx",import.meta.url),"utf8"),{loader:"tsx",format:"cjs",jsx:"automatic"}).code
 new Function("module","exports","require",source)(module,module.exports,(name:string)=>{assert(name in dependencies,`Unexpected dependency: ${name}`);return dependencies[name]})
 module.exports.DesktopCommandController()
 return {calls,composer,button,editor,document,
  key(target:ElementFixture,key:string,code=key,extra:Record<string,unknown>={}){
   const event=new Event("keydown",{cancelable:true})
   Object.defineProperties(event,Object.fromEntries(Object.entries({target,key,code,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,isComposing:false,repeat:false,keyCode:0,...extra}).map(([name,value])=>[name,{value}])));window.dispatchEvent(event);return event
  },async settle(){for(let n=0;n<8;n++)await Promise.resolve()},
  dispose(){while(cleanup.length)cleanup.pop()!();for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name)}},
 }
}
test("CMP47-03: Escape stops the active generation after focus leaves the composer, preserving the Web behavior",async()=>{
 const f=controller()
 try{assert.equal(f.key(f.button,"Escape").defaultPrevented,true);await f.settle();assert.deepEqual(f.calls,["stop"])}finally{f.dispose()}
})
test("CMP47-04: mention Enter selects a reference, and Escape closes the popup without sending or stopping",async()=>{
 const f=controller({},{});
 try{f.key(f.composer,"Enter");f.key(f.composer,"Escape");await f.settle();assert.deepEqual(f.calls,["mention","close"])}finally{f.dispose()}
})
test("CMP47-05: additional send bindings work; removed Enter cannot reach the previous React send handler",async()=>{
 const f=controller({"ai.send":["Cmd+Enter","Ctrl+Enter"]})
 try{
  assert.equal(f.key(f.composer,"Enter").defaultPrevented,true)
  f.key(f.composer,"Enter","Enter",{metaKey:true});f.key(f.composer,"Enter","Enter",{ctrlKey:true});await f.settle();assert.deepEqual(f.calls,["send","send"])
 }finally{f.dispose()}
})
test("CMP47-06: IME Enter cannot send or select a reference",async()=>{
 const f=controller({},{});
 try{assert.equal(f.key(f.composer,"Enter","Enter",{isComposing:true,keyCode:229}).defaultPrevented,false);await f.settle();assert.deepEqual(f.calls,[])}finally{f.dispose()}
})
test("CMP47-14: a still-loading message list cannot seed history even when recovery has become ready",()=>{
 const history=new ComposerHistory()
 historyEffect("late",[],history,"ready",true)
 historyEffect("late",[{role:"user",content:"加载完成"}],history,"ready",false)
 assert.equal(history.move("late",-1,"草稿"),"加载完成")
})
test("CMP47-15: the settings modal blocks background global stop while closing mention retains priority",async()=>{
 const f=controller()
 try{f.document.modal=true;f.key(f.button,"Escape");await f.settle();assert.deepEqual(f.calls,[])}finally{f.dispose()}
})
test("CMP47-16: custom stop binding removes its former Escape behavior outside the composer",async()=>{
 const f=controller({"ai.stop":["F18"]})
 try{assert.equal(f.key(f.button,"Escape").defaultPrevented,true);f.key(f.button,"F18");await f.settle();assert.deepEqual(f.calls,["stop"])}finally{f.dispose()}
})
test("CMP47-17: both platform catalogs expose actual composer/global scopes and retain static contexts when runtime metadata merges",()=>{
 for(const platform of ["darwin","win32"] as const){
  const commands=desktopCommandCatalog(platform)
  assert.equal(commands.find(command=>command.id==="ai.stop")!.scope,"global")
  assert.equal(commands.find(command=>command.id==="ai.send")!.scope,"composer")
  assert.deepEqual(commands.find(command=>command.id==="ai.mentionConfirm")!.contexts,{mention:true})
  assert.deepEqual(commands.find(command=>command.id==="ai.stop")!.contexts,{mention:false})
 }
 const original=desktopCommandCatalog("darwin").find(command=>command.id==="ai.send")!
 const remove=publishDesktopCommands({},[{...original,label:"Runtime label",scope:"markdown",contexts:{mention:true},defaults:["Enter","F19"]}])
 try{const merged=desktopCommandCatalog("darwin").find(command=>command.id==="ai.send")!;assert.equal(merged.label,original.label);assert.equal(merged.scope,"composer");assert.deepEqual(merged.contexts,{mention:false});assert.deepEqual(merged.defaults,["Enter","F19"])}finally{remove()}
})
