import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {test} from "node:test"
import {transformSync} from "esbuild"
import {useTabsStore,type Tab} from "../../src/stores/tabs"
import {useChatStore} from "../../src/stores/chat"
import {registerSceneLeaveGuard,useSceneUiStore} from "../../src/stores/scene-ui"
import {DesktopNavigationHistory} from "../../src/lib/desktop/navigation-history"
import {ChatExecutionController} from "../../src/lib/chat-stream"
import {ChatSessionRepository,emptyChatSession,type ChatSessionEntry} from "../../src/lib/chat-session"
import {newChatChoices,restoreChatChoices,chatTaskOverrides} from "../../src/lib/desktop/chat-defaults"
import {defaultState} from "../../desktop/core/settings"
import {taskDefaultsSchema} from "../../desktop/shared/task-defaults"
import type {DesktopChatNavigation} from "../../src/lib/desktop/navigation-runtime"

// Independent review uses real Zustand stores, guard and repository plus the
// real hook body; only React lifecycle and HTTP delivery are controlled.
// It does not exercise native Electron navigation or browser event ordering.
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve}}
const tab=(id:string):Tab=>({id,type:"theme",novelId:"isolated",title:id})
function tabs(){const old=useTabsStore.getState();useTabsStore.setState({tabs:[tab("a"),tab("b"),tab("c")],activeTabId:"b",activationNonce:0,subTabs:{a:"preview"}});return()=>useTabsStore.setState(old)}
test("NAV49-01: a rejected local leave guard preserves authoritative tab, draft object and history cursor",async()=>{
 const restore=tabs(),drafts=useSceneUiStore.getState().drafts,reason=new Error("保留未批准草稿")
 const remove=registerSceneLeaveGuard("b",async()=>{throw reason})
 const history=new DesktopNavigationHistory({available:target=>useTabsStore.getState().tabs.some(tab=>tab.id===target.id),apply:(target,signal)=>useTabsStore.getState().activateTabForNavigation(target.id,signal)})
 history.record({kind:"tab",id:"a"});history.record({kind:"tab",id:"b"})
 try{await assert.rejects(history.go(-1),error=>error===reason);assert.equal(useTabsStore.getState().activeTabId,"b");assert.equal(useSceneUiStore.getState().drafts,drafts);assert.deepEqual(history.getSnapshot(),{canBack:true,canForward:false,pending:false})}finally{history.dispose();remove();restore()}
})
test("NAV49-02: cancelling a pending guard prevents its late commit and leaves subsequent navigation usable",async()=>{
 const restore=tabs(),gate=deferred<void>();let flushes=0
 const remove=registerSceneLeaveGuard("b",()=>{flushes++;return gate.promise})
 const history=new DesktopNavigationHistory({available:()=>true,apply:(target,signal)=>useTabsStore.getState().activateTabForNavigation(target.id,signal)})
 history.record({kind:"tab",id:"a"});history.record({kind:"tab",id:"b"})
 try{
  const old=history.go(-1);assert.equal(history.getSnapshot().pending,true);assert.equal(flushes,1)
  history.cancel();gate.resolve();assert.equal(await old,false);assert.equal(useTabsStore.getState().activeTabId,"b")
  remove();assert.equal(await history.go(-1),true);assert.equal(useTabsStore.getState().activeTabId,"a");assert.equal(useTabsStore.getState().subTabs.a,"preview")
 }finally{history.dispose();remove();restore()}
})
test("NAV49-03: a target closed and recreated with the same ID while flushing is not the captured target",async()=>{
 const restore=tabs(),gate=deferred<void>(),remove=registerSceneLeaveGuard("b",()=>gate.promise)
 try{const old=useTabsStore.getState().activateTabForNavigation("a",new AbortController().signal);useTabsStore.setState(state=>({tabs:[...state.tabs.filter(tab=>tab.id!=="a"),tab("a")]}));gate.resolve();assert.equal(await old,false);assert.equal(useTabsStore.getState().activeTabId,"b");assert.equal(useTabsStore.getState().activationNonce,0)}finally{remove();restore()}
})

const hookSource=transformSync(readFileSync(new URL("../../src/components/chat/use-agent-chat.ts",import.meta.url),"utf8"),{loader:"ts",format:"cjs"}).code
function hookFixture(entries:ChatSessionEntry[]=[]){
 const old=useChatStore.getState(),storage=new Map<string,string>()
 const repository=new ChatSessionRepository("review-author",{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value)},removeItem:key=>{storage.delete(key)}})
 for(const entry of entries)repository.save(entry)
 useChatStore.setState({accountId:"review-author",conversationId:"source-chat",draftId:"source-draft",draft:"未发送的本地输入",draftNovelId:"source-novel",queuedMessages:[{id:"source-queue",text:"待确认消息"}],queuePaused:false,recoveryStatus:"ready",modelChoice:{modelId:"explicit-source",effort:null},modelChoiceExplicit:true,mode:"standard",modeExplicit:true,isGenerating:false,creatingNovel:false,pendingRequest:null,pendingQuestion:null,pendingPlan:null,chatFocusNonce:0})
 const effects:Array<()=>void|(()=>void)>=[],values:Array<{value:unknown}>=[],errors:unknown[]=[],receipts:unknown[]=[]
 let adapter:DesktopChatNavigation|null=null
 const deps:Record<string,unknown>={
  react:{useState(initial:unknown){const state={value:typeof initial==="function"?(initial as ()=>unknown)():initial};values.push(state);return[state.value,(next:unknown)=>{state.value=typeof next==="function"?(next as (current:unknown)=>unknown)(state.value):next}]},useCallback:(fn:unknown)=>fn,useEffect:(effect:()=>void|(()=>void))=>effects.push(effect),useRef:(current:unknown)=>({current})},
  "@tanstack/react-query":{useQueryClient:()=>({invalidateQueries(){},clear(){}})},
  "@/stores/chat":{useChatStore},"@/stores/desktop":{useDesktopStore:{getState:()=>({bootstrap:{settings:defaultState.settings}})}},
  "@desktop/core/settings":{defaultState},"@desktop/shared/task-defaults":{taskDefaultsSchema},"@/lib/desktop/chat-defaults":{newChatChoices,restoreChatChoices,chatTaskOverrides},
  "@/lib/chat-session":{ChatSessionRepository:function(){return repository},browserSessionStorage:()=>null},"@/lib/chat-stream":{ChatExecutionController},
  "@/lib/chat-parts":{parseChatParts:()=>[]},"./scene-receipts":{applySceneCommitReceipt:(value:unknown)=>receipts.push(value)},
  "@/lib/desktop/navigation-runtime":{registerDesktopChatNavigation:(value:DesktopChatNavigation)=>{adapter=value;return()=>{if(adapter===value)adapter=null}}},
  sonner:{toast:{error:(value:unknown)=>errors.push(value)}},
 }
 const module={exports:{} as {useAgentChat(userId:string):{loadConversation(id:string,options?:{signal?:AbortSignal;preserveOnFailure?:boolean}):Promise<boolean>}}}
 new Function("module","exports","require",hookSource)(module,module.exports,(name:string)=>deps[name]??{})
 const hook=module.exports.useAgentChat("review-author")
 const effect=effects.find(fn=>fn.toString().includes("registerDesktopChatNavigation"))!;assert(effect)
 const cleanup=effect();assert(adapter)
 return {hook,adapter:adapter as DesktopChatNavigation,repository,errors,receipts,values,state:()=>useChatStore.getState(),dispose(){if(typeof cleanup==="function")cleanup();useChatStore.setState(old)}}
}
function detail(id:string){return{conversation:{id,novelId:"target-novel",modelId:"target-model"},messages:[{id:"message",role:"USER",content:"服务端已保存的历史",createdAt:"2026-10-07T00:00:00Z"}]}}
async function withFetch(run:()=>Promise<void>){const before=globalThis.fetch;try{await run()}finally{globalThis.fetch=before}}
test("NAV49-04: aborted late JSON never commits its messages, staged receipt or focus over a new owner",async()=>withFetch(async()=>{
 const gate=deferred<unknown>(),entered=deferred<void>(),f=hookFixture(),controller=new AbortController()
 globalThis.fetch=async()=>{const response=new Response("{}");response.json=()=>{entered.resolve();return gate.promise};return response}
 try{
  const old=f.hook.loadConversation("late-chat",{signal:controller.signal,preserveOnFailure:true});await entered.promise
  controller.abort();useChatStore.setState({conversationId:"new-owner",draftId:"new-draft",draft:"新页面内容",recoveryStatus:"restoring"})
  assert.equal(await old,false)
  const data=detail("late-chat");Object.assign(data.messages[0],{toolCalls:[{toolName:"commitStagedChanges",output:{receipt:"late"}}]});gate.resolve(data)
  for(let n=0;n<8;n++)await Promise.resolve()
  assert.equal(f.state().conversationId,"new-owner");assert.equal(f.state().draft,"新页面内容");assert.equal(f.state().recoveryStatus,"restoring")
  assert.equal(f.state().chatFocusNonce,0);assert.deepEqual(f.receipts,[]);assert.deepEqual(f.errors,[]);assert.deepEqual(f.values[2].value,[])
 }finally{f.dispose()}
}))
test("NAV49-05: draft restoration preserves local identity, pending request, explicit null model and paused queue without HTTP",async()=>withFetch(async()=>{
 const saved={...emptyChatSession(),draftId:"return-draft",draft:"尚未批准的内容",novelId:"draft-novel",pendingNovelTitle:"待创建作品",novelCreationRequestId:"stable-create",modelChoice:{modelId:null,effort:null},modelChoiceExplicit:true,mode:"plan" as const,modeExplicit:true,pendingRequest:{clientRequestId:"held-request",body:"固定请求草稿"},queuedMessages:[{id:"held-queue",text:"尚未发送"}],wasRunning:true}
 const f=hookFixture([saved]);let http=0;globalThis.fetch=async()=>{http++;throw Error("Unexpected request")}
 try{assert.equal(await f.adapter.navigate({kind:"draft",id:saved.draftId,accountId:"review-author"},new AbortController().signal),true);const state=f.state();assert.equal(state.draftId,saved.draftId);assert.equal(state.draft,saved.draft);assert.equal(state.pendingNovelTitle,saved.pendingNovelTitle);assert.equal(state.novelCreationRequestId,saved.novelCreationRequestId);assert.deepEqual(state.modelChoice,saved.modelChoice);assert.deepEqual(state.pendingRequest,saved.pendingRequest);assert.deepEqual(state.queuedMessages,saved.queuedMessages);assert.equal(state.mode,"plan");assert.equal(state.queuePaused,true);assert.equal(http,0)}finally{f.dispose()}
}))
test("NAV49-06: a confirmed missing conversation becomes unavailable while 401 preserves a potentially recoverable target",async()=>withFetch(async()=>{
 for(const status of [401,404]){
  const saved={...emptyChatSession(),conversationId:"deleted-chat",draftId:"deleted-draft"},f=hookFixture([saved])
  globalThis.fetch=async()=>new Response("{}",{status})
  const target={kind:"conversation",id:"deleted-chat",accountId:"review-author"} as const
  try{assert.equal(f.adapter.available(target),true);assert.equal(await f.adapter.navigate(target,new AbortController().signal),false);assert.equal(f.state().conversationId,"source-chat");assert.equal(f.state().draft,"未发送的本地输入");assert.equal(f.state().recoveryStatus,"ready");assert.equal(f.adapter.available(target),status!==404,"a confirmed 404 must not permanently block earlier available history entries")}finally{f.dispose()}
 }
}))
test("NAV49-07: older HTTP completion cannot release the latest owner's restoring state or send a focus request",async()=>withFetch(async()=>{
 const gate=deferred<Response>(),f=hookFixture();globalThis.fetch=async()=>gate.promise
 try{const old=f.hook.loadConversation("old-target",{preserveOnFailure:true});useChatStore.setState({accountId:"another-local-owner",conversationId:"other-chat",draftId:"other-draft",recoveryStatus:"restoring"});gate.resolve(new Response(JSON.stringify(detail("old-target"))));assert.equal(await old,false);assert.equal(f.state().accountId,"another-local-owner");assert.equal(f.state().recoveryStatus,"restoring");assert.equal(f.state().chatFocusNonce,0);assert.deepEqual(f.errors,[])}finally{f.dispose()}
}))
test("NAV49-08: after a missing history conversation fails, the next Back reaches an earlier saved draft without deleting local data",async()=>withFetch(async()=>{
 const draft={...emptyChatSession(),draftId:"earlier-draft",draft:"更早的未发送草稿"},missing={...emptyChatSession(),conversationId:"missing-history",draftId:"missing-draft",draft:"缺失会话仍保留的本地输入"},source={...emptyChatSession(),conversationId:"source-chat",draftId:"source-draft",draft:"未发送的本地输入"}
 const f=hookFixture([draft,missing,source]);let http=0
 globalThis.fetch=async()=>{http++;return new Response("{}",{status:404})}
 const history=new DesktopNavigationHistory({available:target=>target.kind!=="tab"&&f.adapter.available(target),apply:(target,signal)=>target.kind!=="tab"&&f.adapter.navigate(target,signal)})
 history.record({kind:"draft",id:draft.draftId,accountId:"review-author"});history.record({kind:"conversation",id:missing.conversationId!,accountId:"review-author"});history.record({kind:"conversation",id:"source-chat",accountId:"review-author"})
 try{
  assert.equal(await history.go(-1),false);assert.equal(f.state().conversationId,"source-chat")
  assert.equal(await history.go(-1),true,"the missing entry must not block the earlier still-available draft")
  assert.equal(f.state().draftId,draft.draftId);assert.equal(f.state().draft,draft.draft);assert.equal(http,1)
  assert.equal(f.repository.get(missing.conversationId!)?.draft,missing.draft,"skip retains the local recovery input")
 }finally{history.dispose();f.dispose()}
}))
test("NAV49-09: late ownerless 404 cannot mark its target missing; successful explicit reload clears an owned missing mark",async()=>withFetch(async()=>{
 const saved={...emptyChatSession(),conversationId:"reloadable-history",draftId:"reloadable-draft",draft:"仍可人工恢复的草稿"},f=hookFixture([saved]),gate=deferred<Response>()
 const target={kind:"conversation",id:saved.conversationId!,accountId:"review-author"} as const
 globalThis.fetch=async()=>gate.promise
 try{
  const late=f.hook.loadConversation(target.id,{preserveOnFailure:true})
  useChatStore.setState({conversationId:"new-owner",draftId:"new-owner-draft",recoveryStatus:"restoring"})
  gate.resolve(new Response("{}",{status:404}));assert.equal(await late,false)
  assert.equal(f.adapter.available(target),true,"an unowned error must not poison a valid saved target")
  assert.deepEqual(f.errors,[])
  useChatStore.setState({recoveryStatus:"ready"})
  globalThis.fetch=async()=>new Response("{}",{status:404})
  assert.equal(await f.hook.loadConversation(target.id,{preserveOnFailure:true}),false)
  assert.equal(f.adapter.available(target),false)
  assert.equal(f.repository.get(target.id)?.draft,saved.draft)
  globalThis.fetch=async()=>new Response(JSON.stringify(detail(target.id)))
  assert.equal(await f.hook.loadConversation(target.id,{preserveOnFailure:true}),true)
  assert.equal(f.adapter.available(target),true,"successful explicit reload permits navigation again")
  assert.equal(f.state().conversationId,target.id);assert.equal(f.state().draft,saved.draft)
  assert.equal(f.repository.get(target.id)?.draft,saved.draft)
 }finally{f.dispose()}
}))
