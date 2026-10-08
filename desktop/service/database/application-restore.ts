import {applicationNames} from "../../core/brand-names"
import {mkdir,lstat,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {PGlite} from '@electric-sql/pglite'
import sharp from 'sharp'
import type {ApplicationBackups} from '../../core/application-backups'
import type {RootIdentity} from '../../core/data-root'
import {migrateDatabase,type Migration} from './migrations'
import {assertDirectory,directoryIdentity,managedPath,readMetadata,rootMarkerSchema,rootIdentitySchema,sameIdentity,syncDirectory,overlapping} from '../../core/root-ownership'
import {copyFile,createTreeDirectories,inspectTree,canonical,digest,readBoundedBytes,assertTreeImmediately,assertDirectoryImmediately,writeApplicationMetadata,type StoredTree} from '../../core/application-backup-files'
import {applicationCandidateSchema,APPLICATION_BACKUP_LIMITS as limits,type ApplicationRestoreCandidate} from '../../shared/application-backup'
import {LOCAL_AUTHOR_ID} from '../context'
import {stateSchema} from '../../core/settings'
import {DraftJournal} from '../../main/draft-journal'
import {collectClosedRootFiles} from '../../main/owned-root-files'
import {catalogSchema} from '../workspaces'
import {validateApplicationDraftRetentionProof,validateApplicationDraftRetentionSource,persistApplicationDraftRetention,installInertApplicationDraftJournal,validatePersistedApplicationDraftRetention,type ApplicationDraftRetentionProof} from '../../core/application-restore-drafts'
import {validateApplicationColdSourceProof,type ApplicationColdSourceProof} from '../../core/application-cold-source'
import {readRootAuthority} from '../../core/root-authority'
import type {ApplicationClosedSourceSummary} from '../../shared/application-restore'
export interface ApplicationRestoreClosedSourceBinding{kind:'closed-source';bootstrap:RootIdentity;preservation:ApplicationColdSourceProof}
export type {ApplicationRestoreCandidate} from '../../shared/application-backup'
export interface ApplicationRestoreHost{readonly expectedAppId:string;assertOwner(directory:RootIdentity):void|Promise<void>;/** Required for batch35 reseal/activation; legacy candidate-only callers may omit. */assertOwnerImmediately?(directory:RootIdentity):void}
const metadataName='.xuanxiang-application-candidate.json'
type MetadataProof={device:string;inode:string;size:string;mtimeNs:string;ctimeNs:string}
async function metadataProof(path:string):Promise<MetadataProof>{
 const info=await lstat(path,{bigint:true})
 if(!info.isFile()||info.nlink!==1n||info.size>BigInt(limits.metadataBytes))throw Error('APPLICATION_RESTORE_CANDIDATE_CHANGED')
 return{device:String(info.dev),inode:String(info.ino),size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)}
}
async function assertMetadata(directory:RootIdentity,expected:MetadataProof){
 const actual=await metadataProof(await managedPath(directory,metadataName))
 if(canonical(actual)!==canonical(expected))throw Error('APPLICATION_RESTORE_CANDIDATE_CHANGED')
}
async function assertParent(parent:RootIdentity,host:ApplicationRestoreHost,signal?:AbortSignal){signal?.throwIfAborted();await host.assertOwner(parent);await assertDirectory(parent);signal?.throwIfAborted()}
async function validateGlobal(engine:PGlite,expectedMajor:number,guard:()=>Promise<void>){
 const query=async<T>(sql:string,values:unknown[]=[])=>{await guard();const result=await engine.query<T>(sql,values);await guard();return result.rows}
 const version=await query<{server_version:string}>('SHOW server_version')
 if(Number(version[0].server_version.split('.')[0])!==expectedMajor)throw Error('APPLICATION_RESTORE_ENGINE_MISMATCH')
 const users=await query<{id:string}>('SELECT id FROM "User"')
 if(users.length!==1||users[0].id!==LOCAL_AUTHOR_ID)throw Error('APPLICATION_RESTORE_AUTHOR_MISMATCH')
 if((await query<{n:number}>('SELECT count(*)::int AS n FROM "Novel"'))[0].n!==0)throw Error('APPLICATION_RESTORE_NOT_GLOBAL')
 const columns=await query<{table_name:string;column_name:string}>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('userId','novelId')")
 const quoted=(name:string)=>'"'+name.replace(/"/g,'""')+'"'
 for(const column of columns){const condition=column.column_name==='userId'?`${quoted(column.column_name)} IS NOT NULL AND ${quoted(column.column_name)} <> $1`:`${quoted(column.column_name)} IS NOT NULL`
  const count=await query<{n:number}>(`SELECT count(*)::int AS n FROM ${quoted(column.table_name)} WHERE ${condition}`,column.column_name==='userId'?[LOCAL_AUTHOR_ID]:[])
  if(count[0].n)throw Error('APPLICATION_RESTORE_OWNER_MISMATCH')
 }
 const references=await query<{n:number}>('SELECT count(*)::int AS n FROM "AIModel" WHERE "apiKeyEncrypted" <> \'\' OR enabled = true')
 if(references[0].n)throw Error('APPLICATION_RESTORE_MODEL_REFERENCE_INVALID')
}
async function validateApplicationData(directory:RootIdentity,guard:()=>Promise<void>){
 let avatarAssetId:string|null=null
 await guard()
 const catalog=await readBoundedBytes(directory,'catalog.json',limits.metadataBytes,guard)
 try{z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),value:catalogSchema}).passthrough().parse(JSON.parse(catalog.toString('utf8')))}catch{throw Error('APPLICATION_RESTORE_CATALOG_INVALID')}
 await guard()
 try{
  const bytes=await readBoundedBytes(directory,'state.json',64*1024*1024,guard)
  try{const state=z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),value:stateSchema}).passthrough().parse(JSON.parse(bytes.toString('utf8')));avatarAssetId=state.value.settings.user.avatarAssetId}catch{throw Error('APPLICATION_RESTORE_SETTINGS_INVALID')}
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 await guard()
 try{
  // Use the existing journal's data/schema/digest validator. read() does not
  // activate an owner, execute queued requests, or write a recovery checkpoint.
  await readBoundedBytes(directory,'drafts.json',16*1024*1024+65536,guard)
  try{await new DraftJournal(directory.path).read()}catch{throw Error('APPLICATION_RESTORE_DRAFTS_INVALID')}
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 await guard()
 return{avatarAssetId}
}
/** Native host owns the selected empty parent and the backup reader. Never opens the current source or changes bootstrap. */
export interface PreparedApplicationRestoreProof {candidate:ApplicationRestoreCandidate;tree:StoredTree}
interface IssuedApplicationCandidate{parent:RootIdentity;host:ApplicationRestoreHost;nativeOwnerSeal?:()=>void;draftSource?:RootIdentity|null;draftSourceSeal?:()=>void;closedSource?:ApplicationClosedSourceSummary;closedSourceSeal?:()=>void;migrations:readonly Migration[];backups:ApplicationBackups;initialChecksum:string;fingerprint:string;activationOwner?:object}
function nativeOwnerSeal(host:ApplicationRestoreHost,parent:RootIdentity){const assertion=host.assertOwnerImmediately;if(assertion===undefined)return undefined;if(typeof assertion!=='function')throw Error('APPLICATION_RESTORE_OWNER_EXPIRED');const captured=assertion.bind(host),identity=Object.freeze(structuredClone(parent));return()=>{try{const returned:unknown=captured(identity);if(returned!==undefined){void Promise.resolve(returned).catch(()=>{});throw Error('APPLICATION_RESTORE_OWNER_EXPIRED')}}catch{throw Error('APPLICATION_RESTORE_OWNER_EXPIRED')}}}
function assertNativeOwner(issued:IssuedApplicationCandidate){if(!issued.nativeOwnerSeal)throw Error('APPLICATION_RESTORE_OWNER_SEAL_REQUIRED');issued.nativeOwnerSeal()}
// A JSON receipt/StoredTree is data, not evidence that this process performed
// the original backup, engine/schema and resource checks.
const issuedApplicationCandidates=new WeakMap<PreparedApplicationRestoreProof,IssuedApplicationCandidate>()
/** Also retain the producer's complete proof, including its metadata inode, for
 * owned staging cleanup. Never recapture unknown files after this returns. */
export async function prepareApplicationRestoreWithProof(backups:ApplicationBackups,backupId:string,parent:RootIdentity,migrations:readonly Migration[],host:ApplicationRestoreHost,signal?:AbortSignal):Promise<PreparedApplicationRestoreProof>{
 const selected=Object.freeze(structuredClone(parent)),migrationSnapshot=migrations.map(m=>Object.freeze({...m})),ownerSeal=nativeOwnerSeal(host,selected)
 if(z.uuid().parse(host.expectedAppId)!==backups.appId)throw Error('APPLICATION_RESTORE_APP_MISMATCH')
 ownerSeal?.()
 await assertParent(selected,host,signal);await backups.assertOwned(signal)
 if(await overlapping(selected,backups.directory))throw Error('APPLICATION_RESTORE_TARGET_OVERLAP')
 if((await readdir(selected.path)).length)throw Error('APPLICATION_RESTORE_TARGET_NOT_EMPTY')
 const backup=await backups.inspect(backupId,signal)
 await assertParent(selected,host,signal);if((await readdir(selected.path)).length)throw Error('APPLICATION_RESTORE_TARGET_NOT_EMPTY')
 const id=randomUUID();await mkdir(join(selected.path,id),{mode:0o700});const directory=await directoryIdentity(join(selected.path,id))
 const guard=async()=>{await assertParent(selected,host,signal);await backups.assertOwned(signal);await assertDirectory(backup.directory);await assertDirectory(backup.data);await assertDirectory(directory)}
 const targetDirectories=await createTreeDirectories(directory,backup.receipt.directories,guard),copiedFiles=[]
 for(const file of backup.receipt.files){
  const copied=await copyFile(backup.data,directory,file.path,guard,backup.tree.directories,targetDirectories)
  if(copied.sha256!==file.sha256||copied.size!==file.size)throw Error('APPLICATION_RESTORE_BACKUP_CHANGED')
  copiedFiles.push(copied)
 }
 const backupNow=await backups.inspect(backupId,signal)
 if(canonical(backupNow.tree)!==canonical(backup.tree)||canonical(backupNow.metadata)!==canonical(backup.metadata)||!sameIdentity(backupNow.directory,backup.directory))throw Error('APPLICATION_RESTORE_BACKUP_CHANGED')
 const marker=rootMarkerSchema.parse(await readMetadata(join(directory.path,applicationNames(directory).appMarker)))
 if(marker.id!==backup.receipt.appId||marker.phase!=='ready'||!marker.inboxReady)throw Error('APPLICATION_RESTORE_APP_MISMATCH')
 let engine:PGlite|undefined
 try{
  await guard();for(const d of targetDirectories)await assertDirectory(d)
  const application=await validateApplicationData(directory,guard)
  if(application.avatarAssetId&&!backup.receipt.files.some(file=>file.path===`assets/global/${application.avatarAssetId}.png`))throw Error('APPLICATION_RESTORE_AVATAR_MISSING')
  engine=await PGlite.create({dataDir:join(directory.path,'inbox/database'),relaxedDurability:false})
  await validateGlobal(engine,backup.receipt.engine.postgresMajor,guard)
  await guard();await migrateDatabase(engine,migrationSnapshot);await guard()
  await validateGlobal(engine,backup.receipt.engine.postgresMajor,guard)
  const installed=(await engine.query<{id:string;checksum:string}>('SELECT id,checksum FROM "_desktop_migrations" ORDER BY id')).rows
  if(canonical(installed)!==canonical(migrationSnapshot.map(({id,checksum})=>({id,checksum})).sort((a,b)=>a.id.localeCompare(b.id))))throw Error('APPLICATION_RESTORE_SCHEMA_MISMATCH')
  // A global PNG is an actual image, not executable markup hidden by its suffix.
  const avatars=backup.receipt.files.filter(f=>f.path.startsWith('assets/global/'))
  for(const avatar of avatars){
   await guard();if(avatar.size>10*1024*1024)throw Error('APPLICATION_RESTORE_AVATAR_LIMIT')
   const bytes=await readBoundedBytes(directory,avatar.path,10*1024*1024,guard),image=sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning'})
   const info=await image.metadata();if(info.format!=='png'||(info.pages??1)>1)throw Error('APPLICATION_RESTORE_AVATAR_INVALID');await image.stats();await guard()
  }
  await engine.close();engine=undefined;await guard()
  const tree=await inspectTree(directory,guard)
  for(const copied of copiedFiles.filter(file=>!file.path.startsWith('inbox/database/'))){
   if(canonical(tree.files.find(file=>file.path===copied.path))!==canonical(copied))throw Error('APPLICATION_RESTORE_CANDIDATE_CHANGED')
  }
  const inventory=await collectClosedRootFiles(directory,guard)
  if(inventory.preserved.length||canonical(inventory.files)!==canonical(tree.files.map(file=>file.path).sort()))throw Error('APPLICATION_RESTORE_SCHEMA_MISMATCH')
  const body={format:'xuanxiang-application-candidate' as const,schemaVersion:1 as const,id,appId:backup.receipt.appId,backupId,backupChecksum:backup.receipt.checksum,createdAt:new Date().toISOString(),phase:'ready' as const,directory,engine:backup.receipt.engine,migrations:installed,files:tree.files,directories:tree.directories}
  const receipt=applicationCandidateSchema.parse({...body,checksum:digest(canonical(body))})
  for(const d of [...tree.directories].sort((a,b)=>b.path.length-a.path.length))await syncDirectory(d.path)
  const encoded=JSON.stringify(receipt);if(Buffer.byteLength(encoded)>limits.metadataBytes)throw Error('APPLICATION_RESTORE_LIMIT')
  await writeApplicationMetadata(directory,metadataName,encoded,{beforeRename:guard,immediately:temporary=>assertTreeImmediately(directory,tree,[temporary])});await syncDirectory(selected.path)
  const verified=await verifiedCandidateProof(selected,id,host);await guard();ownerSeal?.();assertDirectoryImmediately(selected);assertTreeImmediately(verified.directory,verified.tree)
  const prepared={candidate:structuredClone(verified.receipt),tree:structuredClone(verified.tree)}
  issuedApplicationCandidates.set(prepared,{parent:structuredClone(selected),host,nativeOwnerSeal:ownerSeal,migrations:migrationSnapshot,backups,initialChecksum:verified.receipt.checksum,fingerprint:digest(canonical(prepared))})
  return prepared
 }finally{if(engine)await engine.close()}
}
export async function prepareApplicationRestore(backups:ApplicationBackups,backupId:string,parent:RootIdentity,migrations:readonly Migration[],host:ApplicationRestoreHost,signal?:AbortSignal):Promise<ApplicationRestoreCandidate>{
 const selected=Object.freeze(rootIdentitySchema.parse(structuredClone(parent)))
 const prepared=await prepareApplicationRestoreWithProof(backups,backupId,selected,migrations,host,signal)
 signal?.throwIfAborted();assertDirectoryImmediately(selected);assertTreeImmediately(prepared.candidate.directory,prepared.tree)
 return prepared.candidate
}
async function candidateFor(parent:RootIdentity,id:string,host:ApplicationRestoreHost){
 z.uuid().parse(id);await assertParent(parent,host)
 const directory=await directoryIdentity(join(parent.path,id)),path=await managedPath(directory,metadataName),metadata=await metadataProof(path),receipt=applicationCandidateSchema.parse(await readMetadata(path,limits.metadataBytes)),{checksum,...body}=receipt
 if(receipt.id!==id||receipt.appId!==z.uuid().parse(host.expectedAppId)||receipt.directory.path!==directory.path||!sameIdentity(receipt.directory,directory)||checksum!==digest(canonical(body)))throw Error('APPLICATION_RESTORE_CANDIDATE_CHANGED')
 await assertParent(parent,host);await assertMetadata(directory,metadata);return{directory,receipt,metadata}
}
/** A readonly proof: opening a candidate engine invalidates its sealed file identities/revisions. */
async function verifiedCandidateProof(parent:RootIdentity,id:string,host:ApplicationRestoreHost){
 const selected=Object.freeze(rootIdentitySchema.parse(structuredClone(parent)))
 const {directory,receipt,metadata}=await candidateFor(selected,id,host);if(receipt.phase!=='ready')throw Error('APPLICATION_RESTORE_CANCELLED')
 const tree=await inspectTree(directory,async()=>{await assertParent(selected,host);await assertDirectory(directory)})
 if(canonical(tree.files.filter(file=>file.path!==metadataName))!==canonical(receipt.files)||canonical(tree.directories)!==canonical(receipt.directories))throw Error('APPLICATION_RESTORE_CANDIDATE_CHANGED')
 for(const d of tree.directories)await assertDirectory(d)
 if(new Set(receipt.files.map(f=>f.path.toLowerCase())).size!==receipt.files.length||new Set(receipt.migrations.map(m=>m.id)).size!==receipt.migrations.length)throw Error('APPLICATION_RESTORE_SCHEMA_MISMATCH')
 await assertParent(selected,host);await assertDirectory(directory);await assertMetadata(directory,metadata)
 assertDirectoryImmediately(selected);assertTreeImmediately(directory,tree)
 return {receipt,directory,tree,selected,metadata}
}
export async function verifyApplicationRestore(parent:RootIdentity,id:string,host:ApplicationRestoreHost):Promise<ApplicationRestoreCandidate>{
 const verified=await verifiedCandidateProof(parent,id,host);assertDirectoryImmediately(verified.selected);assertTreeImmediately(verified.directory,verified.tree);return structuredClone(verified.receipt)
}
/** Caller serializes activation and cancellation. Cancellation changes only its own receipt, retaining every candidate byte. */
export async function cancelApplicationRestore(parent:RootIdentity,id:string,host:ApplicationRestoreHost,isActive:()=>Promise<boolean>):Promise<void>{
 const selected=Object.freeze(rootIdentitySchema.parse(structuredClone(parent)))
 const {directory,receipt,metadata}=await candidateFor(selected,id,host)
 if(await isActive())throw Error('APPLICATION_RESTORE_ACTIVE')
 if(receipt.phase==='cancelled')return
 const {checksum:_checksum,...old}=receipt,body={...old,phase:'cancelled' as const},next={...body,checksum:digest(canonical(body))}
 await writeApplicationMetadata(directory,metadataName,JSON.stringify(next),{expectedTarget:metadata,beforeRename:async()=>{await assertParent(selected,host);await assertDirectory(directory);if(await isActive())throw Error('APPLICATION_RESTORE_ACTIVE');await assertMetadata(directory,metadata)}})
}
export async function reSealApplicationRestoreWithProof(prepared:PreparedApplicationRestoreProof,drafts:ApplicationDraftRetentionProof,signal?:AbortSignal,source?:ApplicationRestoreClosedSourceBinding):Promise<PreparedApplicationRestoreProof>{
 const issued=issuedApplicationCandidates.get(prepared)
 if(!issued||digest(canonical(prepared))!==issued.fingerprint)throw Error('APPLICATION_RESTORE_PROOF_INVALID')
 assertNativeOwner(issued)
 signal?.throwIfAborted();await assertParent(issued.parent,issued.host,signal)
 const original=await verifiedCandidateProof(issued.parent,prepared.candidate.id,issued.host)
 if(canonical(original.receipt)!==canonical(prepared.candidate)||canonical(original.tree)!==canonical(prepared.tree))throw Error('APPLICATION_RESTORE_PROOF_INVALID')
 const expected={appId:original.receipt.appId,operationId:drafts.retention.operationId,candidateId:original.receipt.id,backup:original.directory}
 validateApplicationDraftRetentionProof(drafts,expected)
 const draftSource=validateApplicationDraftRetentionSource(drafts,expected)
 let closedSource:ApplicationClosedSourceSummary|undefined,closedSourceSeal:(()=>void)|undefined
 if(source!==undefined){
  const selected=z.object({kind:z.literal('closed-source'),bootstrap:rootIdentitySchema,preservation:z.unknown()}).strict().parse(source),authority=readRootAuthority(selected.bootstrap,()=>assertNativeOwner(issued))
  if(authority.pointer.rootId!==original.receipt.appId||!draftSource||canonical(draftSource)!==canonical(authority.pointer.root))throw Error('APPLICATION_RESTORE_SOURCE_PROOF_INVALID')
  const validated=validateApplicationColdSourceProof(selected.preservation as ApplicationColdSourceProof,{operationId:expected.operationId,bootstrap:selected.bootstrap,appId:original.receipt.appId,source:authority.pointer.root,sourcePointer:authority.pointer})
  if(canonical(validated.receipt.candidateParent)!==canonical(issued.parent))throw Error('APPLICATION_RESTORE_SOURCE_PROOF_INVALID')
  const receipt=validated.receipt;closedSource={kind:'closed-source',health:'not-verified',id:receipt.id,checksum:receipt.checksum,directory:receipt.directory,data:receipt.data};closedSourceSeal=validated.assertSourceCurrent
  validated.assertCurrent()
 }
 if(original.receipt.activation)throw Error('APPLICATION_RESTORE_ALREADY_SEALED')
 // Consume the original process capability before the first own mutation.
 // Failure preserves the partial candidate and cannot replay engine activation.
 issuedApplicationCandidates.delete(prepared)
 closedSourceSeal?.()
 const retained=await installInertApplicationDraftJournal(await persistApplicationDraftRetention(drafts,expected,()=>assertNativeOwner(issued))),retention=validatePersistedApplicationDraftRetention(retained)
 closedSourceSeal?.()
 const guard=async()=>{assertNativeOwner(issued);await assertParent(issued.parent,issued.host,signal);await issued.backups.assertOwned(signal);await assertDirectory(original.directory);validatePersistedApplicationDraftRetention(retained);assertNativeOwner(issued)}
 let engine:PGlite|undefined
 try{
  await guard();const application=await validateApplicationData(original.directory,guard)
  if(application.avatarAssetId&&!original.receipt.files.some(file=>file.path===`assets/global/${application.avatarAssetId}.png`))throw Error('APPLICATION_RESTORE_AVATAR_MISSING')
  engine=await PGlite.create({dataDir:join(original.directory.path,'inbox/database'),relaxedDurability:false})
  await validateGlobal(engine,original.receipt.engine.postgresMajor,guard)
  await guard();await migrateDatabase(engine,[...issued.migrations]);await guard()
  await validateGlobal(engine,original.receipt.engine.postgresMajor,guard)
  const installed=(await engine.query<{id:string;checksum:string}>('SELECT id,checksum FROM "_desktop_migrations" ORDER BY id')).rows
  if(canonical(installed)!==canonical(issued.migrations.map(({id,checksum})=>({id,checksum})).sort((a,b)=>a.id.localeCompare(b.id))))throw Error('APPLICATION_RESTORE_SCHEMA_MISMATCH')
  for(const avatar of original.receipt.files.filter(f=>f.path.startsWith('assets/global/'))){
   await guard();if(avatar.size>10*1024*1024)throw Error('APPLICATION_RESTORE_AVATAR_LIMIT')
   const bytes=await readBoundedBytes(original.directory,avatar.path,10*1024*1024,guard),image=sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning'}),info=await image.metadata()
   if(info.format!=='png'||(info.pages??1)>1)throw Error('APPLICATION_RESTORE_AVATAR_INVALID');await image.stats();await guard()
  }
  await engine.close();engine=undefined;await guard();closedSourceSeal?.()
  const full=await inspectTree(original.directory,guard)
  // Only the producer's two intentional draft writes and engine files may
  // differ. Never re-learn unrelated replacement data as a healthy candidate.
  for(const file of original.tree.files.filter(file=>file.path!==metadataName&&file.path!=='drafts.json'&&file.path!=='application-restore-drafts.json'&&!file.path.startsWith('inbox/database/'))){
   if(canonical(full.files.find(value=>value.path===file.path))!==canonical(file))throw Error('APPLICATION_RESTORE_CANDIDATE_CHANGED')
  }
  const tree={files:full.files.filter(file=>file.path!==metadataName),directories:full.directories},inventory=await collectClosedRootFiles(original.directory,guard)
  if(inventory.preserved.length!==1||inventory.preserved[0]!==metadataName||canonical(inventory.files)!==canonical(tree.files.map(file=>file.path).sort()))throw Error('APPLICATION_RESTORE_SCHEMA_MISMATCH')
  const{checksum:_old,...prior}=original.receipt,body={...prior,files:tree.files,directories:tree.directories,migrations:installed,activation:{operationId:retention.operationId,initialChecksum:issued.initialChecksum,retentionChecksum:retention.checksum,barrierToken:retention.barrier.token}},receipt=applicationCandidateSchema.parse({...body,checksum:digest(canonical(body))})
  for(const dir of [...tree.directories].sort((a,b)=>b.path.length-a.path.length))await syncDirectory(dir.path)
  await guard();assertTreeImmediately(original.directory,full)
  await writeApplicationMetadata(original.directory,metadataName,JSON.stringify(receipt),{expectedTarget:original.metadata,beforeRename:guard,immediately:temporary=>{assertNativeOwner(issued);closedSourceSeal?.();validatePersistedApplicationDraftRetention(retained);assertDirectoryImmediately(issued.parent);assertTreeImmediately(original.directory,full,[temporary])}})
  await syncDirectory(issued.parent.path)
  const verified=await verifiedCandidateProof(issued.parent,original.receipt.id,issued.host)
  await guard();assertNativeOwner(issued);validatePersistedApplicationDraftRetention(retained);assertDirectoryImmediately(issued.parent);assertTreeImmediately(verified.directory,verified.tree)
  const sealed={candidate:structuredClone(verified.receipt),tree:structuredClone(verified.tree)}
  closedSourceSeal?.();issuedApplicationCandidates.set(sealed,{...issued,draftSource,draftSourceSeal:()=>{validatePersistedApplicationDraftRetention(retained)},closedSource,closedSourceSeal,fingerprint:digest(canonical(sealed))});return sealed
 }finally{if(engine)await engine.close()}
}
/** Read-only grant for the cold activation core. JSON or a copied closure cannot
 * reconstruct the process capability issued by the real backup/engine producer. */
export function validatePreparedApplicationRestoreForActivation(prepared:PreparedApplicationRestoreProof){
 const issued=issuedApplicationCandidates.get(prepared)
 if(!issued||digest(canonical(prepared))!==issued.fingerprint||!prepared.candidate.activation||issued.draftSource===undefined||!issued.draftSourceSeal)throw Error('APPLICATION_RESTORE_PROOF_INVALID')
 const candidate=structuredClone(prepared.candidate),tree=structuredClone(prepared.tree)
 const assertCurrent=()=>{if(!issuedApplicationCandidates.has(prepared)||digest(canonical(prepared))!==issued.fingerprint)throw Error('APPLICATION_RESTORE_PROOF_INVALID');assertNativeOwner(issued);issued.draftSourceSeal!();issued.closedSourceSeal?.();assertDirectoryImmediately(issued.parent);assertTreeImmediately(candidate.directory,tree)}
 assertCurrent();return{candidate,parent:structuredClone(issued.parent),source:structuredClone(issued.draftSource),closedSource:structuredClone(issued.closedSource??null),assertCurrent}
}
/** One cold activation owner may use a sealed producer token. Cancellation,
 * success and uncertainty cannot be bypassed by constructing another core. */
export function claimPreparedApplicationRestoreForActivation(prepared:PreparedApplicationRestoreProof,owner:object){
 const verified=validatePreparedApplicationRestoreForActivation(prepared),issued=issuedApplicationCandidates.get(prepared)!
 if(issued.activationOwner&&issued.activationOwner!==owner)throw Error('APPLICATION_RESTORE_ALREADY_CLAIMED')
 issued.activationOwner=owner;return verified
}
export function retirePreparedApplicationRestoreActivation(prepared:PreparedApplicationRestoreProof,owner:object){const issued=issuedApplicationCandidates.get(prepared);if(!issued||issued.activationOwner!==owner)throw Error('APPLICATION_RESTORE_PROOF_INVALID');issuedApplicationCandidates.delete(prepared)}
