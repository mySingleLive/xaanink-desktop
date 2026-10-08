import {randomUUID} from 'node:crypto'
import {AsyncLocalStorage} from 'node:async_hooks'
type WriteFlight={active:boolean;children:Set<Promise<unknown>>;failures:unknown[]}
/** Main-process physical file writes only. Never hold this around a worker RPC
 * or a whole settings operation; that can deadlock the engine capture mutex. */
export class ApplicationMetadataGate {
 private writes=new Set<Promise<unknown>>()
 private flight=new AsyncLocalStorage<WriteFlight>()
 private capture:{id:string;ready:boolean;released:Promise<void>;release:()=>void}|null=null
 write<T>(run:()=>Promise<T>):Promise<T>{
  const held=this.flight.getStore()
  if(held?.active){
   const child=Promise.resolve().then(run);held.children.add(child)
   void child.then(()=>{held.children.delete(child)},cause=>{held.children.delete(child);held.failures.push(cause)})
   return child
  }
  return this.writeOrdinary(run)
 }
 private async writeOrdinary<T>(run:()=>Promise<T>):Promise<T>{
  while(this.capture)await this.capture.released
  const operation=Promise.resolve().then(run);this.writes.add(operation)
  try{return await operation}finally{this.writes.delete(operation)}
 }
 /** Main-only composition of actual journal/barrier/control writes. The
  * private async context is never an IPC flag. A capture can drain the parent
  * while its original inner file writers finish; detached children are also
  * drained, and expired contexts become ordinary writes again. */
 writeFlight<T>(run:()=>Promise<T>):Promise<T>{
  if(this.flight.getStore()?.active)return this.write(run)
  return this.write(()=>{
   const held:WriteFlight={active:true,children:new Set(),failures:[]}
   return this.flight.run(held,async()=>{
    let result:T|undefined,failed=false,cause:unknown
    try{result=await run()}catch(error){failed=true;cause=error}
    try{while(held.children.size)await Promise.allSettled([...held.children])}
    finally{held.active=false}
    if(failed)throw cause
    if(held.failures.length)throw held.failures[0]
    return result as T
   })
  })
 }
 async acquire():Promise<string>{
  if(this.flight.getStore()?.active)throw Error('APPLICATION_CAPTURE_INSIDE_WRITE')
  if(this.capture)throw Error('APPLICATION_CAPTURE_ACTIVE')
  const released=Promise.withResolvers<void>(),capture={id:randomUUID(),ready:false,released:released.promise,release:released.resolve}
  this.capture=capture
  await Promise.allSettled([...this.writes])
  if(this.capture!==capture)throw Error('APPLICATION_CAPTURE_REVOKED')
  capture.ready=true;return capture.id
 }
 release(id:string):void{
  if(!this.capture?.ready||this.capture.id!==id)throw Error('APPLICATION_CAPTURE_LEASE_INVALID')
  const capture=this.capture;this.capture=null;capture.release()
 }
 /** Called only when the owning service disconnects, never by the renderer. */
 revoke():void{const capture=this.capture;this.capture=null;capture?.release()}
}
