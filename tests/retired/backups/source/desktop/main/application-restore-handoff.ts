import {join} from 'node:path'
import type {RootIdentity} from '../core/data-root'
import {directoryIdentity} from '../core/root-ownership'
import {assertRootAuthorityHost,readRootAuthority} from '../core/root-authority'
import {ApplicationRestoreRequests} from './application-restore-request'
import {createNativeApplicationRestoreLayout,bindApplicationRestoreLayout,inspectApplicationRestoreLayouts,flushApplicationRestoreLayouts,captureApplicationRestoreProtectedDirectories,type NativeApplicationRestoreLayoutHandle} from './application-restore-layout'
import {inspectApplicationRestoreProtection} from './application-restore-preflight'
import type {ApplicationRestoreRequest} from '../shared/application-restore-request'
import {applicationRestoreHandoffCommandSchema,type ApplicationRestoreHandoffCommand,type ApplicationRestoreHandoffState} from '../shared/application-restore-handoff'

export interface ApplicationRestoreHandoffOptions {
 bootstrap:RootIdentity;root:string;ownerNonce:string
 assertStableLock():void;assertOwner():void;assertClosed():void
 pauseSelection():Promise<void>;releaseSelection():Promise<void>
 chooseParent():Promise<string|null>;protectedDirectories():Promise<readonly RootIdentity[]>
 confirm(request:Readonly<ApplicationRestoreRequest>):Promise<boolean>
 requestClose():Promise<boolean>;destroyAndFlush():Promise<void>;relaunchAndQuit():void
 closedHandoffPending?():boolean
 withWrite?<T>(run:()=>Promise<T>):Promise<T>
}
function fail(code:string):never{throw Object.assign(Error(code),{code})}
/** Normal UI may choose a semantic backup id. All paths, ownership and closing
 * authority originate in the main process; armed remains an intent only. */
export class ApplicationRestoreHandoff {
 readonly #options:ApplicationRestoreHandoffOptions
 readonly #requests:ApplicationRestoreRequests
 #layout:NativeApplicationRestoreLayoutHandle|undefined
 #directories:ReturnType<typeof captureApplicationRestoreProtectedDirectories>|undefined
 #request:ApplicationRestoreRequest|null=null
 #phase:ApplicationRestoreHandoffState['phase']='idle'
 #closingOwner=false
 #flight:Promise<ApplicationRestoreHandoffState>|null=null
 constructor(options:ApplicationRestoreHandoffOptions){
  this.#options=Object.freeze({...options,bootstrap:Object.freeze(structuredClone(options.bootstrap))})
  const o=this.#options
  this.#requests=new ApplicationRestoreRequests(o.bootstrap,{assertStableLock:()=>o.assertStableLock(),assertOwner:nonce=>{if(nonce!==o.ownerNonce)fail('OWNER_EXPIRED');this.owner()},assertQuiesced:()=>{this.closed();this.#directories?.assertCurrent()},assertOldProcessExited(){fail('COLD_ENTRY_REQUIRED')},assertCold(){fail('COLD_ENTRY_REQUIRED')},assertExecutionSettled(){fail('COLD_ENTRY_REQUIRED')},inspectPendingEvidence:()=>{const layout=inspectApplicationRestoreLayouts(o.bootstrap,{allowed:this.#layout}),protection=inspectApplicationRestoreProtection(o.bootstrap,()=>o.assertStableLock());return{operationIds:[...new Set([...layout.operationIds,...protection.operationIds])],unknown:layout.unknown||protection.unknown}},withWrite:o.withWrite})
 }
 get pending(){return this.#phase!=='idle'}
 get closing(){return this.#phase==='closing'||this.#phase==='armed'||this.#closingOwner}
 get inspection(){return this.#phase==='inspection'}
 state():ApplicationRestoreHandoffState{return{phase:this.#phase,operationId:this.#request?.operationId??null,backupId:this.#request?.backup.backupId??null,targetPath:this.#request?.parent.path??null}}
 private owner(){assertRootAuthorityHost(()=>this.#options.assertStableLock(),'LOCK_REQUIRED');assertRootAuthorityHost(this.#closingOwner?()=>this.#options.assertClosed():()=>this.#options.assertOwner(),'OWNER_EXPIRED')}
 private closed(){assertRootAuthorityHost(()=>this.#options.assertClosed(),'SOURCE_NOT_CLOSED')}
 command(input:ApplicationRestoreHandoffCommand):Promise<ApplicationRestoreHandoffState>{
  let command:ApplicationRestoreHandoffCommand;try{command=applicationRestoreHandoffCommandSchema.parse(input);this.owner()}catch(cause){return Promise.reject(cause)}
  if(command.type==='status')return Promise.resolve(this.state())
  if(this.#flight)return Promise.reject(Error('APPLICATION_RESTORE_BUSY'))
  const flight=this.run(command).finally(()=>{if(this.#flight===flight)this.#flight=null});this.#flight=flight;return flight
 }
 private async run(command:Exclude<ApplicationRestoreHandoffCommand,{type:'status'}>):Promise<ApplicationRestoreHandoffState>{
  const o=this.#options
  if(command.type==='select'){
   if(this.pending)fail('APPLICATION_RESTORE_PENDING');this.#phase='selecting'
   try{
    await o.pauseSelection();this.owner()
    const authority=readRootAuthority(o.bootstrap,()=>this.owner());if(authority.pointer.root.path!==o.root)fail('SOURCE_CHANGED')
    this.#directories=captureApplicationRestoreProtectedDirectories(o.bootstrap,()=>this.owner())
    const backup=await directoryIdentity(join(o.root,'backups/application/packages',command.backupId));this.owner();this.#directories.assertCurrent()
    const blocked=await o.protectedDirectories();this.owner();this.#directories.assertCurrent()
    const path=await o.chooseParent();this.owner();this.#directories.assertCurrent()
    if(path===null){this.#phase='idle';return this.state()}
    const base=await directoryIdentity(path);this.owner();this.#directories.assertCurrent()
    this.#layout=await createNativeApplicationRestoreLayout(o.bootstrap,base,o.ownerNonce,'healthy',()=>{this.owner();this.#directories!.assertCurrent()},[backup,...blocked]);this.owner()
    this.#request=await this.#requests.prepare(o.ownerNonce,{backup:{directory:backup,backupId:command.backupId},parent:this.#layout.layout.parents.candidate});this.owner()
    await bindApplicationRestoreLayout(this.#layout,this.#request);this.owner();this.#phase='prepared';return this.state()
   }catch(cause){this.#phase=this.#layout||inspectApplicationRestoreLayouts(o.bootstrap).unknown?'inspection':'idle';throw cause}
   finally{await o.releaseSelection()}
  }
  if(!this.#request||this.#request.operationId!==command.operationId)fail('APPLICATION_RESTORE_NOT_PREPARED')
  if(this.#phase==='closing'&&command.type==='start'&&this.#options.closedHandoffPending?.()===true){await o.requestClose();return this.state()}
  if(this.#phase!=='prepared')fail('APPLICATION_RESTORE_NOT_PREPARED')
  if(command.type==='cancel'){await this.#requests.cancelPrepared(o.ownerNonce,command.operationId);this.#request=null;this.#phase='idle';return this.state()}
  this.#directories!.assertCurrent();this.#layout!.assertCurrent()
  const accepted:unknown=await o.confirm(structuredClone(this.#request));this.owner();this.#directories!.assertCurrent();this.#layout!.assertCurrent()
  if(accepted!==true&&accepted!==false)fail('INVALID_CONFIRMATION')
  if(!accepted)return this.state()
  this.#phase='closing'
  const closed=await o.requestClose()
  if(this.state().phase==='inspection')return this.state()
  if(!closed&&!this.#closingOwner){if(o.closedHandoffPending?.()!==true)this.#phase='prepared';return this.state()}
  if(this.state().phase!=='armed')fail('APPLICATION_RESTORE_INSPECTION_REQUIRED')
  return this.state()
 }
 async commitClosed():Promise<void>{
  if(this.#phase!=='closing'||!this.#request||this.#closingOwner)fail('APPLICATION_RESTORE_NOT_CLOSING')
  this.owner();this.#directories!.assertCurrent();this.#layout!.assertCurrent()
  await this.#requests.flush();await flushApplicationRestoreLayouts(this.#options.bootstrap,this.#layout);this.owner()
  try{
   await this.#options.destroyAndFlush()
   this.#closingOwner=true
   this.owner();this.closed();this.#directories!.assertCurrent()
   this.#request=await this.#requests.arm(this.#options.ownerNonce,this.#request.operationId)
   this.#phase='armed';assertRootAuthorityHost(()=>this.#options.relaunchAndQuit(),'RELAUNCH_REQUIRED')
  }catch(cause){this.#phase='inspection';throw cause}
 }
 async flush(){await this.#flight?.catch(()=>{});await this.#requests.flush();await flushApplicationRestoreLayouts(this.#options.bootstrap,this.#layout)}
}
