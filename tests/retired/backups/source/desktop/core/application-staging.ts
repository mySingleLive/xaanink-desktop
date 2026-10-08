import {mkdirSync,lstatSync,opendirSync,unlinkSync,rmdirSync} from 'node:fs'
import {join,dirname,basename,relative,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {RootIdentity} from './data-root'
import {rootIdentitySchema,within,safeRelative,syncDirectory} from './root-ownership'
import {canonical,compareText,inspectTree,assertDirectoryImmediately,assertFileImmediately,assertTreeImmediately,type StoredTree} from './application-backup-files'
import {applicationCandidateBodySchema,APPLICATION_BACKUP_LIMITS as limits} from '../shared/application-backup'
export type ApplicationStagingGuard=()=>void|Promise<void>
export class ApplicationStagingError extends Error {
 constructor(readonly code:string,readonly removedFiles=0,readonly removedDirectories=0){super(code)}
}
export interface ApplicationStagingCleanup {status:'removed';removedFiles:number;removedDirectories:number}
const codes=new Set(['APPLICATION_STAGING_INPUT_INVALID','APPLICATION_STAGING_OWNER_LOST','APPLICATION_STAGING_CHANGED','APPLICATION_STAGING_LIMIT','APPLICATION_STAGING_BUSY','APPLICATION_STAGING_CANCELLED','APPLICATION_STAGING_NOT_EMPTY','APPLICATION_STAGING_IO_FAILED'])
const treeSchema=z.object({files:applicationCandidateBodySchema.shape.files,directories:z.array(rootIdentitySchema).max(limits.directories)}).strict()
const pending=new Set<string>()
function fail(code:string):never{throw new ApplicationStagingError(code)}
function safe(error:unknown,files=0,directories=0){
 const code=error instanceof ApplicationStagingError&&codes.has(error.code)?error.code:'APPLICATION_STAGING_IO_FAILED'
 return new ApplicationStagingError(code,files,directories)
}
function root(input:RootIdentity){try{return Object.freeze(rootIdentitySchema.parse(structuredClone(input)))}catch{return fail('APPLICATION_STAGING_INPUT_INVALID')}}
function immediate(directory:RootIdentity){try{assertDirectoryImmediately(directory)}catch{return fail('APPLICATION_STAGING_CHANGED')}}
function checkSignal(signal?:AbortSignal){if(signal?.aborted)fail('APPLICATION_STAGING_CANCELLED')}
async function owned(directories:readonly RootIdentity[],assertOwner:ApplicationStagingGuard,signal?:AbortSignal){
 checkSignal(signal)
 try{await assertOwner()}catch{checkSignal(signal);fail('APPLICATION_STAGING_OWNER_LOST')}
 checkSignal(signal);for(const expected of directories)immediate(expected)
}
function capacity(directory:RootIdentity,reserve=0){
 immediate(directory);const handle=opendirSync(directory.path);let count=0
 try{while(handle.readSync())if(++count>limits.packages-reserve)fail('APPLICATION_STAGING_LIMIT')}finally{handle.closeSync()}
 immediate(directory)
}
function identityImmediately(path:string){
 const info=lstatSync(path,{bigint:true}),directory={path,device:String(info.dev),inode:String(info.ino)}
 immediate(directory);return Object.freeze(directory)
}
function parsedTree(directory:RootIdentity,input:StoredTree){
 let tree:StoredTree
 try{tree=treeSchema.parse(structuredClone(input))}catch{return fail('APPLICATION_STAGING_INPUT_INVALID')}
 const directories=new Map<string,RootIdentity>([[directory.path,directory]]),files=new Set<string>();let bytes=0
 for(const child of tree.directories){
  const path=relative(directory.path,child.path).split(sep).join('/')
  if(child.path===directory.path||!within(child.path,directory.path)||!safeRelative(path)||directories.has(child.path))fail('APPLICATION_STAGING_INPUT_INVALID')
  directories.set(child.path,Object.freeze(child))
 }
 for(const child of tree.directories)if(!directories.has(dirname(child.path)))fail('APPLICATION_STAGING_INPUT_INVALID')
 for(const file of tree.files){
  const path=join(directory.path,...file.path.split('/'))
  if(files.has(file.path)||directories.has(path)||!directories.has(dirname(path))||file.revision.size!==String(file.size))fail('APPLICATION_STAGING_INPUT_INVALID')
  files.add(file.path);bytes+=file.size;if(bytes>limits.bytes)fail('APPLICATION_STAGING_LIMIT')
 }
 tree.files.sort((a,b)=>compareText(a.path,b.path));tree.directories.sort((a,b)=>compareText(a.path,b.path))
 return{tree,directories}
}
function ancestors(parent:RootIdentity,directory:RootIdentity,path:string,directories:Map<string,RootIdentity>){
 immediate(parent);immediate(directory)
 let cursor=dirname(path);const chain:RootIdentity[]=[]
 while(cursor!==directory.path){const expected=directories.get(cursor);if(!expected)fail('APPLICATION_STAGING_INPUT_INVALID');chain.push(expected);cursor=dirname(cursor)}
 for(const expected of chain.reverse())immediate(expected)
}
function empty(directory:RootIdentity){
 immediate(directory);const handle=opendirSync(directory.path)
 try{if(handle.readSync())fail('APPLICATION_STAGING_NOT_EMPTY')}finally{handle.closeSync()}
 immediate(directory)
}
/** Create only a new direct UUID child of the host's private staging container.
 * The guard closure authorizes the captured private namespace and owner lease.
 * Uncertain creation never cleans by pathname or claims neighbors.
 */
export async function createApplicationStagingParent(container:RootIdentity,assertOwner:ApplicationStagingGuard):Promise<RootIdentity>{
 try{
  if(typeof assertOwner!=='function')fail('APPLICATION_STAGING_INPUT_INVALID')
  const captured=root(container);await owned([captured],assertOwner)
  // Capacity, exclusive mkdir and inode capture share one JS turn, so two
  // local creators cannot both reserve the last available container slot.
  capacity(captured,1);const path=join(captured.path,randomUUID());mkdirSync(path,{mode:0o700});const created=identityImmediately(path)
  await owned([captured,created],assertOwner);await syncDirectory(created.path);await syncDirectory(captured.path)
  await owned([captured,created],assertOwner);capacity(captured);empty(created)
  return created
 }catch(error){throw safe(error)}
}
/** Caller supplies the complete previously sealed tree and retains a closed
 * engine + exclusive namespace lease until this promise physically settles.
 * Partial failure preserves every remaining/foreign byte; never retry by
 * re-learning an unknown tree, and never use recursive rm.
 */
export async function cleanupApplicationStaging(parent:RootIdentity,directory:RootIdentity,input:StoredTree,assertOwner:ApplicationStagingGuard,signal?:AbortSignal):Promise<ApplicationStagingCleanup>{
 let files=0,removedDirectories=0,active:string|undefined
 try{
  if(typeof assertOwner!=='function')fail('APPLICATION_STAGING_INPUT_INVALID')
  const capturedParent=root(parent),captured=root(directory)
  if(dirname(captured.path)!==capturedParent.path||!z.uuid().safeParse(basename(captured.path)).success)fail('APPLICATION_STAGING_INPUT_INVALID')
  const {tree,directories}=parsedTree(captured,input)
  if([...pending].some(path=>within(captured.path,path)||within(path,captured.path)))fail('APPLICATION_STAGING_BUSY')
  active=captured.path;pending.add(active)
  const guard=()=>owned([capturedParent,captured],assertOwner,signal)
  await guard();capacity(capturedParent)
  const actual=await inspectTree(captured,guard)
  if(canonical(actual)!==canonical(tree))fail('APPLICATION_STAGING_CHANGED')
  await guard()
  // One complete seal, then O(depth) checks per destructive action rather than
  // re-scanning all 1,391 engine entries before every unlink.
  try{assertTreeImmediately(captured,tree)}catch{fail('APPLICATION_STAGING_CHANGED')}
  for(const file of tree.files){
   await guard();const path=join(captured.path,...file.path.split('/'))
   checkSignal(signal);ancestors(capturedParent,captured,path,directories)
   try{assertFileImmediately(captured,file.path,{...file.identity,...file.revision})}catch{fail('APPLICATION_STAGING_CHANGED')}
   unlinkSync(path);files++;await syncDirectory(dirname(path))
  }
  const ordered=[...tree.directories].sort((a,b)=>b.path.split(sep).length-a.path.split(sep).length||compareText(a.path,b.path))
  for(const child of ordered){
   await guard();checkSignal(signal);ancestors(capturedParent,captured,child.path,directories);empty(child)
   rmdirSync(child.path);removedDirectories++;await syncDirectory(dirname(child.path))
  }
  await guard();checkSignal(signal);immediate(capturedParent);empty(captured)
  rmdirSync(captured.path);removedDirectories++;await syncDirectory(capturedParent.path)
  await owned([capturedParent],assertOwner,signal);capacity(capturedParent)
  let exists=false;try{lstatSync(captured.path);exists=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  if(exists)fail('APPLICATION_STAGING_CHANGED')
  return{status:'removed',removedFiles:files,removedDirectories}
 }catch(error){throw safe(error,files,removedDirectories)}
 finally{if(active)pending.delete(active)}
}
