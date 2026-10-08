import {constants,lstatSync,realpathSync,readdirSync,renameSync,unlinkSync} from 'node:fs'
import {open,lstat,mkdir,readdir} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {join,dirname,basename} from 'node:path'
import type {RootIdentity} from './data-root'
import {assertDirectory,directoryIdentity,hashRegular,managedPath,sameIdentity,within,safeRelative,syncDirectory,type FileIdentity} from './root-ownership'
import {APPLICATION_BACKUP_LIMITS as limits,type ApplicationBackup} from '../shared/application-backup'
export type Guard=()=>void|Promise<void>
export type StoredFile=ApplicationBackup['files'][number]&{identity:FileIdentity;revision:{size:string;mtimeNs:string;ctimeNs:string}}
export interface StoredTree{files:StoredFile[];directories:RootIdentity[]}
type MetadataProof={device:string;inode:string;size:string;mtimeNs:string;ctimeNs:string}
/** Finish an already hashed proof without yielding to an owner callback or another JS task. */
export function assertDirectoryImmediately(root:RootIdentity){
 const info=lstatSync(root.path,{bigint:true})
 if(!info.isDirectory()||info.isSymbolicLink()||String(info.dev)!==root.device||String(info.ino)!==root.inode||realpathSync(root.path)!==root.path)throw Error('APPLICATION_BACKUP_CHANGED')
}
export function assertFileImmediately(root:RootIdentity,path:string,proof:{device:string;inode:string;size:string;mtimeNs:string;ctimeNs:string}){
 if(!safeRelative(path))throw Error('APPLICATION_BACKUP_CHANGED')
 const info=lstatSync(join(root.path,...path.split('/')),{bigint:true})
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||String(info.dev)!==proof.device||String(info.ino)!==proof.inode||String(info.size)!==proof.size||String(info.mtimeNs)!==proof.mtimeNs||String(info.ctimeNs)!==proof.ctimeNs)throw Error('APPLICATION_BACKUP_CHANGED')
}
export function assertTreeImmediately(root:RootIdentity,tree:StoredTree,ownedExtraNames:readonly string[]=[]){
 assertDirectoryImmediately(root)
 const members=new Map<string,string[]>([[root.path,[]]])
 for(const directory of tree.directories){assertDirectoryImmediately(directory);members.set(directory.path,[])}
 for(const directory of tree.directories){const names=members.get(dirname(directory.path));if(!names)throw Error('APPLICATION_BACKUP_CHANGED');names.push(basename(directory.path))}
 for(const file of tree.files){
  assertFileImmediately(root,file.path,{...file.identity,...file.revision})
  const parts=file.path.split('/'),name=parts.pop()!,parent=join(root.path,...parts),names=members.get(parent);if(!names)throw Error('APPLICATION_BACKUP_CHANGED');names.push(name)
 }
 members.get(root.path)!.push(...ownedExtraNames)
 for(const [directory,expected] of members)if(canonical(readdirSync(directory).sort())!==canonical(expected.sort()))throw Error('APPLICATION_BACKUP_CHANGED')
}
/** Metadata temporaries must not borrow atomicWrite's pathname-only cleanup ownership. */
export async function writeApplicationMetadata(root:RootIdentity,path:string,content:string,options:{beforeRename:Guard;expectedTarget?:MetadataProof;immediately?:(ownedTemporary:string)=>void}){
 if(!safeRelative(path)||path.includes('/'))throw Error('APPLICATION_BACKUP_METADATA_INVALID')
 const bytes=Buffer.from(content,'utf8');if(bytes.length>limits.metadataBytes)throw Error('APPLICATION_BACKUP_LIMIT')
 await assertDirectory(root);const temporary='.'+randomUUID()+'.tmp',target=join(root.path,path),tempPath=join(root.path,temporary)
 let owned:MetadataProof|undefined,committed=false
 try{
  const handle=await open(tempPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
  try{await handle.writeFile(bytes);await handle.sync();const info=await handle.stat({bigint:true});owned={device:String(info.dev),inode:String(info.ino),size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)}}finally{await handle.close()}
  const actual=await readBoundedBytes(root,temporary,limits.metadataBytes,()=>{})
  if(!actual.equals(bytes))throw Error('APPLICATION_BACKUP_CHANGED')
  await options.beforeRename()
  assertDirectoryImmediately(root);assertFileImmediately(root,temporary,owned)
  if(options.expectedTarget)assertFileImmediately(root,path,options.expectedTarget)
  else{let exists=false;try{lstatSync(target);exists=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}if(exists)throw Error('APPLICATION_BACKUP_CHANGED')}
  options.immediately?.(temporary)
  renameSync(tempPath,target);committed=true
  // rename legitimately changes ctime. Capture only that owned inode's new
  // revision synchronously, then protect it across all subsequent awaits.
  const after=lstatSync(target,{bigint:true})
  if(!after.isFile()||after.nlink!==1n||String(after.dev)!==owned.device||String(after.ino)!==owned.inode||String(after.size)!==owned.size||String(after.mtimeNs)!==owned.mtimeNs)throw Error('APPLICATION_BACKUP_CHANGED')
  owned={...owned,ctimeNs:String(after.ctimeNs)}
  await syncDirectory(root.path)
  assertDirectoryImmediately(root);assertFileImmediately(root,path,owned)
 }finally{
  if(owned&&!committed)try{assertDirectoryImmediately(root);assertFileImmediately(root,temporary,owned);unlinkSync(tempPath)}catch{/* Preserve all foreign replacements or uncertain partial writes. */}
 }
}
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
export const compareText=(a:string,b:string)=>a<b?-1:a>b?1:0
export function canonical(value:unknown):string{return JSON.stringify(stable(value))}
function stable(value:unknown):unknown{return Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)])):value}
export async function guardPath(root:RootIdentity,path:string,guard:Guard,parents?:readonly RootIdentity[]){
 await guard();await assertDirectory(root)
 if(parents)for(const parent of parents)if(within(join(root.path,path),parent.path))await assertDirectory(parent)
 return managedPath(root,path)
}
export async function inspectTree(root:RootIdentity,guard:Guard):Promise<StoredTree>{
 const files:StoredFile[]=[],directories:RootIdentity[]=[];let bytes=0,visited=0
 async function walk(relative:string){
  await guard();await assertDirectory(root)
  const current=relative?await directoryIdentity(await managedPath(root,relative)):root
  if(relative){directories.push(current);if(directories.length>limits.directories)throw Error('APPLICATION_BACKUP_LIMIT')}
  const names=await readdir(current.path);await assertDirectory(current)
  for(const name of names.sort()){
   if(++visited>limits.files+limits.directories)throw Error('APPLICATION_BACKUP_LIMIT')
   const path=relative?relative+'/'+name:name,absolute=await guardPath(root,path,guard,directories),info=await lstat(absolute,{bigint:true})
   if(info.isSymbolicLink())throw Error('APPLICATION_BACKUP_UNSAFE')
   if(info.isDirectory())await walk(path)
   else{
    if(!info.isFile()||info.nlink!==1n||info.size>BigInt(limits.fileBytes)||files.length>=limits.files)throw Error('APPLICATION_BACKUP_UNSAFE')
    bytes+=Number(info.size);if(bytes>limits.bytes)throw Error('APPLICATION_BACKUP_LIMIT')
    const file=await hashRegular(absolute,async()=>{await guardPath(root,path,guard,directories);if((await lstat(absolute)).size>limits.fileBytes)throw Error('APPLICATION_BACKUP_LIMIT')})
    files.push({path,size:file.size,sha256:file.sha256,identity:file.identity,revision:file.revision})
   }
  }
  await assertDirectory(current)
 }
 await walk('');await guard();await assertDirectory(root)
 for(const file of files){
  const info=await lstat(await guardPath(root,file.path,guard,directories),{bigint:true})
  if(!info.isFile()||info.nlink!==1n||!sameIdentity({device:String(info.dev),inode:String(info.ino)},file.identity)||String(info.size)!==file.revision.size||String(info.mtimeNs)!==file.revision.mtimeNs||String(info.ctimeNs)!==file.revision.ctimeNs)throw Error('APPLICATION_BACKUP_CHANGED')
 }
 for(const directory of directories)await assertDirectory(directory)
 return{files:files.sort((a,b)=>compareText(a.path,b.path)),directories:directories.sort((a,b)=>compareText(a.path,b.path))}
}
export async function createTreeDirectories(root:RootIdentity,paths:readonly string[],guard:Guard){
 const result:RootIdentity[]=[]
 for(const path of [...paths].sort((a,b)=>a.split('/').length-b.split('/').length||compareText(a,b))){
  const absolute=await guardPath(root,path,guard,result);await mkdir(absolute,{mode:0o700});const identity=await directoryIdentity(absolute);result.push(identity);await guardPath(root,path,guard,result)
 }
 return result
}
export async function copyFile(source:RootIdentity,destination:RootIdentity,path:string,guard:Guard,sourceParents:readonly RootIdentity[]=[],targetParents:readonly RootIdentity[]=[]):Promise<StoredFile>{
 const from=await guardPath(source,path,guard,sourceParents),to=await guardPath(destination,path,guard,targetParents)
 const before=await lstat(from,{bigint:true})
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(limits.fileBytes))throw Error('APPLICATION_BACKUP_UNSAFE')
 const input=await open(from,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{
  const opened=await input.stat({bigint:true})
  if(!sameIdentity({device:String(before.dev),inode:String(before.ino)},{device:String(opened.dev),inode:String(opened.ino)})||opened.nlink!==1n||opened.size!==before.size)throw Error('APPLICATION_BACKUP_CHANGED')
  const output=await open(to,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
  let identity:FileIdentity
  const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);let size=0
  try{
   const created=await output.stat({bigint:true});identity={device:String(created.dev),inode:String(created.ino)}
   for(;;){
    await guardPath(source,path,guard,sourceParents);await guardPath(destination,path,guard,targetParents)
    const {bytesRead}=await input.read(buffer,0,buffer.length,null);if(!bytesRead)break
    size+=bytesRead;if(size>limits.fileBytes||size>Number(opened.size))throw Error('APPLICATION_BACKUP_CHANGED')
    const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);await output.writeFile(chunk)
   }
   await output.sync()
  }finally{await output.close()}
  const after=await input.stat({bigint:true}),current=await lstat(await guardPath(source,path,guard,sourceParents),{bigint:true})
  if(size!==Number(opened.size)||opened.size!==after.size||opened.mtimeNs!==after.mtimeNs||opened.ctimeNs!==after.ctimeNs||current.dev!==opened.dev||current.ino!==opened.ino||current.nlink!==1n||current.size!==after.size||current.mtimeNs!==after.mtimeNs||current.ctimeNs!==after.ctimeNs)throw Error('APPLICATION_BACKUP_CHANGED')
  const copied=await hashRegular(await guardPath(destination,path,guard,targetParents),async()=>{const absolute=await guardPath(destination,path,guard,targetParents);if((await lstat(absolute)).size>limits.fileBytes)throw Error('APPLICATION_BACKUP_LIMIT')})
  const sha256=hash.digest('hex');if(!sameIdentity(copied.identity,identity!)||copied.sha256!==sha256||copied.size!==size)throw Error('APPLICATION_BACKUP_VERIFY_FAILED')
  return{path,size,sha256,identity:copied.identity,revision:copied.revision}
 }finally{await input.close()}
}
export function publicFiles(files:StoredFile[]){return files.map(({path,size,sha256})=>({path,size,sha256}))}
export async function readBoundedBytes(root:RootIdentity,path:string,max:number,guard:Guard){
 const absolute=await guardPath(root,path,guard),before=await lstat(absolute,{bigint:true})
 if(!before.isFile()||before.nlink!==1n||before.size>BigInt(max))throw Error('APPLICATION_BACKUP_LIMIT')
 const handle=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW),chunks:Buffer[]=[],buffer=Buffer.alloc(256*1024);let size=0
 try{
  const opened=await handle.stat({bigint:true});if(opened.dev!==before.dev||opened.ino!==before.ino||opened.nlink!==1n||opened.size!==before.size)throw Error('APPLICATION_BACKUP_CHANGED')
  for(;;){await guardPath(root,path,guard);const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,max+1-size),null);if(!bytesRead)break;size+=bytesRead;if(size>max)throw Error('APPLICATION_BACKUP_LIMIT');chunks.push(Buffer.from(buffer.subarray(0,bytesRead)))}
  const after=await handle.stat({bigint:true}),current=await lstat(await guardPath(root,path,guard),{bigint:true})
  if(opened.size!==after.size||opened.mtimeNs!==after.mtimeNs||opened.ctimeNs!==after.ctimeNs||current.dev!==opened.dev||current.ino!==opened.ino||current.nlink!==1n||current.size!==after.size||current.mtimeNs!==after.mtimeNs||current.ctimeNs!==after.ctimeNs)throw Error('APPLICATION_BACKUP_CHANGED')
  return Buffer.concat(chunks,size)
 }finally{await handle.close()}
}
