import {randomUUID} from "node:crypto"
import {constants} from "node:fs"
import {lstat,open,realpath} from "node:fs/promises"
import {dirname,isAbsolute,resolve,basename,sep} from "node:path"
import {atomicWrite} from "../core/versioned-store"
import {exportConfiguration,prepareConfigurationImport,resolveConfigurationImport,MAX_CONFIGURATION_BYTES,ConfigurationTransferError,type ConfigurationImportChoices,type ConfigurationImportPlan,type TrustedShortcutCatalogs} from "../core/configuration-transfer"
import type {ConfigurationPreview} from "../shared/configuration"
import type {ModelRepository} from "./model-repository"

interface Operation {owner:string;token:string;cancelled:boolean;applying:boolean;plan?:ConfigurationImportPlan;stopped:PromiseWithResolvers<never>}
export interface ConfigurationFileOptions {
 repository:Pick<ModelRepository,"read"|"updateSettings"|"path">
 catalogs:TrustedShortcutCatalogs
 assertOwner(owner:string):void
 chooseImport(owner:string):Promise<string|null>
 chooseExport(owner:string):Promise<string|null>
 protectedRoots?():Promise<string[]>
}
function safePath(path:string){if(!isAbsolute(path)||path.length>4096||path.includes("\0"))throw Error("请选择本地配置文件")}
async function readSelected(path:string,active:()=>void){
 safePath(path);active()
 const before=await lstat(path,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.size>BigInt(MAX_CONFIGURATION_BYTES))throw Error("配置文件不是可读取的普通文件或超过4MiB")
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{
  const opened=await handle.stat({bigint:true});if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)throw Error("配置文件已变化，请重新选择")
  const chunks:Buffer[]=[];let length=0
  for(;;){active();const block=Buffer.allocUnsafe(Math.min(64*1024,MAX_CONFIGURATION_BYTES+1-length)),{bytesRead}=await handle.read(block);if(!bytesRead)break;length+=bytesRead;if(length>MAX_CONFIGURATION_BYTES)throw Error("配置文件超过4MiB");chunks.push(block.subarray(0,bytesRead))}
  const after=await lstat(path,{bigint:true});active()
  if(after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||length!==Number(opened.size))throw Error("配置文件已变化，请重新选择")
  try{return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks,length))}catch{throw Error("配置文件须使用UTF-8编码")}
 }finally{await handle.close()}
}
async function exportGuard(path:string){
 safePath(path)
 const parent=dirname(path),parentPath=await realpath(parent),parentInfo=await lstat(parent,{bigint:true})
 if(!parentInfo.isDirectory()||parentInfo.isSymbolicLink())throw Error("导出目录无效")
 const selected=async()=>{try{const info=await lstat(path,{bigint:true});if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n)throw Error("导出目标不是普通文件");return info}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error}}
 const before=await selected()
 return async()=>{
  const now=await lstat(parent,{bigint:true})
  if(!now.isDirectory()||now.isSymbolicLink()||now.dev!==parentInfo.dev||now.ino!==parentInfo.ino||await realpath(parent)!==parentPath)throw Error("导出目录已变化，原文件已保留")
  const after=await selected()
  if(before?(after?.dev!==before.dev||after?.ino!==before.ino||after?.size!==before.size||after?.mtimeNs!==before.mtimeNs||after?.ctimeNs!==before.ctimeNs):after!==null)throw Error("导出目标已变化，原文件已保留")
 }
}
/** Native paths stay in main. The renderer receives a preview and a session-bound token only. */
export class ConfigurationFiles {
 private operations=new Map<string,Operation>()
 private pending=new Set<Promise<unknown>>()
 constructor(private options:ConfigurationFileOptions){}
 private begin(owner:string){this.options.assertOwner(owner);this.cancel(owner);const operation:Operation={owner,token:randomUUID(),cancelled:false,applying:false,stopped:Promise.withResolvers<never>()};void operation.stopped.promise.catch(()=>{});this.operations.set(owner,operation);return operation}
 private active(operation:Operation){if(operation.cancelled||this.operations.get(operation.owner)!==operation)throw Error("配置操作已取消或预览已失效");try{this.options.assertOwner(operation.owner)}catch(error){this.cancel(operation.owner);throw error}}
 private track<T>(operation:Promise<T>):Promise<T>{this.pending.add(operation);void operation.finally(()=>this.pending.delete(operation)).catch(()=>{});return operation}
 cancel(owner:string){const operation=this.operations.get(owner);if(operation){operation.cancelled=true;operation.stopped.reject(Error("配置操作已取消或预览已失效"));this.operations.delete(owner)}}
 cancelWindow(prefix:string){for(const owner of this.operations.keys())if(owner.startsWith(prefix))this.cancel(owner)}
 async flush(){for(;;){const pending=[...this.pending];if(!pending.length)return;await Promise.allSettled(pending)}}
 async preview(owner:string):Promise<ConfigurationPreview|null>{
  const operation=this.begin(owner)
  return this.track((async()=>{
   try{
    const selected=await Promise.race([this.options.chooseImport(owner),operation.stopped.promise]);this.active(operation)
    if(!selected){this.cancel(owner);return null}
    const json=await readSelected(selected,()=>this.active(operation)),current=await this.options.repository.read();this.active(operation)
    operation.plan=prepareConfigurationImport(json,{revision:current.revision,settings:current.settings,models:current.models},this.options.catalogs)
    return{token:operation.token,plan:structuredClone(operation.plan)}
   }catch(error){if(this.operations.get(owner)===operation)this.cancel(owner);throw error}
  })())
 }
 async apply(owner:string,token:string,choices:ConfigurationImportChoices){
  const operation=this.operations.get(owner)
  if(!operation?.plan||operation.token!==token||operation.applying)throw Error("配置预览已失效，请重新选择文件")
  this.active(operation);operation.applying=true
  return this.track((async()=>{
   let keepPreview=false
   try{
    const current=await this.options.repository.read();this.active(operation)
    let settings
    try{settings=resolveConfigurationImport(operation.plan!,{revision:current.revision,settings:current.settings,models:current.models},choices,this.options.catalogs)}catch(error){keepPreview=error instanceof ConfigurationTransferError&&error.code!=="INVALID_PLAN";throw error}
    if(!choices.selectedPaths.length)return current
    return await this.options.repository.updateSettings(operation.plan!.baseRevision,settings,()=>this.active(operation))
   }finally{operation.applying=false;if(!keepPreview&&this.operations.get(owner)===operation)this.cancel(owner)}
  })())
 }
 async export(owner:string):Promise<boolean>{
  const operation=this.begin(owner)
  return this.track((async()=>{
   try{
    const selected=await Promise.race([this.options.chooseExport(owner),operation.stopped.promise]);this.active(operation)
    if(!selected)return false
    const protectedPath=async()=>{
     safePath(selected)
     const target=resolve(await realpath(dirname(selected)),basename(selected)),roots=await this.options.protectedRoots?.()??[]
     const state=await realpath(this.options.repository.path).catch(error=>{if((error as NodeJS.ErrnoException).code==="ENOENT")return resolve(this.options.repository.path);throw error})
     const actual=await realpath(selected).catch(error=>{if((error as NodeJS.ErrnoException).code==="ENOENT")return target;throw error})
     if(actual===state)throw Error("不能覆盖正在使用的应用配置文件")
     for(const root of roots){const canonical=await realpath(root).catch(error=>{if((error as NodeJS.ErrnoException).code==="ENOENT")return resolve(root);throw error});if(actual===canonical||actual.startsWith(canonical+sep))throw Error("请选择应用数据和作品目录之外的导出位置")}
    }
    await protectedPath();this.active(operation)
    const guard=await exportGuard(selected),current=await this.options.repository.read();this.active(operation)
    await atomicWrite(selected,exportConfiguration({revision:current.revision,settings:current.settings,models:current.models}),{beforeRename:async()=>{await protectedPath();await guard();this.active(operation)}})
    return true
   }finally{if(this.operations.get(owner)===operation)this.cancel(owner)}
  })())
 }
}
