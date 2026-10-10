import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
import {defaultState} from '../../desktop/core/settings'
import {onboardingStartup} from '../../src/lib/desktop/onboarding-flow'
// Actual controller orchestration; controlled hooks/IPC do not certify DOM focus.
function rig(options:{request?:string;progress?:any;commit?:(payload:any,state:any)=>Promise<any>}={}){
 const bootstrap:any={revision:0,...structuredClone(defaultState),onboarding:options.progress??null},calls:any[]=[]
 let props:any={request:options.request??'auto',suspended:false,finalFocus:()=>null,onExit(){closed++}},closed=0,changed=false,cursor=0,surfaces:any[]=[]
 const hooks:any[]=[],effects:Array<()=>void>=[]
 const react={useState(initial:any){const n=cursor++,hook=hooks[n]??(hooks[n]={value:typeof initial==='function'?initial():initial});return[hook.value,(next:any)=>{hook.value=typeof next==='function'?next(hook.value):next;changed=true}]},useRef(initial:any){const n=cursor++;return(hooks[n]??(hooks[n]={value:{current:initial}})).value},useEffect(run:any,deps:any[]){const n=cursor++,hook=hooks[n]??(hooks[n]={});if(!hook.deps||deps.some((value,index)=>!Object.is(value,hook.deps[index]))){hook.deps=deps;effects.push(()=>{hook.cleanup?.();hook.cleanup=run()})}}}
 const module={exports:{} as any},content=(v:any):string=>Array.isArray(v)?v.map(content).join(''):v?.props?content(v.props.children):typeof v==='string'?v:''
 const primitives=(names:string[])=>Object.fromEntries(names.map(name=>[name,name]))
 new Function('module','exports','require',transformSync(readFileSync('src/components/desktop/OnboardingController.tsx','utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code)(module,module.exports,(name:string)=>{
  if(name==='react')return react
  if(name==='react/jsx-runtime')return{jsx:(type:any,props:any,key:any)=>({type,props,key}),jsxs:(type:any,props:any,key:any)=>({type,props,key}),Fragment:'Fragment'}
  if(name==='lucide-react')return new Proxy({},{get:(_t,key)=>String(key)})
  if(name==='@/components/ui/dialog')return primitives(['Dialog','DialogContent','DialogTitle','DialogDescription'])
  if(name==='@/components/ui/button')return primitives(['Button'])
  if(name==='./ProfileSettings')return primitives(['ProfileEditorDialog'])
  if(name==='./ModelConfigurationDialog')return primitives(['ModelConfigurationDialog'])
  if(name==='@/lib/desktop/onboarding-flow')return{onboardingStartup}
  if(name==='@/stores/desktop')return{useDesktopStore:(select:any)=>select({bootstrap}),createDesktopOnboardingCommit:(payload:any)=>{const captured=structuredClone(payload);return async()=>{calls.push(structuredClone(captured));return options.commit?options.commit(captured,bootstrap):{...bootstrap,onboarding:{version:1,completed:false,step:'profile',textModelId:null,imageModelId:null,receipt:null}}}}}
  throw Error(name)
 })
 function render(){for(let n=0;n<12;n++){changed=false;cursor=0;surfaces=[];const visit=(v:any)=>{if(Array.isArray(v)){v.forEach(visit);return}if(!v?.props)return;surfaces.push({...v,name:v.props['aria-label']??content(v.props.children)});if(v.props.ref)v.props.ref.current={focus(){}};visit(v.props.children)};visit(module.exports.OnboardingController(props));while(effects.length)effects.shift()!();if(!changed)return}throw Error('did not settle')}
 const find=(name:string)=>{render();const found=surfaces.find(s=>s.name===name&&['Button','button','input'].includes(s.type));assert.ok(found,name);return found}
 render()
 return{calls,bootstrap,find,closed:()=>closed,all(){render();return surfaces},click(name:string){const b=find(name);if(!b.props.disabled)b.props.onClick();render()},change(name:string){const b=find(name);if(!b.props.disabled)b.props.onChange();render()},setProps(next:any){props={...props,...next};render()},async settle(){for(let n=0;n<20;n++)await Promise.resolve();render()},finish(){hooks.forEach(h=>h.cleanup?.())}}
}
for(const afterRename of [false,true])test(`ONB-02b: theme failure (${afterRename?'after':'before'} replace) blocks advance and retries frozen identity`,async()=>{
 let fail=true
 const ui=rig({commit:async(payload,state)=>{if(payload.type==='theme'){if(afterRename)state.settings.appearance.theme=payload.theme;if(fail)throw Error('未确认');return{...state,onboarding:{version:1,completed:false,step:'theme',textModelId:null,imageModelId:null,receipt:null}}}return{...state,onboarding:{version:1,completed:false,step:'profile',textModelId:null,imageModelId:null,receipt:null}}}})
 try{ui.change('玄墨');await ui.settle();assert.equal(ui.find('继续').props.disabled,true);ui.click('继续');assert.equal(ui.calls.length,1);fail=false;ui.click('重试主题保存');await ui.settle();assert.deepEqual(ui.calls[1],ui.calls[0]);assert.equal(ui.find('继续').props.disabled,false);ui.click('继续');await ui.settle();assert.ok(ui.all().some(s=>s.type==='ProfileEditorDialog'))}finally{ui.finish()}
})
test('ONB-06/08: short start failure stays entry, retry acknowledges before mounting text',async()=>{
 let fail=true
 const ui=rig({request:'models',progress:{version:1,completed:true,step:'welcome',textModelId:null,imageModelId:null,receipt:null},commit:async(_p,state)=>{if(fail)throw Error('未确认');return{...state,onboarding:{...state.onboarding,step:'text'}}}})
 try{await ui.settle();assert.equal(ui.all().some(s=>s.type==='ModelConfigurationDialog'),false);fail=false;ui.click('开始配置');await ui.settle();assert.deepEqual(ui.calls[1],ui.calls[0]);assert.ok(ui.all().some(s=>s.type==='ModelConfigurationDialog'))}finally{ui.finish()}
})
test('ONB-07/08: deleted confirmed model requires explicit selection instead of silent new draft',()=>{
 const id=crypto.randomUUID(),ui=rig({progress:{version:1,completed:false,step:'text',textModelId:id,imageModelId:null,receipt:null}})
 try{assert.equal(ui.all().some(s=>s.type==='ModelConfigurationDialog'),false);ui.click('重新选择或添加');assert.equal(ui.all().some(s=>s.type==='ModelConfigurationDialog'),true)}finally{ui.finish()}
})
for(const stage of ['profile','text','image'] as const)test(`ONB-08: ${stage} committed error freezes fields, retains exact retry and only acknowledged result advances`,async()=>{
 let fail=true
 const start={version:1,completed:false,step:stage,textModelId:null,imageModelId:null,receipt:null}
 const ui=rig({progress:start,commit:async(payload,state)=>{
  const target=stage==='profile'?'text':stage==='text'?'image-choice':'welcome'
  state.onboarding={...start,step:target,completed:stage==='image',receipt:{id:payload.operationId,type:payload.type}}
  if(stage!=='profile'){const id=payload.selection.creationId;state.onboarding[stage==='text'?'textModelId':'imageModelId']=id;state.models=[{...payload.selection.model,id,apiKey:undefined,keyMask:'••••'}]}
  if(fail)throw Error('同步未确认')
  return structuredClone(state)
 }})
 try{
  const first=ui.all().find(s=>s.type===(stage==='profile'?'ProfileEditorDialog':'ModelConfigurationDialog'))!
  const user={penName:'保留署名',email:'',avatarAssetId:null},draft={kind:stage==='text'?'TEXT':'IMAGE',name:'夹具',apiKey:'synthetic-only'}
  const submit=()=>stage==='profile'?first.props.onSubmit('avatar-session',user,'avatar-draft'):first.props.onboarding.onSubmit(draft)
  await assert.rejects(submit());await ui.settle()
  const pending=ui.all().find(s=>s.type===first.type)!
  assert.equal(stage==='profile'?pending.props.confirmationPending:pending.props.onboarding.confirmationPending,true)
  assert.equal(stage==='profile'?pending.props.blocked:pending.props.onboarding.blocked,false)
  if(stage!=='profile')pending.props.onboarding.onDraftChanged()
  fail=false
  if(stage==='profile')await pending.props.onRetry();else await pending.props.onboarding.onRetry()
  await ui.settle();assert.deepEqual(ui.calls[1],ui.calls[0]);assert.equal(ui.calls.length,2)
  assert.equal(ui.all().some(s=>s.type===first.type),false)
 }finally{ui.finish()}
})
