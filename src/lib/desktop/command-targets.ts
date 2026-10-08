export type CommandHandler=(()=>void|Promise<void>)|{enabled?():boolean;run():void|Promise<void>}
export interface CommandTarget<T> {owner:unknown;accepts(target:T):boolean;commands:Record<string,CommandHandler>}
/** A command can have several editor registrations, but exactly one visible
 * owner may accept the captured focus. Never fall back to a different editor. */
export class CommandTargets<T> {
 private registrations=new Set<CommandTarget<T>>()
 register(target:CommandTarget<T>){this.registrations.add(target);return()=>{this.registrations.delete(target)}}
 private resolve(id:string,target:T){
  const matches=[...this.registrations].filter(registration=>registration.commands[id]&&registration.accepts(target))
  if(matches.length!==1)return null
  const registration=matches[0],handler=registration.commands[id]
  return typeof handler==="function"||handler.enabled?.()!==false?{registration,handler}:null
 }
 enabled(id:string,target:T){return this.resolve(id,target)!==null}
 capture(id:string,target:T):(()=>Promise<boolean>)|null{
  const captured=this.resolve(id,target)
  if(!captured)return null
  return async()=>{
   const current=this.resolve(id,target)
   if(!current||current.registration!==captured.registration||current.handler!==captured.handler)return false
   await (typeof current.handler==="function"?current.handler():current.handler.run())
   return true
  }
 }
 async execute(id:string,target:T){return await this.capture(id,target)?.()??false}
}
