import type {RootIdentity} from '../core/data-root'
import {RootRelocation,RootRelocationError,inspectRootRelocation,type RootRelocationPreview,type RootRelocationOutcome} from '../core/root-relocation'
import {DirectoryAuthority} from './directory-authority'
import {rootRelocationPreflight} from './root-relocation-preflight'
import type {RootRelocationState,RootRelocationNotice} from '../shared/root-relocation'
export interface RootRelocationControllerOptions{bootstrap:RootIdentity;mode:'lost'|'blocked';theme:'paper'|'ink';notice?:RootRelocationNotice;sourcePath?:string|null;assertStableLock():void;assertCold():void;assertOwner(nonce:string):void;chooseDirectory(nonce:string):Promise<string|null>;confirm(preview:Readonly<RootRelocationPreview>):Promise<boolean>;restart():Promise<void>;quit():Promise<void>}
export class RootRelocationControllerError extends Error{constructor(readonly code:string){super(code);this.name='RootRelocationControllerError'}}
const fail=(code:string):never=>{throw new RootRelocationControllerError(code)}
function syncAssert(assertion:()=>void,code:string){try{const value:unknown=assertion();if(value!==undefined){void Promise.resolve(value).catch(()=>{});fail(code)}}catch{fail(code)}}
function noticeFor(error:unknown):RootRelocationNotice{
 const code=error instanceof RootRelocationError||error instanceof RootRelocationControllerError?error.code:''
 if(['POINTER_INVALID','CONTROL_UNSAFE','BOOTSTRAP_CHANGED'].includes(code))return'pointer-invalid'
 if(code==='TARGET_NOT_ORIGINAL')return'target-not-original'
 if(['TARGET_INVALID','TARGET_CHANGED','NATIVE_DIRECTORY_INVALID'].includes(code))return'target-invalid'
 if(['OWNER_EXPIRED','ATTEMPT_EXPIRED','SOURCE_NOT_CLOSED','LOCK_REQUIRED'].includes(code))return'owner-expired'
 if(['CONFIRMATION_FAILED','INVALID_CONFIRMATION'].includes(code))return'confirmation-failed'
 if(code==='DURABILITY_UNCONFIRMED')return'write-unconfirmed'
 if(code.startsWith('JOURNAL_')||code.startsWith('REQUEST_')||code.startsWith('RECEIPT_')||code.startsWith('MIGRATION_')||code==='CONTROL_CHANGED')return'history-needs-recovery'
 return'operation-failed'
}
/** Only main receives paths. Renderer requests are enums bound to this window. */
export class RootRelocationController{
 private readonly authority=new DirectoryAuthority()
 private readonly core:RootRelocation
 private readonly recoverable:boolean
 private current:RootRelocationState
 private listeners=new Set<(state:RootRelocationState)=>void>()
 private owner:string|null=null
 private startFlight:Promise<void>|null=null
 private workFlight:Promise<void>|null=null
 private choiceFlight:Promise<void>|null=null
 private cancellation:Promise<void>|null=null
 private exitFlight:Promise<void>|null=null
 private ticket=0
 private preview:RootRelocationPreview|null=null
 private outcome:RootRelocationOutcome|null=null
 private exiting=false
 private leaving=false
 constructor(readonly options:RootRelocationControllerOptions){
  this.recoverable=options.mode==='lost'
  this.current={version:1,revision:0,phase:'checking',theme:options.theme,sourcePath:options.sourcePath??null,targetPath:null,notice:null,unreadResultCount:null,canChoose:false,canCancel:false,canRestart:false}
  this.core=new RootRelocation(options.bootstrap,{assertStableLock:()=>options.assertStableLock(),assertCold:()=>options.assertCold(),assertOwner:nonce=>options.assertOwner(nonce),confirm:async preview=>{
   const token=this.ticket,owner=this.owner!;this.guard(owner,token);this.publish({phase:'confirming',canChoose:false,canCancel:true})
   const accepted:unknown=await options.confirm(preview);this.guard(owner,token)
   if(accepted!==true&&accepted!==false)fail('INVALID_CONFIRMATION')
   if(accepted===true)this.publish({phase:'writing',canChoose:false,canCancel:true})
   return accepted===true
  }})
 }
 state():RootRelocationState{return{...this.current}}
 subscribe(listener:(state:RootRelocationState)=>void):()=>void{this.listeners.add(listener);try{listener(this.state())}catch{};return()=>this.listeners.delete(listener)}
 private publish(update:Partial<RootRelocationState>){this.current={...this.current,...update,revision:this.current.revision+1};for(const listener of this.listeners)try{listener(this.state())}catch{/* UI observers cannot change authority. */}}
 private host(owner?:string){syncAssert(()=>this.options.assertStableLock(),'LOCK_REQUIRED');syncAssert(()=>this.options.assertCold(),'SOURCE_NOT_CLOSED');if(owner!==undefined){if(this.owner!==owner)fail('OWNER_EXPIRED');syncAssert(()=>this.options.assertOwner(owner),'OWNER_EXPIRED')}}
 private guard(owner:string,ticket?:number){this.host(owner);if(this.exiting||this.leaving||ticket!==undefined&&ticket!==this.ticket)fail('OPERATION_CANCELLED')}
 start(owner:string):Promise<void>{
  if(this.startFlight)return this.startFlight
  if(this.owner&&this.owner!==owner)return Promise.reject(new RootRelocationControllerError('OWNER_EXPIRED'))
  this.owner=owner
  const work=Promise.resolve().then(async()=>{
   this.guard(owner)
   if(!this.recoverable){this.publish({phase:'blocked',notice:this.options.notice??'pointer-invalid',canChoose:false});return}
   try{const pointer=await this.core.inspectLost();this.guard(owner);this.publish({phase:'unavailable',sourcePath:pointer.root.path,notice:'root-unavailable',canChoose:true})}
   catch(error){this.publish({phase:'blocked',notice:noticeFor(error),canChoose:false,canCancel:false,canRestart:false})}
  }).finally(()=>{if(this.startFlight===work)this.startFlight=null})
  this.startFlight=work;return work
 }
 choose(owner:string):Promise<void>{
  if(this.choiceFlight){if(this.owner!==owner)return Promise.reject(new RootRelocationControllerError('OWNER_EXPIRED'));return this.choiceFlight}
  if(!this.recoverable||!this.current.canChoose||this.exiting)return Promise.reject(new RootRelocationControllerError('CANNOT_CHOOSE'))
  try{this.guard(owner)}catch(error){return Promise.reject(error)}
  const ticket=++this.ticket;this.preview=null;this.outcome=null
  const work=Promise.resolve().then(async()=>{
   this.guard(owner,ticket);const selected=await this.options.chooseDirectory(owner);this.guard(owner,ticket)
   if(selected===null){this.publish({phase:'cancelled',notice:null,canChoose:true,canCancel:false});return}
   if(typeof selected!=='string'||!selected.length)fail('NATIVE_DIRECTORY_INVALID')
   let proof:RootIdentity|undefined
   try{const grant=await this.authority.issue(selected,'data-root',owner);this.guard(owner,ticket);proof=await this.authority.consume(grant.id,'data-root',owner)}catch(error){this.guard(owner,ticket);if(error instanceof RootRelocationControllerError)throw error;fail('NATIVE_DIRECTORY_INVALID')}
   if(!proof)throw new RootRelocationControllerError('NATIVE_DIRECTORY_INVALID')
   this.guard(owner,ticket);this.preview=await this.core.prepare(owner,proof);this.guard(owner,ticket)
   this.publish({targetPath:proof.path,unreadResultCount:this.preview.unreadMigrationResults})
   try{
    const result=await this.core.commit(owner,this.preview.attemptId);this.guard(owner,ticket)
    // Fresh exact proof, not a cached receipt ID, is the cold-relaunch gate.
    const verified=await inspectRootRelocation(this.options.bootstrap,{assertStableLock:()=>this.options.assertStableLock(),assertCold:()=>this.options.assertCold()});this.guard(owner,ticket)
    if(!verified)return fail('DURABILITY_UNCONFIRMED')
    if(verified.receiptId!==result.receiptId||JSON.stringify(verified.pointer)!==JSON.stringify(result.pointer))fail('DURABILITY_UNCONFIRMED')
    verified.assertCurrent();this.outcome=structuredClone(result)
    this.publish({phase:'complete',notice:null,canChoose:false,canCancel:false,canRestart:true})
   }catch(error){
    if(error instanceof RootRelocationError&&error.code==='CONFIRMATION_REQUIRED'){this.publish({phase:'cancelled',notice:null,canChoose:true,canCancel:false});return}
    throw error
   }
  }).catch(error=>{
   if(ticket!==this.ticket){if(this.current.phase==='writing')this.publish({phase:'blocked',notice:'write-unconfirmed',canChoose:false,canCancel:false,canRestart:false});return}
   const notice=noticeFor(error),blocked=['write-unconfirmed','history-needs-recovery','owner-expired','pointer-invalid'].includes(notice??'')
   this.publish({phase:blocked?'blocked':'unavailable',notice,canChoose:!blocked,canCancel:false,canRestart:false})
   throw new RootRelocationControllerError('RELOCATION_NOT_COMPLETED')
  }).finally(async()=>{
   this.authority.revokeOwner(owner)
   if(this.preview)await this.core.cancel(owner,this.preview.attemptId).catch(()=>{})
   await this.core.flush();if(this.workFlight===work)this.workFlight=null
  })
  this.workFlight=work
  const result=work.then(async()=>{if(ticket===this.ticket&&this.current.phase==='complete'&&this.current.canRestart)await this.performExit(owner,'restart')}).finally(()=>{if(this.choiceFlight===result)this.choiceFlight=null})
  this.choiceFlight=result;this.publish({phase:'picking',notice:null,targetPath:null,canChoose:false,canCancel:true,canRestart:false});return result
 }
 cancel(owner:string):Promise<void>{
  if(this.owner!==owner)return Promise.reject(new RootRelocationControllerError('OWNER_EXPIRED'))
  if(this.cancellation)return this.cancellation
  ++this.ticket;this.authority.revokeOwner(owner)
  const work=Promise.resolve().then(async()=>{
   const physical=this.workFlight,coreCancel=this.preview?this.core.cancel(owner,this.preview.attemptId).catch(()=>{}):Promise.resolve()
   await Promise.allSettled([physical,coreCancel]);await this.core.flush()
   if(!['complete','blocked'].includes(this.current.phase))this.publish({phase:'cancelled',notice:null,canChoose:this.recoverable&&!this.exiting&&!this.leaving,canCancel:false,canRestart:false})
  }).finally(()=>{if(this.cancellation===work)this.cancellation=null})
  this.cancellation=work;this.publish({canChoose:false,canCancel:false,canRestart:false});return work
 }
 private performExit(owner:string,action:'restart'|'quit'):Promise<void>{
  if(this.exitFlight)return this.exitFlight
  if(this.exiting)return Promise.resolve()
  if(action==='quit'){this.leaving=true;++this.ticket;this.authority.revokeOwner(owner)}
  const work=Promise.resolve().then(async()=>{
   if(action==='restart'){
    this.guard(owner);if(!this.current.canRestart||!this.outcome)return fail('CANNOT_RESTART')
    const ticket=this.ticket,outcome=this.outcome
    try{
     // Neither completion publication nor a failed process handoff grants a
     // reusable restart capability. Re-read the complete receipt chain here.
     const proof=await inspectRootRelocation(this.options.bootstrap,{assertStableLock:()=>this.options.assertStableLock(),assertCold:()=>this.options.assertCold()});this.guard(owner,ticket)
     if(!proof)return fail('DURABILITY_UNCONFIRMED')
     if(proof.receiptId!==outcome.receiptId||JSON.stringify(proof.pointer)!==JSON.stringify(outcome.pointer))fail('DURABILITY_UNCONFIRMED')
     proof.assertCurrent()
     this.leaving=true;this.exiting=true;this.publish({canChoose:false,canCancel:false,canRestart:false})
     // Observers run synchronously. Seal again after their last notification,
     // with no asynchronous work before the trusted main restart closure.
     this.host(owner);if(ticket!==this.ticket)fail('DURABILITY_UNCONFIRMED');proof.assertCurrent()
    }catch{
     this.exiting=false;this.publish({phase:'blocked',notice:'write-unconfirmed',canChoose:false,canCancel:false,canRestart:false});fail('DURABILITY_UNCONFIRMED')
    }
   }else{await this.cancel(owner);await this.flush();this.host();this.leaving=true;this.exiting=true;this.publish({canChoose:false,canCancel:false,canRestart:false})}
   try{if(action==='restart')await this.options.restart();else await this.options.quit()}
   catch{this.exiting=false;this.publish({notice:'operation-failed',canRestart:action==='restart'&&this.current.phase==='complete'});fail('PROCESS_HANDOFF_FAILED')}
  }).finally(()=>{if(!this.exiting)this.leaving=false;if(this.exitFlight===work)this.exitFlight=null})
  this.exitFlight=work;return work
 }
 restart(owner:string):Promise<void>{if(this.owner!==owner)return Promise.reject(new RootRelocationControllerError('OWNER_EXPIRED'));if(!this.current.canRestart)return Promise.reject(new RootRelocationControllerError('CANNOT_RESTART'));return this.performExit(owner,'restart')}
 quit(owner:string):Promise<void>{if(this.owner!==owner)return Promise.reject(new RootRelocationControllerError('OWNER_EXPIRED'));return this.performExit(owner,'quit')}
 async flush():Promise<void>{await Promise.allSettled([this.startFlight,this.workFlight]);await this.core.flush()}
}
