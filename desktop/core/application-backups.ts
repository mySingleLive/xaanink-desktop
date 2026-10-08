import {BRAND_NAMES} from '../shared/brand-names'
import {applicationNames} from "./brand-names"
import {constants,unlinkSync,rmdirSync,readdirSync,opendirSync} from 'node:fs'
import {open,lstat,mkdir,readdir} from 'node:fs/promises'
import {join,relative,isAbsolute} from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {RootIdentity} from './data-root'
import {applicationBackupSchema,APPLICATION_BACKUP_LIMITS as limits,type ApplicationBackup} from '../shared/application-backup'
import {assertDirectory,directoryIdentity,rootIdentitySchema,rootMarkerSchema,readMetadata,managedPath,sameIdentity,syncDirectory,allowedManagedFile,allowedManagedDirectory,hashRegular,within} from './root-ownership'
import {collectClosedRootFiles} from '../main/owned-root-files'
import {canonical,digest,compareText,inspectTree,copyFile,createTreeDirectories,publicFiles,assertTreeImmediately,assertDirectoryImmediately,assertFileImmediately,writeApplicationMetadata,type StoredTree} from './application-backup-files'
export interface ApplicationBackupHost{
 assertOwner(directory:RootIdentity):void|Promise<void>
 assertClosed(source:RootIdentity):void|Promise<void>
 /** Mandatory: validate a separate owned copy with the actual inbox engine/migrations. Never open the source or sealed package. */
 verifyCaptured(backup:ApplicationBackup,signal?:AbortSignal):Promise<void>
}
export interface ApplicationBackupOptions{hook?:(phase:'file-copied'|'before-seal'|'before-prune',path:string)=>void|Promise<void>}
export interface VerifiedApplicationBackup{receipt:ApplicationBackup;directory:RootIdentity;data:RootIdentity;tree:StoredTree;metadata:{device:string;inode:string;size:string;mtimeNs:string;ctimeNs:string}}
const metadataName='xuanxiang-app-backup.json'
const appFile=(p:string)=>allowedManagedFile(p)&&!p.startsWith('backups/')&&!p.startsWith('session/')&&!p.startsWith('inbox/snapshots/')&&!BRAND_NAMES.some(names=>p.startsWith(names.rootRecoveryPrefix))
const appDirectory=(p:string)=>allowedManagedDirectory(p)&&p!=='backups'&&!p.startsWith('backups/')&&p!=='session'&&!p.startsWith('session/')&&p!=='inbox/snapshots'&&!p.startsWith('inbox/snapshots/')
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b)
export class ApplicationBackups{
 readonly directory:RootIdentity;readonly appId:string;readonly engine:{pglite:string;postgresMajor:number}
 private queue:Promise<unknown>=Promise.resolve()
 constructor(directory:RootIdentity,appId:string,engine:{pglite:string;postgresMajor:number},readonly host:ApplicationBackupHost,readonly options:ApplicationBackupOptions={}){
  this.directory=Object.freeze(rootIdentitySchema.parse(structuredClone(directory)));this.appId=z.uuid().parse(appId)
  if(typeof host.verifyCaptured!=='function')throw Error('APPLICATION_BACKUP_VERIFIER_REQUIRED')
  this.engine=Object.freeze(z.object({pglite:z.string().min(1).max(40),postgresMajor:z.number().int().positive()}).strict().parse(structuredClone(engine)))
 }
 private serialize<T>(operation:()=>Promise<T>){const work=this.queue.then(operation);this.queue=work.catch(()=>{});return work}
 private containerEntries(reserve=0){
  assertDirectoryImmediately(this.directory);const directory=opendirSync(this.directory.path),entries:string[]=[]
  try{for(;;){const entry=directory.readSync();if(!entry)break;if(entries.length>=limits.packages-reserve)throw Error('APPLICATION_BACKUP_LIMIT');entries.push(entry.name)}}finally{directory.closeSync()}
  return entries
 }
 async assertOwned(signal?:AbortSignal){signal?.throwIfAborted();await this.host.assertOwner(this.directory);await assertDirectory(this.directory);signal?.throwIfAborted()}
 private async assertSource(source:RootIdentity,signal?:AbortSignal){await this.assertOwned(signal);await this.host.assertOwner(source);await this.host.assertClosed(source);await assertDirectory(source);signal?.throwIfAborted()}
 private async assertStorageTarget(source:RootIdentity){
  // A broad host lease cannot turn engine, avatar/cache or work directories
  // into backup containers. A dedicated unlisted subdirectory of root is OK.
  const catalog=z.object({value:z.array(z.object({path:z.string().refine(isAbsolute)}).passthrough())}).passthrough().parse(await readMetadata(join(source.path,'catalog.json')))
  if(sameIdentity(this.directory,source)||within(source.path,this.directory.path)||['inbox','assets','session'].some(path=>within(this.directory.path,join(source.path,path)))||catalog.value.some(work=>within(this.directory.path,work.path)))throw Error('APPLICATION_BACKUP_TARGET_UNSAFE')
 }
 private validate(value:unknown,id:string){
  const receipt=applicationBackupSchema.parse(value),{checksum,...body}=receipt
  if(checksum!==digest(canonical(body))||receipt.id!==id||receipt.appId!==this.appId||!same(receipt.engine,this.engine))throw Error('APPLICATION_BACKUP_VERIFY_FAILED')
  const paths=[...receipt.files.map(f=>f.path),...receipt.directories]
  if(new Set(paths.map(p=>p.toLowerCase())).size!==paths.length||receipt.files.some(f=>!appFile(f.path))||receipt.directories.some(p=>!appDirectory(p))||receipt.bytes!==receipt.files.reduce((n,f)=>n+f.size,0))throw Error('APPLICATION_BACKUP_MANIFEST_INVALID')
  if(!(BRAND_NAMES.filter(names=>receipt.files.some(file=>file.path===names.appMarker)).length===1&&['catalog.json','inbox/database/PG_VERSION'].every(p=>receipt.files.some(f=>f.path===p))))throw Error('APPLICATION_BACKUP_INCOMPLETE')
  return receipt
 }
 async inspect(id:string,signal?:AbortSignal):Promise<VerifiedApplicationBackup>{
  z.uuid().parse(id);const guard=()=>this.assertOwned(signal);await guard()
  const directory=await directoryIdentity(join(this.directory.path,id)),path=await managedPath(directory,metadataName)
  const metadata=await lstat(path,{bigint:true}),receipt=this.validate(await readMetadata(path,limits.metadataBytes),id),afterRead=await lstat(path,{bigint:true})
  if(metadata.dev!==afterRead.dev||metadata.ino!==afterRead.ino||metadata.size!==afterRead.size||metadata.mtimeNs!==afterRead.mtimeNs||metadata.ctimeNs!==afterRead.ctimeNs||afterRead.nlink!==1n)throw Error('APPLICATION_BACKUP_CHANGED')
  if(!same((await readdir(directory.path)).sort(),['data',metadataName].sort()))throw Error('APPLICATION_BACKUP_UNKNOWN_CONTENT')
  const data=await directoryIdentity(await managedPath(directory,'data')),tree=await inspectTree(data,async()=>{await guard();await assertDirectory(directory)})
  if(!same(publicFiles(tree.files),receipt.files)||!same(tree.directories.map(d=>relative(data.path,d.path).split('\\').join('/')).sort(),receipt.directories))throw Error('APPLICATION_BACKUP_VERIFY_FAILED')
  const marker=rootMarkerSchema.parse(await readMetadata(join(data.path,applicationNames(data).appMarker)))
  if(marker.id!==this.appId||marker.phase!=='ready'||!marker.inboxReady)throw Error('APPLICATION_BACKUP_APP_MISMATCH')
  const inventory=await collectClosedRootFiles(data,guard,{includeApplicationBackups:false})
  if(!same(inventory.files.filter(appFile),receipt.files.map(f=>f.path).sort())||!same(inventory.directories.filter(appDirectory),receipt.directories)||inventory.preserved.length)throw Error('APPLICATION_BACKUP_MANIFEST_INVALID')
  const pg=await open(await managedPath(data,'inbox/database/PG_VERSION'),constants.O_RDONLY|constants.O_NOFOLLOW)
  try{const buffer=Buffer.alloc(81),{bytesRead}=await pg.read(buffer,0,81,0);if(bytesRead>80||Number(buffer.subarray(0,bytesRead).toString('utf8').trim())!==this.engine.postgresMajor)throw Error('APPLICATION_BACKUP_ENGINE_MISMATCH')}finally{await pg.close()}
  for(const file of tree.files){await guard();const info=await lstat(await managedPath(data,file.path),{bigint:true});if(!info.isFile()||info.nlink!==1n||!sameIdentity({device:String(info.dev),inode:String(info.ino)},file.identity)||String(info.size)!==file.revision.size||String(info.mtimeNs)!==file.revision.mtimeNs||String(info.ctimeNs)!==file.revision.ctimeNs)throw Error('APPLICATION_BACKUP_CHANGED')}
  await guard();await assertDirectory(directory);await assertDirectory(data);for(const d of tree.directories)await assertDirectory(d)
  const end=await lstat(path,{bigint:true});if(end.dev!==metadata.dev||end.ino!==metadata.ino||end.mtimeNs!==metadata.mtimeNs||end.ctimeNs!==metadata.ctimeNs||end.nlink!==1n)throw Error('APPLICATION_BACKUP_CHANGED')
  return{receipt,directory,data,tree,metadata:{device:String(end.dev),inode:String(end.ino),size:String(end.size),mtimeNs:String(end.mtimeNs),ctimeNs:String(end.ctimeNs)}}
 }
 read(id:string,signal?:AbortSignal):Promise<ApplicationBackup>{return this.serialize(async()=>structuredClone((await this.inspect(id,signal)).receipt))}
 private async listing(){
  await this.assertOwned();const entries=this.containerEntries()
  const rows:VerifiedApplicationBackup[]=[]
  for(const name of entries){if(!z.uuid().safeParse(name).success)continue;try{rows.push(await this.inspect(name))}catch{await this.assertOwned()}}
  return rows.sort((a,b)=>compareText(b.receipt.createdAt,a.receipt.createdAt)||compareText(b.receipt.id,a.receipt.id))
 }
 list():Promise<ApplicationBackup[]>{return this.serialize(async()=>(await this.listing()).filter(row=>row.receipt.phase==='verified').map(row=>structuredClone(row.receipt)))}
 create(source:RootIdentity,retention:number,pins:readonly string[]=[],signal?:AbortSignal):Promise<ApplicationBackup&{retained:string[]}>{
  const original=rootIdentitySchema.parse(structuredClone(source)),protectedIds=[...pins]
  return this.serialize(async()=>{
   z.number().int().min(1).max(limits.packages).parse(retention);const pinned=new Set(z.array(z.uuid()).max(limits.packages).parse(protectedIds))
   const guard=()=>this.assertSource(original,signal);await guard();this.containerEntries(1)
   const marker=rootMarkerSchema.parse(await readMetadata(join(original.path,applicationNames(original).appMarker)))
   if(marker.id!==this.appId||marker.phase!=='ready'||!marker.inboxReady)throw Error('APPLICATION_BACKUP_APP_MISMATCH')
   await this.assertStorageTarget(original);await guard()
   const inventory=await collectClosedRootFiles(original,guard,{includeApplicationBackups:false}),paths=inventory.files.filter(appFile),dirs=inventory.directories.filter(appDirectory)
   if(paths.length>limits.files||dirs.length>limits.directories)throw Error('APPLICATION_BACKUP_LIMIT')
   const parents=await Promise.all(dirs.map(async path=>directoryIdentity(await managedPath(original,path))))
   const sources=new Map<string,Awaited<ReturnType<typeof hashRegular>>>();let sourceBytes=0
   for(const path of paths){const absolute=await managedPath(original,path),info=await lstat(absolute);if(info.size>limits.fileBytes)throw Error('APPLICATION_BACKUP_LIMIT');sourceBytes+=info.size;if(sourceBytes>limits.bytes)throw Error('APPLICATION_BACKUP_LIMIT');sources.set(path,await hashRegular(absolute,async()=>{await guard();for(const parent of parents)if(within(absolute,parent.path))await assertDirectory(parent);if((await lstat(absolute)).size>limits.fileBytes)throw Error('APPLICATION_BACKUP_LIMIT')}))}
   const old=await this.listing();await guard();this.containerEntries(1)
   const id=randomUUID(),packagePath=join(this.directory.path,id);await mkdir(packagePath,{mode:0o700});const directory=await directoryIdentity(packagePath)
   await guard();await mkdir(join(packagePath,'data'),{mode:0o700});const data=await directoryIdentity(join(packagePath,'data'))
   const copyGuard=async()=>{await guard();await assertDirectory(directory);await assertDirectory(data)}
   const targetParents=await createTreeDirectories(data,dirs,copyGuard),targetFiles:StoredTree['files']=[],files:ApplicationBackup['files']=[];let bytes=0
   for(const path of paths){const file=await copyFile(original,data,path,copyGuard,parents,targetParents);targetFiles.push(file);files.push({path,size:file.size,sha256:file.sha256});bytes+=file.size;if(bytes>limits.bytes)throw Error('APPLICATION_BACKUP_LIMIT');await this.options.hook?.('file-copied',join(packagePath,'data',path))}
   const sourceNow=await collectClosedRootFiles(original,guard,{includeApplicationBackups:false})
   if(!same(paths,sourceNow.files.filter(appFile))||!same(dirs,sourceNow.directories.filter(appDirectory)))throw Error('APPLICATION_BACKUP_CHANGED')
   for(const file of files){const actual=await hashRegular(await managedPath(original,file.path),async()=>{await copyGuard();for(const p of parents)if(within(join(original.path,file.path),p.path))await assertDirectory(p)});if(actual.sha256!==file.sha256||actual.size!==file.size||!same(actual,sources.get(file.path)))throw Error('APPLICATION_BACKUP_CHANGED')}
   const body={format:'xuanxiang-application-backup' as const,schemaVersion:1 as const,id,appId:this.appId,createdAt:new Date(Math.max(Date.now(),...old.map(o=>Date.parse(o.receipt.createdAt)+1))).toISOString(),phase:'captured' as const,engine:this.engine,files:files.sort((a,b)=>compareText(a.path,b.path)),directories:[...dirs].sort(),bytes}
   let receipt=this.validate({...body,checksum:digest(canonical(body))},id)
   await this.options.hook?.('before-seal',packagePath)
   const sealGuard=async()=>{await copyGuard();for(const d of targetParents)await assertDirectory(d)}
   await sealGuard()
   for(const d of [...targetParents].reverse())await syncDirectory(d.path)
   const encoded=JSON.stringify(receipt);if(Buffer.byteLength(encoded)>limits.metadataBytes)throw Error('APPLICATION_BACKUP_LIMIT')
   await writeApplicationMetadata(directory,metadataName,encoded,{beforeRename:sealGuard,immediately:()=>assertTreeImmediately(data,{files:targetFiles,directories:targetParents})});await syncDirectory(data.path);await syncDirectory(this.directory.path)
   let fresh=await this.inspect(id,signal)
   if(!sameIdentity(fresh.directory,directory)||fresh.receipt.checksum!==receipt.checksum||!same(fresh.tree.files,targetFiles.sort((a,b)=>compareText(a.path,b.path)))||!same(fresh.tree.directories,[...targetParents].sort((a,b)=>compareText(a.path,b.path))))throw Error('APPLICATION_BACKUP_CHANGED')
   const retained:string[]=[]
   const verifyNew=async()=>{await copyGuard();const latest=await this.inspect(id,signal);if(!sameIdentity(latest.directory,fresh.directory)||latest.receipt.checksum!==receipt.checksum||!same(latest.tree,fresh.tree)||!same(latest.metadata,fresh.metadata))throw Error('APPLICATION_BACKUP_CHANGED');this.containerEntries()}
   await verifyNew();await this.host.verifyCaptured(structuredClone(receipt),signal);await verifyNew()
   const verifiedBody={...body,phase:'verified' as const},verifiedReceipt=this.validate({...verifiedBody,checksum:digest(canonical(verifiedBody))},id)
   await writeApplicationMetadata(directory,metadataName,JSON.stringify(verifiedReceipt),{expectedTarget:fresh.metadata,immediately:()=>assertTreeImmediately(data,fresh.tree),beforeRename:async()=>{
    // The writer's owned temporary metadata lives beside the receipt. Inspect
    // data, not the package's exact-entry list, while that temporary exists.
    await copyGuard();const tree=await inspectTree(data,copyGuard)
    if(!same(tree,fresh.tree)||!same(await readMetadata(join(packagePath,metadataName),limits.metadataBytes),receipt))throw Error('APPLICATION_BACKUP_CHANGED')
    const metadata=await lstat(join(packagePath,metadataName),{bigint:true})
    if(!metadata.isFile()||metadata.nlink!==1n||String(metadata.dev)!==fresh.metadata.device||String(metadata.ino)!==fresh.metadata.inode||String(metadata.size)!==fresh.metadata.size||String(metadata.mtimeNs)!==fresh.metadata.mtimeNs||String(metadata.ctimeNs)!==fresh.metadata.ctimeNs)throw Error('APPLICATION_BACKUP_CHANGED')
   }})
   const verified=await this.inspect(id,signal)
   if(!sameIdentity(verified.directory,fresh.directory)||verified.receipt.checksum!==verifiedReceipt.checksum||!same(verified.tree,fresh.tree))throw Error('APPLICATION_BACKUP_CHANGED')
   fresh=verified;receipt=verifiedReceipt
   const newImmediately=()=>{
    signal?.throwIfAborted();this.containerEntries();assertDirectoryImmediately(fresh.directory);assertTreeImmediately(fresh.data,fresh.tree)
    assertFileImmediately(fresh.directory,metadataName,fresh.metadata)
    if(!same(readdirSync(fresh.directory.path).sort(),['data',metadataName].sort()))throw Error('APPLICATION_BACKUP_CHANGED')
   }
   for(const previous of old.filter(o=>o.receipt.phase==='verified'&&!pinned.has(o.receipt.id)).slice(retention-1)){
    await verifyNew();await this.options.hook?.('before-prune',previous.directory.path);await verifyNew()
    try{
     const current=await this.inspect(previous.receipt.id,signal)
     if(!sameIdentity(previous.directory,current.directory)||!same(previous.tree,current.tree)||!same(previous.metadata,current.metadata))throw Error('APPLICATION_BACKUP_CHANGED')
     for(const file of current.tree.files){
      await copyGuard();await assertDirectory(current.directory);for(const d of current.tree.directories)if(within(join(current.data.path,file.path),d.path))await assertDirectory(d)
      const path=await managedPath(current.data,file.path),info=await lstat(path,{bigint:true})
      if(!info.isFile()||info.nlink!==1n||!sameIdentity({device:String(info.dev),inode:String(info.ino)},file.identity)||String(info.size)!==file.revision.size||String(info.mtimeNs)!==file.revision.mtimeNs||String(info.ctimeNs)!==file.revision.ctimeNs)throw Error('APPLICATION_BACKUP_CHANGED')
      newImmediately();assertDirectoryImmediately(current.directory);assertDirectoryImmediately(current.data)
      for(const d of current.tree.directories)if(within(path,d.path))assertDirectoryImmediately(d)
      assertFileImmediately(current.data,file.path,{...file.identity,...file.revision});unlinkSync(path)
     }
     for(const d of [...current.tree.directories].sort((a,b)=>b.path.length-a.path.length)){await copyGuard();await assertDirectory(d);newImmediately();assertDirectoryImmediately(current.directory);assertDirectoryImmediately(current.data);assertDirectoryImmediately(d);rmdirSync(d.path)}
     await copyGuard();await assertDirectory(current.data);newImmediately();assertDirectoryImmediately(current.directory);assertDirectoryImmediately(current.data);rmdirSync(current.data.path)
     await assertDirectory(current.directory);const meta=await lstat(join(current.directory.path,metadataName),{bigint:true});if(String(meta.dev)!==current.metadata.device||String(meta.ino)!==current.metadata.inode||meta.nlink!==1n||String(meta.mtimeNs)!==current.metadata.mtimeNs||String(meta.ctimeNs)!==current.metadata.ctimeNs)throw Error('APPLICATION_BACKUP_CHANGED')
     newImmediately();assertDirectoryImmediately(current.directory);assertFileImmediately(current.directory,metadataName,current.metadata);unlinkSync(join(current.directory.path,metadataName))
     newImmediately();assertDirectoryImmediately(current.directory);rmdirSync(current.directory.path);await syncDirectory(this.directory.path)
    }catch{retained.push(previous.receipt.id);await copyGuard()}
   }
   await verifyNew();newImmediately();return{...structuredClone(receipt),retained}
  })
 }
}
