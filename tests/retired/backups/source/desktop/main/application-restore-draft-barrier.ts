import {directoryIdentity,rootMarkerSchema} from '../core/root-ownership'
import {canonical,digest,writeApplicationMetadata} from '../core/application-backup-files'
import {assertRootAuthorityHost,assertRootAuthorityFile,assertRootAuthorityDirectory,observeRootAuthority,type RootAuthorityObservation} from '../core/root-authority'
import {applicationDraftRetentionSchema,applicationDraftRecoveryItems,APPLICATION_DRAFT_RETENTION_LIMITS,type ApplicationDraftRetention} from '../shared/application-restore'
import {draftReceiptSchema,type DraftReceipt} from '../shared/drafts'
import {DraftJournal,validateDraftSnapshot} from './draft-journal'
export class ApplicationRestoreDraftBarrierError extends Error{constructor(readonly code:string){super(code);this.name='ApplicationRestoreDraftBarrierError'}}
function fail(code:string):never{throw new ApplicationRestoreDraftBarrierError(code)}
const name='application-restore-drafts.json'
/** Application-only, two actual journal checkpoint/ACK barrier. Preserved
 * snapshots remain inert after ACK; no workId, replay or database API exists. */
export class ApplicationRestoreDraftBarrier{
 private root:ReturnType<typeof directoryIdentity>
 private queue:Promise<unknown>=Promise.resolve()
 constructor(root:string,private journal:DraftJournal,private options:{assertOwner():void;beforeRename?():Promise<void>;withWrite?<T>(run:()=>Promise<T>):Promise<T>}){if(journal.root!==root)fail('APPLICATION_DRAFT_JOURNAL_MISMATCH');this.root=directoryIdentity(root);void this.root.catch(()=>{})}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const work=this.queue.then(run).catch(cause=>{if(cause instanceof ApplicationRestoreDraftBarrierError)throw cause;fail('APPLICATION_DRAFT_BARRIER_INVALID')});this.queue=work.catch(()=>{});return work}
 private async read(){const root=await this.root;assertRootAuthorityHost(()=>this.options.assertOwner(),'APPLICATION_DRAFT_OWNER_EXPIRED');assertRootAuthorityDirectory(root);const observed=observeRootAuthority(root,name,APPLICATION_DRAFT_RETENTION_LIMITS.bytes,true);if(!observed)return null
  try{const retention=applicationDraftRetentionSchema.parse(JSON.parse(observed.text)),{checksum,...body}=retention;if(digest(canonical(body))!==checksum)fail('APPLICATION_DRAFT_BARRIER_INVALID');for(const row of retention.snapshots)validateDraftSnapshot(row.snapshot);const marker=observeRootAuthority(root,'xuanxiang-app.json',16384)!,parsed=rootMarkerSchema.parse(JSON.parse(marker.text));if(parsed.id!==retention.appId||parsed.phase!=='ready'||!parsed.inboxReady)fail('APPLICATION_DRAFT_BARRIER_INVALID');return{root,observed,retention,marker}}catch{fail('APPLICATION_DRAFT_BARRIER_INVALID')}
 }
 inspect(){return this.serial(async()=>structuredClone((await this.read())?.retention??null))}
 checkpoint(token:string,owner:string,receipt:DraftReceipt){return this.transition(token,owner,receipt,'checkpointed')}
 acknowledge(token:string,owner:string,receipt:DraftReceipt){return this.transition(token,owner,receipt,'complete')}
 async flush(){await this.queue}
 private withWrite<T>(run:()=>Promise<T>){return this.options.withWrite?this.options.withWrite(run):run()}
 private transition(token:string,owner:string,input:DraftReceipt,phase:'checkpointed'|'complete'){return this.serial(()=>this.withWrite(async()=>{
  const before=await this.read();if(!before||before.retention.barrier.token!==token)fail('APPLICATION_DRAFT_TOKEN_EXPIRED')
  const barrier=before.retention.barrier
  if(phase==='checkpointed'&&barrier.phase!=='protected'||phase==='complete'&&barrier.phase!=='checkpointed')fail('APPLICATION_DRAFT_CHECKPOINT_PHASE_INVALID')
  let receipt:DraftReceipt,journalFile:RootAuthorityObservation
  try{receipt=draftReceiptSchema.parse(input);await this.journal.confirm(owner,receipt);journalFile=observeRootAuthority(before.root,'drafts.json',APPLICATION_DRAFT_RETENTION_LIMITS.bytes+65536)!}catch{fail('APPLICATION_DRAFT_CHECKPOINT_UNCONFIRMED')}
  if(phase==='complete'&&(!barrier.firstCheckpoint||receipt.revision<=barrier.firstCheckpoint.revision||receipt.clientRevision<=barrier.firstCheckpoint.clientRevision))fail('APPLICATION_DRAFT_SECOND_CHECKPOINT_REQUIRED')
  const snapshot=await this.journal.read();if(!snapshot)fail('APPLICATION_DRAFT_CHECKPOINT_UNCONFIRMED')
  const recovery=snapshot.sources.recovery as {version?:unknown;items?:unknown[]}|undefined,expected=applicationDraftRecoveryItems(before.retention)
  if(recovery?.version!==1||!Array.isArray(recovery.items)||expected.some(item=>!recovery.items!.some(actual=>canonical(actual)===canonical(item))))fail('APPLICATION_DRAFT_RECOVERY_INCOMPLETE')
  const sourceSeal=()=>{assertRootAuthorityHost(()=>this.options.assertOwner(),'APPLICATION_DRAFT_OWNER_EXPIRED');assertRootAuthorityDirectory(before.root);try{assertRootAuthorityFile(before.root,'drafts.json',journalFile.proof);assertRootAuthorityFile(before.root,'xuanxiang-app.json',before.marker.proof)}catch{fail('APPLICATION_DRAFT_CHECKPOINT_CHANGED')}}
  const{checksum:_old,...body}=before.retention,nextBody={...body,barrier:{...barrier,phase,...(phase==='checkpointed'?{firstCheckpoint:receipt}:{secondCheckpoint:receipt})}},next:ApplicationDraftRetention=applicationDraftRetentionSchema.parse({...nextBody,checksum:digest(canonical(nextBody))})
  if(Buffer.byteLength(JSON.stringify(next))>APPLICATION_DRAFT_RETENTION_LIMITS.bytes)fail('APPLICATION_DRAFT_CAPACITY')
  sourceSeal();await writeApplicationMetadata(before.root,name,JSON.stringify(next),{expectedTarget:before.observed.proof,beforeRename:async()=>{await this.options.beforeRename?.();sourceSeal();assertRootAuthorityFile(before.root,name,before.observed.proof)},immediately:()=>{sourceSeal();assertRootAuthorityFile(before.root,name,before.observed.proof)}})
  const after=await this.read();sourceSeal();if(!after||canonical(after.retention)!==canonical(next))fail('APPLICATION_DRAFT_CHECKPOINT_CHANGED')
  return structuredClone(after.retention.barrier)
 }))}
}
