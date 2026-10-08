import {applicationNames} from "../core/brand-names"
import {randomUUID} from 'node:crypto'
import {constants,renameSync,unlinkSync,opendirSync,readdirSync} from 'node:fs'
import {open} from 'node:fs/promises'
import {join,dirname,basename,isAbsolute} from 'node:path'
import {z} from 'zod'
import type {RootIdentity} from '../core/data-root'
import {rootIdentitySchema,sameIdentity,within} from '../core/root-ownership'
import {canonical,digest} from '../core/application-backup-files'
import {observeRootAuthority,assertRootAuthorityDirectory,assertRootAuthorityHost,syncRootAuthorityDirectory,readRootAuthority,applicationRestoreReceiptNames,assertCurrentApplicationMarker,type RootAuthorityObservation,type RootAuthorityFile,type ApplicationRestoreActivationRecord} from '../core/root-authority'
import {applicationBackupSchema,APPLICATION_BACKUP_LIMITS} from '../shared/application-backup'
import {applicationDraftRetentionSchema,applicationDraftRecoveryItems,APPLICATION_DRAFT_RETENTION_LIMITS} from '../shared/application-restore'
import {draftSnapshotSchema,draftReceiptSchema,type DraftReceipt} from '../shared/drafts'
import {DraftJournal,validateDraftSnapshot} from './draft-journal'
import {APPLICATION_RESTORE_REQUEST_LIMITS as limits,applicationRestoreSelectionSchema,applicationRestoreRequestBodySchema,applicationRestoreRequestSnapshotSchema,applicationRestorePhaseRecordSchema,type ApplicationRestoreRequest,type ApplicationRestoreRequestSnapshot,type ApplicationRestoreSelection,type ApplicationRestoreExecution,type ApplicationRestoreActivationWitness,type ApplicationRestoreCheckpointWitness,type ApplicationRestoreProcess} from '../shared/application-restore-request'

const requestName='application-recovery-request.json',phasePrefix='application-recovery-phase-'
const sha=z.string().regex(/^[a-f0-9]{64}$/)
const requestEnvelope=z.object({state:applicationRestoreRequestSnapshotSchema,checksum:sha}).strict()
const phaseEnvelope=z.object({record:applicationRestorePhaseRecordSchema,checksum:sha}).strict()
type Body=Omit<ApplicationRestoreRequest,'history'>
export class ApplicationRestoreRequestError extends Error{constructor(readonly code:string){super(code);this.name='ApplicationRestoreRequestError'}}
export interface ApplicationRestoreRequestOptions{
 assertStableLock():void
 assertOwner(ownerNonce:string):void
 assertQuiesced(request:Readonly<ApplicationRestoreRequest>):void
 assertOldProcessExited(process:Readonly<ApplicationRestoreProcess>):void
 assertCold(process:Readonly<ApplicationRestoreProcess>):void
 assertExecutionSettled(execution:Readonly<ApplicationRestoreExecution>):void
 /** Trusted synchronous filesystem inspector, never a renderer boolean. */
 inspectPendingEvidence():{operationIds:string[];unknown:boolean}
 /** The host wraps the entire first checkpoint/consumption flight in the same
  * ApplicationMetadataGate used by the actual journal and barrier. */
 withWrite?<T>(run:()=>Promise<T>):Promise<T>
 writeHooks?:{beforeRename?(kind:'phase'|'request'):Promise<void>;beforeDirectorySync?(kind:'phase'|'request'):Promise<void>}
}
export interface ApplicationRestoreExecutionHandle{readonly operationId:string;readonly attemptId:string;assertCurrent():void}
export type ApplicationRestoreStartup={mode:'normal'|'cold'|'execute-ready'|'protected';request?:ApplicationRestoreRequest;activation?:ApplicationRestoreActivationWitness;code?:string}
interface ReadState{state:ApplicationRestoreRequestSnapshot;observation:RootAuthorityObservation|null;phases:Map<string,RootAuthorityObservation>}
interface Capability{handle:ApplicationRestoreExecutionHandle;execution:ApplicationRestoreExecution;operationId:string;retired:boolean}
const empty=():ApplicationRestoreRequestSnapshot=>({schemaVersion:1,revision:0,operations:[]})
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b)
function fail(code:string):never{throw new ApplicationRestoreRequestError(code)}
function parse<T>(schema:z.ZodType<T>,value:unknown,code='RECORD_INVALID'):T{try{return schema.parse(value)}catch{fail(code)}}
function body(request:ApplicationRestoreRequest):Body{const{history:_history,...value}=request;return value}
function base(request:Body){const{phase:_phase,execution:_execution,activation:_activation,firstCheckpoint:_checkpoint,secondCheckpoint:_second,reason:_reason,...value}=request;return value}
function assertSameObservation(actual:RootAuthorityObservation|null,expected:RootAuthorityObservation|null){if(!same(actual,expected))fail('RECORD_CHANGED')}
function safe(cause:unknown,fallback='RECORD_INVALID'):never{if(cause instanceof ApplicationRestoreRequestError)throw cause;fail(fallback)}
const snapshotEnvelope=z.object({version:z.literal(1),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),sessionId:z.uuid(),digest:sha,snapshot:draftSnapshotSchema}).strict()
const confirmJournal=DraftJournal.prototype.confirm
type RecordKind='phase'|'first-checkpoint'|'checkpointed-session-restart'|'completed-barrier-restart'

/** Only intent/audit lives on disk. Executing JSON never reissues this instance's
 * execution handle, and a handle grants no batch35 producer/confirmation proof. */
export class ApplicationRestoreRequests{
 private flight:Promise<unknown>|null=null
 private uncertain=false
 private expected:RootAuthorityObservation|null|undefined
 readonly #handles=new WeakMap<object,Capability>()
 readonly #processIdentity:ApplicationRestoreProcess=Object.freeze({pid:process.pid,instanceNonce:randomUUID(),startedAt:new Date().toISOString()})
 readonly #bootstrap:RootIdentity
 readonly #options:ApplicationRestoreRequestOptions
 get bootstrap(){return this.#bootstrap}
 get options(){return this.#options}
 constructor(bootstrap:RootIdentity,options:ApplicationRestoreRequestOptions){this.#bootstrap=Object.freeze(parse(rootIdentitySchema,structuredClone(bootstrap),'BOOTSTRAP_CHANGED'));this.#options=Object.freeze({...options,...(options.writeHooks?{writeHooks:Object.freeze({...options.writeHooks})}:{})})}
 private host(owner?:string){this.guarded(()=>this.#options.assertStableLock(),'LOCK_REQUIRED');try{assertRootAuthorityDirectory(this.#bootstrap)}catch{fail('BOOTSTRAP_CHANGED')};if(owner!==undefined)this.guarded(()=>this.#options.assertOwner(owner),'OWNER_EXPIRED')}
 private guarded(action:()=>void,code:string){try{assertRootAuthorityHost(action,code)}catch{fail(code)}}
 private names(){this.host();const directory=opendirSync(this.#bootstrap.path),names:string[]=[];let count=0;try{for(;;){const entry=directory.readSync();if(!entry)break;if(++count>limits.controls)fail('CONTROL_LIMIT');if(entry.name.startsWith('application-recovery-')||entry.name.startsWith('.application-recovery-'))names.push(entry.name)}}finally{directory.closeSync()}return names.sort()}
 private read():ReadState{
  this.host();const names=this.names(),observation=observeRootAuthority(this.#bootstrap,requestName,limits.requestBytes,true)
  if(this.expected!==undefined)assertSameObservation(observation,this.expected)
  if(!observation){if(names.length)fail('HISTORY_INCOMPLETE');this.expected=null;return{state:empty(),observation:null,phases:new Map()}}
  const envelope=parse(requestEnvelope,JSON.parse(observation.text)),state=envelope.state
  if(digest(canonical(state))!==envelope.checksum)fail('RECORD_INVALID')
  if(new Set(state.operations.map(row=>row.operationId)).size!==state.operations.length||state.operations.filter(row=>!['consumed','cancelled'].includes(row.phase)).length>1)fail('RECORD_INVALID')
  const phases=new Map<string,RootAuthorityObservation>(),revisions:number[]=[]
  for(const operation of state.operations){let previous:Body|undefined,reference:ApplicationRestoreRequest['history'][number]|null=null
   for(const witness of operation.history){
    if(phases.has(witness.name))fail('HISTORY_INCOMPLETE')
    const actual=observeRootAuthority(this.#bootstrap,witness.name,limits.phaseBytes)!
    if(!same(actual.proof,witness.file))fail('HISTORY_CHANGED')
    const entry=parse(phaseEnvelope,JSON.parse(actual.text)),record=entry.record
    if(witness.name!==`${phasePrefix}${record.receiptId}.json`||digest(canonical(record))!==entry.checksum||record.request.operationId!==operation.operationId||!same(record.previous,reference))fail('HISTORY_INCOMPLETE')
    this.validTransition(previous,record.request,record.kind)
    phases.set(witness.name,actual);revisions.push(record.revision);previous=record.request;reference=witness
   }
   if(!same(previous,body(operation)))fail('HISTORY_INCOMPLETE')
  }
  if(names.length!==phases.size+1||names.some(name=>name!==requestName&&!phases.has(name)))fail('HISTORY_INCOMPLETE')
  // Single-flight starts the next operation only after the previous terminal
  // record. The stored operation order and each exact predecessor chain must
  // therefore already be the global append order; sorting hides corruption.
  if(revisions.length>limits.controls||state.revision!==revisions.length||revisions.some((value,index)=>value!==index+1))fail('HISTORY_INCOMPLETE')
  this.expected=observation;return{state,observation,phases}
 }
 private validTransition(previous:Body|undefined,next:Body,kind:RecordKind){
  if(!same(next.source.rootId,next.backup.appId)||!isAbsolute(next.parent.path)||!isAbsolute(next.backup.directory.path))fail('RECORD_INVALID')
  if(!previous){if(kind!=='phase'||next.phase!=='prepared'||next.execution||next.activation||next.firstCheckpoint||next.secondCheckpoint||next.reason)fail('RECORD_INVALID');return}
  if(!same(base(previous),base(next)))fail('HISTORY_CHANGED')
  if(kind!=='phase'){
   if(!['executing','unknown','activated'].includes(previous.phase)||next.phase!==previous.phase||!next.firstCheckpoint||next.firstCheckpoint.kind!==kind||!next.activation||!same(previous.execution,next.execution)||!same(previous.reason,next.reason)||previous.activation&&!same(previous.activation,next.activation)||previous.firstCheckpoint&&(next.firstCheckpoint.receipt.revision<=previous.firstCheckpoint.receipt.revision||next.firstCheckpoint.receipt.clientRevision<=previous.firstCheckpoint.receipt.clientRevision))fail('RECORD_INVALID')
  }else{
   const permitted:Record<string,string[]>={prepared:['armed','cancelled'],armed:['executing'],executing:['activated','unknown','cancelled'],unknown:['consumed'],activated:['consumed'],consumed:[],cancelled:[]}
   if(!permitted[previous.phase].includes(next.phase))fail('PHASE_INVALID')
   // A phase transition cannot smuggle in an execution or first attestation.
   // Only armed→executing introduces the attempt; only a non-phase immutable
   // attestation introduces/replaces first. Prepared cancellation stays inert.
   if(next.phase==='executing'?(!!next.activation||!!next.firstCheckpoint):!same(previous.execution,next.execution))fail('HISTORY_CHANGED')
   if(!same(previous.firstCheckpoint,next.firstCheckpoint)||next.phase!=='activated'&&!same(previous.activation,next.activation))fail('HISTORY_CHANGED')
   if(previous.activation&&!same(previous.activation,next.activation))fail('HISTORY_CHANGED')
  }
  if(['executing','unknown','activated','consumed'].includes(next.phase)&&!next.execution||['activated','consumed'].includes(next.phase)&&!next.activation||next.phase==='consumed'&&(!next.firstCheckpoint||!next.secondCheckpoint))fail('RECORD_INVALID')
  if(next.phase==='consumed'){const first=next.firstCheckpoint!,second=next.secondCheckpoint!;if(second.receipt.revision<=first.receipt.revision||second.receipt.clientRevision<=first.receipt.clientRevision||first.sessionId!==second.sessionId||first.recoveryChecksum!==second.recoveryChecksum||first.kind!==second.kind)fail('RECORD_INVALID')}
 }
 private evidence(){return parse(z.object({operationIds:z.array(z.uuid()).max(limits.operations),unknown:z.boolean()}).strict(),this.#options.inspectPendingEvidence(),'PENDING_EVIDENCE_INVALID')}
 startup():ApplicationRestoreStartup{
  try{
   this.host();if(this.uncertain)return{mode:'cold',code:'DURABILITY_UNCONFIRMED'}
   const{state}=this.read();this.authorityRequests(state)
   const evidence=this.evidence(),request=state.operations.find(row=>!['consumed','cancelled'].includes(row.phase))
   if(evidence.unknown||evidence.operationIds.some(id=>id!==request?.operationId))return{mode:'cold',code:'PENDING_EVIDENCE_UNRELATED'}
   if(!request){this.consumedHistory(state);return{mode:'normal'}}
   if(request.phase==='armed'){this.sameSource(request);this.bindings(request,true);return{mode:'execute-ready',request:structuredClone(request)}}
   if(['executing','unknown','activated'].includes(request.phase)){
    try{return{mode:'protected',request:structuredClone(request),activation:this.committed(request).witness}}catch{return{mode:'cold',request:structuredClone(request),code:'INSPECTION_REQUIRED'}}
   }
   return{mode:'cold',request:structuredClone(request),code:'REQUEST_PREPARED'}
  }catch(cause){return{mode:'cold',code:cause instanceof ApplicationRestoreRequestError?cause.code:'CONTROL_INVALID'}}
 }
 inspect(){return this.startup()}
 private authorityRequests(state:ApplicationRestoreRequestSnapshot){
  // A vanished handoff ledger is not proof that a restore never happened.
  // Actual append-only core receipts independently require its control chain.
  if(!applicationRestoreReceiptNames(this.#bootstrap).length)return
  const authority=readRootAuthority(this.#bootstrap,()=>this.host())
  for(const entry of authority.records)if(entry.kind==='application'){
   const id=(entry.record as ApplicationRestoreActivationRecord).receiptId,request=state.operations.find(row=>row.operationId===id)
   if(!request)fail('HISTORY_INCOMPLETE')
   if(['prepared','armed','cancelled'].includes(request.phase))fail('STATE_RESULT_MISMATCH')
  }
  authority.assertCurrent()
 }
 private consumedHistory(state:ApplicationRestoreRequestSnapshot){
  const completed=state.operations.filter(row=>row.phase==='consumed');if(!completed.length)return
  const authority=readRootAuthority(this.#bootstrap,()=>this.host())
  for(const operation of completed){const entry=authority.links.find(row=>row.kind==='application'&&(row.record as ApplicationRestoreActivationRecord).receiptId===operation.operationId),record=entry?.record as ApplicationRestoreActivationRecord|undefined
   if(!entry||!record||!same(entry.file,operation.activation!.receiptFile)||!same(record.before,operation.source)||!same(record.beforePointerFile,operation.sourcePointerFile)||!same(record.after,operation.activation!.pointer)||record.candidate.id!==operation.activation!.candidateId||record.candidate.backupId!==operation.backup.backupId||record.candidate.backupChecksum!==operation.backup.checksum)fail('HISTORY_INCOMPLETE')
  }
  authority.assertCurrent()
 }
 private serial<T>(run:()=>Promise<T>):Promise<T>{if(this.flight)return Promise.reject(new ApplicationRestoreRequestError('APPLICATION_RESTORE_REQUEST_BUSY'));if(this.uncertain)return Promise.reject(new ApplicationRestoreRequestError('DURABILITY_UNCONFIRMED'));const pending=Promise.resolve().then(()=>{this.host();return run()}).catch(cause=>safe(cause));this.flight=pending;void pending.finally(()=>{if(this.flight===pending)this.flight=null}).catch(()=>{});return pending}
 async flush(){await this.flight?.catch(()=>{})}
 private owned(read:ReadState,id:string){const request=read.state.operations.find(row=>row.operationId===id);if(!request)fail('REQUEST_MISMATCH');return request}
 private sameSource(request:Body){const authority=readRootAuthority(this.#bootstrap,()=>this.host());if(!same(authority.pointer,request.source)||!same(authority.pointerFile,request.sourcePointerFile))fail('SOURCE_CHANGED');authority.assertCurrent()}
 private backup(selection:ApplicationRestoreSelection){
  assertRootAuthorityDirectory(selection.backup.directory)
  const observation=observeRootAuthority(selection.backup.directory,'xuanxiang-app-backup.json',APPLICATION_BACKUP_LIMITS.metadataBytes)!
  const receipt=parse(applicationBackupSchema,JSON.parse(observation.text),'BACKUP_INVALID'),{checksum,...content}=receipt
  if(receipt.id!==selection.backup.backupId||receipt.phase!=='verified'||checksum!==digest(canonical(content)))fail('BACKUP_INVALID')
  return{directory:selection.backup.directory,backupId:receipt.id,appId:receipt.appId,checksum,receiptFile:observation.proof}
 }
 private bindings(request:Body,emptyParent=false){
  this.host();assertRootAuthorityDirectory(request.parent);assertRootAuthorityDirectory(request.backup.directory)
  const backup=this.backup({backup:{directory:request.backup.directory,backupId:request.backup.backupId},parent:request.parent})
  if(!same(backup,request.backup))fail('BACKUP_CHANGED')
  for(const other of[this.#bootstrap,request.source.root,request.backup.directory])if(within(request.parent.path,other.path)||within(other.path,request.parent.path)||sameIdentity(request.parent,other))fail('TARGET_OVERLAP')
  if(emptyParent&&readdirSync(request.parent.path).length)fail('TARGET_NOT_EMPTY')
 }
 private departed(request:Body){
  this.guarded(()=>this.#options.assertOldProcessExited(structuredClone(request.oldProcess)),'SOURCE_PROCESS_UNCONFIRMED')
  try{process.kill(request.oldProcess.pid,0);fail('SOURCE_PROCESS_ACTIVE')}catch(cause){if(cause instanceof ApplicationRestoreRequestError)throw cause;if((cause as NodeJS.ErrnoException).code!=='ESRCH')fail('SOURCE_PROCESS_UNCONFIRMED')}
  this.guarded(()=>this.#options.assertCold(structuredClone(request.oldProcess)),'SOURCE_NOT_CLOSED')
 }
 private cleanup(name:string,file:RootAuthorityFile,text:string){try{const current=observeRootAuthority(this.#bootstrap,name,limits.requestBytes,true);if(current&&sameIdentity(current.proof,file)&&(current.text===text||current.text===''&&file.size==='0'))unlinkSync(join(this.#bootstrap.path,name))}catch{/* Unknown temporary or changed bootstrap is retained. */}}
 private async publish(name:string,text:string,expected:RootAuthorityObservation|null,kind:'phase'|'request',guard:()=>void){
  const temporary=`.application-recovery-${randomUUID()}.tmp`;let handle:Awaited<ReturnType<typeof open>>|undefined,file:RootAuthorityFile|undefined,renamed=false
  try{
   guard();handle=await open(join(this.#bootstrap.path,temporary),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);guard()
   const initial=await handle.stat({bigint:true});file={device:String(initial.dev),inode:String(initial.ino),size:'0',mtimeNs:String(initial.mtimeNs),ctimeNs:String(initial.ctimeNs),sha256:digest('')};guard()
   await handle.writeFile(text,'utf8');guard();await handle.sync();guard();await handle.close();handle=undefined;guard()
   const temp=observeRootAuthority(this.#bootstrap,temporary,kind==='request'?limits.requestBytes:limits.phaseBytes)!
   if(!sameIdentity(temp.proof,file)||temp.text!==text)fail('RECORD_CHANGED');file=temp.proof
   await this.#options.writeHooks?.beforeRename?.(kind);guard()
   // Last business assertion precedes a bounded synchronous full-byte CAS.
   // No callback or await can separate this CAS from the actual rename.
   assertSameObservation(observeRootAuthority(this.#bootstrap,name,kind==='request'?limits.requestBytes:limits.phaseBytes,true),expected)
   assertSameObservation(observeRootAuthority(this.#bootstrap,temporary,kind==='request'?limits.requestBytes:limits.phaseBytes),temp)
   renameSync(join(this.#bootstrap.path,temporary),join(this.#bootstrap.path,name));renamed=true
   const published=observeRootAuthority(this.#bootstrap,name,kind==='request'?limits.requestBytes:limits.phaseBytes)!
   if(!sameIdentity(published.proof,temp.proof)||published.text!==text)fail('RECORD_CHANGED')
   await this.#options.writeHooks?.beforeDirectorySync?.(kind);guard();assertSameObservation(observeRootAuthority(this.#bootstrap,name,kind==='request'?limits.requestBytes:limits.phaseBytes),published)
   await syncRootAuthorityDirectory(this.#bootstrap);guard();assertSameObservation(observeRootAuthority(this.#bootstrap,name,kind==='request'?limits.requestBytes:limits.phaseBytes),published)
   return published
  }catch(cause){if(renamed){this.uncertain=true;fail('DURABILITY_UNCONFIRMED')}safe(cause,'WRITE_FAILED')}
  finally{await handle?.close().catch(()=>{});if(!renamed&&file)this.cleanup(temporary,file,text)}
 }
 private async write(read:ReadState,next:Body,guard:()=>void,kind:RecordKind='phase'){
  next=parse(applicationRestoreRequestBodySchema,next)
  const previous=read.state.operations.find(row=>row.operationId===next.operationId)
  this.validTransition(previous?body(previous):undefined,next,kind)
  if(read.state.revision>=limits.controls-1)fail('CONTROL_LIMIT')
  const receiptId=randomUUID(),name=`${phasePrefix}${receiptId}.json`,record={schemaVersion:1 as const,receiptId,revision:read.state.revision+1,kind,previous:previous?.history.at(-1)??null,request:next,createdAt:new Date().toISOString()}
  const phaseText=JSON.stringify({record,checksum:digest(canonical(record))})+'\n'
  if(Buffer.byteLength(phaseText)>limits.phaseBytes)fail('RECORD_TOO_LARGE')
  let phasePublished=false
  try{
   guard();assertSameObservation(observeRootAuthority(this.#bootstrap,requestName,limits.requestBytes,true),read.observation)
   const phase=await this.publish(name,phaseText,null,'phase',guard);phasePublished=true
   const request:ApplicationRestoreRequest={...next,history:[...previous?.history??[],{name,file:phase.proof}]}
   const state=parse(applicationRestoreRequestSnapshotSchema,{schemaVersion:1,revision:record.revision,operations:previous?read.state.operations.map(row=>row.operationId===next.operationId?request:row):[...read.state.operations,request]})
   const text=JSON.stringify({state,checksum:digest(canonical(state))})+'\n';if(Buffer.byteLength(text)>limits.requestBytes)fail('RECORD_TOO_LARGE')
   const seal=()=>{guard();for(const[oldName,old]of read.phases)assertSameObservation(observeRootAuthority(this.#bootstrap,oldName,limits.phaseBytes),old);assertSameObservation(observeRootAuthority(this.#bootstrap,name,limits.phaseBytes),phase)}
   const written=await this.publish(requestName,text,read.observation,'request',seal);this.expected=written
   this.read();return structuredClone(request)
  }catch(cause){if(phasePublished)this.uncertain=true;safe(cause)}
 }
 prepare(ownerNonce:string,input:ApplicationRestoreSelection):Promise<ApplicationRestoreRequest>{return this.serial(async()=>{
  const owner=parse(z.uuid(),ownerNonce,'OWNER_EXPIRED'),selection=parse(applicationRestoreSelectionSchema,input,'SELECTION_INVALID');this.host(owner)
  const read=this.read();this.authorityRequests(read.state)
  const evidence=this.evidence()
  if(evidence.unknown||evidence.operationIds.length||read.state.operations.some(row=>!['consumed','cancelled'].includes(row.phase)))fail('REQUEST_PENDING')
  if(read.state.operations.length>=limits.operations)fail('OPERATION_LIMIT')
  const authority=readRootAuthority(this.#bootstrap,()=>this.host(owner)),backup=this.backup(selection)
  if(backup.appId!==authority.pointer.rootId)fail('BACKUP_APP_MISMATCH')
  const next:Body={operationId:randomUUID(),ownerNonce:owner,oldProcess:this.#processIdentity,source:authority.pointer,sourcePointerFile:authority.pointerFile,backup,parent:selection.parent,createdAt:new Date().toISOString(),phase:'prepared'}
  const seal=()=>{this.host(owner);authority.assertCurrent();this.bindings(next,true)};seal()
  return this.write(read,next,seal)
 })}
 arm(ownerNonce:string,operationId:string):Promise<ApplicationRestoreRequest>{return this.serial(async()=>{
  this.host(ownerNonce);const read=this.read(),request=this.owned(read,operationId)
  if(request.ownerNonce!==ownerNonce)fail('OWNER_EXPIRED');if(request.phase!=='prepared')fail('PHASE_INVALID')
  const seal=()=>{this.host(ownerNonce);this.sameSource(request);this.bindings(request,true);this.guarded(()=>this.#options.assertQuiesced(structuredClone(request)),'SOURCE_NOT_CLOSED')}
  return this.write(read,{...body(request),phase:'armed'},seal)
 })}
 beginExecution(ownerNonce:string,operationId:string):Promise<ApplicationRestoreExecutionHandle>{return this.serial(async()=>{
  this.host(ownerNonce);const read=this.read(),request=this.owned(read,operationId);if(request.phase!=='armed')fail('PHASE_INVALID')
  const execution:ApplicationRestoreExecution={attemptId:randomUUID(),ownerNonce,process:this.#processIdentity}
  const seal=()=>{this.host(ownerNonce);this.departed(request);this.sameSource(request);this.bindings(request,true)}
  const started=await this.write(read,{...body(request),phase:'executing',execution},seal)
  const handle:ApplicationRestoreExecutionHandle=Object.freeze({operationId,attemptId:execution.attemptId,assertCurrent:()=>{
   const cap=this.capability(handle);this.host(cap.execution.ownerNonce);this.departed(started);this.sameSource(started);this.bindings(started)
   const current=this.owned(this.read(),operationId);if(current.phase!=='executing'||!same(current.execution,execution))fail('ATTEMPT_EXPIRED')
  }})
  this.#handles.set(handle,{handle,execution,operationId,retired:false});return handle
 })}
 private capability(handle:ApplicationRestoreExecutionHandle){const cap=handle&&this.#handles.get(handle);if(!cap||cap.retired)fail('ATTEMPT_EXPIRED');return cap}
 private execution(read:ReadState,handle:ApplicationRestoreExecutionHandle){const cap=this.capability(handle),request=this.owned(read,cap.operationId);if(request.phase!=='executing'||!same(request.execution,cap.execution))fail('ATTEMPT_EXPIRED');return{cap,request}}
 private committed(request:ApplicationRestoreRequest){
  const authority=readRootAuthority(this.#bootstrap,()=>this.host()),entry=authority.links.find(row=>row.kind==='application'&&(row.record as ApplicationRestoreActivationRecord).receiptId===request.operationId)
  if(!entry)fail('INSPECTION_REQUIRED')
  const record=entry.record as ApplicationRestoreActivationRecord
  if(!same(record.before,request.source)||!same(record.beforePointerFile,request.sourcePointerFile)||record.candidate.backupId!==request.backup.backupId||record.candidate.backupChecksum!==request.backup.checksum||!same(authority.pointer,record.after)||dirname(record.after.root.path)!==request.parent.path||basename(record.after.root.path)!==record.candidate.id)fail('ACTIVATION_MISMATCH')
  assertRootAuthorityDirectory(request.parent);assertCurrentApplicationMarker(authority.pointer)
  const marker=observeRootAuthority(authority.pointer.root,applicationNames(authority.pointer.root).appMarker,16384)!
  const witness:ApplicationRestoreActivationWitness={receiptId:record.receiptId,receiptFile:entry.file,pointer:authority.pointer,pointerFile:authority.pointerFile,candidateId:record.candidate.id,barrierToken:record.candidate.barrierToken}
  if(request.activation&&!same(request.activation,witness))fail('ACTIVATION_CHANGED')
  return{witness,seal:()=>{this.host();authority.assertCurrent();assertSameObservation(observeRootAuthority(authority.pointer.root,applicationNames(authority.pointer.root).appMarker,16384),marker)}}
 }
 activated(handle:ApplicationRestoreExecutionHandle):Promise<ApplicationRestoreRequest>{return this.serial(async()=>{
  const read=this.read(),{cap,request}=this.execution(read,handle),result=this.committed(request)
  const seal=()=>{this.host(cap.execution.ownerNonce);this.departed(request);result.seal()}
  const changed=await this.write(read,{...body(request),phase:'activated',activation:result.witness},seal);cap.retired=true;return changed
 })}
 cancelPrepared(ownerNonce:string,operationId:string):Promise<ApplicationRestoreRequest>{return this.serial(async()=>{
  this.host(ownerNonce);const read=this.read(),request=this.owned(read,operationId)
  if(request.ownerNonce!==ownerNonce)fail('OWNER_EXPIRED');if(request.phase!=='prepared')fail('PHASE_INVALID')
  return this.write(read,{...body(request),phase:'cancelled'},()=>{this.host(ownerNonce);this.sameSource(request)})
 })}
 unknown(handle:ApplicationRestoreExecutionHandle,reason:NonNullable<ApplicationRestoreRequest['reason']>='CONTROL_UNCERTAIN'):Promise<ApplicationRestoreRequest>{return this.serial(async()=>{
  const read=this.read(),{cap,request}=this.execution(read,handle),changed=await this.write(read,{...body(request),phase:'unknown',reason},()=>this.host());cap.retired=true;return changed
 })}
 cancelExecution(handle:ApplicationRestoreExecutionHandle):Promise<ApplicationRestoreRequest>{return this.serial(async()=>{
  const read=this.read(),{cap,request}=this.execution(read,handle)
  this.guarded(()=>this.#options.assertExecutionSettled(structuredClone(cap.execution)),'IO_PENDING')
  let cancelled=true;try{this.sameSource(request);if(observeRootAuthority(this.#bootstrap,`application-restore-${request.operationId}.json`,limits.phaseBytes,true))cancelled=false}catch{cancelled=false}
  const seal=()=>{this.host();this.guarded(()=>this.#options.assertExecutionSettled(structuredClone(cap.execution)),'IO_PENDING');if(cancelled){this.sameSource(request);if(observeRootAuthority(this.#bootstrap,`application-restore-${request.operationId}.json`,limits.phaseBytes,true))fail('COMMIT_UNCERTAIN')}}
  const changed=await this.write(read,{...body(request),phase:cancelled?'cancelled':'unknown',...(cancelled?{}:{reason:'COMMIT_UNCERTAIN' as const})},seal);cap.retired=true;return changed
 })}
 private checkpoint(request:ApplicationRestoreRequest,result:ReturnType<ApplicationRestoreRequests['committed']>,receipt:DraftReceipt){
  const root=result.witness.pointer.root,retentionFile=observeRootAuthority(root,'application-restore-drafts.json',APPLICATION_DRAFT_RETENTION_LIMITS.bytes)!,retention=parse(applicationDraftRetentionSchema,JSON.parse(retentionFile.text),'BARRIER_INVALID'),{checksum,...content}=retention
  if(checksum!==digest(canonical(content))||retention.appId!==request.source.rootId||retention.operationId!==request.operationId||retention.candidateId!==result.witness.candidateId||retention.barrier.token!==result.witness.barrierToken)fail('BARRIER_INVALID')
  for(const row of retention.snapshots)validateDraftSnapshot(row.snapshot)
  const journalFile=observeRootAuthority(root,'drafts.json',APPLICATION_DRAFT_RETENTION_LIMITS.bytes+65536)!,journal=parse(snapshotEnvelope,JSON.parse(journalFile.text),'CHECKPOINT_UNCONFIRMED'),snapshot=validateDraftSnapshot(journal.snapshot)
  if(journal.digest!==digest(JSON.stringify(snapshot))||!same(receipt,{revision:journal.revision,digest:journal.digest,clientRevision:snapshot.revision}))fail('CHECKPOINT_UNCONFIRMED')
  const recovery=snapshot.sources.recovery as {version?:unknown;items?:unknown[]}|undefined,items=applicationDraftRecoveryItems(retention)
  if(recovery?.version!==1||!Array.isArray(recovery.items)||items.some(item=>!recovery.items!.some(actual=>same(actual,item))))fail('RECOVERY_INCOMPLETE')
  const witness:ApplicationRestoreCheckpointWitness={kind:'first-checkpoint',receipt,sessionId:journal.sessionId,journalFile:journalFile.proof,retentionFile:retentionFile.proof,snapshotChecksum:journal.digest,recoveryChecksum:digest(canonical(items))}
  return{retention,witness,seal:()=>{result.seal();assertSameObservation(observeRootAuthority(root,'application-restore-drafts.json',APPLICATION_DRAFT_RETENTION_LIMITS.bytes),retentionFile);assertSameObservation(observeRootAuthority(root,'drafts.json',APPLICATION_DRAFT_RETENTION_LIMITS.bytes+65536),journalFile)}}
 }
 private withWrite<T>(run:()=>Promise<T>):Promise<T>{return this.#options.withWrite?this.#options.withWrite(run):run()}
 recordFirstCheckpoint(ownerNonce:string,operationId:string,journal:DraftJournal,journalOwner:string,input:DraftReceipt):Promise<ApplicationRestoreRequest>{return this.serial(()=>this.withWrite(async()=>{
  this.host(ownerNonce);const read=this.read(),request=this.owned(read,operationId)
  if(!['executing','unknown','activated'].includes(request.phase))fail('PHASE_INVALID')
  const result=this.committed(request),receipt=parse(draftReceiptSchema,input,'CHECKPOINT_UNCONFIRMED')
  if(!(journal instanceof DraftJournal)||journal.root!==result.witness.pointer.root.path)fail('JOURNAL_MISMATCH')
  const checkpoint=this.checkpoint(request,result,receipt)
  try{await confirmJournal.call(journal,journalOwner,receipt)}catch{fail('CHECKPOINT_UNCONFIRMED')}
  checkpoint.seal();this.host(ownerNonce)
  const barrier=checkpoint.retention.barrier,after=(previous:DraftReceipt|undefined)=>!!previous&&receipt.revision>previous.revision&&receipt.clientRevision>previous.clientRevision
  let kind:ApplicationRestoreCheckpointWitness['kind']
  if(barrier.phase==='checkpointed'&&same(barrier.firstCheckpoint,receipt))kind='first-checkpoint'
  else if(barrier.phase==='checkpointed'&&after(barrier.firstCheckpoint))kind='checkpointed-session-restart'
  else if(barrier.phase==='complete'&&after(barrier.secondCheckpoint))kind='completed-barrier-restart'
  else fail('FIRST_CHECKPOINT_REQUIRED')
  checkpoint.witness.kind=kind
  if(request.firstCheckpoint&&same(request.firstCheckpoint,checkpoint.witness))return structuredClone(request)
  const seal=()=>{this.host(ownerNonce);checkpoint.seal()}
  return this.write(read,{...body(request),activation:result.witness,firstCheckpoint:checkpoint.witness},seal,kind)
 }))}
 consumed(ownerNonce:string,operationId:string,journal:DraftJournal,journalOwner:string,input:DraftReceipt):Promise<ApplicationRestoreRequest>{return this.serial(()=>this.withWrite(async()=>{
  this.host(ownerNonce);const read=this.read(),request=this.owned(read,operationId)
  if(!['activated','unknown','executing'].includes(request.phase)||!request.firstCheckpoint)fail('FIRST_CHECKPOINT_REQUIRED')
  const result=this.committed(request),receipt=parse(draftReceiptSchema,input,'CHECKPOINT_UNCONFIRMED')
  if(!(journal instanceof DraftJournal)||journal.root!==result.witness.pointer.root.path)fail('JOURNAL_MISMATCH')
  const checkpoint=this.checkpoint(request,result,receipt),first=request.firstCheckpoint
  try{await confirmJournal.call(journal,journalOwner,receipt)}catch{fail('CHECKPOINT_UNCONFIRMED')}
  checkpoint.seal();this.host(ownerNonce)
  const barrier=checkpoint.retention.barrier,greater=(a:DraftReceipt,b:DraftReceipt|undefined)=>!!b&&a.revision>b.revision&&a.clientRevision>b.clientRevision
  const original=first.kind==='first-checkpoint'&&same(barrier.firstCheckpoint,first.receipt)&&same(barrier.secondCheckpoint,receipt)
  const checkpointRestart=first.kind==='checkpointed-session-restart'&&greater(first.receipt,barrier.firstCheckpoint)&&same(barrier.secondCheckpoint,receipt)
  const completedRestart=first.kind==='completed-barrier-restart'&&greater(first.receipt,barrier.secondCheckpoint)&&same(first.retentionFile,checkpoint.witness.retentionFile)
  if(barrier.phase!=='complete'||!(original||checkpointRestart||completedRestart)||!greater(receipt,first.receipt)||checkpoint.witness.sessionId!==first.sessionId||checkpoint.witness.recoveryChecksum!==first.recoveryChecksum)fail('SECOND_CHECKPOINT_REQUIRED')
  checkpoint.witness.kind=first.kind
  const{reason:_reason,...completed}=body(request)
  return this.write(read,{...completed,phase:'consumed',activation:result.witness,secondCheckpoint:checkpoint.witness},()=>{this.host(ownerNonce);checkpoint.seal()})
 }))}
}
