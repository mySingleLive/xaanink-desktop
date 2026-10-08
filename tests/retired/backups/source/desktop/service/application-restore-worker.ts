import {isMainThread,parentPort,workerData} from 'node:worker_threads'
import {lstatSync,realpathSync} from 'node:fs'
import {dirname,basename} from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {sameIdentity,directoryIdentity} from '../core/root-ownership'
import {canonical} from '../core/application-backup-files'
import {assertRootAuthorityDirectory,observeRootAuthority,readRootAuthority} from '../core/root-authority'
import {ApplicationBackups} from '../core/application-backups'
import {ApplicationRestoreActivation,type ApplicationRestoreActivationPreview,type ApplicationRestoreSource} from '../core/application-restore-activation'
import {preserveClosedApplicationSource} from '../core/application-cold-source'
import {prepareApplicationDraftRetention} from '../core/application-restore-drafts'
import {loadApplicationRestoreLayout} from '../main/application-restore-layout'
import {applicationRestoreRequestSchema} from '../shared/application-restore-request'
import {applicationRestoreLayoutSchema} from '../shared/application-restore-layout'
import {applicationBackupSchema} from '../shared/application-backup'
import {prepareApplicationRestoreWithProof,reSealApplicationRestoreWithProof,cancelApplicationRestore} from './database/application-restore'
import {loadMigrations} from './database/migrations'
const inputSchema=z.object({kind:z.literal('application-restore36'),request:applicationRestoreRequestSchema,layout:applicationRestoreLayoutSchema,migrationsPath:z.string().min(1).max(8192),revocation:z.custom<SharedArrayBuffer>(value=>value instanceof SharedArrayBuffer&&value.byteLength===4)}).strict()
export type ApplicationRestoreWorkerInput=z.infer<typeof inputSchema>
type WorkerResult={receiptId:string;requiresColdStart:true}
type WorkerHost={confirm(preview:Readonly<ApplicationRestoreActivationPreview>):Promise<boolean>;progress?(phase:'snapshot'|'preserving'|'candidate'|'drafts'|'confirming'|'activating'):void}
interface ExecutionScope{input:ApplicationRestoreWorkerInput;signal:AbortSignal;assertCurrent():void;host:WorkerHost}
export interface ApplicationRestoreWorkerOperations{execute(scope:ExecutionScope):Promise<WorkerResult>}
function fail(code:string):never{throw Object.assign(Error(code),{code})}
function present(root:ApplicationRestoreWorkerInput['request']['source']['root']){let stat;try{stat=lstatSync(root.path,{bigint:true})}catch(cause){if(['ENOENT','ENOTDIR'].includes((cause as NodeJS.ErrnoException).code??''))return false;throw cause}if(!stat.isDirectory()||stat.isSymbolicLink()||!sameIdentity({device:String(stat.dev),inode:String(stat.ino)},root))return false;if(realpathSync(root.path)!==root.path)fail('SOURCE_UNCONFIRMED');return true}
/** One-shot worker lifecycle. The main-held request handle stays in main; only
 * this private transport receives its exact request/attempt and shared fence.
 * Genuine producer/retention/source proofs never leave this worker. */
export class ApplicationRestoreWorkerRuntime{
 readonly #input:ApplicationRestoreWorkerInput
 readonly #host:WorkerHost
 readonly #operations:ApplicationRestoreWorkerOperations
 readonly #abort=new AbortController()
 #flight:Promise<WorkerResult>|null=null
 #started=false
 #settled=false
 constructor(input:ApplicationRestoreWorkerInput,host:WorkerHost,operations:ApplicationRestoreWorkerOperations={execute:executeActualApplicationRestore}){
  this.#input=inputSchema.parse(input);this.#host=Object.freeze({...host});this.#operations=Object.freeze({...operations})
  const r=this.#input.request,layout=this.#input.layout
  if(r.phase!=='executing'||!r.execution||r.execution.process.pid!==process.pid||layout.phase!=='bound'||!layout.binding||layout.binding.operationId!==r.operationId||!layout.parents||canonical(layout.parents.candidate)!==canonical(r.parent)||layout.ownerNonce!==r.ownerNonce)fail('WORKER_ATTEMPT_INVALID')
  this.assertCurrent()
 }
 assertCurrent(){
  const i=this.#input;this.#abort.signal.throwIfAborted();if(Atomics.load(new Int32Array(i.revocation),0)!==0)fail('OWNER_EXPIRED')
  assertRootAuthorityDirectory(i.layout.bootstrap);assertRootAuthorityDirectory(i.layout.base);for(const parent of Object.values(i.layout.parents!))assertRootAuthorityDirectory(parent)
  try{process.kill(i.request.oldProcess.pid,0);fail('SOURCE_PROCESS_ACTIVE')}catch(cause){if((cause as {code?:string}).code!=='ESRCH')throw cause}
 }
 run():Promise<WorkerResult>{if(this.#started)return Promise.reject(Object.assign(Error('WORKER_ALREADY_STARTED'),{code:'WORKER_ALREADY_STARTED'}));this.#started=true
  const flight=Promise.resolve().then(async()=>{this.assertCurrent();const actual=loadApplicationRestoreLayout(this.#input.layout.bootstrap,this.#input.request);if(canonical(actual)!==canonical(this.#input.layout))fail('WORKER_LAYOUT_CHANGED');const source=readRootAuthority(actual.bootstrap,()=>this.assertCurrent());if(canonical(source.pointer)!==canonical(this.#input.request.source)||canonical(source.pointerFile)!==canonical(this.#input.request.sourcePointerFile))fail('WORKER_SOURCE_CHANGED');source.assertCurrent();return this.#operations.execute({input:this.#input,signal:this.#abort.signal,assertCurrent:()=>this.assertCurrent(),host:this.#host})}).finally(()=>{this.#settled=true});this.#flight=flight;return flight
 }
 async cancel(){Atomics.store(new Int32Array(this.#input.revocation),0,1);this.#abort.abort(Error('OPERATION_CANCELLED'));await this.#flight?.catch(()=>{});return{settled:this.#settled||!this.#started}}
 get settled(){return this.#settled}
}
async function executeActualApplicationRestore(scope:ExecutionScope):Promise<WorkerResult>{
 const{input,host,signal,assertCurrent:guard}=scope,r=input.request,layout=input.layout,parents=layout.parents!;guard()
 const fresh=readRootAuthority(layout.bootstrap,guard),available=present(fresh.pointer.root)
 if((layout.sourceKind==='missing')!==!available)fail('SOURCE_KIND_CHANGED')
 const container=await directoryIdentity(dirname(r.backup.directory.path));guard();if(basename(r.backup.directory.path)!==r.backup.backupId)fail('BACKUP_PACKAGE_ID_MISMATCH')
 const receipt=applicationBackupSchema.parse(JSON.parse(observeRootAuthority(r.backup.directory,'xuanxiang-app-backup.json',16*1024*1024)!.text))
 const backupGuard=()=>{guard();assertRootAuthorityDirectory(container);assertRootAuthorityDirectory(r.backup.directory);const current=observeRootAuthority(r.backup.directory,'xuanxiang-app-backup.json',16*1024*1024)!;if(canonical(current.proof)!==canonical(r.backup.receiptFile))fail('BACKUP_CHANGED')}
 const selected=new ApplicationBackups(container,fresh.pointer.rootId,receipt.engine,{assertOwner:backupGuard,assertClosed(){fail('SELECTED_BACKUP_READ_ONLY')},async verifyCaptured(){fail('SELECTED_BACKUP_READ_ONLY')}})
 const inspected=await selected.inspect(r.backup.backupId,signal);backupGuard();if(inspected.receipt.phase!=='verified'||inspected.receipt.checksum!==r.backup.checksum||canonical(inspected.directory)!==canonical(r.backup.directory))fail('BACKUP_CHANGED')
 const migrations=await loadMigrations(input.migrationsPath);guard()
 const producerHost={expectedAppId:fresh.pointer.rootId,assertOwner:guard,assertOwnerImmediately:guard}
 let source:ApplicationRestoreSource,preservation:Awaited<ReturnType<typeof preserveClosedApplicationSource>>|undefined
 if(layout.sourceKind==='closed-source'){
  host.progress?.('preserving');preservation=await preserveClosedApplicationSource({operationId:r.operationId,bootstrap:layout.bootstrap,parent:parents.raw,candidateParent:parents.candidate},{assertStableLock:guard,assertCold:guard,assertOwnerImmediately:guard},{signal});guard();source={kind:'closed-source',preservation}
 }else if(available){
  host.progress?.('snapshot')
  const before=new ApplicationBackups(parents.before,fresh.pointer.rootId,receipt.engine,{assertOwner:guard,assertClosed:guard,async verifyCaptured(captured,verificationSignal){guard();const verified=await prepareApplicationRestoreWithProof(before,captured.id,parents.verify,migrations,producerHost,verificationSignal);guard();await cancelApplicationRestore(parents.verify,verified.candidate.id,producerHost,async()=>false);guard()}})
  const captured=await before.create(fresh.pointer.root,1,[],signal);guard();if(captured.phase!=='verified')fail('BEFORE_SNAPSHOT_NOT_VERIFIED');source={kind:'healthy',beforeSnapshot:{backups:before,backupId:captured.id}}
 }else source={kind:'missing'}
 host.progress?.('candidate');const candidate=await prepareApplicationRestoreWithProof(selected,r.backup.backupId,parents.candidate,migrations,producerHost,signal);guard()
 host.progress?.('drafts');const drafts=await prepareApplicationDraftRetention({appId:fresh.pointer.rootId,operationId:r.operationId,candidateId:candidate.candidate.id,current:available?fresh.pointer.root:null,backup:candidate.candidate.directory},guard);guard()
 const sealed=await reSealApplicationRestoreWithProof(candidate,drafts,signal,preservation?{kind:'closed-source',bootstrap:layout.bootstrap,preservation}:undefined);guard()
 const activation=new ApplicationRestoreActivation(layout.bootstrap,{assertStableLock:guard,assertCold:guard,assertOwner:guard,async confirm(preview){guard();host.progress?.('confirming');const accepted:unknown=await host.confirm(preview);guard();if(accepted!==true&&accepted!==false)fail('INVALID_CONFIRMATION');if(accepted===true)host.progress?.('activating');return accepted===true}})
 try{const preview=await activation.prepare(r.execution!.ownerNonce,sealed,source);guard();if(preview.operationId!==r.operationId)fail('WORKER_OPERATION_MISMATCH');const result=await activation.activate(r.execution!.ownerNonce,r.operationId);return{receiptId:result.receiptId,requiresColdStart:true}}
 finally{await activation.flush()}
}

if(!isMainThread&&workerData?.kind==='application-restore36'&&parentPort){
 const port=parentPort,confirmations=new Map<string,{resolve:(value:boolean)=>void;reject:(cause:unknown)=>void}>()
 const runtime=new ApplicationRestoreWorkerRuntime(workerData,{confirm:preview=>new Promise<boolean>((resolve,reject)=>{const id=randomUUID();confirmations.set(id,{resolve,reject});port.postMessage({type:'confirm',id,preview})}),progress:phase=>port.postMessage({type:'progress',phase})})
 port.on('message',(message:unknown)=>{
  const command=z.union([z.object({type:z.literal('cancel')}).strict(),z.object({type:z.literal('confirmed'),id:z.uuid(),accepted:z.boolean()}).strict()]).safeParse(message);if(!command.success)return
  if(command.data.type==='cancel'){for(const pending of confirmations.values())pending.reject(Error('OPERATION_CANCELLED'));confirmations.clear();void runtime.cancel()}
  else{const pending=confirmations.get(command.data.id);if(pending){confirmations.delete(command.data.id);pending.resolve(command.data.accepted)}}
 })
 void runtime.run().then(result=>port.postMessage({type:'complete',result}),cause=>port.postMessage({type:'failed',code:typeof cause?.code==='string'?cause.code:'APPLICATION_RESTORE_FAILED'})).finally(()=>{confirmations.clear();port.close()})
}
