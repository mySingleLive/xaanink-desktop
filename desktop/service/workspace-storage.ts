import {join} from 'node:path'
import {z} from 'zod'
import {WorkStorage} from '../core/work-storage'
import {atomicWrite} from '../core/versioned-store'
import {assertDirectory,directoryIdentity,readMetadata} from '../core/root-ownership'
import {workManifestSchema} from '../shared/workspace'
import {readWorkBrand} from '../core/brand-names'
const markerSchema=z.object({schemaVersion:z.literal(1),workId:z.uuid(),required:z.literal(true)}).strict()
/** The marker is independent from the pointer and never changes the Web work manifest. */
export async function workspaceStorage(path:string,assertOwner:()=>void|Promise<void>=()=>{}){
 const root=await directoryIdentity(path),brand=await readWorkBrand(root),manifest=brand.value,marker=join(path,brand.names.storageRequired)
 const guard=async()=>{await assertOwner();await assertDirectory(root);brand.assertCurrent()}
 const required=async()=>{
  await guard();let value:unknown
  try{value=await readMetadata(marker,4096)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){await guard();return false}throw error}
  const data=markerSchema.parse(value);if(data.workId!==manifest.id)throw Error('作品存储保护标记不匹配');await guard();return true
 }
 return new WorkStorage(root,manifest.id,{names:brand.names,assertOwner:guard,required,markRequired:async()=>{
  if(await required())return
  await atomicWrite(marker,JSON.stringify({schemaVersion:1,workId:manifest.id,required:true}),{beforeRename:async()=>{await guard();if(await required())return}})
 }})
}
