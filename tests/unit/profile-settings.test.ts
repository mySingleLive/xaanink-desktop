import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { createHash } from "node:crypto"
import { transformSync } from "esbuild"
import { defaultState, settingsSchema, type Settings } from "../../desktop/core/settings"

// Run the actual profile component with controlled IPC and hooks. These tests
// do not implement Base UI's focus trap or a native file chooser/decoder.
type Props=Record<string,unknown>
interface Element {type:string|((props:Props)=>unknown);props:Props}
interface Hook {value?:unknown;deps?:unknown[];cleanup?:void|(()=>void)}
interface Surface {element:Element;name:string;disabled:boolean;focus():void}
type Avatar={draftId:string;previewDataUrl:string;width:number;height:number;bytes:number}
const committedAvatar="00000000-0000-4000-8000-000000000099"
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function content(value:unknown):string{if(Array.isArray(value))return value.map(content).join("");if(value&&typeof value==="object"&&"props"in value)return content((value as Element).props.children);return typeof value==="string"||typeof value==="number"?String(value):""}
function profile(options:{choose?:(session:string)=>Promise<Avatar|null>;save?:(session:string,user:Settings["user"],avatar?:string)=>Promise<unknown>}={}){
  const state={settings:structuredClone(defaultState.settings)},writes:Array<{session:string;user:Settings["user"];avatar?:string}>=[],legacyWrites:unknown[]=[],choices:string[]=[],canceled:string[]=[]
  state.settings.user={penName:"原作者",email:"before@example.test",avatarAssetId:null}
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,"window")
  Object.defineProperty(globalThis,"window",{configurable:true,writable:true,value:{desktop:{async chooseAvatar(session:string){choices.push(session);return await options.choose?.(session)??null},async cancelAvatar(session:string){canceled.push(session)}}}})
  const hooks:Hook[]=[],effects:Array<()=>void>=[];let cursor=0,changed=false,mounted=true,surfaces:Surface[]=[]
  const react={
    useState(initial:unknown){const n=cursor++,hook=hooks[n]??(hooks[n]={value:typeof initial==="function"?initial():initial});return [hook.value,(next:unknown)=>{const value=typeof next==="function"?next(hook.value):next;if(!Object.is(value,hook.value)){hook.value=value;changed=true}}]},
    useRef(initial:unknown){const n=cursor++;return (hooks[n]??(hooks[n]={value:{current:initial}})).value},
    useEffect(callback:()=>void|(()=>void),deps:unknown[]){const n=cursor++,hook=hooks[n]??(hooks[n]={});if(!hook.deps||deps.length!==hook.deps.length||deps.some((value,index)=>!Object.is(value,hook.deps![index]))){hook.deps=deps;effects.push(()=>{hook.cleanup?.();hook.cleanup=callback()})}},
  }
  const module={exports:{} as {ProfileSettings:()=>unknown}},primitives=(names:string[])=>Object.fromEntries(names.map(name=>[name,name]))
  new Function("module","exports","require",transformSync(readFileSync(new URL("../../src/components/desktop/ProfileSettings.tsx",import.meta.url),"utf8"),{loader:"tsx",format:"cjs",jsx:"automatic"}).code)(module,module.exports,(name:string)=>{
    if(name==="react")return react
    if(name==="react/jsx-runtime")return {jsx:(type:Element["type"],props:Props)=>({type,props}),jsxs:(type:Element["type"],props:Props)=>({type,props}),Fragment:"Fragment"}
    if(name==="lucide-react")return new Proxy({},{get:(_target,key)=>String(key)})
    if(name==="sonner")return {toast:{error(){}}}
    if(name==="@/components/ui/dialog")return primitives(["Dialog","DialogContent","DialogTitle","DialogDescription"])
    if(name==="@/components/ui/button")return primitives(["Button"])
    if(name==="@/components/ui/input")return primitives(["Input"])
    if(name==="@desktop/core/settings")return {settingsSchema}
    if(name==="@/stores/desktop")return {
      useDesktopStore:(select:(state:unknown)=>unknown)=>select({bootstrap:state}),
      async updateDesktopSettings(update:(before:Settings)=>Settings){const next=update(structuredClone(state.settings));legacyWrites.push(next);state.settings=next},
      async saveDesktopProfile(session:string,user:Settings["user"],avatar?:string){const copy=structuredClone(user);writes.push({session,user:copy,avatar});await options.save?.(session,copy,avatar);state.settings.user={...copy,avatarAssetId:avatar?committedAvatar:copy.avatarAssetId}},
    }
    throw new Error(`Unexpected profile dependency: ${name}`)
  })
  function render(){
    if(!mounted){surfaces=[];return}
    for(let n=0;n<12;n++){
      changed=false;cursor=0;surfaces=[]
      function visit(value:unknown,disabled=false){if(Array.isArray(value)){value.forEach(child=>visit(child,disabled));return}if(!value||typeof value!=="object"||!("props"in value))return;const element=value as Element;if(typeof element.type==="function"){visit(element.type(element.props),disabled);return}if(element.type==="Dialog"&&!element.props.open)return;const ownDisabled=disabled||!!element.props.disabled,surface:Surface={element,name:String(element.props["aria-label"]??content(element.props.children)),disabled:ownDisabled,focus(){}};surfaces.push(surface);const ref=element.props.ref as {current?:unknown}|((surface:Surface)=>void)|undefined;if(typeof ref==="function")ref(surface);else if(ref)ref.current=surface;visit(element.props.children,ownDisabled)}
      visit(module.exports.ProfileSettings());while(effects.length)effects.shift()!();if(!changed)return
    }
    throw new Error("Profile component did not settle")
  }
  function controls(){render();return surfaces.filter(surface=>["Button","button","Input"].includes(String(surface.element.type)))}
  function find(name:string){const control=controls().find(surface=>surface.name===name);assert.ok(control,`Visible profile control: ${name}`);return control}
  function call(surface:Surface,handler:string,event?:unknown){if(surface.disabled)return;const action=surface.element.props[handler] as ((event:unknown)=>unknown)|undefined;assert.ok(action,`${surface.name} supports ${handler}`);void action(event);render()}
  function unmount(){mounted=false;for(const hook of hooks)hook.cleanup?.();surfaces=[]}
  render()
  return {state,writes,legacyWrites,choices,canceled,find,all:()=>{render();return surfaces},click:(name:string)=>call(find(name),"onClick"),fill:(name:string,value:string)=>call(find(name),"onChange",{target:{value}}),avatar(){const control=controls().find(surface=>/选择头像|更换头像|编辑头像/.test(surface.name));assert.ok(control,"The profile avatar opens the system file picker through an accessible button");call(control,"onClick")},dismiss(){render();const dialog=surfaces.find(surface=>surface.element.type==="Dialog"&&surface.element.props.open);assert.ok(dialog);call(dialog,"onOpenChange",false)},async settle(){for(let n=0;n<8;n++)await Promise.resolve();render()},unmount,finish(){unmount();if(oldWindow)Object.defineProperty(globalThis,"window",oldWindow);else Reflect.deleteProperty(globalThis,"window")}}
}
const avatar=(id:string):Avatar=>({draftId:`00000000-0000-4000-8000-${createHash("sha256").update(id).digest("hex").slice(0,12)}`,previewDataUrl:`data:image/png;base64,${Buffer.from(id).toString("base64")}`,width:64,height:64,bytes:120})

test("profile: text edits are local drafts and saving uses one dedicated profile transaction",async()=>{
  const ui=profile()
  try{
    ui.click("编辑用户");ui.fill("笔名","新作者");ui.fill("邮件","after@example.test")
    assert.equal(ui.state.settings.user.penName,"原作者");assert.equal(ui.writes.length,0)
    ui.click("取消");ui.click("编辑用户");assert.equal(ui.find("笔名").element.props.value,"原作者")
    ui.fill("笔名","新作者");ui.fill("邮件","after@example.test");ui.click("保存");await ui.settle()
    assert.equal(ui.writes.length,1,"Save must use the profile/avatar atomic transaction rather than an unrelated settings update")
    assert.equal(ui.legacyWrites.length,0);assert.ok(ui.writes[0].session);assert.equal(ui.writes[0].user.penName,"新作者");assert.equal(ui.writes[0].user.email,"after@example.test")
    assert.equal(ui.state.settings.user.penName,"新作者");assert.ok(ui.all().some(surface=>surface.element.props.className==="desktop-user-card"&&surface.name.includes("新作者")))
  }finally{ui.finish()}
})

test("profile: avatar selection is a preview draft; failed save retains text and avatar for retry",async()=>{
  let fail=true;const selected=avatar("avatar-one"),ui=profile({choose:async()=>selected,save:async()=>{if(fail)throw new Error("资料保存失败")}})
  try{
    ui.click("编辑用户");ui.fill("笔名","待保存作者");ui.avatar();await ui.settle()
    assert.equal(ui.choices.length,1);assert.equal(ui.state.settings.user.avatarAssetId,null);assert.equal(ui.writes.length,0)
    assert.ok(ui.all().some(surface=>surface.element.type==="img"&&surface.element.props.src===selected.previewDataUrl))
    ui.click("保存");await ui.settle();assert.equal(ui.find("笔名").element.props.value,"待保存作者")
    assert.ok(ui.all().some(surface=>surface.element.props.role==="alert"&&surface.name.includes("资料保存失败")))
    assert.equal(ui.state.settings.user.penName,"原作者");assert.equal(ui.writes[0].avatar,selected.draftId);assert.equal(ui.writes[0].session,ui.choices[0])
    fail=false;ui.click("保存");await ui.settle();assert.equal(ui.writes.length,2);assert.equal(ui.state.settings.user.avatarAssetId,committedAvatar)
  }finally{ui.finish()}
})

test("profile: cancel, X, dialog dismiss and unmount cancel avatar sessions and isolate late file replies",async()=>{
  for(const reason of ["cancel","X","dismiss","unmount"]){
    const pending=deferred<Avatar|null>(),ui=profile({choose:()=>pending.promise})
    try{
      ui.click("编辑用户");ui.fill("笔名","丢弃草稿");ui.avatar();const session=ui.choices[0];assert.ok(session)
      if(reason==="cancel")ui.click("取消")
      else if(reason==="X"){const x=ui.all().find(surface=>["Button","button"].includes(String(surface.element.type))&&/关闭.*用户|用户.*关闭/.test(surface.name));assert.ok(x,"Approved profile X dismiss action is accessible");ui.click(x.name)}
      else if(reason==="dismiss")ui.dismiss();else ui.unmount()
      assert.ok(ui.canceled.includes(session),reason)
      pending.resolve(avatar("late-avatar"));await ui.settle();assert.equal(ui.state.settings.user.penName,"原作者");assert.equal(ui.writes.length,0)
      if(reason!=="unmount"){ui.click("编辑用户");assert.equal(ui.find("笔名").element.props.value,"原作者");assert.ok(!ui.all().some(surface=>surface.element.type==="img"&&surface.element.props.src===avatar("late-avatar").previewDataUrl))}
    }finally{ui.finish()}
  }
})

test("profile: later selection wins even when an earlier file result arrives last",async()=>{
  const first=deferred<Avatar|null>(),second=deferred<Avatar|null>();let n=0
  const ui=profile({choose:()=>n++===0?first.promise:second.promise})
  try{
    ui.click("编辑用户");ui.avatar();ui.avatar();assert.equal(ui.choices.length,2)
    second.resolve(avatar("second-avatar"));await ui.settle();first.resolve(avatar("first-avatar"));await ui.settle()
    assert.ok(ui.all().some(surface=>surface.element.type==="img"&&surface.element.props.src===avatar("second-avatar").previewDataUrl))
    assert.ok(!ui.all().some(surface=>surface.element.type==="img"&&surface.element.props.src===avatar("first-avatar").previewDataUrl))
    ui.click("保存");await ui.settle();assert.equal(ui.writes[0].avatar,avatar("second-avatar").draftId)
  }finally{ui.finish()}
})

test("profile: an in-flight save freezes its copied draft, prevents repeats and commits once",async()=>{
  const saved=deferred<void>(),ui=profile({save:()=>saved.promise})
  try{
    ui.click("编辑用户");ui.fill("笔名","一次保存");ui.click("保存")
    assert.equal(ui.writes.length,1);assert.equal(ui.find("笔名").disabled,true);assert.equal(ui.find("邮件").disabled,true)
    const saving=ui.all().find(surface=>["Button","button"].includes(String(surface.element.type))&&/保存/.test(surface.name));assert.ok(saving);assert.equal(saving.disabled,true)
    ui.click(saving.name);assert.equal(ui.writes.length,1);assert.equal(ui.find("取消").disabled,true)
    assert.equal(ui.state.settings.user.penName,"原作者");saved.resolve();await ui.settle();assert.equal(ui.state.settings.user.penName,"一次保存");assert.equal(ui.writes.length,1)
  }finally{ui.finish()}
})

test("profile: actual user schema rejects invalid names and emails without writing and trims a valid save",async()=>{
  const ui=profile()
  try{
    ui.click("编辑用户")
    for(const [name,email] of [["  ",""],["作者","invalid-email"],["字".repeat(81),""]]){
      ui.fill("笔名",name);ui.fill("邮件",email);ui.click("保存");await ui.settle()
      assert.equal(ui.writes.length,0);assert.ok(ui.all().some(surface=>surface.element.props.role==="alert"))
    }
    ui.fill("笔名","  修正作者  ");ui.fill("邮件","");ui.click("保存");await ui.settle()
    assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].user.penName,"修正作者");assert.equal(ui.writes[0].user.email,"")
  }finally{ui.finish()}
})

test("profile: picker cancellation and failed replacement retain the displayed valid avatar draft",async()=>{
  const first=avatar("valid-avatar");let attempt=0
  const ui=profile({choose:async()=>{if(attempt++===0)return first;if(attempt===2)return null;throw new Error("请选择有效的PNG、JPEG或WebP图片")}})
  try{
    ui.click("编辑用户");ui.avatar();await ui.settle();ui.avatar();await ui.settle();ui.avatar();await ui.settle()
    assert.ok(ui.all().some(surface=>surface.element.type==="img"&&surface.element.props.src===first.previewDataUrl))
    assert.ok(ui.all().some(surface=>surface.element.props.role==="alert"&&surface.name.includes("有效的")))
    ui.click("保存");await ui.settle();assert.equal(ui.writes[0].avatar,first.draftId)
  }finally{ui.finish()}
})

test("profile: a late result from a closed session cannot replace the newly opened session's avatar or text",async()=>{
  const old=deferred<Avatar|null>();let n=0
  const ui=profile({choose:async()=>n++===0?old.promise:avatar("new-session")})
  try{
    ui.click("编辑用户");ui.avatar();ui.click("取消");ui.click("编辑用户");ui.fill("笔名","新会话作者");ui.avatar();await ui.settle()
    assert.notEqual(ui.choices[0],ui.choices[1]);old.resolve(avatar("old-session"));await ui.settle()
    assert.equal(ui.find("笔名").element.props.value,"新会话作者")
    assert.ok(ui.all().some(surface=>surface.element.type==="img"&&surface.element.props.src===avatar("new-session").previewDataUrl))
    ui.click("保存");await ui.settle();assert.equal(ui.writes[0].session,ui.choices[1]);assert.equal(ui.writes[0].avatar,avatar("new-session").draftId)
  }finally{old.resolve(null);ui.finish()}
})
