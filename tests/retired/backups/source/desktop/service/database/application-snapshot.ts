import {PGlite} from '@electric-sql/pglite'
import {opendirSync} from 'node:fs'
import {mkdir,readdir,lstat} from 'node:fs/promises'
import {join,relative} from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {RootIdentity} from '../../core/data-root'
import {assertDirectory,directoryIdentity,hashRegular,managedPath,readMetadata,rootIdentitySchema,rootMarkerSchema,sameIdentity,syncDirectory,within} from '../../core/root-ownership'
import {canonical,copyFile,createTreeDirectories,inspectTree,assertDirectoryImmediately,assertTreeImmediately,type StoredTree} from '../../core/application-backup-files'
import {APPLICATION_BACKUP_LIMITS as limits} from '../../shared/application-backup'
import {validateEngineArchive} from './backup-archive'
import packageInfo from '../../../package.json'

export interface ApplicationSnapshotHost {
 /** Trusted worker owns both the app root and its private staging parent. */
 assertOwner(directory:RootIdentity):void|Promise<void>
 /** Keep this exact inbox connection leased while the capture is in progress. */
 assertLiveInbox(engine:PGlite,source:RootIdentity):void|Promise<void>
 /** Acquire only after both engine mutexes; release before candidate import. */
 withMetadataSnapshot?<T>(run:()=>Promise<T>):Promise<T>
}
export interface ApplicationSnapshotOptions {hook?:(phase:'after-dump'|'before-import'|'before-seal')=>void|Promise<void>}
export interface CapturedApplicationRoot {directory:RootIdentity;appId:string;engine:{pglite:string;postgresMajor:number};tree:StoredTree}
const fixed=['xuanxiang-app.json','catalog.json','state.json','drafts.json','backup-plan.json','restore-draft-barrier.json','application-restore-drafts.json']
const metadataLimit=64*1024*1024
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT'
function assertStagingCapacity(root:RootIdentity,reserve=0){
 assertDirectoryImmediately(root)
 const directory=opendirSync(root.path);let count=0
 try{while(directory.readSync()){if(++count>limits.packages-reserve)throw Error('APPLICATION_BACKUP_LIMIT')}}finally{directory.closeSync()}
 assertDirectoryImmediately(root)
}
async function metadataInventory(root:RootIdentity,guard:()=>Promise<void>){
 const files:string[]=[],directories:RootIdentity[]=[]
 const check=async(path:string)=>{await guard();const info=await lstat(await managedPath(root,path));if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>metadataLimit)throw Error('APPLICATION_SNAPSHOT_UNSAFE');files.push(path)}
 for(const path of fixed){try{await check(path)}catch(error){if(!missing(error)||['xuanxiang-app.json','catalog.json'].includes(path))throw error}}
 for(const path of ['assets','assets/global']){
  let identity:RootIdentity
  try{identity=await directoryIdentity(await managedPath(root,path))}catch(error){if(missing(error))break;throw error}
  directories.push(identity);await guard();await assertDirectory(identity)
  if(path==='assets/global')for(const name of (await readdir(identity.path)).sort()){
   if(!name.endsWith('.png')||!z.uuid().safeParse(name.slice(0,-4)).success)continue
   if(files.length>=limits.files)throw Error('APPLICATION_BACKUP_LIMIT')
   await check('assets/global/'+name)
  }
 }
 const result:Record<string,Awaited<ReturnType<typeof hashRegular>>>={};let bytes=0
 for(const path of files.sort()){
  const absolute=await managedPath(root,path)
  result[path]=await hashRegular(absolute,async()=>{await guard();for(const dir of directories)await assertDirectory(dir);if((await lstat(absolute)).size>metadataLimit)throw Error('APPLICATION_BACKUP_LIMIT')})
  bytes+=result[path].size;if(bytes>limits.bytes-limits.fileBytes)throw Error('APPLICATION_BACKUP_LIMIT')
 }
 for(const dir of directories)await assertDirectory(dir)
 await guard();return{files:result,directories}
}
/** Capture an online engine using its mutexes; never copy its live database
 * files. Import only the captured archive into an owned isolated root and close
 * that engine before returning it to ApplicationBackups' closed-source API.
 */
export async function captureApplicationRoot(source:RootIdentity,parent:RootIdentity,engine:PGlite,host:ApplicationSnapshotHost,signal?:AbortSignal,options:ApplicationSnapshotOptions={}):Promise<CapturedApplicationRoot>{
 const original=Object.freeze(rootIdentitySchema.parse(structuredClone(source))),staging=Object.freeze(rootIdentitySchema.parse(structuredClone(parent)))
 const guard=async()=>{signal?.throwIfAborted();await host.assertOwner(original);await host.assertOwner(staging);await host.assertLiveInbox(engine,original);await assertDirectory(original);await assertDirectory(staging);signal?.throwIfAborted()}
 await guard()
 // A private staging folder may live under root/backups, but never in the
 // source engine, avatar or Chromium trees, or at/above the application root.
 if(sameIdentity(original,staging)||within(original.path,staging.path)||['inbox','assets','session'].some(name=>within(staging.path,join(original.path,name))))throw Error('APPLICATION_SNAPSHOT_TARGET_INVALID')
 assertStagingCapacity(staging,1)
 const marker=rootMarkerSchema.parse(await readMetadata(join(original.path,'xuanxiang-app.json')))
 if(marker.phase!=='ready'||!marker.inboxReady)throw Error('APPLICATION_SNAPSHOT_SOURCE_INVALID')
 const postgres=(await engine.query<{server_version:string}>('SHOW server_version')).rows[0].server_version,postgresMajor=Number(postgres.split('.')[0])
 if(!Number.isSafeInteger(postgresMajor)||postgresMajor<1)throw Error('APPLICATION_SNAPSHOT_ENGINE_INVALID')
 let directory!:RootIdentity
 const targetGuard=async()=>{await guard();await assertDirectory(directory)}
 const copiedMetadata:StoredTree['files']=[];let targetDirectories:RootIdentity[]=[]
 const capture=async()=>{
  // Include the preliminary scan in the same metadata lease: autosave can
  // legitimately create/replace a journal even before the export begins.
  await metadataInventory(original,guard)
  await guard();assertStagingCapacity(staging,1);const created=join(staging.path,randomUUID());await mkdir(created,{mode:0o700})
  directory=await directoryIdentity(created)
  const before=await metadataInventory(original,targetGuard)
  targetDirectories=await createTreeDirectories(directory,before.directories.map(d=>relative(original.path,d.path).split('\\').join('/')),targetGuard)
  for(const path of Object.keys(before.files))copiedMetadata.push(await copyFile(original,directory,path,targetGuard,before.directories,targetDirectories))
  await targetGuard();await engine.syncToFs();const dump=await engine.dumpDataDir('gzip')
  if(dump.size>limits.fileBytes)throw Error('APPLICATION_BACKUP_LIMIT')
  const bytes=Buffer.from(await dump.arrayBuffer());await options.hook?.('after-dump')
  const after=await metadataInventory(original,targetGuard)
  if(canonical(before)!==canonical(after))throw Error('APPLICATION_SNAPSHOT_CHANGED')
  for(const copied of copiedMetadata){const originalFile=before.files[copied.path];if(copied.size!==originalFile.size||copied.sha256!==originalFile.sha256)throw Error('APPLICATION_SNAPSHOT_CHANGED')}
  await targetGuard();return bytes
 }
 const archive=await engine._runExclusiveTransaction(()=>engine.runExclusive(()=>host.withMetadataSnapshot?host.withMetadataSnapshot(capture):capture()))
 await options.hook?.('before-import');await targetGuard()
 if(canonical(rootMarkerSchema.parse(await readMetadata(join(directory.path,'xuanxiang-app.json'))))!==canonical(marker))throw Error('APPLICATION_SNAPSHOT_CHANGED')
 const tar=await validateEngineArchive(archive,postgresMajor)
 await targetGuard();await mkdir(join(directory.path,'inbox'),{mode:0o700});const inbox=await directoryIdentity(join(directory.path,'inbox'))
 await targetGuard();await assertDirectory(inbox);await mkdir(join(inbox.path,'database'),{mode:0o700});const database=await directoryIdentity(join(inbox.path,'database'))
 let candidate:PGlite|undefined
 try{
  await targetGuard();await assertDirectory(inbox);await assertDirectory(database);if((await readdir(database.path)).length)throw Error('APPLICATION_SNAPSHOT_TARGET_INVALID')
  candidate=await PGlite.create({dataDir:database.path,loadDataDir:new Blob([new Uint8Array(tar)],{type:'application/x-tar'}),relaxedDurability:false})
  await targetGuard();await assertDirectory(inbox);await assertDirectory(database);await candidate.close();candidate=undefined
  await options.hook?.('before-seal');await targetGuard();await assertDirectory(inbox);await assertDirectory(database)
  const tree=await inspectTree(directory,targetGuard)
  for(const file of copiedMetadata)if(canonical(tree.files.find(row=>row.path===file.path))!==canonical(file))throw Error('APPLICATION_SNAPSHOT_CHANGED')
  for(const dir of [...tree.directories].sort((a,b)=>b.path.length-a.path.length))await syncDirectory(dir.path)
  await syncDirectory(directory.path);await syncDirectory(staging.path);await targetGuard()
  // No asynchronous host callback or cleanup may yield between this final
  // identity/content seal and returning the closed snapshot's proof.
  signal?.throwIfAborted();assertDirectoryImmediately(original);assertStagingCapacity(staging);assertTreeImmediately(directory,tree)
  return{directory,appId:marker.id,engine:{pglite:packageInfo.dependencies['@electric-sql/pglite'],postgresMajor},tree}
 }finally{if(candidate)await candidate.close()}
}
