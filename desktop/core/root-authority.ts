import {readApplicationBrandImmediately} from './brand-names'
import {constants,lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,opendirSync,type BigIntStats} from 'node:fs'
import {syncOwnedDirectory} from './directory-sync'
import {join,isAbsolute,basename} from 'node:path'
import {z} from 'zod'
import {DataRootManager,rootAuthorityFileSchema,type RootIdentity,type RootPointer} from './data-root'
import {rootIdentitySchema,rootMarkerSchema,sameIdentity,within} from './root-ownership'
import {applicationClosedSourceSummarySchema} from '../shared/application-restore'
import {canonical,digest} from './application-backup-files'
import {ROOT_MIGRATION_LIMITS} from './root-inventory-limits'
import {readRootRelocationAuthorityRecords,ROOT_RELOCATION_LIMITS} from './root-relocation'
import {MAX_ROOT_MIGRATION_REQUEST_BYTES,validateRootMigrationRequestSnapshot} from '../main/root-migration-request'
export const ROOT_AUTHORITY_LIMITS={receipts:16,entries:512,recordBytes:ROOT_MIGRATION_LIMITS.journalBytes*2+MAX_ROOT_MIGRATION_REQUEST_BYTES*2+1024*1024} as const
export type RootAuthorityFile=z.infer<typeof rootAuthorityFileSchema>
export interface RootAuthorityObservation{proof:RootAuthorityFile;text:string}
export class RootAuthorityError extends Error{constructor(readonly code:string){super(code);this.name='RootAuthorityError'}}
function fail(code:string):never{throw new RootAuthorityError(code)}
const missing=(cause:unknown)=>(cause as NodeJS.ErrnoException)?.code==='ENOENT'
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b)
export function assertRootAuthorityHost(action:()=>void,code:string){try{const returned:unknown=action();if(returned!==undefined){void Promise.resolve(returned).catch(()=>{});fail(code)}}catch{fail(code)}}
export function assertRootAuthorityDirectory(root:RootIdentity){try{const info=lstatSync(root.path,{bigint:true});if(!isAbsolute(root.path)||!info.isDirectory()||info.isSymbolicLink()||String(info.dev)!==root.device||String(info.ino)!==root.inode||realpathSync(root.path)!==root.path)fail('DIRECTORY_CHANGED')}catch{fail('DIRECTORY_CHANGED')}}
function proof(info:BigIntStats,bytes:Buffer):RootAuthorityFile{return{device:String(info.dev),inode:String(info.ino),size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs),sha256:digest(bytes.toString('utf8'))}}
export function observeRootAuthority(root:RootIdentity,name:string,max:number,optional=false):RootAuthorityObservation|null{
 assertRootAuthorityDirectory(root);let info:BigIntStats
 try{info=lstatSync(join(root.path,name),{bigint:true})}catch(cause){if(optional&&missing(cause))return null;fail('CONTROL_UNSAFE')}
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size>BigInt(max))fail('CONTROL_UNSAFE')
 let fd:number|undefined
 try{
  fd=openSync(join(root.path,name),constants.O_RDONLY|constants.O_NOFOLLOW);const opened=fstatSync(fd,{bigint:true})
  if(opened.dev!==info.dev||opened.ino!==info.ino||opened.size!==info.size||opened.mtimeNs!==info.mtimeNs||opened.ctimeNs!==info.ctimeNs||opened.nlink!==1n)fail('CONTROL_CHANGED')
  const buffer=Buffer.alloc(Math.min(64*1024,max+1)),chunks:Buffer[]=[];let size=0
  for(;;){const count=readSync(fd,buffer,0,Math.min(buffer.length,max+1-size),null);if(!count)break;size+=count;if(size>max)fail('CONTROL_UNSAFE');chunks.push(Buffer.from(buffer.subarray(0,count)))}
  const after=fstatSync(fd,{bigint:true}),current=lstatSync(join(root.path,name),{bigint:true})
  if(size!==Number(opened.size)||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||!current.isFile()||current.isSymbolicLink()||current.nlink!==1n||current.dev!==opened.dev||current.ino!==opened.ino||current.size!==after.size||current.mtimeNs!==after.mtimeNs||current.ctimeNs!==after.ctimeNs)fail('CONTROL_CHANGED')
  const bytes=Buffer.concat(chunks,size),text=new TextDecoder('utf8',{fatal:true}).decode(bytes);assertRootAuthorityDirectory(root);return{proof:proof(current,bytes),text}
 }catch(cause){if(cause instanceof RootAuthorityError)throw cause;return fail('CONTROL_UNSAFE')}finally{if(fd!==undefined)closeSync(fd)}
}
export function assertRootAuthorityFile(root:RootIdentity,name:string,expected:RootAuthorityFile|null,code='CONTROL_CHANGED'){
 assertRootAuthorityDirectory(root);let info:BigIntStats
 try{info=lstatSync(join(root.path,name),{bigint:true})}catch(cause){if(!expected&&missing(cause))return;fail(code)}
 if(!expected||!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||String(info.dev)!==expected.device||String(info.ino)!==expected.inode||String(info.size)!==expected.size||String(info.mtimeNs)!==expected.mtimeNs||String(info.ctimeNs)!==expected.ctimeNs)fail(code)
}
export const syncRootAuthorityDirectory = syncOwnedDirectory
const pointerSchema=z.unknown().transform(value=>DataRootManager.parsePointer(value))
const copiedObservationSchema=z.object({proof:rootAuthorityFileSchema,text:z.string()}).strict()
const controlsSchema=z.object({journal:copiedObservationSchema.nullable(),request:copiedObservationSchema.nullable()}).strict()
export const applicationRestoreActivationRecordV1Schema=z.object({schemaVersion:z.literal(1),type:z.literal('application'),receiptId:z.uuid(),createdAt:z.iso.datetime(),bootstrap:rootIdentitySchema,before:pointerSchema,beforePointerFile:rootAuthorityFileSchema,after:pointerSchema,pointerFile:rootAuthorityFileSchema.omit({ctimeNs:true}),candidate:z.object({id:z.uuid(),backupId:z.uuid(),backupChecksum:z.string().regex(/^[a-f0-9]{64}$/),initialChecksum:z.string().regex(/^[a-f0-9]{64}$/),finalChecksum:z.string().regex(/^[a-f0-9]{64}$/),retentionChecksum:z.string().regex(/^[a-f0-9]{64}$/),barrierToken:z.uuid()}).strict(),currentRootAvailable:z.boolean(),beforeSnapshot:z.object({id:z.uuid(),checksum:z.string().regex(/^[a-f0-9]{64}$/),directory:rootIdentitySchema,data:rootIdentitySchema}).strict().nullable(),marker:rootAuthorityFileSchema,controls:controlsSchema,history:z.array(z.object({name:z.string().max(100),file:rootAuthorityFileSchema}).strict()).max(ROOT_AUTHORITY_LIMITS.receipts+ROOT_RELOCATION_LIMITS.receipts)}).strict()
const activationV2Base=applicationRestoreActivationRecordV1Schema.omit({schemaVersion:true,currentRootAvailable:true,beforeSnapshot:true}).extend({schemaVersion:z.literal(2),beforePointerText:z.string().max(16*1024)})
export const applicationRestoreActivationRecordV2Schema=z.discriminatedUnion("sourceKind",[
 activationV2Base.extend({sourceKind:z.literal("healthy"),currentRootAvailable:z.literal(true),beforeSnapshot:applicationRestoreActivationRecordV1Schema.shape.beforeSnapshot.unwrap(),closedSource:z.null()}).strict(),
 activationV2Base.extend({sourceKind:z.literal("missing"),currentRootAvailable:z.literal(false),beforeSnapshot:z.null(),closedSource:z.null()}).strict(),
 activationV2Base.extend({sourceKind:z.literal("closed-source"),currentRootAvailable:z.literal(true),beforeSnapshot:z.null(),closedSource:applicationClosedSourceSummarySchema}).strict(),
])
export const applicationRestoreActivationRecordSchema=z.union([applicationRestoreActivationRecordV1Schema,applicationRestoreActivationRecordV2Schema])
export type ApplicationRestoreActivationRecord=z.infer<typeof applicationRestoreActivationRecordSchema>
export interface RootAuthorityRecord{name:string;file:RootAuthorityFile;kind:'application'|'relocation';before:RootPointer;beforePointerFile:RootAuthorityFile;after:RootPointer;pointerFile:Omit<RootAuthorityFile,'ctimeNs'>;record:ApplicationRestoreActivationRecord|ReturnType<typeof readRootRelocationAuthorityRecords>[number]['record']}
export interface RootAuthorityContext{pointer:RootPointer;pointerFile:RootAuthorityFile;controls:{journal:RootAuthorityObservation|null;request:RootAuthorityObservation|null};records:RootAuthorityRecord[];links:RootAuthorityRecord[];journalChecksum:string|null;retainedMigration:{migrationId:string;phase:string;pendingCount:number}|null;unreadMigrationResultIds:string[];completionWitnesses:{requestId:string;receiptId:string;sha256:string}[];assertCurrent(own?:{pointerFile?:RootAuthorityFile;receipt?:{name:string;file:RootAuthorityFile};relocationReceipt?:{name:string;file:RootAuthorityFile}}):void}
export function applicationRestoreReceiptNames(boot:RootIdentity){assertRootAuthorityDirectory(boot);const names:string[]=[],directory=opendirSync(boot.path);let count=0;try{for(;;){const entry=directory.readSync();if(!entry)break;if(++count>ROOT_AUTHORITY_LIMITS.entries)fail('RECEIPT_LIMIT');if(entry.name.startsWith('application-restore-'))names.push(entry.name)}}finally{directory.closeSync()}if(names.length>ROOT_AUTHORITY_LIMITS.receipts)fail('RECEIPT_LIMIT');return names.sort()}
function decodedApplicationRecord(boot:RootIdentity,name:string,observed:RootAuthorityObservation):ApplicationRestoreActivationRecord{
 try{const envelope=z.object({record:applicationRestoreActivationRecordSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(JSON.parse(observed.text)),r=envelope.record
  if(digest(canonical(r))!==envelope.sha256||name!==`application-restore-${r.receiptId}.json`||!same(r.bootstrap,boot)||!same(r.after,{...r.before,revision:r.before.revision+1,root:r.after.root})||r.before.rootId!==r.after.rootId||r.after.root.path===r.before.root.path||sameIdentity(r.before.root,r.after.root)||r.pointerFile.sha256!==digest(JSON.stringify(r.after)+'\n')||(r.schemaVersion===1&&r.currentRootAvailable!==!!r.beforeSnapshot)||new Set(r.history.map(row=>row.name)).size!==r.history.length)fail('RECEIPT_INVALID')
  if(r.schemaVersion===2){if(Buffer.byteLength(r.beforePointerText)>16*1024||Buffer.byteLength(r.beforePointerText)!==Number(r.beforePointerFile.size)||digest(r.beforePointerText)!==r.beforePointerFile.sha256||!same(DataRootManager.parsePointer(JSON.parse(r.beforePointerText)),r.before))fail('RECEIPT_INVALID')}
  if(r.schemaVersion===2&&r.sourceKind==="closed-source"){const s=r.closedSource;if(basename(s.directory.path)!==s.id||s.data.path!==join(s.directory.path,"data")||[boot,r.before.root,r.after.root].some(root=>within(s.directory.path,root.path)||within(root.path,s.directory.path))||sameIdentity(s.directory,r.before.root)||sameIdentity(s.directory,r.after.root))fail("RECEIPT_INVALID")}
  for(const value of[r.controls.journal,r.controls.request])if(value&&(Buffer.byteLength(value.text)!==Number(value.proof.size)||digest(value.text)!==value.proof.sha256))fail('RECEIPT_INVALID')
  return r
 }catch{fail('RECEIPT_INVALID')}
}
function pinned(a:Omit<RootAuthorityFile,'ctimeNs'>,b:RootAuthorityFile){return sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.sha256===b.sha256}
function migration(observed:RootAuthorityObservation|null){if(!observed)return null;try{const parsed=DataRootManager.parseMigrationSnapshot(JSON.parse(observed.text)),j=parsed.journal;if(!['complete','cleanup-pending','rolled-back','rollback-pending'].includes(j.phase))fail('MIGRATION_RECOVERY_REQUIRED');const pointer=['complete','cleanup-pending'].includes(j.phase)?{schemaVersion:1 as const,revision:j.source.revision+1,rootId:j.source.rootId,migrationId:j.migrationId,root:j.target}:j.source;return{journal:j,pointer,checksum:parsed.sha256}}catch(cause){if(cause instanceof RootAuthorityError)throw cause;fail('JOURNAL_INVALID')}}
function ledger(observed:RootAuthorityObservation|null){if(!observed)return null;try{const state=validateRootMigrationRequestSnapshot(JSON.parse(observed.text));if(state.active)fail('MIGRATION_REQUEST_ACTIVE');return{revision:state.revision,results:state.results.map(row=>({requestId:row.requestId,receiptId:row.receiptId,sha256:digest(canonical(row))}))}}catch(cause){if(cause instanceof RootAuthorityError)throw cause;fail('REQUEST_INVALID')}}
function ledgerSubset(before:ReturnType<typeof ledger>,after:ReturnType<typeof ledger>){return before?after!==null&&after.revision>=before.revision&&after.results.every(row=>before.results.some(old=>same(old,row))):after===null||after.results.length===0}
type MigrationAuthority=NonNullable<ReturnType<typeof migration>>&{observation:RootAuthorityObservation}
type AuthorityStep={kind:'receipt';receipt:RootAuthorityRecord}|{kind:'migration';authority:MigrationAuthority}
/** Follow exact persisted pointer file witnesses through restore/relocation and
 * the latest migration. This is data inspection, never authority to replay an
 * old cleanup/rollback or open any source/candidate database. */
export function readRootAuthority(boot:RootIdentity,guard:()=>void):RootAuthorityContext{
 guard();const current=observeRootAuthority(boot,'data-root.json',16*1024,true);if(!current)fail('POINTER_INVALID');let pointer:RootPointer
 try{pointer=DataRootManager.parsePointer(JSON.parse(current.text))}catch{fail('POINTER_INVALID')}
 const relocations=readRootRelocationAuthorityRecords(boot),applications=applicationRestoreReceiptNames(boot).map(name=>{if(!/^application-restore-[0-9a-f-]{36}\.json$/i.test(name))fail('RECEIPT_INVALID');const observed=observeRootAuthority(boot,name,ROOT_AUTHORITY_LIMITS.recordBytes)!;return{name,file:observed.proof,record:decodedApplicationRecord(boot,name,observed)}})
 const records:RootAuthorityRecord[]=[...relocations.map(row=>({...row,kind:'relocation' as const,...pickLink(row.record)})),...applications.map(row=>({...row,kind:'application' as const,...pickLink(row.record)}))]
 const controls={journal:observeRootAuthority(boot,'root-migration.json',ROOT_MIGRATION_LIMITS.journalBytes,true),request:observeRootAuthority(boot,'root-migration-request.json',MAX_ROOT_MIGRATION_REQUEST_BYTES,true)},liveMigration=migration(controls.journal),liveLedger=ledger(controls.request)
 if(records.some(row=>row.before.rootId!==pointer.rootId||row.after.rootId!==pointer.rootId))fail('RECEIPT_INVALID')
 // Later application receipts retain the exact old journal bytes. Those
 // archived terminal journals are necessary once a subsequent migration has
 // replaced the one live journal; no cached id or unrelated journal is used.
 const migrations:MigrationAuthority[]=[]
 for(const observation of[controls.journal,...applications.map(row=>row.record.controls.journal)]){if(!observation)continue;const parsed=migration(observation)!
  if(parsed.journal.source.rootId!==pointer.rootId)fail('JOURNAL_UNRELATED')
  if(!migrations.some(old=>same(old.observation.proof,observation.proof)&&old.checksum===parsed.checksum))migrations.push({...parsed,observation})
 }
 const follow=(head:RootPointer,headFile:RootAuthorityFile):AuthorityStep[]=>{const steps:AuthorityStep[]=[];let walk=head,file:RootAuthorityFile|undefined=headFile
  for(;;){const semantic=records.filter(row=>same(row.after,walk)),matches=semantic.filter(row=>!file||pinned(row.pointerFile,file));if(matches.length>1||semantic.length&&!matches.length)fail('POINTER_CHANGED')
   if(matches.length){const row=matches[0];if(steps.some(step=>step.kind==='receipt'&&step.receipt===row))fail('RECEIPT_INVALID');steps.unshift({kind:'receipt',receipt:row});walk=row.before;file=row.beforePointerFile;continue}
   const matching=migrations.filter(row=>same(walk,row.pointer)&&!same(row.pointer,row.journal.source));if(matching.length>1)fail('CONTROL_CHANGED')
   if(matching.length){const authority=matching[0];if(steps.some(step=>step.kind==='migration'&&step.authority===authority))fail('JOURNAL_INVALID');steps.unshift({kind:'migration',authority});walk=authority.journal.source;file=authority.journal.authoritySourcePointerFile;continue}break
  }return steps
 }
 const steps=follow(pointer,current.proof),links=steps.flatMap(step=>step.kind==='receipt'?[step.receipt]:[])
 if(liveMigration&&!same(liveMigration.pointer,pointer)&&!links.some(row=>same(row.before,liveMigration.pointer)||same(row.after,liveMigration.pointer)))fail('JOURNAL_UNRELATED')
 // Every historical application receipt pins the original byte-identical
 // controls and all earlier append-only receipts. Never accept a partial list.
 for(const row of applications){const record=row.record
  for(const witness of record.history){const actual=records.find(value=>value.name===witness.name);if(!actual||!same(actual.file,witness.file))fail('HISTORY_CHANGED')}
  // A checksummed partial list is still incomplete. Pin every actual earlier
  // append-only file plus the complete authority ancestry of this before
  // pointer. Receipt ctime belongs to the same bootstrap filesystem; replacing
  // a receipt never makes it an earlier authorized audit record.
  const ancestors=follow(record.before,record.beforePointerFile).flatMap(step=>step.kind==='receipt'?[step.receipt]:[]),required=records.filter(value=>value.name!==row.name&&BigInt(value.file.ctimeNs)<BigInt(row.file.ctimeNs))
  for(const prior of[...required,...ancestors])if(!record.history.some(witness=>witness.name===prior.name&&same(witness.file,prior.file)))fail('HISTORY_INCOMPLETE')
  const priorMigration=migration(record.controls.journal),priorLedger=ledger(record.controls.request)
  if(priorMigration&&!same(priorMigration.pointer,record.before)&&!record.history.some(witness=>{const prior=records.find(value=>value.name===witness.name)!;return same(prior.before,priorMigration.pointer)||same(prior.after,priorMigration.pointer)}))fail('JOURNAL_UNRELATED')
  for(const witness of record.history){const prior=records.find(value=>value.name===witness.name)!;if(prior.kind==='relocation'&&same(prior.after,record.before)){const old=prior.record as ReturnType<typeof readRootRelocationAuthorityRecords>[number]['record'];if(!same(old.controls.journal,record.controls.journal?.proof??null)||!ledgerSubset(old.ledgerWitness,priorLedger))fail('CONTROL_CHANGED')}}
 }
 // Check controls at their place in the ordered chain. A migration changes
 // the journal only at an exact source pointer witness; later relocation or
 // restore receipts must pin that new journal, not the first restore's journal.
 let expectedJournal:RootAuthorityFile|null|undefined,expectedLedger:ReturnType<typeof ledger>|ReturnType<typeof readRootRelocationAuthorityRecords>[number]['record']['ledgerWitness']|undefined,applicationSeen=false
 for(const step of steps){if(step.kind==='migration'){if(applicationSeen&&!step.authority.journal.authoritySourcePointerFile)fail('HISTORY_INCOMPLETE');expectedJournal=step.authority.observation.proof;expectedLedger=undefined;continue}
  const row=step.receipt,journalFile=row.kind==='application'?(row.record as ApplicationRestoreActivationRecord).controls.journal?.proof??null:row.record.controls.journal as RootAuthorityFile|null,recordLedger=row.kind==='application'?ledger((row.record as ApplicationRestoreActivationRecord).controls.request):(row.record as ReturnType<typeof readRootRelocationAuthorityRecords>[number]['record']).ledgerWitness
  if(expectedJournal!==undefined&&!same(expectedJournal,journalFile)||expectedLedger!==undefined&&!ledgerSubset(expectedLedger,recordLedger))fail('CONTROL_CHANGED')
  expectedJournal=journalFile;expectedLedger=recordLedger;if(row.kind==='application')applicationSeen=true
 }
 if(expectedJournal!==undefined&&!same(expectedJournal,controls.journal?.proof??null)||expectedLedger!==undefined&&!ledgerSubset(expectedLedger,liveLedger))fail('CONTROL_CHANGED')
 // If restore history lies before the walk but no saved migration can bridge
 // it, refuse the missing authority evidence rather than accepting an empty
 // chain and treating the old restore receipts as unrelated audit.
 const uncommittedAudit=(record:ApplicationRestoreActivationRecord)=>same(record.before,pointer)&&same(record.beforePointerFile,current.proof)||steps.some(step=>step.kind==='migration'?same(record.before,step.authority.journal.source)&&same(record.beforePointerFile,step.authority.journal.authoritySourcePointerFile):same(record.before,step.receipt.before)&&same(record.beforePointerFile,step.receipt.beforePointerFile)||same(record.before,step.receipt.after)&&pinned(step.receipt.pointerFile,record.beforePointerFile))
 if(!links.some(row=>row.kind==='application')&&applications.some(row=>row.record.after.revision<=pointer.revision&&!uncommittedAudit(row.record)))fail('HISTORY_INCOMPLETE')
 const assertCurrent=(own?:{pointerFile?:RootAuthorityFile;receipt?:{name:string;file:RootAuthorityFile};relocationReceipt?:{name:string;file:RootAuthorityFile}})=>{guard();assertRootAuthorityFile(boot,'data-root.json',own?.pointerFile??current.proof,'POINTER_CHANGED');assertRootAuthorityFile(boot,'root-migration.json',controls.journal?.proof??null);assertRootAuthorityFile(boot,'root-migration-request.json',controls.request?.proof??null);for(const row of records)assertRootAuthorityFile(boot,row.name,row.file,'RECEIPT_CHANGED');for(const extra of[own?.receipt,own?.relocationReceipt])if(extra)assertRootAuthorityFile(boot,extra.name,extra.file,'RECEIPT_CHANGED');const expectedRelocations=[...relocations.map(row=>({name:row.name,file:row.file})),...(own?.relocationReceipt?[own.relocationReceipt]:[])].sort((a,b)=>a.name.localeCompare(b.name));if(!same(applicationRestoreReceiptNames(boot),[...applications.map(row=>row.name),...(own?.receipt?[own.receipt.name]:[])].sort())||!same(readRootRelocationAuthorityRecords(boot).map(row=>({name:row.name,file:row.file})),expectedRelocations))fail('RECEIPT_CHANGED')}
 assertCurrent();return{pointer,pointerFile:current.proof,controls,records,links,journalChecksum:liveMigration?.checksum??null,retainedMigration:liveMigration?{migrationId:liveMigration.journal.migrationId,phase:liveMigration.journal.phase,pendingCount:liveMigration.journal.pending.length}:null,unreadMigrationResultIds:liveLedger?.results.map(row=>row.receiptId)??[],completionWitnesses:liveLedger?.results??[],assertCurrent}
}
function pickLink(record:{before:RootPointer;beforePointerFile:RootAuthorityFile;after:RootPointer;pointerFile:Omit<RootAuthorityFile,'ctimeNs'>}){return{before:record.before,beforePointerFile:record.beforePointerFile,after:record.after,pointerFile:record.pointerFile}}
export function assertCurrentApplicationMarker(pointer:RootPointer){const brand=readApplicationBrandImmediately(pointer.root),observed=observeRootAuthority(pointer.root,brand.filename,16*1024)!;brand.assertCurrent();try{const marker=rootMarkerSchema.parse(JSON.parse(observed.text));if(marker.id!==pointer.rootId||marker.phase!=='ready'||!marker.inboxReady)fail('TARGET_INVALID')}catch{fail('TARGET_INVALID')}return observed.proof}
