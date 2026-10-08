import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
import {ShortcutDispatcher} from '../../desktop/core/shortcut-dispatch'
import * as keys from '../../desktop/core/shortcuts'
import {commandScope} from '../../src/lib/desktop/command-scope'
import {CommandTargets} from '../../src/lib/desktop/command-targets'
// Explicit capture → native target → bubble phases around the real Controller.
// The native resolver is a controlled consumer; actual Monaco is checked in Electron.
function fixture(){
 class Element {kind='markdown';closest(selector:string){return this.kind==='markdown'&&selector==='.monaco-editor'||this.kind==='preview'&&selector==='.desktop-markdown-editor'?this:null};matches(){return false}}
 const target=new Element(),document=Object.assign(new EventTarget(),{querySelector:()=>null}),listeners=new Map<string,Set<(event:Event)=>void>>()
 const window={addEventListener(type:string,fn:(event:Event)=>void,capture=false){const key=type+capture;const set=listeners.get(key)??new Set();set.add(fn);listeners.set(key,set)},removeEventListener(type:string,fn:(event:Event)=>void,capture=false){listeners.get(type+capture)?.delete(fn)}}
 const commands=[{id:'text.copy',scope:'text',defaults:['Cmd+C'],locked:false},{id:'chat.search',scope:'global',defaults:['Cmd+K'],locked:false},{id:'md.fold',scope:'markdown',defaults:['Cmd+K Cmd+0'],locked:false,monacoBindings:[{binding:'Cmd+K Cmd+0'}]}]
 const bus=new CommandTargets<HTMLElement|null>(),calls:string[]=[],cleanups:Array<()=>void>=[]
 cleanups.push(bus.register({owner:{},accepts:()=>true,commands:{'text.copy':()=>{calls.push('copy')},'chat.search':()=>{calls.push('search')},'md.fold':()=>{calls.push('fold')}}}))
 const dependencies:Record<string,unknown>={react:{useEffect(fn:()=>()=>void){cleanups.push(fn())}},sonner:{toast:{info(){},error(){}}},'@/stores/desktop':{useDesktopStore:{getState:()=>({bootstrap:{platform:'darwin',settings:{shortcuts:{darwin:{},win32:{}}}}})}},'@/stores/tabs':{useTabsStore:{getState:()=>({})}},'@desktop/core/shortcut-dispatch':{ShortcutDispatcher},'@desktop/core/shortcuts':keys,'@/lib/desktop/command-runtime':{desktopCommandCatalog:()=>commands,desktopCommandTargets:bus,desktopCommandTarget:()=>target,desktopEditorTarget:()=>target,rememberDesktopCommandTarget(){}},'@/lib/desktop/use-command-target':{useDesktopCommands(){}},'@/lib/desktop/input-commands':{installInputCommands:()=>()=>{}},'@/lib/desktop/native-text-edits':{nativeTextEdits:()=>({run(){},dispose(){}})},'@/lib/desktop/composer-text-commands':{installComposerTextCommands:()=>()=>{}},'@/lib/desktop/command-scope':{commandScope}}
 const original=['window','document','HTMLElement'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const)
 for(const [key,value]of Object.entries({window,document,HTMLElement:Element}))Object.defineProperty(globalThis,key,{configurable:true,value})
 const module={exports:{} as {DesktopCommandController():null}}
 new Function('module','exports','require',transformSync(readFileSync(new URL('../../src/components/desktop/DesktopCommandController.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs'}).code)(module,module.exports,(id:string)=>{if(id in dependencies)return dependencies[id];throw Error(id)})
 module.exports.DesktopCommandController()
 return {target,calls,
  key(consumeNative:boolean,letter='k'){const event=new Event('keydown',{cancelable:true});Object.defineProperties(event,Object.fromEntries(Object.entries({key:letter,code:'Key'+letter.toUpperCase(),metaKey:true,ctrlKey:false,altKey:false,shiftKey:false,repeat:false,isComposing:false,target}).map(([key,value])=>[key,{value}])));for(const fn of listeners.get('keydowntrue')??[])fn(event);const preventedAtTarget=event.defaultPrevented;if(consumeNative)event.preventDefault();for(const fn of listeners.get('keydownfalse')??[])fn(event);return{preventedAtTarget,preventedAfterBubble:event.defaultPrevented}},
  async settle(){for(let i=0;i<8;i++)await Promise.resolve()},
  dispose(){while(cleanups.length)cleanups.pop()!();for(const[key,value]of original){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key)}}}
}
test('unchanged global shortcut waits for native Monaco chord consumption',async()=>{const f=fixture();try{const event=f.key(true);assert.equal(event.preventedAtTarget,false,'native resolver must see Cmd+K first');await f.settle();assert.deepEqual(f.calls,[])}finally{f.dispose()}})
test('unconsumed native key falls back to global command without inactive native chord conflicts',async()=>{const f=fixture();try{const event=f.key(false);assert.equal(event.preventedAtTarget,false);assert.equal(event.preventedAfterBubble,true);await f.settle();assert.deepEqual(f.calls,['search'])}finally{f.dispose()}})
test('outside the editor the same global shortcut remains available',async()=>{const f=fixture();try{f.target.kind='none';const event=f.key(false);assert.equal(event.preventedAtTarget,true);await f.settle();assert.deepEqual(f.calls,['search'])}finally{f.dispose()}})

test('preview default copy delegates to manuscript owner instead of copying comment UI',async()=>{const f=fixture();try{f.target.kind='preview';const event=f.key(false,'c');assert.equal(event.preventedAtTarget,true);await f.settle();assert.deepEqual(f.calls,['copy'])}finally{f.dispose()}})
