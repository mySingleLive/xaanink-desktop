import type {RootIdentity} from '../core/data-root'
import {rootIdentitySchema} from '../core/root-ownership'
import {canonical} from '../core/application-backup-files'
import {assertRootAuthorityDirectory,assertRootAuthorityHost,assertRootAuthorityFile,assertCurrentApplicationMarker,readRootAuthority} from '../core/root-authority'
import {captureApplicationRestoreProtectedDirectories} from './application-restore-layout'

function fail(code:string):never{throw Object.assign(Error(code),{code})}
const methods=new Set(['protected-directories','task-status','stop-tasks','ready'])

/** A main-only RPC-shaped readonly endpoint while the two application draft
 * checkpoints remain protected. It owns no worker, engine, template library or
 * conversation runtime. ready/status describe this endpoint, never DB health. */
export class ApplicationRestoreProtectedService {
 readonly #bootstrap:RootIdentity
 readonly #root:RootIdentity
 readonly #assertLock:()=>void
 readonly #pending=new Set<Promise<unknown>>()
 #closing=false
 #disposed=false
 #closeFlight:Promise<boolean>|null=null

 constructor(bootstrap:RootIdentity,root:RootIdentity,assertLock:()=>void){
  this.#bootstrap=Object.freeze(rootIdentitySchema.parse(structuredClone(bootstrap)))
  this.#root=Object.freeze(rootIdentitySchema.parse(structuredClone(root)))
  if(typeof assertLock!=='function')fail('APPLICATION_PROTECTED_LOCK_REQUIRED')
  const captured=assertLock
  this.#assertLock=()=>assertRootAuthorityHost(captured,'APPLICATION_PROTECTED_LOCK_REQUIRED')
  this.#fresh().assertCurrent()
 }
 #guard(){
  if(this.#disposed)fail('APPLICATION_PROTECTED_SERVICE_DISPOSED')
  this.#assertLock();assertRootAuthorityDirectory(this.#bootstrap);assertRootAuthorityDirectory(this.#root)
 }
 #fresh(){
  const authority=readRootAuthority(this.#bootstrap,()=>this.#guard())
  if(canonical(authority.pointer.root)!==canonical(this.#root))fail('APPLICATION_PROTECTED_ROOT_CHANGED')
  const marker=assertCurrentApplicationMarker(authority.pointer)
  const assertCurrent=()=>{this.#guard();authority.assertCurrent();assertRootAuthorityFile(this.#root,'xuanxiang-app.json',marker,'APPLICATION_PROTECTED_ROOT_CHANGED')}
  assertCurrent();return{assertCurrent}
 }
 #close():Promise<boolean>{
  if(this.#closeFlight)return this.#closeFlight
  // Stop admission synchronously. Already admitted reads may finish, and close
  // waits for their actual final observations rather than clearing the set.
  this.#closing=true
  this.#closeFlight=Promise.allSettled([...this.#pending]).then(()=>true)
  return this.#closeFlight
 }
 call<T>(method:string,value?:unknown):Promise<T>{
  if(value!==undefined)return Promise.reject(Error('APPLICATION_PROTECTED_INPUT_INVALID'))
  if(method==='close')return this.#close() as Promise<T>
  if(this.#closing||this.#disposed)return Promise.reject(Error('APPLICATION_PROTECTED_SERVICE_CLOSED'))
  if(!methods.has(method))return Promise.reject(Error('APPLICATION_RESTORE_PROTECTED'))
  const flight=Promise.resolve().then(async()=>{
   const authority=this.#fresh()
   const catalog=method==='protected-directories'?captureApplicationRestoreProtectedDirectories(this.#bootstrap,()=>this.#guard()):null
   const result=catalog?catalog.directories.map(root=>root.path):method==='task-status'?{active:0}:true
   // Keep the complete readonly call tracked through its asynchronous delivery.
   // Final checks use the captured authority/catalog, never relearn changed IO.
   await Promise.resolve()
   authority.assertCurrent();catalog?.assertCurrent();this.#guard()
   return result as T
  })
  this.#pending.add(flight)
  void flight.then(()=>this.#pending.delete(flight),()=>this.#pending.delete(flight))
  return flight
 }
 dispose():void{
  this.#disposed=true
  void this.#close()
 }
}
