import {applicationNames} from './brand-names'
import {BRAND_NAMES} from '../shared/brand-names'
import {constants,lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,renameSync,unlinkSync,opendirSync,type BigIntStats} from 'node:fs'
import {open} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
import {isAbsolute,join} from 'node:path'
import {z} from 'zod'
import {DataRootManager,type RootIdentity,type RootPointer} from './data-root'
import {rootIdentitySchema,rootMarkerSchema,sameIdentity,within} from './root-ownership'
import {ROOT_MIGRATION_LIMITS} from './root-inventory-limits'
import {validateRootMigrationRequestSnapshot,MAX_ROOT_MIGRATION_REQUEST_BYTES} from '../main/root-migration-request'
import type {RootAuthorityContext} from './root-authority'

export const ROOT_RELOCATION_LIMITS={pointerBytes:16*1024,markerBytes:16*1024,catalogBytes:16*1024*1024,receiptBytes:64*1024,receipts:16,bootstrapEntries:512} as const
export interface RootRelocationPreview {attemptId:string;source:RootPointer;target:RootIdentity;unreadMigrationResults:number;retainedMigration:{migrationId:string;phase:string;pendingCount:number}|null}
export interface RootRelocationOutcome {pointer:RootPointer;receiptId:string;requiresColdStart:true}
export interface RootRelocationOptions {
 assertStableLock():void
 assertCold():void
 assertOwner(ownerNonce:string):void
 confirm(preview:Readonly<RootRelocationPreview>):Promise<boolean>
 beforeReceiptRename?():void|Promise<void>
 beforePointerRename?():void|Promise<void>
 beforeDirectorySync?(record:'receipt'|'pointer'|'recovery'):void|Promise<void>
}
export class RootRelocationError extends Error {constructor(readonly code:string){super(code);this.name='RootRelocationError'}}
export interface RootRelocationDisposition {pointer:RootPointer;receiptId:string;retainedMigration:RootRelocationPreview['retainedMigration'];unreadMigrationResultIds:string[];journalChecksum:string|null;completionWitnesses:{requestId:string;receiptId:string;sha256:string}[];/** Trusted core/main closure, never serialized to renderer. */assertCurrent():void}
interface FileProof{device:string;inode:string;size:string;mtimeNs:string;ctimeNs:string;sha256:string}
interface Observation{proof:FileProof;value:unknown}
interface Layout{directories:RootIdentity[];files:{marker:FileProof;catalog:FileProof;pgVersion:FileProof}}
interface Controls{journal:FileProof|null;request:FileProof|null}
interface LedgerWitness{revision:number;results:{requestId:string;receiptId:string;sha256:string}[]}
interface Receipt{schemaVersion:1;receiptId:string;createdAt:string;bootstrap:RootIdentity;before:RootPointer;beforePointerFile:FileProof;after:RootPointer;pointerFile:Omit<FileProof,'ctimeNs'>;controls:Controls;ledgerWitness:LedgerWitness|null;layout:Layout;retainedMigration:RootRelocationPreview['retainedMigration'];unreadMigrationResultIds:string[]}
interface ReceiptObservation{record:Receipt;file:FileProof;name:string}
interface Context{pointer:RootPointer;pointerFile:FileProof;controls:Controls;journalChecksum:string|null;ledgerWitness:LedgerWitness|null;retainedMigration:RootRelocationPreview['retainedMigration'];resultIds:string[];records:ReceiptObservation[];authority?:RootAuthorityContext}
interface Attempt{owner:string;preview:RootRelocationPreview;context:Context;layout:Layout;cancelled:boolean;ownReceipt?:{name:string;proof:FileProof}}
interface Temporary{name:string;proof:FileProof}
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex')
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>[key,stable(v)])):value
const same=(a:unknown,b:unknown)=>JSON.stringify(stable(a))===JSON.stringify(stable(b))
const missing=(error:unknown)=>(error as NodeJS.ErrnoException)?.code==='ENOENT'
function fail(code:string):never{throw new RootRelocationError(code)}
function safeError(error:unknown,code:string):never{if(error instanceof RootRelocationError)throw error;fail(code)}
function synchronousAssertion(action:()=>void,code:string){
 try{const result:unknown=action();if(result!==undefined){void Promise.resolve(result).catch(()=>{});fail(code)}}catch{fail(code)}
}
function parsedPointer(value:unknown):RootPointer{try{const p=DataRootManager.parsePointer(value);if(!isAbsolute(p.root.path)||/[\x00-\x1f]/.test(p.root.path))fail('POINTER_INVALID');return p}catch(error){safeError(error,'POINTER_INVALID')}}
function identityStat(info:BigIntStats):RootIdentity{return{path:'',device:String(info.dev),inode:String(info.ino)}}
function proofOf(info:BigIntStats,bytes:Buffer):FileProof{return{device:String(info.dev),inode:String(info.ino),size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs),sha256:sha(bytes)}}
function assertDirectory(root:RootIdentity,code='TARGET_CHANGED'){
 try{const info=lstatSync(root.path,{bigint:true});if(!isAbsolute(root.path)||/[\x00-\x1f]/.test(root.path)||!info.isDirectory()||info.isSymbolicLink()||!sameIdentity(identityStat(info),root)||realpathSync(root.path)!==root.path)fail(code)}catch(error){safeError(error,code)}
}
function currentDirectory(path:string):RootIdentity{
 try{const info=lstatSync(path,{bigint:true}),identity={...identityStat(info),path};assertDirectory(identity);return identity}catch(error){safeError(error,'TARGET_INVALID')}
}
/** Cold control reads are bounded and synchronous. The final CAS cannot yield
 * between owner/source/path checks and rename; stat revisions also guard ABA. */
function observe(root:RootIdentity,name:string,max:number,optional=false):Observation|null{
 assertDirectory(root,'BOOTSTRAP_CHANGED')
 const path=join(root.path,name);let info:BigIntStats
 try{info=lstatSync(path,{bigint:true})}catch(error){if(optional&&missing(error))return null;safeError(error,'CONTROL_UNSAFE')}
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size>BigInt(max))fail('CONTROL_UNSAFE')
 let fd:number|undefined
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const opened=fstatSync(fd,{bigint:true})
  if(opened.dev!==info.dev||opened.ino!==info.ino||opened.size!==info.size||opened.mtimeNs!==info.mtimeNs||opened.ctimeNs!==info.ctimeNs||opened.nlink!==1n)fail('CONTROL_CHANGED')
  const buffer=Buffer.alloc(Math.min(64*1024,max+1)),chunks:Buffer[]=[];let size=0
  for(;;){const count=readSync(fd,buffer,0,Math.min(buffer.length,max+1-size),null);if(!count)break;size+=count;if(size>max)fail('CONTROL_UNSAFE');chunks.push(Buffer.from(buffer.subarray(0,count)))}
  const after=fstatSync(fd,{bigint:true}),leaf=lstatSync(path,{bigint:true})
  if(size!==Number(opened.size)||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||!leaf.isFile()||leaf.nlink!==1n||leaf.dev!==opened.dev||leaf.ino!==opened.ino||leaf.size!==after.size||leaf.mtimeNs!==after.mtimeNs||leaf.ctimeNs!==after.ctimeNs)fail('CONTROL_CHANGED')
  assertDirectory(root,'BOOTSTRAP_CHANGED');const bytes=Buffer.concat(chunks,size)
  return{proof:proofOf(leaf,bytes),value:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
 }catch(error){return safeError(error,'CONTROL_UNSAFE')}finally{if(fd!==undefined)closeSync(fd)}
}
function json(observed:Observation|null,code:string):unknown{
 if(!observed)fail(code);try{return JSON.parse(observed.value as string)}catch{fail(code)}
}
function assertFile(root:RootIdentity,name:string,expected:FileProof|null,code='CONTROL_CHANGED'){
 assertDirectory(root,'BOOTSTRAP_CHANGED');let info:BigIntStats
 try{info=lstatSync(join(root.path,name),{bigint:true})}catch(error){if(expected===null&&missing(error))return;fail(code)}
 if(!expected||!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||!sameIdentity(identityStat(info),expected)||String(info.size)!==expected.size||String(info.mtimeNs)!==expected.mtimeNs||String(info.ctimeNs)!==expected.ctimeNs)fail(code)
}
const proofSchema=z.object({device:z.string().regex(/^\d+$/),inode:z.string().regex(/^\d+$/),size:z.string().regex(/^\d+$/),mtimeNs:z.string().regex(/^\d+$/),ctimeNs:z.string().regex(/^\d+$/),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
const identitySchema=rootIdentitySchema.refine(v=>isAbsolute(v.path)&&!/[\x00-\x1f]/.test(v.path))
const pointerSchema=z.unknown().transform((v,ctx)=>{try{return parsedPointer(v)}catch{ctx.addIssue({code:'custom',message:'pointer'});return z.NEVER}})
const summarySchema=z.object({migrationId:z.uuid(),phase:z.enum(['complete','cleanup-pending','rolled-back','rollback-pending']),pendingCount:z.number().int().nonnegative().max(ROOT_MIGRATION_LIMITS.pending)}).strict()
const ledgerSchema=z.object({revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),results:z.array(z.object({requestId:z.uuid(),receiptId:z.uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(16)}).strict()
const receiptSchema=z.object({schemaVersion:z.literal(1),receiptId:z.uuid(),createdAt:z.iso.datetime(),bootstrap:identitySchema,before:pointerSchema,beforePointerFile:proofSchema,after:pointerSchema,pointerFile:proofSchema.omit({ctimeNs:true}),controls:z.object({journal:proofSchema.nullable(),request:proofSchema.nullable()}).strict(),ledgerWitness:ledgerSchema.nullable(),layout:z.object({directories:z.array(identitySchema).length(2),files:z.object({marker:proofSchema,catalog:proofSchema,pgVersion:proofSchema}).strict()}).strict(),retainedMigration:summarySchema.nullable(),unreadMigrationResultIds:z.array(z.uuid()).max(16)}).strict()
function decodeReceipt(value:unknown,name:string,boot:RootIdentity):Receipt{
 try{
  const envelope=z.object({record:receiptSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(value),r=envelope.record
  if(sha(JSON.stringify(stable(r)))!==envelope.sha256||name!==`root-relocation-${r.receiptId}.json`||!same(boot,r.bootstrap)||!sameIdentity(r.before.root,r.after.root)||r.after.root.path===r.before.root.path||!same(r.after,{...r.before,revision:r.before.revision+1,root:r.after.root})||r.after.revision>Number.MAX_SAFE_INTEGER||r.pointerFile.sha256!==sha(JSON.stringify(r.after)+'\n')||new Set(r.unreadMigrationResultIds).size!==r.unreadMigrationResultIds.length)fail('RECEIPT_INVALID')
  if(r.layout.directories[0].path!==join(r.after.root.path,'inbox')||r.layout.directories[1].path!==join(r.after.root.path,'inbox','database')||(!r.controls.journal)!==(!r.retainedMigration)||!r.controls.request&&r.unreadMigrationResultIds.length)fail('RECEIPT_INVALID')
  if((!r.controls.request)!==(!r.ledgerWitness)||!same(r.unreadMigrationResultIds,r.ledgerWitness?.results.map(result=>result.receiptId)??[])||r.ledgerWitness&&new Set(r.ledgerWitness.results.map(result=>result.requestId)).size!==r.ledgerWitness.results.length)fail('RECEIPT_INVALID')
  return r
 }catch(error){safeError(error,'RECEIPT_INVALID')}
}
function receiptNames(boot:RootIdentity):string[]{
 assertDirectory(boot,'BOOTSTRAP_CHANGED');const entries:string[]=[]
 try{const directory=opendirSync(boot.path);try{for(;;){const entry=directory.readSync();if(!entry)break;if(entries.length>=ROOT_RELOCATION_LIMITS.bootstrapEntries)fail('RECEIPT_LIMIT');entries.push(entry.name)}}finally{directory.closeSync()}}catch(error){safeError(error,'CONTROL_UNSAFE')}
 const names=entries.filter(name=>name.startsWith('root-relocation-'));if(names.length>ROOT_RELOCATION_LIMITS.receipts)fail('RECEIPT_LIMIT')
 return names.sort()
}
function receipts(boot:RootIdentity):ReceiptObservation[]{
 return receiptNames(boot).map(name=>{if(!/^root-relocation-[0-9a-f-]{36}\.json$/i.test(name))fail('RECEIPT_INVALID');const data=observe(boot,name,ROOT_RELOCATION_LIMITS.receiptBytes)!;return{record:decodeReceipt(json(data,'RECEIPT_INVALID'),name,boot),name,file:data.proof}})
}
/** Bounded, read-only decoding for the unified authority chain. This does not
 * grant relocation or hide journal mismatches in the ordinary getter. */
export function readRootRelocationAuthorityRecords(boot:RootIdentity){return receipts(boot).map(row=>({name:row.name,file:row.file,record:structuredClone(row.record)}))}
function pinned(a:Omit<FileProof,'ctimeNs'>,b:FileProof){return sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.sha256===b.sha256}
function chain(records:ReceiptObservation[],pointer:RootPointer,pointerFile:FileProof):ReceiptObservation[]{
 const result:ReceiptObservation[]=[];let current=pointer,currentFile=pointerFile
 for(;;){const semantic=records.filter(r=>same(r.record.after,current));if(!semantic.length)break;const matches=semantic.filter(r=>pinned(r.record.pointerFile,currentFile));if(matches.length!==1)fail('POINTER_CHANGED');const r=matches[0];if(result.includes(r))fail('RECEIPT_INVALID');result.unshift(r);current=r.record.before;currentFile=r.record.beforePointerFile}
 return result
}
function sourceLost(pointer:RootPointer){
 try{const info=lstatSync(pointer.root.path,{bigint:true});if(info.isDirectory()&&!info.isSymbolicLink()&&sameIdentity(identityStat(info),pointer.root)&&realpathSync(pointer.root.path)===pointer.root.path)fail('ROOT_ALREADY_AVAILABLE')}
 catch(error){if(missing(error))return;safeError(error,'SOURCE_UNAVAILABLE')}
}
function targetLayout(pointer:RootPointer,target:RootIdentity):Layout{
 if(!sameIdentity(pointer.root,target))fail('TARGET_NOT_ORIGINAL')
 assertDirectory(target)
 if(target.path===pointer.root.path)fail('ROOT_ALREADY_AVAILABLE')
 for(const names of BRAND_NAMES)try{lstatSync(join(target.path,names.workManifest));fail('TARGET_INVALID')}catch(error){if(!missing(error))safeError(error,'TARGET_INVALID')}
 try{
  const marker=observe(target,applicationNames(target).appMarker,ROOT_RELOCATION_LIMITS.markerBytes)!,catalog=observe(target,'catalog.json',ROOT_RELOCATION_LIMITS.catalogBytes)!,inbox=currentDirectory(join(target.path,'inbox')),database=currentDirectory(join(inbox.path,'database')),pg=observe(database,'PG_VERSION',32)!
  const parsed=rootMarkerSchema.parse(json(marker,'TARGET_INVALID'));if(parsed.id!==pointer.rootId||parsed.phase!=='ready'||!parsed.inboxReady)fail('TARGET_INVALID')
  // Catalog content is opaque here: parse only to reject broken encoding/JSON.
  // Domain schema and PGlite health remain the ordinary startup's job.
  json(catalog,'TARGET_INVALID');if(!/^\d{1,3}\s*$/.test(pg.value as string))fail('TARGET_INVALID')
  return{directories:[inbox,database],files:{marker:marker.proof,catalog:catalog.proof,pgVersion:pg.proof}}
 }catch(error){if(error instanceof RootRelocationError&&error.code==='TARGET_CHANGED')throw error;fail('TARGET_INVALID')}
}
function assertLayout(target:RootIdentity,layout:Layout){
 assertDirectory(target);for(const dir of layout.directories)assertDirectory(dir)
 try{assertFile(target,applicationNames(target).appMarker,layout.files.marker);assertFile(target,'catalog.json',layout.files.catalog);assertFile(layout.directories[1],'PG_VERSION',layout.files.pgVersion);for(const names of BRAND_NAMES)try{lstatSync(join(target.path,names.workManifest));fail('TARGET_CHANGED')}catch(error){if(!missing(error))throw error}}
 catch{fail('TARGET_CHANGED')}
}
async function syncBootstrap(boot:RootIdentity){
 // A Windows-specific unsupported directory handle/sync is not an EIO ACK.
 let handle:Awaited<ReturnType<typeof open>>|undefined
 try{handle=await open(boot.path,'r');await handle.sync()}
 catch(error){if(process.platform!=='win32'||!['EINVAL','ENOTSUP','EISDIR','EBADF'].includes((error as NodeJS.ErrnoException)?.code??''))throw error}
 finally{await handle?.close()}
}
function ledgerCompatible(before:LedgerWitness|null,current:LedgerWitness|null){
 if(!before)return current===null||current.results.length===0
 return current!==null&&current.revision>=before.revision&&current.results.every(result=>before.results.some(old=>same(old,result)))
}
async function readContext(boot:RootIdentity,guard:()=>void):Promise<Context>{
 // Application restore introduces a new physical root. Resolve its complete
 // ordered chain before the legacy relocation correlation, never catch and
 // suppress JOURNAL_UNRELATED or trust a cached migration ID.
 let applicationHistory=false,count=0;const directory=opendirSync(boot.path)
 try{for(;;){const entry=directory.readSync();if(!entry)break;if(++count>ROOT_RELOCATION_LIMITS.bootstrapEntries)fail('RECEIPT_LIMIT');if(entry.name.startsWith('application-restore-'))applicationHistory=true}}finally{directory.closeSync()}
 if(applicationHistory){const{readRootAuthority}=await import('./root-authority');const authority=readRootAuthority(boot,guard),state=authority.controls.request?validateRootMigrationRequestSnapshot(JSON.parse(authority.controls.request.text)):null;return{pointer:authority.pointer,pointerFile:authority.pointerFile,controls:{journal:authority.controls.journal?.proof??null,request:authority.controls.request?.proof??null},journalChecksum:authority.journalChecksum,ledgerWitness:state?{revision:state.revision,results:authority.completionWitnesses}:null,retainedMigration:authority.retainedMigration,resultIds:authority.unreadMigrationResultIds,records:receipts(boot),authority}}
 guard();const pointerData=observe(boot,'data-root.json',ROOT_RELOCATION_LIMITS.pointerBytes,true)
 if(!pointerData)fail('POINTER_INVALID');const pointer=parsedPointer(json(pointerData,'POINTER_INVALID')),records=receipts(boot),links=chain(records,pointer,pointerData.proof)
 const journal=observe(boot,'root-migration.json',ROOT_MIGRATION_LIMITS.journalBytes,true),request=observe(boot,'root-migration-request.json',MAX_ROOT_MIGRATION_REQUEST_BYTES,true),controls={journal:journal?.proof??null,request:request?.proof??null};let retained:RootRelocationPreview['retainedMigration']=null,resultIds:string[]=[],ledgerWitness:LedgerWitness|null=null,journalChecksum:string|null=null
 if(request){let state:ReturnType<typeof validateRootMigrationRequestSnapshot>;try{state=validateRootMigrationRequestSnapshot(json(request,'REQUEST_INVALID'))}catch{fail('REQUEST_INVALID')}if(state.active)fail('MIGRATION_REQUEST_ACTIVE');resultIds=state.results.map(r=>r.receiptId);ledgerWitness={revision:state.revision,results:state.results.map(r=>({requestId:r.requestId,receiptId:r.receiptId,sha256:sha(JSON.stringify(stable(r)))}))}}
 if(journal){
  const value=json(journal,'JOURNAL_INVALID') as {journal?:{migrationId?:unknown};sha256?:unknown};let record:Awaited<ReturnType<DataRootManager['recordedMigration']>>
  try{if(!z.uuid().safeParse(value?.journal?.migrationId).success)fail('JOURNAL_INVALID');record=await new DataRootManager(boot.path,pointer.root.path).recordedMigration(value.journal!.migrationId as string)}catch{fail('JOURNAL_INVALID')}
  guard();assertFile(boot,'root-migration.json',journal.proof)
  if(!record||!record.result)fail('MIGRATION_RECOVERY_REQUIRED')
  if(typeof value.sha256!=='string'||sha(JSON.stringify(stable(value.journal)))!==value.sha256)fail('JOURNAL_INVALID')
  journalChecksum=value.sha256
  const authoritative=record.result.root,baseline=links.length?links[0].record.before:pointer
  if(!same(authoritative,baseline))fail('JOURNAL_UNRELATED')
  retained={migrationId:record.migrationId,phase:record.phase,pendingCount:record.result.pending.length}
 }
 for(const r of links)if(!same(r.record.controls.journal,controls.journal)||!same(r.record.retainedMigration,retained)||!ledgerCompatible(r.record.ledgerWitness,ledgerWitness))fail('CONTROL_CHANGED')
 guard();assertFile(boot,'data-root.json',pointerData.proof,'POINTER_CHANGED');assertFile(boot,'root-migration.json',controls.journal);assertFile(boot,'root-migration-request.json',controls.request)
 for(const r of records)assertFile(boot,r.name,r.file,'RECEIPT_CHANGED')
 return{pointer,pointerFile:pointerData.proof,controls,journalChecksum,ledgerWitness,retainedMigration:retained,resultIds,records}
}

/** Main-only cold authority. Neither a persisted receipt nor a native path can
 * reconstruct the in-memory user confirmation after cancellation/process loss. */
export class RootRelocation {
 private attempt:Attempt|null=null
 private flight:Promise<unknown>|null=null
 constructor(readonly bootstrap:RootIdentity,readonly options:RootRelocationOptions){this.bootstrap=Object.freeze({...bootstrap})}
 private host(owner?:string){
  synchronousAssertion(()=>this.options.assertStableLock(),'LOCK_REQUIRED')
  synchronousAssertion(()=>this.options.assertCold(),'SOURCE_NOT_CLOSED')
  if(owner!==undefined){if(!z.uuid().safeParse(owner).success)fail('OWNER_EXPIRED');synchronousAssertion(()=>this.options.assertOwner(owner),'OWNER_EXPIRED')}
  assertDirectory(this.bootstrap,'BOOTSTRAP_CHANGED')
 }
 private start<T>(action:()=>Promise<T>):Promise<T>{
  if(this.flight)fail('RELOCATION_BUSY')
  // Register before callbacks/publishing can reenter.
  const flight=Promise.resolve().then(action).catch(error=>safeError(error,'RELOCATION_FAILED'));this.flight=flight
  void flight.finally(()=>{if(this.flight===flight)this.flight=null}).catch(()=>{});return flight
 }
 async inspectLost():Promise<RootPointer>{return this.start(async()=>{this.host();const c=await readContext(this.bootstrap,()=>this.host());sourceLost(c.pointer);return structuredClone(c.pointer)})}
 async prepare(ownerNonce:string,target:RootIdentity):Promise<RootRelocationPreview>{
  return this.start(async()=>{
   this.host(ownerNonce);let selected:RootIdentity;try{selected=identitySchema.parse(target)}catch{fail('TARGET_INVALID')}
   const context=await readContext(this.bootstrap,()=>this.host(ownerNonce));sourceLost(context.pointer)
   if(within(selected.path,this.bootstrap.path)||within(this.bootstrap.path,selected.path))fail('TARGET_INVALID')
   if(context.pointer.revision===Number.MAX_SAFE_INTEGER)fail('REVISION_LIMIT')
   if(context.records.length>=ROOT_RELOCATION_LIMITS.receipts)fail('RECEIPT_LIMIT')
   const layout=targetLayout(context.pointer,selected),preview={attemptId:randomUUID(),source:structuredClone(context.pointer),target:structuredClone(selected),retainedMigration:context.retainedMigration,unreadMigrationResults:context.resultIds.length}
   this.attempt={owner:ownerNonce,preview:structuredClone(preview),context,layout,cancelled:false};return structuredClone(preview)
  })
 }
 private own(owner:string,id:string):Attempt{this.host(owner);const a=this.attempt;if(!a||a.cancelled||a.owner!==owner||a.preview.attemptId!==id)fail('ATTEMPT_EXPIRED');return a}
 private final(a:Attempt){
  this.own(a.owner,a.preview.attemptId);sourceLost(a.context.pointer)
  a.context.authority?.assertCurrent({relocationReceipt:a.ownReceipt?{name:a.ownReceipt.name,file:a.ownReceipt.proof}:undefined})
  assertFile(this.bootstrap,'data-root.json',a.context.pointerFile,'POINTER_CHANGED')
  assertFile(this.bootstrap,'root-migration.json',a.context.controls.journal);assertFile(this.bootstrap,'root-migration-request.json',a.context.controls.request)
  assertLayout(a.preview.target,a.layout)
  for(const r of a.context.records)assertFile(this.bootstrap,r.name,r.file,'RECEIPT_CHANGED')
  if(!same(receiptNames(this.bootstrap),[...a.context.records.map(r=>r.name),...(a.ownReceipt?[a.ownReceipt.name]:[])].sort()))fail('RECEIPT_CHANGED')
  if(a.ownReceipt)assertFile(this.bootstrap,a.ownReceipt.name,a.ownReceipt.proof,'RECEIPT_CHANGED')
 }
 private committedSeal(a:Attempt,pointerFile:FileProof){
  // Pointer rename replaces its old CAS proof. Keep every other authority seal
  // live across directory-sync and native callbacks; failure cannot undo that
  // commit or acknowledge a now unavailable target.
  try{
   this.own(a.owner,a.preview.attemptId);assertFile(this.bootstrap,'data-root.json',pointerFile,'POINTER_CHANGED')
   a.context.authority?.assertCurrent({pointerFile,relocationReceipt:a.ownReceipt?{name:a.ownReceipt.name,file:a.ownReceipt.proof}:undefined})
   assertLayout(a.preview.target,a.layout)
   assertFile(this.bootstrap,'root-migration.json',a.context.controls.journal);assertFile(this.bootstrap,'root-migration-request.json',a.context.controls.request)
   for(const r of a.context.records)assertFile(this.bootstrap,r.name,r.file,'RECEIPT_CHANGED')
   if(!a.ownReceipt||!same(receiptNames(this.bootstrap),[...a.context.records.map(r=>r.name),a.ownReceipt.name].sort()))fail('RECEIPT_CHANGED')
   assertFile(this.bootstrap,a.ownReceipt.name,a.ownReceipt.proof,'RECEIPT_CHANGED')
  }catch{fail('DURABILITY_UNCONFIRMED')}
 }
 private async temporary(content:string):Promise<Temporary>{
  const name=`.root-relocation-${randomUUID()}.tmp`,path=join(this.bootstrap.path,name);this.host()
  let handle:Awaited<ReturnType<typeof open>>|undefined,owned:FileProof|undefined
  try{
   handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(content,'utf8');await handle.sync();const stat=await handle.stat({bigint:true});owned=proofOf(stat,Buffer.from(content));await handle.close();handle=undefined
   const observed=observe(this.bootstrap,name,ROOT_RELOCATION_LIMITS.receiptBytes)!
   if(!same(observed.proof,owned))fail('CONTROL_CHANGED');return{name,proof:owned}
  }catch(error){await handle?.close().catch(()=>{});if(owned)this.cleanup({name,proof:owned});safeError(error,'WRITE_FAILED')}
 }
 private cleanup(temp:Temporary){try{assertFile(this.bootstrap,temp.name,temp.proof);unlinkSync(join(this.bootstrap.path,temp.name))}catch{/* Never unlink an external or uncertain replacement. */}}
 private async publish(temp:Temporary,name:string,expected:FileProof|null,stage:'receipt'|'pointer',guard:()=>void):Promise<FileProof>{
  let committed=false
  try{
   guard();assertFile(this.bootstrap,name,expected,stage==='pointer'?'POINTER_CHANGED':'RECEIPT_CHANGED');assertFile(this.bootstrap,temp.name,temp.proof)
   renameSync(join(this.bootstrap.path,temp.name),join(this.bootstrap.path,name));committed=true
   const own=observe(this.bootstrap,name,ROOT_RELOCATION_LIMITS.receiptBytes)!
   if(!sameIdentity(own.proof,temp.proof)||own.proof.size!==temp.proof.size||own.proof.mtimeNs!==temp.proof.mtimeNs||own.proof.sha256!==temp.proof.sha256)fail('CONTROL_CHANGED')
   await this.options.beforeDirectorySync?.(stage);this.host();assertFile(this.bootstrap,name,own.proof);await syncBootstrap(this.bootstrap);this.host();assertFile(this.bootstrap,name,own.proof)
   return own.proof
  }catch(error){if(committed)fail('DURABILITY_UNCONFIRMED');safeError(error,'WRITE_FAILED')}
 }
 async commit(ownerNonce:string,attemptId:string):Promise<RootRelocationOutcome>{
  return this.start(async()=>{
   const a=this.own(ownerNonce,attemptId);this.final(a)
   let granted:unknown;try{granted=await this.options.confirm(structuredClone(a.preview))}catch{fail('CONFIRMATION_FAILED')}
   this.own(ownerNonce,attemptId);if(granted!==true)fail('CONFIRMATION_REQUIRED');this.final(a)
   const after={...a.context.pointer,revision:a.context.pointer.revision+1,root:a.preview.target},pointerText=JSON.stringify(after)+'\n',pointerTemp=await this.temporary(pointerText);let receiptTemp:Temporary|undefined
   try{
    this.final(a);const {ctimeNs:_ignored,...pointerFile}=pointerTemp.proof,record:Receipt={schemaVersion:1,receiptId:attemptId,createdAt:new Date().toISOString(),bootstrap:this.bootstrap,before:a.context.pointer,beforePointerFile:a.context.pointerFile,after,pointerFile,controls:a.context.controls,ledgerWitness:a.context.ledgerWitness,layout:a.layout,retainedMigration:a.context.retainedMigration,unreadMigrationResultIds:a.context.resultIds},receiptText=JSON.stringify({record,sha256:sha(JSON.stringify(stable(record)))})+'\n'
    if(Buffer.byteLength(receiptText)>ROOT_RELOCATION_LIMITS.receiptBytes)fail('RECEIPT_LIMIT')
    receiptTemp=await this.temporary(receiptText);await this.options.beforeReceiptRename?.();this.final(a)
    const receiptName=`root-relocation-${attemptId}.json`,receiptProof=await this.publish(receiptTemp,receiptName,null,'receipt',()=>this.final(a));receiptTemp=undefined
    a.ownReceipt={name:receiptName,proof:receiptProof}
    await this.options.beforePointerRename?.();this.final(a)
    const committedPointer=await this.publish(pointerTemp,'data-root.json',a.context.pointerFile,'pointer',()=>{this.final(a);assertFile(this.bootstrap,receiptName,receiptProof,'RECEIPT_CHANGED')})
    this.committedSeal(a,committedPointer);this.attempt=null;return{pointer:structuredClone(after),receiptId:attemptId,requiresColdStart:true}
   }finally{this.cleanup(pointerTemp);if(receiptTemp)this.cleanup(receiptTemp);this.attempt=null}
  })
 }
 async cancel(ownerNonce:string,attemptId:string):Promise<void>{
  const a=this.attempt;if(!a||a.owner!==ownerNonce||a.preview.attemptId!==attemptId)fail('ATTEMPT_EXPIRED');a.cancelled=true
  await this.flush();if(this.attempt===a)this.attempt=null
 }
 async flush():Promise<void>{await this.flight?.catch(()=>{})}
}

/** Read-only recovery disposition, never an authorization to move/clean data.
 * The receipt pins the actual wx-created pointer inode before its rename. */
export async function inspectRootRelocation(bootstrap:RootIdentity,host:Pick<RootRelocationOptions,'assertStableLock'|'assertCold'>):Promise<RootRelocationDisposition|null>{
 bootstrap=Object.freeze({...bootstrap})
 const guard=()=>{synchronousAssertion(()=>host.assertStableLock(),'LOCK_REQUIRED');synchronousAssertion(()=>host.assertCold(),'SOURCE_NOT_CLOSED');assertDirectory(bootstrap,'BOOTSTRAP_CHANGED')}
 try{
  const context=await readContext(bootstrap,guard),links=chain(context.records,context.pointer,context.pointerFile);if(!links.length)return null
  const latest=links.at(-1)!,expected=latest.record.pointerFile,actual=context.pointerFile
  if(!sameIdentity(expected,actual)||expected.size!==actual.size||expected.mtimeNs!==actual.mtimeNs||expected.sha256!==actual.sha256)fail('POINTER_CHANGED')
  assertDirectory(context.pointer.root)
  const currentMarker=observe(context.pointer.root,applicationNames(context.pointer.root).appMarker,ROOT_RELOCATION_LIMITS.markerBytes)!,marker=rootMarkerSchema.parse(json(currentMarker,'TARGET_INVALID'))
  if(marker.id!==context.pointer.rootId||marker.phase!=='ready'||!marker.inboxReady)fail('TARGET_INVALID')
  const assertCurrent=()=>{
   context.authority?.assertCurrent()
   guard();assertFile(bootstrap,'data-root.json',context.pointerFile,'POINTER_CHANGED')
   assertFile(bootstrap,'root-migration.json',context.controls.journal);assertFile(bootstrap,'root-migration-request.json',context.controls.request);for(const r of context.records)assertFile(bootstrap,r.name,r.file,'RECEIPT_CHANGED')
   if(!same(receiptNames(bootstrap),context.records.map(record=>record.name).sort()))fail('RECEIPT_CHANGED')
   assertDirectory(context.pointer.root);assertFile(context.pointer.root,applicationNames(context.pointer.root).appMarker,currentMarker.proof,'TARGET_CHANGED')
  }
  guard();await syncBootstrap(bootstrap);assertCurrent()
  return{pointer:structuredClone(context.pointer),receiptId:latest.record.receiptId,retainedMigration:context.retainedMigration,unreadMigrationResultIds:[...context.resultIds],journalChecksum:context.journalChecksum,completionWitnesses:structuredClone(context.ledgerWitness?.results??[]),assertCurrent}
 }catch(error){safeError(error,'DURABILITY_UNCONFIRMED')}
}
