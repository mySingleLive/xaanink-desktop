import {applicationNames} from "./brand-names"
import {constants,lstatSync,renameSync,unlinkSync,readdirSync} from 'node:fs'
import {open} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {RootIdentity,RootPointer} from './data-root'
import {ApplicationBackups,type VerifiedApplicationBackup} from './application-backups'
import {within,sameIdentity} from './root-ownership'
import {inspectClosedApplicationSnapshotSource} from './application-restore-source'
import {assertDirectoryImmediately,assertFileImmediately,assertTreeImmediately,canonical,digest,type StoredFile} from './application-backup-files'
import {claimPreparedApplicationRestoreForActivation,retirePreparedApplicationRestoreActivation,validatePreparedApplicationRestoreForActivation,type PreparedApplicationRestoreProof} from '../service/database/application-restore'
import {applicationRestoreReceiptNames,applicationRestoreActivationRecordSchema,readRootAuthority,observeRootAuthority,assertRootAuthorityHost,assertRootAuthorityDirectory,assertRootAuthorityFile,syncRootAuthorityDirectory,assertCurrentApplicationMarker,ROOT_AUTHORITY_LIMITS,RootAuthorityError,type RootAuthorityContext,type RootAuthorityFile,type ApplicationRestoreActivationRecord} from './root-authority'
import {validateApplicationColdSourceProof,type ApplicationColdSourceProof} from './application-cold-source'
import type {ApplicationRestoreSourceKind,ApplicationClosedSourceSummary} from '../shared/application-restore'
export class ApplicationRestoreActivationError extends Error{constructor(readonly code:string){super(code);this.name='ApplicationRestoreActivationError'}}
export type ApplicationRestoreSource={kind:'healthy';beforeSnapshot:{backups:ApplicationBackups;backupId:string}}|{kind:'missing'}|{kind:'closed-source';preservation:ApplicationColdSourceProof}
/** Trusted legacy batch35 callers only: real availability/snapshot checks remain mandatory. */
export interface LegacyApplicationRestoreSource{currentRootAvailable:boolean;beforeSnapshot:{backups:ApplicationBackups;backupId:string}|null}
export interface ApplicationRestoreActivationPreview{operationId:string;candidateId:string;backupId:string;source:RootPointer;target:RootIdentity;sourceKind:ApplicationRestoreSourceKind;closedSource:ApplicationClosedSourceSummary|null;currentRootAvailable:boolean;beforeSnapshot:{id:string;checksum:string;path:string}|null;retainedRootPath:string;initialCandidateChecksum:string;finalCandidateChecksum:string;retentionChecksum:string;unreadMigrationResults:number;requiresColdStart:true}
export interface ApplicationRestoreActivationOptions{assertStableLock():void;assertCold():void;assertOwner(ownerNonce:string):void;confirm(preview:Readonly<ApplicationRestoreActivationPreview>):Promise<boolean>;beforeReceiptRename?():void|Promise<void>;beforePointerRename?():void|Promise<void>;beforeDirectorySync?(stage:'receipt'|'pointer'|'inspection'):void|Promise<void>}
export interface ApplicationRestoreActivationDisposition{pointer:RootPointer;receiptId:string;candidateId:string;initialCandidateChecksum:string;finalCandidateChecksum:string;sourceKind:ApplicationRestoreSourceKind;closedSource:ApplicationClosedSourceSummary|null;currentRootAvailable:boolean;retainedRootPath:string;beforeSnapshot:{id:string;checksum:string;directory:RootIdentity;data:RootIdentity}|null;journalChecksum:string|null;retainedMigration:RootAuthorityContext['retainedMigration'];unreadMigrationResultIds:string[];completionWitnesses:RootAuthorityContext['completionWitnesses'];assertCurrent():void}
interface SourceProof{snapshot:VerifiedApplicationBackup|null;files:StoredFile[];available:boolean;kind:ApplicationRestoreSourceKind;legacy:boolean;closedSource:ApplicationClosedSourceSummary|null;closedSourceSeal?:()=>void}
interface Attempt{owner:string;prepared:PreparedApplicationRestoreProof;preview:ApplicationRestoreActivationPreview;context:RootAuthorityContext;candidateSeal:()=>void;source:SourceProof;cancelled:boolean;ownReceipt?:{name:string;file:RootAuthorityFile}}
interface Temporary{name:string;file:RootAuthorityFile}
function fail(code:string):never{throw new ApplicationRestoreActivationError(code)}
const beforeSnapshotSchema=z.object({backups:z.instanceof(ApplicationBackups),backupId:z.uuid()}).strict()
const sourceSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('healthy'),beforeSnapshot:beforeSnapshotSchema}).strict(),z.object({kind:z.literal('missing')}).strict(),z.object({kind:z.literal('closed-source'),preservation:z.unknown()}).strict()])
const legacySourceSchema=z.object({currentRootAvailable:z.boolean(),beforeSnapshot:beforeSnapshotSchema.nullable()}).strict()
function normalizeSource(source:ApplicationRestoreSource|LegacyApplicationRestoreSource):{kind:ApplicationRestoreSourceKind;legacy:boolean;beforeSnapshot?:{backups:ApplicationBackups;backupId:string};preservation?:ApplicationColdSourceProof}{try{if(Object.hasOwn(source,'kind'))return{...sourceSchema.parse(source),legacy:false} as ReturnType<typeof normalizeSource>;const legacy=legacySourceSchema.parse(source);if(legacy.currentRootAvailable!==!!legacy.beforeSnapshot)fail('APPLICATION_RESTORE_SOURCE_PROOF_INVALID');return{kind:legacy.currentRootAvailable?'healthy':'missing',legacy:true,beforeSnapshot:legacy.beforeSnapshot??undefined}}catch{fail('APPLICATION_RESTORE_SOURCE_PROOF_INVALID')}}
function safe(cause:unknown,fallback='APPLICATION_RESTORE_ACTIVATION_FAILED'):never{if(cause instanceof ApplicationRestoreActivationError)throw cause;if(cause instanceof RootAuthorityError)fail(cause.code);fail(fallback)}
function available(root:RootIdentity){try{assertDirectoryImmediately(root);return true}catch(cause){if((cause as NodeJS.ErrnoException)?.code==='ENOENT')return false;try{const info=lstatSync(root.path,{bigint:true});if(!info.isDirectory()||info.isSymbolicLink()||!sameIdentity({device:String(info.dev),inode:String(info.ino)},root))return false}catch{}fail('SOURCE_UNAVAILABLE')}}
/** The stable-lock holder supplies only real producer grants and native-owned
 * directories. No path, confirmation token or serialized proof comes from IPC. */
export class ApplicationRestoreActivation{
 private flight:Promise<unknown>|null=null
 private attempt:Attempt|null=null
 private uncertain=false
 private readonly producerOwner={}
 constructor(readonly bootstrap:RootIdentity,readonly options:ApplicationRestoreActivationOptions){this.bootstrap=Object.freeze(structuredClone(bootstrap))}
 private host(owner?:string){assertRootAuthorityHost(()=>this.options.assertStableLock(),'LOCK_REQUIRED');assertRootAuthorityHost(()=>this.options.assertCold(),'SOURCE_NOT_CLOSED');if(owner!==undefined)assertRootAuthorityHost(()=>this.options.assertOwner(owner),'OWNER_EXPIRED');assertRootAuthorityDirectory(this.bootstrap)}
 private serial<T>(run:()=>Promise<T>):Promise<T>{if(this.flight)fail('APPLICATION_RESTORE_BUSY');if(this.uncertain)fail('DURABILITY_UNCONFIRMED');const flight=Promise.resolve().then(run).catch(cause=>safe(cause));this.flight=flight;void flight.finally(()=>{if(this.flight===flight)this.flight=null}).catch(()=>{});return flight}
 async prepare(owner:string,prepared:PreparedApplicationRestoreProof,source:ApplicationRestoreSource|LegacyApplicationRestoreSource):Promise<ApplicationRestoreActivationPreview>{return this.serial(async()=>{
  this.host(owner);let verified:ReturnType<typeof validatePreparedApplicationRestoreForActivation>
  try{verified=claimPreparedApplicationRestoreForActivation(prepared,this.producerOwner)}catch{fail('APPLICATION_RESTORE_PROOF_INVALID')}
  const c=readRootAuthority(this.bootstrap,()=>this.host(owner)),candidate=verified.candidate,activation=candidate.activation!
  if(c.pointer.rootId!==candidate.appId||c.pointer.revision>=Number.MAX_SAFE_INTEGER)fail('APPLICATION_RESTORE_APP_MISMATCH')
  if(within(candidate.directory.path,this.bootstrap.path)||within(this.bootstrap.path,candidate.directory.path)||within(candidate.directory.path,c.pointer.root.path)||within(c.pointer.root.path,candidate.directory.path)||sameIdentity(candidate.directory,c.pointer.root))fail('APPLICATION_RESTORE_TARGET_OVERLAP')
  if(applicationRestoreReceiptNames(this.bootstrap).length>=ROOT_AUTHORITY_LIMITS.receipts)fail('RECEIPT_LIMIT')
  const input=normalizeSource(source),actualAvailable=available(c.pointer.root)
  if(actualAvailable!==(input.kind!=='missing'))fail('APPLICATION_RESTORE_SOURCE_PROOF_INVALID')
  if(actualAvailable!==!!verified.source||verified.source&&canonical(verified.source)!==canonical(c.pointer.root))fail('APPLICATION_RESTORE_SOURCE_PROOF_INVALID')
  let closedSource:ApplicationClosedSourceSummary|null=null,closedSourceSeal:(()=>void)|undefined
  if(input.kind==='closed-source'){
   const raw=validateApplicationColdSourceProof(input.preservation!,{operationId:activation.operationId,bootstrap:this.bootstrap,appId:c.pointer.rootId,source:c.pointer.root,sourcePointer:c.pointer}),r=raw.receipt
   closedSource={kind:'closed-source',health:'not-verified',id:r.id,checksum:r.checksum,directory:r.directory,data:r.data}
   if(canonical(r.candidateParent)!==canonical(verified.parent)||canonical(closedSource)!==canonical(verified.closedSource))fail('APPLICATION_RESTORE_SOURCE_PROOF_INVALID')
   closedSourceSeal=raw.assertSourceCurrent
  }else if(verified.closedSource)fail('APPLICATION_RESTORE_SOURCE_PROOF_INVALID')
  let files:StoredFile[]=[];const snapshot=input.kind==='healthy'&&input.beforeSnapshot?await input.beforeSnapshot.backups.inspect(input.beforeSnapshot.backupId):null
  if(snapshot){if(snapshot.receipt.phase!=='verified'||snapshot.receipt.appId!==c.pointer.rootId)fail('APPLICATION_RESTORE_SOURCE_PROOF_INVALID');assertCurrentApplicationMarker(c.pointer)
   files=await inspectClosedApplicationSnapshotSource(c.pointer.root,snapshot.receipt.files,()=>{this.host(owner);c.assertCurrent()},verified.assertCurrent)
  }
  if(input.kind==='healthy'&&!snapshot)fail('APPLICATION_RESTORE_SOURCE_PROOF_INVALID')
  const preview:ApplicationRestoreActivationPreview={operationId:activation.operationId,candidateId:candidate.id,backupId:candidate.backupId,source:structuredClone(c.pointer),target:structuredClone(candidate.directory),sourceKind:input.kind,closedSource:structuredClone(closedSource),currentRootAvailable:actualAvailable,beforeSnapshot:snapshot?{id:snapshot.receipt.id,checksum:snapshot.receipt.checksum,path:snapshot.directory.path}:null,retainedRootPath:c.pointer.root.path,initialCandidateChecksum:activation.initialChecksum,finalCandidateChecksum:candidate.checksum,retentionChecksum:activation.retentionChecksum,unreadMigrationResults:c.unreadMigrationResultIds.length,requiresColdStart:true}
  const a:Attempt={owner,prepared,preview,context:c,candidateSeal:verified.assertCurrent,source:{snapshot,files,available:actualAvailable,kind:input.kind,legacy:input.legacy,closedSource,closedSourceSeal},cancelled:false};this.attempt=a;this.final(a);return structuredClone(preview)
 })}
 private own(owner:string,id:string){this.host(owner);const a=this.attempt;if(!a||a.cancelled||a.owner!==owner||a.preview.operationId!==id)fail('ATTEMPT_EXPIRED');return a}
 private sourceSeal(a:Attempt){if(available(a.context.pointer.root)!==a.source.available)fail('SOURCE_CHANGED');a.source.closedSourceSeal?.();if(a.source.available){assertDirectoryImmediately(a.context.pointer.root);for(const file of a.source.files)assertFileImmediately(a.context.pointer.root,file.path,{...file.identity,...file.revision})}
  const snapshot=a.source.snapshot;if(snapshot){assertDirectoryImmediately(snapshot.directory);assertTreeImmediately(snapshot.data,snapshot.tree);assertFileImmediately(snapshot.directory,'xuanxiang-app-backup.json',snapshot.metadata);if(canonical(readdirSync(snapshot.directory.path).sort())!==canonical(['data','xuanxiang-app-backup.json'].sort()))fail('BEFORE_SNAPSHOT_CHANGED')}
 }
 private final(a:Attempt){this.own(a.owner,a.preview.operationId);a.context.assertCurrent({receipt:a.ownReceipt});a.candidateSeal();this.sourceSeal(a)
  const expected=a.context.records.filter(row=>row.kind==='application').map(row=>row.name);if(a.ownReceipt)expected.push(a.ownReceipt.name)
  if(canonical(applicationRestoreReceiptNames(this.bootstrap))!==canonical(expected.sort()))fail('RECEIPT_CHANGED');if(a.ownReceipt)assertRootAuthorityFile(this.bootstrap,a.ownReceipt.name,a.ownReceipt.file,'RECEIPT_CHANGED')
 }
 private committed(a:Attempt,pointer:RootAuthorityFile){try{this.own(a.owner,a.preview.operationId);a.context.assertCurrent({pointerFile:pointer,receipt:a.ownReceipt});a.candidateSeal();this.sourceSeal(a);if(!a.ownReceipt)fail('RECEIPT_CHANGED')}catch{this.uncertain=true;fail('DURABILITY_UNCONFIRMED')}}
 private cleanup(temp:Temporary){try{assertRootAuthorityFile(this.bootstrap,temp.name,temp.file);unlinkSync(join(this.bootstrap.path,temp.name))}catch{/* Keep every unknown or replaced temporary. */}}
 private async temporary(text:string):Promise<Temporary>{this.host();const name=`.application-restore-${randomUUID()}.tmp`;let handle:Awaited<ReturnType<typeof open>>|undefined,file:RootAuthorityFile|undefined
  try{handle=await open(join(this.bootstrap.path,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(text,'utf8');await handle.sync();const info=await handle.stat({bigint:true});file={device:String(info.dev),inode:String(info.ino),size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs),sha256:digest(text)};await handle.close();handle=undefined;const verified=observeRootAuthority(this.bootstrap,name,ROOT_AUTHORITY_LIMITS.recordBytes)!;if(canonical(verified.proof)!==canonical(file))fail('CONTROL_CHANGED');return{name,file}}catch(cause){await handle?.close().catch(()=>{});if(file)this.cleanup({name,file});safe(cause,'WRITE_FAILED')}
 }
 private async publish(temp:Temporary,name:string,expected:RootAuthorityFile|null,stage:'receipt'|'pointer',seal:()=>void):Promise<RootAuthorityFile>{let committed=false
  try{seal();assertRootAuthorityFile(this.bootstrap,name,expected,stage==='pointer'?'POINTER_CHANGED':'RECEIPT_CHANGED');assertRootAuthorityFile(this.bootstrap,temp.name,temp.file);renameSync(join(this.bootstrap.path,temp.name),join(this.bootstrap.path,name));committed=true;const current=observeRootAuthority(this.bootstrap,name,ROOT_AUTHORITY_LIMITS.recordBytes)!;if(!sameIdentity(current.proof,temp.file)||current.proof.size!==temp.file.size||current.proof.mtimeNs!==temp.file.mtimeNs||current.proof.sha256!==temp.file.sha256)fail('CONTROL_CHANGED');await this.options.beforeDirectorySync?.(stage);this.host();assertRootAuthorityFile(this.bootstrap,name,current.proof);await syncRootAuthorityDirectory(this.bootstrap);this.host();assertRootAuthorityFile(this.bootstrap,name,current.proof);return current.proof}catch(cause){if(committed){this.uncertain=true;fail('DURABILITY_UNCONFIRMED')}safe(cause,'WRITE_FAILED')}
 }
 async activate(owner:string,operationId:string):Promise<{pointer:RootPointer;receiptId:string;requiresColdStart:true}>{return this.serial(async()=>{
  const a=this.own(owner,operationId);this.final(a);let answer:unknown
  try{answer=await this.options.confirm(structuredClone(a.preview))}catch{fail('CONFIRMATION_FAILED')}
  this.own(owner,operationId);if(answer!==true)fail('CONFIRMATION_REQUIRED');this.final(a)
  const after={...a.context.pointer,revision:a.context.pointer.revision+1,root:a.preview.target},pointerTemp=await this.temporary(JSON.stringify(after)+'\n');let receiptTemp:Temporary|undefined
  try{this.final(a);const{ctimeNs:_ctime,...pointerFile}=pointerTemp.file,snapshot=a.source.snapshot
   const candidateData=observeRootAuthority(a.preview.target,'.xuanxiang-application-candidate.json',16*1024*1024)!,candidate=JSON.parse(candidateData.text) as {backupChecksum:string;activation:{barrierToken:string}},record:ApplicationRestoreActivationRecord=applicationRestoreActivationRecordSchema.parse({schemaVersion:a.source.legacy?1:2,...(a.source.legacy?{}:{sourceKind:a.source.kind,closedSource:a.source.closedSource,beforePointerText:observeRootAuthority(this.bootstrap,"data-root.json",16*1024)!.text}),type:'application',receiptId:operationId,createdAt:new Date().toISOString(),bootstrap:this.bootstrap,before:a.context.pointer,beforePointerFile:a.context.pointerFile,after,pointerFile,candidate:{id:a.preview.candidateId,backupId:a.preview.backupId,backupChecksum:candidate.backupChecksum,initialChecksum:a.preview.initialCandidateChecksum,finalChecksum:a.preview.finalCandidateChecksum,retentionChecksum:a.preview.retentionChecksum,barrierToken:candidate.activation.barrierToken},currentRootAvailable:a.source.available,beforeSnapshot:snapshot?{id:snapshot.receipt.id,checksum:snapshot.receipt.checksum,directory:snapshot.directory,data:snapshot.data}:null,marker:assertCurrentApplicationMarker(after),controls:a.context.controls,history:a.context.records.map(row=>({name:row.name,file:row.file}))}),text=JSON.stringify({record,sha256:digest(canonical(record))})+'\n'
   if(Buffer.byteLength(text)>ROOT_AUTHORITY_LIMITS.recordBytes)fail('RECEIPT_LIMIT');receiptTemp=await this.temporary(text);await this.options.beforeReceiptRename?.();this.final(a)
   const name=`application-restore-${operationId}.json`,receipt=await this.publish(receiptTemp,name,null,'receipt',()=>this.final(a));receiptTemp=undefined;a.ownReceipt={name,file:receipt}
   await this.options.beforePointerRename?.();this.final(a)
   const pointer=await this.publish(pointerTemp,'data-root.json',a.context.pointerFile,'pointer',()=>this.final(a));this.committed(a,pointer);retirePreparedApplicationRestoreActivation(a.prepared,this.producerOwner);return{pointer:structuredClone(after),receiptId:operationId,requiresColdStart:true}
  }finally{this.cleanup(pointerTemp);if(receiptTemp)this.cleanup(receiptTemp);this.attempt=null}
 })}
 async cancel(owner:string,operationId:string):Promise<void>{const a=this.attempt;if(!a||a.owner!==owner||a.preview.operationId!==operationId)fail('ATTEMPT_EXPIRED');a.cancelled=true;await this.flush();if(this.attempt===a)this.attempt=null;if(!this.uncertain)try{retirePreparedApplicationRestoreActivation(a.prepared,this.producerOwner)}catch{fail('APPLICATION_RESTORE_PROOF_INVALID')}}
 async flush(){await this.flight?.catch(()=>{})}
 inspect(){return inspectApplicationRestoreActivation(this.bootstrap,this.options)}
}
/** Cold restart can prove a completed CAS, but cannot recreate confirmation or
 * automatically activate a receipt written before its pointer rename. */
export async function inspectApplicationRestoreActivation(bootstrap:RootIdentity,host:Pick<ApplicationRestoreActivationOptions,'assertStableLock'|'assertCold'|'beforeDirectorySync'>):Promise<ApplicationRestoreActivationDisposition|null>{
 const guard=()=>{assertRootAuthorityHost(()=>host.assertStableLock(),'LOCK_REQUIRED');assertRootAuthorityHost(()=>host.assertCold(),'SOURCE_NOT_CLOSED');assertRootAuthorityDirectory(bootstrap)}
 try{const context=readRootAuthority(bootstrap,guard),head=[...context.links].reverse().find(row=>row.kind==='application');if(!head)return null;const record=head.record as ApplicationRestoreActivationRecord,marker=assertCurrentApplicationMarker(context.pointer),assertCurrent=()=>{context.assertCurrent();assertRootAuthorityFile(context.pointer.root,applicationNames(context.pointer.root).appMarker,marker,'TARGET_CHANGED')};await host.beforeDirectorySync?.('inspection');guard();await syncRootAuthorityDirectory(bootstrap);assertCurrent();return{pointer:structuredClone(context.pointer),receiptId:record.receiptId,candidateId:record.candidate.id,initialCandidateChecksum:record.candidate.initialChecksum,finalCandidateChecksum:record.candidate.finalChecksum,sourceKind:record.schemaVersion===2?record.sourceKind:record.currentRootAvailable?"healthy":"missing",closedSource:record.schemaVersion===2?structuredClone(record.closedSource):null,currentRootAvailable:record.currentRootAvailable,retainedRootPath:record.before.root.path,beforeSnapshot:structuredClone(record.beforeSnapshot),journalChecksum:context.journalChecksum,retainedMigration:context.retainedMigration,unreadMigrationResultIds:context.unreadMigrationResultIds,completionWitnesses:context.completionWitnesses,assertCurrent}}catch(cause){safe(cause,'DURABILITY_UNCONFIRMED')}
}
