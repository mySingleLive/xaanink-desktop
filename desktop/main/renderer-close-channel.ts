import {randomUUID} from "node:crypto"
import {closeReplySchema,type CloseReply,type PrepareClose} from "../shared/close"
import type {CloseOwner} from "./close-coordinator"
export class RendererCloseChannel {
 private pending:{owner:CloseOwner;id:string;action:"flush"|"export";resolve(value:CloseReply):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}|null=null
 constructor(private send:(event:PrepareClose)=>void,private timeoutMs=20000){}
 request(owner:CloseOwner,action:"flush"|"export",retryFailures=false):Promise<CloseReply>{
  if(this.pending)return Promise.reject(new Error("仍在等待窗口保存响应"))
  return new Promise((resolve,reject)=>{
   const id=randomUUID(),timer=setTimeout(()=>{if(this.pending?.id===id){this.pending=null;reject(new Error("窗口保存响应超时，尚未关闭"))}},this.timeoutMs)
   this.pending={owner:{...owner},id,action,resolve,reject,timer}
   try{this.send({type:"prepare-close",id,sessionId:owner.sessionId,action,retryFailures})}catch(error){clearTimeout(timer);this.pending=null;reject(error)}
  })
 }
 reply(owner:CloseOwner,id:string,value:unknown):boolean{
  const pending=this.pending
  if(!pending||pending.id!==id||pending.owner.owner!==owner.owner||pending.owner.sessionId!==owner.sessionId)return false
  const parsed=closeReplySchema.safeParse(value)
  if(!parsed.success||parsed.data.status!=="failed"&&!(pending.action==="flush"?["saved","unmodified"].includes(parsed.data.status):parsed.data.status==="export"))return false
  this.pending=null;clearTimeout(pending.timer);pending.resolve(parsed.data);return true
 }
 cancel():void{const pending=this.pending;this.pending=null;if(pending){clearTimeout(pending.timer);pending.reject(new Error("窗口保存等待已取消"))}}
}
