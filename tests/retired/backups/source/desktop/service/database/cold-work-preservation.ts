import {constants} from 'node:fs'
import {mkdir,lstat,readdir,open} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {RootIdentity} from '../../core/data-root'
import {assertDirectory,directoryIdentity,readMetadata,safeRelative,sameIdentity,syncDirectory,rootIdentitySchema} from '../../core/root-ownership'
import {atomicWrite} from '../../core/versioned-store'
const MAX_BYTES=512*1024*1024,MAX_FILES=25000,MAX_DIRS=5000
const fileSchema=z.object({path:z.string().refine(safeRelative),bytes:z.number().int().nonnegative().max(MAX_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/),device:z.string(),inode:z.string()}).strict()
const inventorySchema=z.object({files:z.array(fileSchema).max(MAX_FILES),directories:z.array(z.object({path:z.string().refine(safeRelative),identity:rootIdentitySchema}).strict()).max(MAX_DIRS),missing:z.array(z.enum(['database','assets'])).max(2)}).strict()
const receiptSchema=z.object({version:z.literal(1),kind:z.literal('closed-source'),id:z.uuid(),workId:z.uuid(),createdAt:z.iso.datetime(),directory:rootIdentitySchema,source:rootIdentitySchema,inventory:inventorySchema,missing:z.array(z.enum(['database','assets'])).max(2)}).strict()
export type ColdPreservation=z.infer<typeof receiptSchema>
type FileRecord=z.infer<typeof fileSchema>
/** A closed source may be corrupt or missing. Preserve its raw bytes, never label
 * this record as a healthy engine backup and never initialize the old database. */
async function digestFile(path:string,guard:()=>Promise<void>,destination?:string):Promise<Omit<FileRecord,'path'>>{
 const before=await lstat(path,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(MAX_BYTES))throw Error('源文件不是安全的普通文件或超过上限')
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let out:Awaited<ReturnType<typeof open>>|undefined
 try{
  const opened=await file.stat({bigint:true});if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)throw Error('源文件已变化')
  if(destination)out=await open(destination,'wx',0o600)
  const hash=createHash('sha256'),chunk=Buffer.alloc(65536);let bytes=0
  for(;;){await guard();const result=await file.read(chunk,0,chunk.length,null);if(!result.bytesRead)break;bytes+=result.bytesRead;if(bytes>MAX_BYTES||bytes>Number(opened.size))throw Error('源文件已变化或超过上限');const part=chunk.subarray(0,result.bytesRead);hash.update(part);if(out)await out.writeFile(part)}
  const after=await lstat(path,{bigint:true});if(bytes!==Number(opened.size)||after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||after.nlink!==1n)throw Error('源文件在保留期间已变化')
  await out?.sync();return{bytes,sha256:hash.digest('hex'),device:String(opened.dev),inode:String(opened.ino)}
 }finally{await out?.close();await file.close()}
}
async function inventory(root:RootIdentity,guard:()=>Promise<void>){
 const files:z.infer<typeof fileSchema>[]=[],directories:z.infer<typeof inventorySchema>['directories']=[],missing:Array<'database'|'assets'>=[];let bytes=0
 const visit=async(path:string)=>{
  if(!safeRelative(path))throw Error('源文件路径无效');await guard();const full=join(root.path,path),info=await lstat(full)
  if(info.isSymbolicLink())throw Error('源目录包含链接，原文件已保留')
  if(info.isDirectory()){
   if(directories.length>=MAX_DIRS)throw Error('源目录数量超过上限');const identity=await directoryIdentity(full);directories.push({path,identity});const entries=(await readdir(full)).sort();if(entries.length>MAX_FILES+MAX_DIRS)throw Error('源目录项目过多');for(const name of entries)await visit(`${path}/${name}`);await assertDirectory(identity)
  }else{
   if(files.length>=MAX_FILES||info.size+bytes>MAX_BYTES)throw Error('源文件数量或总大小超过上限');const item=await digestFile(full,guard);bytes+=item.bytes;files.push({path,...item})
  }
 }
 for(const name of ['database','assets'] as const){try{await lstat(join(root.path,name))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){missing.push(name);continue}throw error}await visit(name)}
 await guard();return inventorySchema.parse({files,directories,missing})
}
const content=(value:z.infer<typeof inventorySchema>)=>JSON.stringify({files:value.files.map(({path,bytes,sha256})=>({path,bytes,sha256})),directories:value.directories.map(x=>x.path),missing:value.missing})
export async function preserveColdWork(work:RootIdentity,source:RootIdentity,workId:string,assertOwner:()=>Promise<void>,options:{beforeCommit?():Promise<void>}={}):Promise<ColdPreservation>{
 z.uuid().parse(workId)
 const guard=async()=>{await assertOwner();await assertDirectory(work);await assertDirectory(source)};await guard()
 const before=await inventory(source,guard),parent=join(work.path,'.xuanxiang-preserved')
 try{await mkdir(parent,{mode:0o700})}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}
 const parentIdentity=await directoryIdentity(parent),id=randomUUID(),path=join(parent,id);await mkdir(path,{mode:0o700});const directory=await directoryIdentity(path)
 const destinationGuard=async()=>{await guard();await assertDirectory(parentIdentity);await assertDirectory(directory)}
 for(const dir of before.directories){await destinationGuard();await mkdir(join(path,dir.path),{mode:0o700})}
 for(const file of before.files){await destinationGuard();const copied=await digestFile(join(source.path,file.path),destinationGuard,join(path,file.path));if(JSON.stringify({...file,...copied})!==JSON.stringify(file))throw Error('源文件内容已变化')}
 for(const dir of [...before.directories].reverse())await syncDirectory(join(path,dir.path))
 await options.beforeCommit?.();await destinationGuard();const after=await inventory(source,guard)
 if(JSON.stringify(after)!==JSON.stringify(before))throw Error('源文件清单已变化')
 const stored=await inventory(directory,destinationGuard);if(content(stored)!==content(before))throw Error('保留副本校验失败')
 const receipt=receiptSchema.parse({version:1,kind:'closed-source',id,workId,createdAt:new Date().toISOString(),directory,source,inventory:stored,missing:before.missing})
 await atomicWrite(join(path,'receipt.json'),JSON.stringify(receipt),{beforeRename:destinationGuard});await syncDirectory(parent);await verifyColdPreservation(receipt,assertOwner);return receipt
}
export async function verifyColdPreservation(input:ColdPreservation,assertOwner:()=>Promise<void>):Promise<void>{
 const receipt=receiptSchema.parse(input),guard=async()=>{await assertOwner();await assertDirectory(receipt.directory)};await guard()
 const stored=receiptSchema.parse(await readMetadata(join(receipt.directory.path,'receipt.json'),16*1024*1024));if(JSON.stringify(stored)!==JSON.stringify(receipt))throw Error('保留副本回执已变化')
 if(!sameIdentity(stored.directory,receipt.directory))throw Error('保留副本身份已变化')
 const names=(await readdir(receipt.directory.path)).sort(),expected=['receipt.json',...['database','assets'].filter(name=>!receipt.missing.includes(name as 'database'|'assets'))].sort();if(JSON.stringify(names)!==JSON.stringify(expected))throw Error('保留副本含未知项目')
 if(JSON.stringify(await inventory(receipt.directory,guard))!==JSON.stringify(receipt.inventory))throw Error('保留副本内容已变化');await guard()
}
