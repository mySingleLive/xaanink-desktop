import {AsyncLocalStorage} from 'node:async_hooks'
import {ContentError} from '../../src/lib/content-errors'
type Deferred=ReturnType<typeof Promise.withResolvers<void>>
interface PhaseState{active:Map<symbol,Deferred>;blocked?:Deferred}
interface Owner{id:string;token:symbol}
async function wait(promise:Promise<unknown>,signal?:AbortSignal):Promise<void>{
 signal?.throwIfAborted()
 if(!signal){await promise;return}
 const cancelled=Promise.withResolvers<never>()
 const abort=()=>cancelled.reject(signal.reason??new DOMException('Aborted','AbortError'))
 signal.addEventListener('abort',abort,{once:true})
 try{await Promise.race([promise,cancelled.promise]);signal.throwIfAborted()}finally{signal.removeEventListener('abort',abort)}
}
/** Short database operations only; provider/network work is never a phase. */
export class ConversationPhaseGate {
 private readonly states=new Map<string,PhaseState>()
 private readonly owner=new AsyncLocalStorage<Owner>()
 private state(id:string){if(!id)throw Error('Invalid conversation phase');let state=this.states.get(id);if(!state){state={active:new Map()};this.states.set(id,state)}return state}
 private collect(id:string,state:PhaseState){if(!state.blocked&&!state.active.size&&this.states.get(id)===state)this.states.delete(id)}
 async run<T>(id:string,operation:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted()
  for(;;){
   const state=this.state(id),current=this.owner.getStore()
   if(current?.id===id&&state.active.has(current.token))return operation()
   if(state.blocked){await wait(state.blocked.promise,signal);continue}
   const token=Symbol(id),done=Promise.withResolvers<void>();state.active.set(token,done)
   try{return await this.owner.run({id,token},operation)}finally{state.active.delete(token);done.resolve();this.collect(id,state)}
  }
 }
 async transfer<T>(id:string,operation:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted()
  const state=this.state(id)
  if(state.blocked)throw new ContentError('CONVERSATION_TRANSFER_BUSY','会话正在转移，请稍后重试')
  const blocked=Promise.withResolvers<void>();state.blocked=blocked
  const current=this.owner.getStore(),owner=current?.id===id?current.token:undefined
  const token=owner&&state.active.has(owner)?owner:Symbol(id)
  const added=token!==owner
  if(added)state.active.set(token,Promise.withResolvers<void>())
  try{
   await wait(Promise.all([...state.active].filter(([key])=>key!==token).map(([,entry])=>entry.promise)),signal)
   signal?.throwIfAborted()
   return await this.owner.run({id,token},operation)
  }finally{
   if(added){state.active.get(token)?.resolve();state.active.delete(token)}
   if(state.blocked===blocked){state.blocked=undefined;blocked.resolve()}
   this.collect(id,state)
  }
 }
}
