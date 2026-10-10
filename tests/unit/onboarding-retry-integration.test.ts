import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {transformSync} from 'esbuild'
import {ModelRepository} from '../../desktop/main/model-repository'
import {defaultState,settingsSchema,parseContextWindow} from '../../desktop/core/settings'
import {presetsFor} from '../../desktop/shared/model-catalog'
import {modelChoices,excludedBuiltinModel} from '../../desktop/shared/builtin-model-catalog'
import {onboardingStartup} from '../../src/lib/desktop/onboarding-flow'
import * as store from '../../src/stores/desktop'
import type {OnboardingAction} from '../../desktop/shared/onboarding'

// Real editor + Controller + store queue + real-file repository. Controlled
// hooks/primitives deliberately do not claim native DOM/focus verification.
function screen(){
 const contexts=new Map<string,any>(),effects:Array<()=>void>=[],modules=new Map<string,any>()
 let current:any,changed=false,surfaces:any[]=[]
 const react={useState(initial:any){const n=current.cursor++,h=current.hooks[n]??(current.hooks[n]={value:typeof initial==='function'?initial():initial});return[h.value,(next:any)=>{h.value=typeof next==='function'?next(h.value):next;changed=true}]},useRef(initial:any){const n=current.cursor++;return(current.hooks[n]??(current.hooks[n]={value:{current:initial}})).value},useEffect(run:any,deps:any[]){const n=current.cursor++,h=current.hooks[n]??(current.hooks[n]={});if(!h.deps||deps.some((v,i)=>!Object.is(v,h.deps[i]))){h.deps=deps;effects.push(()=>{h.cleanup?.();h.cleanup=run()})}}}
 const primitives=(names:string[])=>Object.fromEntries(names.map(name=>[name,name]))
 function load(file:string){
  if(modules.has(file))return modules.get(file)
  const module={exports:{} as any};modules.set(file,module.exports)
  new Function('module','exports','require',transformSync(readFileSync(`src/components/desktop/${file}.tsx`,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code)(module,module.exports,(name:string)=>{
   if(name==='react')return react
   if(name==='react/jsx-runtime')return{jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key}),Fragment:'Fragment'}
   if(name==='lucide-react')return new Proxy({},{get:(_t,key)=>String(key)})
   if(name==='@/components/ui/dialog')return primitives(['Dialog','DialogContent','DialogTitle','DialogDescription'])
   if(name==='@/components/ui/button')return primitives(['Button'])
   if(name==='@/components/ui/input')return primitives(['Input'])
   if(name==='./ModelChoiceSelect')return primitives(['ModelChoiceSelect'])
   if(name==='@desktop/core/settings')return{settingsSchema,parseContextWindow}
   if(name==='@desktop/shared/model-catalog')return{presetsFor}
   if(name==='@desktop/shared/builtin-model-catalog')return{modelChoices,excludedBuiltinModel}
   if(name==='@/lib/desktop/onboarding-flow')return{onboardingStartup}
   if(name==='@/stores/desktop')return{...store,useDesktopStore:(select:any)=>select(store.useDesktopStore.getState())}
   if(name==='./ModelConfigurationDialog')return load('ModelConfigurationDialog')
   if(name==='./ProfileSettings')return primitives(['ProfileEditorDialog'])
   throw Error(`Unexpected integration dependency: ${name}`)
  });return module.exports
 }
 const Controller=load('OnboardingController').OnboardingController
 const content=(v:any):string=>Array.isArray(v)?v.map(content).join(''):v?.props?content(v.props.children):typeof v==='string'?v:''
 function render(){for(let n=0;n<16;n++){
  changed=false;surfaces=[];const visited=new Set<string>()
  function component(type:any,props:any,path:string,disabled=false){const before=current;current=contexts.get(path)??{hooks:[],cursor:0};contexts.set(path,current);visited.add(path);current.cursor=0;const value=type(props);current=before;visit(value,path,disabled)}
  function visit(value:any,path:string,disabled=false){if(Array.isArray(value)){value.forEach((v,i)=>visit(v,`${path}/${i}`,disabled));return}if(!value?.props)return;if(typeof value.type==='function'){component(value.type,value.props,`${path}/${value.type.name}:${value.key??''}`,disabled);return}if(value.type==='Dialog'&&!value.props.open)return;const own=disabled||!!value.props.disabled;surfaces.push({...value,disabled:own,name:value.props['aria-label']??value.props.label??content(value.props.children)});if(value.props.ref)value.props.ref.current={focus(){}};visit(value.props.children,path,own)}
  component(Controller,{request:'auto',suspended:false,onExit(){},finalFocus:()=>null},'root')
  for(const [path,ctx]of contexts)if(!visited.has(path)){ctx.hooks.forEach((h:any)=>h.cleanup?.());contexts.delete(path)}
  while(effects.length)effects.shift()!();if(!changed)return
 }throw Error('Integration render did not settle')}
 function find(name:string){render();const item=surfaces.find(s=>['Button','Input','select','ModelChoiceSelect','button'].includes(s.type)&&s.name===name);assert.ok(item,name);return item}
 render();return{find,fill(name:string,value:string){const s=find(name);assert.equal(s.disabled,false);s.props.onChange(s.type==='ModelChoiceSelect'?value:{target:{value}});render()},click(name:string){const s=find(name);assert.equal(s.disabled,false);s.props.onClick();render()},has(type:string,name:string){render();return surfaces.some(s=>s.type===type&&s.name===name)},alerts(){render();return surfaces.filter(s=>s.props.role==='alert').map(s=>s.name)},finish(){contexts.forEach(ctx=>ctx.hooks.forEach((h:any)=>h.cleanup?.()))}}
}
for(const kind of ['TEXT','IMAGE']as const)test(`ONB-08 real ${kind} editor retries post-rename creation through Controller/store/repo without duplicate validation`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'xaanink-onboarding-integration-')),previous=Object.getOwnPropertyDescriptor(globalThis,'window'),old=store.useDesktopStore.getState()
 let fail=false,encrypted=0
 const repo=new ModelRepository(join(root,'state.json'),{isEncryptionAvailable:()=>true,encryptString(value){encrypted++;return Buffer.from(value.split('').reverse().join(''))},decryptString:value=>value.toString().split('').reverse().join('')},{replace(){},remove(){}},{beforeDirectorySync:async()=>{if(fail)throw Error('synthetic durability failure')}})
 const sessionId=crypto.randomUUID(),calls:OnboardingAction[]=[]
 const apply=async(body:any)=>repo.commitOnboarding({...body,flow:'full',sessionId,operationId:crypto.randomUUID(),revision:(await repo.read()).revision},()=>{})
 let ui:ReturnType<typeof screen>|undefined
 try{
  await apply({type:'next-theme'});await apply({type:'profile',user:defaultState.settings.user,avatarSessionId:crypto.randomUUID()})
  if(kind==='IMAGE'){await apply({type:'model',selection:{type:'draft',model:{name:'已确认TEXT',kind:'TEXT',provider:'custom',protocol:'openai',endpoint:'https://fixture.invalid/v1',modelId:'fixture-text',enabled:true,contextWindow:0,thinkingLevels:[],defaultThinking:'default',apiKey:'synthetic-text'},creationId:crypto.randomUUID()}});await apply({type:'image-choice',choice:'configure'})}
  const bootstrap=async()=>({...await repo.read(),draftSessionId:sessionId,platform:'win32' as const,systemDark:false,version:'fixture',dataRoot:root})
  Object.defineProperty(globalThis,'window',{configurable:true,value:{desktop:{bootstrap,onboarding:async(action:OnboardingAction)=>{calls.push(structuredClone(action));return repo.commitOnboarding(action,()=>{})},cancelModelConfiguration:async()=>{}}}})
  store.useDesktopStore.setState({bootstrap:await bootstrap(),saving:0,error:null});ui=screen()
  ui.fill('供应商','custom');ui.fill('协议','openai');ui.fill('供应商名称','专项夹具');ui.fill('展示名称',`${kind}新增`);ui.fill('Base URL','https://fixture.invalid/v1');ui.fill('模型 ID',`${kind.toLowerCase()}-new`);ui.fill('API Key','synthetic-integration-secret')
  const initialEncryption=encrypted;fail=true;ui.click('继续')
  async function wait(predicate:()=>boolean){for(let n=0;n<150;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10))}throw Error(`Integration condition timed out: calls=${calls.length}, alerts=${ui!.alerts().join(';')}`)}
  await wait(()=>store.useDesktopStore.getState().saving===0&&!!store.useDesktopStore.getState().error)
  assert.equal(ui.find('展示名称').disabled,true);assert.equal(ui.find('继续').disabled,false);assert.equal(calls.length,1);assert.equal((await repo.read()).models.filter(m=>m.kind===kind).length,1);assert.equal(encrypted-initialEncryption,1)
  fail=false;ui.click('继续');await wait(()=>store.useDesktopStore.getState().saving===0&&calls.length===2)
  assert.deepEqual(calls[1],calls[0]);assert.equal(encrypted-initialEncryption,1);assert.equal((await repo.read()).models.filter(m=>m.kind===kind).length,1)
  assert.equal(ui.has('DialogTitle',kind==='TEXT'?'要配置文生图模型吗？':'欢迎使用'),true);await store.flushDesktopSettings()
 }finally{ui?.finish();if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');store.useDesktopStore.setState(old);await rm(root,{recursive:true,force:true})}
})
