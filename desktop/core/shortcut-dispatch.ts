import {bindingsFor,canonicalKey,capturedKey,type ShortcutCommand} from "./shortcuts"
export interface ShortcutContext {
 commands:ShortcutCommand[];overrides:Record<string,string[]>;platform:"darwin"|"win32"
 scope:"none"|"markdown"|"composer"|"input"|"preview";focus:unknown;modal?:boolean;recording?:boolean
 enabled?(id:string):boolean;repeatable?(id:string):boolean
}
type KeyInput=Parameters<typeof capturedKey>[0]&{defaultPrevented?:boolean}
function configurationFor(context:ShortcutContext){
 const commands=context.commands.filter(command=> (command.scope===context.scope||command.scope==="markdown"&&context.scope==="preview"||command.scope==="text"&&context.scope!=="none"||command.scope==="global"&&!context.modal))
 const bindings=commands.flatMap(command=>(command.locked?command.defaults:bindingsFor(command,context.overrides)).map(binding=>({command,binding:canonicalKey(binding)})))
 return {commands,bindings,key:JSON.stringify([context.scope,context.modal??false,bindings.map(row=>[row.command.id,row.binding])])}
}
export type ShortcutResolution={kind:"run";id:string}|{kind:"none"|"prefix"|"blocked"}
/** One dispatcher per window. The DOM and Monaco keep their own edit/undo
 * machinery; this class only resolves confirmed bindings and chord lifetimes. */
export class ShortcutDispatcher {
 private prefix="";private at=0;private focus:unknown;private configuration=""
 constructor(private now=()=>Date.now(),private timeout=2000){}
 reset(){this.prefix="";this.focus=undefined;this.configuration=""}
 waitingFor(context:ShortcutContext){return !!this.prefix&&this.focus===context.focus&&this.now()-this.at<=this.timeout&&this.configuration===configurationFor(context).key}
 key(event:KeyInput,context:ShortcutContext):ShortcutResolution {
  if(event.defaultPrevented||event.isComposing||event.keyCode===229||context.recording){this.reset();return{kind:"none"}}
  // Browser KeyboardEvent fields are inherited accessors, not enumerable own
  // properties. Extract them explicitly rather than spreading the event.
  const stroke=capturedKey({key:event.key,code:event.code,metaKey:event.metaKey,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,isComposing:event.isComposing,keyCode:event.keyCode,repeat:false},context.platform)
  if(!stroke)return{kind:"none"}
  const key=canonicalKey(stroke)
  const {commands,bindings,key:configuration}=configurationFor(context)
  if(this.focus!==context.focus||this.configuration!==configuration||this.now()-this.at>this.timeout)this.prefix=""
  this.focus=context.focus;this.configuration=configuration;this.at=this.now()
  const resolve=(candidate:string):ShortcutResolution|null=>{
   const matched=bindings.filter(row=>row.binding===candidate)
   const exact=matched.filter(row=>context.enabled?.(row.command.id)!==false)
   const prefixes=bindings.some(row=>row.binding.startsWith(candidate+" "))
   if(exact.length){
    this.prefix=""
    const ids=new Set(exact.map(row=>row.command.id))
    if(ids.size!==1||prefixes)return{kind:"blocked"}
    const id=exact[0].command.id
    if(event.repeat&&!context.repeatable?.(id))return{kind:"blocked"}
    return{kind:"run",id}
   }
   if(prefixes){if(!event.repeat)this.prefix=candidate;return{kind:"prefix"}}
   if(matched.length)return{kind:"blocked"}
   return null
  }
  const chord=this.prefix
  if(chord){const result=resolve(chord+" "+key);if(result)return result;this.prefix=""}
  const result=resolve(key)
  if(result)return result
  // A removed/rebound default must not leak through to the browser/Monaco's
  // original handler, which would otherwise keep the old shortcut alive.
  const removedDefault=commands.some(command=>!command.locked&&Object.hasOwn(context.overrides,command.id)&&command.defaults.some(binding=>canonicalKey(binding)===key||canonicalKey(binding).startsWith(key+" ")))
  return{kind:removedDefault?"blocked":"none"}
 }
}
