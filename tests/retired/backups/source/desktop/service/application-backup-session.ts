import {constants,openSync,closeSync,fstatSync,lstatSync,readSync,mkdirSync} from 'node:fs'
import {join,basename,isAbsolute} from 'node:path'
import {z} from 'zod'
import type {PGlite} from '@electric-sql/pglite'
import type {RootIdentity} from '../core/data-root'
import {ApplicationBackups} from '../core/application-backups'
import {APPLICATION_BACKUP_LIMITS,type ApplicationBackup} from '../shared/application-backup'
import {assertDirectory,directoryIdentity,rootIdentitySchema,rootMarkerSchema,readMetadata,sameIdentity,within} from '../core/root-ownership'
import {captureApplicationRoot,type CapturedApplicationRoot} from './database/application-snapshot'
import {prepareApplicationRestoreWithProof,type PreparedApplicationRestoreProof} from './database/application-restore'
import {validateApplicationMaintenanceMetadata} from './database/application-maintenance-metadata'
import {createApplicationStagingParent,cleanupApplicationStaging} from '../core/application-staging'
import type {Migration} from './database/migrations'
import packageInfo from '../../package.json'
import {catalogSchema} from './workspaces'
import {assertDirectoryImmediately} from '../core/application-backup-files'
const catalogEnvelope=z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),value:catalogSchema}).passthrough()

export interface ApplicationBackupSessionOptions {
 source:RootIdentity
 engine:PGlite
 migrations:readonly Migration[]
 /** The caller must retain the exact source inbox lease through this promise. */
 assertLive():void|Promise<void>
 withMetadataSnapshot?<T>(run:()=>Promise<T>):Promise<T>
}
export interface ApplicationBackupSessionResult {receipt:ApplicationBackup;retained:string[];cleanupPending:string[]}
interface Containers {packages:RootIdentity;staging:RootIdentity;validation:RootIdentity}
/** Worker-only orchestration. No renderer path, plaintext key or live dataDir
 * copy enters a package. A verified receipt requires a separately opened and
 * closed inbox candidate before retention or staging cleanup can begin. */
export class ApplicationBackupSession {
 private source:RootIdentity
 private migrations:Migration[]
 private known=new Map<string,RootIdentity>()
 private queue:Promise<unknown>=Promise.resolve()
 constructor(private options:ApplicationBackupSessionOptions){
  this.source=Object.freeze(rootIdentitySchema.parse(structuredClone(options.source)))
  this.migrations=structuredClone([...options.migrations]);this.known.set(this.source.path,this.source)
 }
 private serial<T>(run:()=>Promise<T>){const work=this.queue.then(run);this.queue=work.catch(()=>{});return work}
 private namespace(value:unknown){
  const catalog=catalogEnvelope.parse(value),namespace=join(this.source.path,'backups/application')
  if(catalog.value.some(work=>!isAbsolute(work.path)||within(namespace,work.path)||within(work.path,namespace)))throw Error('APPLICATION_BACKUP_NAMESPACE_OVERLAPS_WORK')
 }
 private namespaceImmediately(){
  // An inbox lease alone does not freeze the catalog. No host callback or JS
  // task may register a work between the last catalog proof and our mkdir.
  assertDirectoryImmediately(this.source)
  const path=join(this.source.path,'catalog.json'),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW)
  try{
   const before=fstatSync(fd,{bigint:true})
   if(!before.isFile()||before.nlink!==1n||before.size>BigInt(APPLICATION_BACKUP_LIMITS.metadataBytes))throw Error('APPLICATION_BACKUP_NAMESPACE_INVALID')
   const buffer=Buffer.alloc(Number(before.size)+1);let bytes=0
   while(bytes<buffer.length){const count=readSync(fd,buffer,bytes,buffer.length-bytes,bytes);if(!count)break;bytes+=count}
   const after=fstatSync(fd,{bigint:true}),current=lstatSync(path,{bigint:true})
   for(const value of [after,current])if(!value.isFile()||value.isSymbolicLink()||value.nlink!==1n||value.dev!==before.dev||value.ino!==before.ino||value.size!==before.size||value.mtimeNs!==before.mtimeNs||value.ctimeNs!==before.ctimeNs)throw Error('APPLICATION_BACKUP_NAMESPACE_CHANGED')
   if(bytes!==Number(before.size))throw Error('APPLICATION_BACKUP_NAMESPACE_CHANGED')
   assertDirectoryImmediately(this.source);this.namespace(JSON.parse(buffer.subarray(0,bytes).toString('utf8')))
  }finally{closeSync(fd)}
 }
 private async guard(signal?:AbortSignal){signal?.throwIfAborted();await this.options.assertLive();await assertDirectory(this.source);signal?.throwIfAborted();this.namespaceImmediately()}
 private async ensure(parent:RootIdentity,name:string,signal?:AbortSignal){
  const path=join(parent.path,name),known=this.known.get(path);await this.guard(signal);await assertDirectory(parent)
  this.namespaceImmediately();assertDirectoryImmediately(parent)
  if(known){assertDirectoryImmediately(known);return known}
  try{mkdirSync(path,{mode:0o700})}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}
  const directory=await directoryIdentity(path);await this.guard(signal);await assertDirectory(parent);await assertDirectory(directory);this.known.set(path,directory);return directory
 }
 private async containers(signal?:AbortSignal):Promise<Containers>{
  await this.guard(signal)
  this.namespace(await readMetadata(join(this.source.path,'catalog.json'),APPLICATION_BACKUP_LIMITS.metadataBytes))
  const backups=await this.ensure(this.source,'backups',signal),base=await this.ensure(backups,'application',signal)
  return{packages:await this.ensure(base,'packages',signal),staging:await this.ensure(base,'staging',signal),validation:await this.ensure(base,'validation',signal)}
 }
 private async guardContainers(signal?:AbortSignal){await this.guard(signal);for(const directory of this.known.values())await assertDirectory(directory)}
 private async metadata(signal?:AbortSignal){
  await this.guard(signal);const marker=rootMarkerSchema.parse(await readMetadata(join(this.source.path,'xuanxiang-app.json')))
  if(marker.phase!=='ready'||!marker.inboxReady)throw Error('APPLICATION_BACKUP_SOURCE_INVALID')
  const version=(await this.options.engine.query<{server_version:string}>('SHOW server_version')).rows[0].server_version,postgresMajor=Number(version.split('.')[0])
  if(!Number.isSafeInteger(postgresMajor)||postgresMajor<1)throw Error('APPLICATION_BACKUP_ENGINE_INVALID')
  await this.guard(signal);return{appId:marker.id,engine:{pglite:packageInfo.dependencies['@electric-sql/pglite'],postgresMajor}}
 }
 list():Promise<ApplicationBackup[]>{return this.serial(async()=>{
  const metadata=await this.metadata(),containers=await this.containers()
  const store=new ApplicationBackups(containers.packages,metadata.appId,metadata.engine,{assertOwner:async directory=>{await this.guardContainers();if(directory.path!==containers.packages.path||!sameIdentity(directory,containers.packages))throw Error('APPLICATION_BACKUP_OWNER_INVALID')},assertClosed:()=>{throw Error('APPLICATION_BACKUP_READ_ONLY')},verifyCaptured:async()=>{throw Error('APPLICATION_BACKUP_READ_ONLY')}})
  return store.list()
 })}
 create(retention:number,signal?:AbortSignal):Promise<ApplicationBackupSessionResult>{return this.serial(async()=>{
  z.number().int().min(1).max(APPLICATION_BACKUP_LIMITS.packages).parse(retention);await this.guard(signal)
  const metadata=await this.metadata(signal),containers=await this.containers(signal),scope=new Map(this.known)
  const guard=()=>this.guardContainers(signal)
  const owner=async(directory:RootIdentity)=>{await guard();const expected=scope.get(directory.path);if(!expected||!sameIdentity(directory,expected))throw Error('APPLICATION_BACKUP_OWNER_INVALID');await assertDirectory(expected)}
  const snapshot=await captureApplicationRoot(this.source,containers.staging,this.options.engine,{assertOwner:owner,withMetadataSnapshot:this.options.withMetadataSnapshot,assertLiveInbox:async(engine,source)=>{if(engine!==this.options.engine||!sameIdentity(source,this.source)||source.path!==this.source.path)throw Error('APPLICATION_BACKUP_INBOX_CHANGED');await guard()}},signal)
  if(snapshot.appId!==metadata.appId||snapshot.engine.postgresMajor!==metadata.engine.postgresMajor)throw Error('APPLICATION_BACKUP_SOURCE_CHANGED')
  scope.set(snapshot.directory.path,snapshot.directory)
  let verification:{parent:RootIdentity;proof:PreparedApplicationRestoreProof}|undefined
  const closed=(directory:RootIdentity,captured:CapturedApplicationRoot)=>{if(directory.path!==captured.directory.path||!sameIdentity(directory,captured.directory))throw Error('APPLICATION_BACKUP_SOURCE_ACTIVE')}
  const store=new ApplicationBackups(containers.packages,metadata.appId,snapshot.engine,{assertOwner:owner,assertClosed:async directory=>{await owner(directory);closed(directory,snapshot)},verifyCaptured:async(receipt,verificationSignal)=>{
   const packageProof=await store.inspect(receipt.id,verificationSignal)
   await validateApplicationMaintenanceMetadata(packageProof.data,guard)
   const parent=await createApplicationStagingParent(containers.validation,guard);scope.set(parent.path,parent)
   const proof=await prepareApplicationRestoreWithProof(store,receipt.id,parent,this.migrations,{expectedAppId:metadata.appId,assertOwner:owner},verificationSignal)
   verification={parent,proof}
  }})
  const {retained,...receipt}=await store.create(snapshot.directory,retention,[],signal),cleanupPending:string[]=[]
  // Failure before a verified receipt retains all unknown/unfinished stages.
  // Successful cleanup consumes original producer proofs, never a new inventory.
  if(verification){const {parent,proof}=verification
   try{await cleanupApplicationStaging(parent,proof.candidate.directory,proof.tree,guard,signal);await cleanupApplicationStaging(containers.validation,parent,{files:[],directories:[]},guard,signal)}catch{cleanupPending.push('validation/'+basename(parent.path))}
  }
  try{await cleanupApplicationStaging(containers.staging,snapshot.directory,snapshot.tree,guard,signal)}catch{cleanupPending.push('staging/'+basename(snapshot.directory.path))}
  await guard();return{receipt,retained,cleanupPending}
 })}
}
