import {applicationNames} from "./brand-names"
import {lstat} from 'node:fs/promises'
import {lstatSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {z} from 'zod'
import type {RootIdentity} from './data-root'
import {rootIdentitySchema,rootMarkerSchema,hashRegular} from './root-ownership'
import {assertDirectoryImmediately,assertFileImmediately,readBoundedBytes,canonical,digest,writeApplicationMetadata,type StoredFile} from './application-backup-files'
import {DraftJournal,validateDraftSnapshot} from '../main/draft-journal'
import {applicationDraftRetentionSchema,applicationDraftRecoveryItems,APPLICATION_DRAFT_RETENTION_LIMITS as limits,type ApplicationDraftRetention} from '../shared/application-restore'
export interface ApplicationDraftRetentionInput{appId:string;operationId:string;candidateId:string;current:RootIdentity|null;backup:RootIdentity}
/** Read-only draft evidence. This is never an engine/candidate/activation grant. */
export interface ApplicationDraftRetentionProof{retention:ApplicationDraftRetention;assertCurrent():void}
export interface PersistedApplicationDraftRetentionProof{retention:ApplicationDraftRetention;file:StoredFile;assertCurrent():void}
export class ApplicationRestoreDraftError extends Error{constructor(readonly code:string){super(code);this.name='ApplicationRestoreDraftError'}}
function fail(code:string):never{throw new ApplicationRestoreDraftError(code)}
const isMissing=(cause:unknown)=>(cause as NodeJS.ErrnoException)?.code==='ENOENT'
const retentionName='application-restore-drafts.json'
interface Observation{root:RootIdentity;name:string;file:StoredFile|null;bytes:Buffer|null}
interface DraftAuthority{expected:Pick<ApplicationDraftRetentionInput,'appId'|'operationId'|'candidateId'|'backup'>;current:RootIdentity|null;fingerprint:string;assertCurrent:()=>void;observations:Observation[];roots:RootIdentity[];guard:()=>void}
const issued=new WeakMap<ApplicationDraftRetentionProof,DraftAuthority>()
const persisted=new WeakMap<PersistedApplicationDraftRetentionProof,{fingerprint:string;assertCurrent:()=>void;authority:DraftAuthority}>()
function assertOwner(guard:()=>void){try{const returned:unknown=guard();if(returned!==undefined){void Promise.resolve(returned).catch(()=>{});fail('APPLICATION_DRAFT_OWNER_EXPIRED')}}catch{fail('APPLICATION_DRAFT_OWNER_EXPIRED')}}
function finalFile(value:Observation){
 if(value.file)assertFileImmediately(value.root,value.name,{...value.file.identity,...value.file.revision})
 else{let present=false;try{lstatSync(join(value.root.path,value.name));present=true}catch(cause){if(!isMissing(cause))throw cause}if(present)fail('APPLICATION_DRAFT_CHANGED')}
}
async function observe(root:RootIdentity,name:string,max:number,guard:()=>void,optional=false):Promise<Observation>{
 assertOwner(guard);assertDirectoryImmediately(root)
 try{
  const info=await lstat(join(root.path,name),{bigint:true})
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size>BigInt(max))fail('APPLICATION_DRAFT_INVALID')
 }catch(cause){if(optional&&isMissing(cause)){assertOwner(guard);assertDirectoryImmediately(root);const observation={root,name,file:null,bytes:null};finalFile(observation);return observation}throw cause}
 const checked=()=>{assertOwner(guard);assertDirectoryImmediately(root)}
 const hashed=await hashRegular(join(root.path,name),checked),bytes=await readBoundedBytes(root,name,max,checked)
 if(hashed.size>max)fail('APPLICATION_DRAFT_CHANGED')
 // hashRegular hashes the actual byte stream; readBoundedBytes protects a
 // separate nofollow reader. Their hashes and captured revisions must agree.
 if(createHash('sha256').update(bytes).digest('hex')!==hashed.sha256)fail('APPLICATION_DRAFT_CHANGED')
 const observation={root,name,file:{path:name,...hashed},bytes};assertOwner(guard);assertDirectoryImmediately(root);finalFile(observation);return observation
}
function json(observation:Observation):unknown{if(!observation.bytes)return null;try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(observation.bytes))}catch{fail('APPLICATION_DRAFT_INVALID')}}
function parsePrior(observation:Observation,appId:string):ApplicationDraftRetention|null{
 if(!observation.bytes)return null
 try{const parsed=applicationDraftRetentionSchema.parse(json(observation)),{checksum,...body}=parsed;if(parsed.appId!==appId||digest(canonical(body))!==checksum)fail('APPLICATION_DRAFT_INVALID');for(const row of parsed.snapshots)validateDraftSnapshot(row.snapshot);if(new Set(parsed.snapshots.map(row=>row.id)).size!==parsed.snapshots.length)fail('APPLICATION_DRAFT_INVALID');return parsed}catch{fail('APPLICATION_DRAFT_INVALID')}
}
export async function prepareApplicationDraftRetention(input:ApplicationDraftRetentionInput,guard:()=>void):Promise<ApplicationDraftRetentionProof>{
 const observations:Observation[]=[],roots:RootIdentity[]=[],rows:ApplicationDraftRetention['snapshots']=[]
 try{
  const selected=z.object({appId:z.uuid(),operationId:z.uuid(),candidateId:z.uuid(),current:rootIdentitySchema.nullable(),backup:rootIdentitySchema}).strict().parse(input)
  assertOwner(guard)
  for(const [origin,root]of [['current',selected.current],['backup',selected.backup]] as const){
   if(!root)continue
   roots.push(root);const marker=await observe(root,applicationNames(root).appMarker,16384,guard);observations.push(marker)
   const app=rootMarkerSchema.parse(json(marker));if(app.id!==selected.appId||app.phase!=='ready'||!app.inboxReady)fail('APPLICATION_DRAFT_APP_MISMATCH')
   const previous=await observe(root,retentionName,limits.bytes,guard,true);observations.push(previous);const prior=parsePrior(previous,selected.appId)
   for(const row of prior?.snapshots??[]){const duplicate=rows.find(item=>item.id===row.id);if(duplicate&&canonical(duplicate)!==canonical(row))fail('APPLICATION_DRAFT_HISTORY_CONFLICT');if(!duplicate)rows.push(structuredClone(row))}
   const draft=await observe(root,'drafts.json',limits.bytes+65536,guard,true);observations.push(draft)
   // The original journal validates digest, snapshot, complexity and data-only
   // values; do not create/activate a writer, execute requests or grant saves.
   if(draft.bytes){json(draft);const snapshot=await new DraftJournal(root.path).read();if(!snapshot)fail('APPLICATION_DRAFT_CHANGED');finalFile(draft);rows.push({id:randomUUID(),operationId:selected.operationId,candidateId:selected.candidateId,origin,createdAt:snapshot.createdAt,snapshot})}
  }
  if(rows.length>limits.snapshots)fail('APPLICATION_DRAFT_CAPACITY')
  const body={format:'xuanxiang-application-draft-retention' as const,schemaVersion:1 as const,type:'application' as const,appId:selected.appId,operationId:selected.operationId,candidateId:selected.candidateId,reason:'APPLICATION_RESTORED' as const,currentRootAvailable:selected.current!==null,createdAt:new Date().toISOString(),barrier:{type:'application' as const,reason:'APPLICATION_RESTORED' as const,token:randomUUID(),phase:'protected' as const},snapshots:rows},retention=applicationDraftRetentionSchema.parse({...body,checksum:digest(canonical(body))})
  if(Buffer.byteLength(JSON.stringify(retention))>limits.bytes)fail('APPLICATION_DRAFT_CAPACITY')
  try{validateDraftSnapshot({version:1,revision:0,createdAt:retention.createdAt,autosaves:[],sources:{recovery:{version:1,items:applicationDraftRecoveryItems(retention)}},issues:[]})}catch{fail('APPLICATION_DRAFT_CAPACITY')}
  const assertCurrent=()=>{assertOwner(guard);try{for(const root of roots)assertDirectoryImmediately(root);for(const value of observations)finalFile(value)}catch(cause){if(cause instanceof ApplicationRestoreDraftError)throw cause;fail('APPLICATION_DRAFT_CHANGED')}assertOwner(guard)}
  assertCurrent();const proof={retention:structuredClone(retention),assertCurrent}
  issued.set(proof,{expected:{appId:selected.appId,operationId:selected.operationId,candidateId:selected.candidateId,backup:structuredClone(selected.backup)},current:structuredClone(selected.current),fingerprint:digest(canonical(retention)),assertCurrent,observations,roots,guard});return proof
 }catch(cause){if(cause instanceof ApplicationRestoreDraftError)throw cause;fail('APPLICATION_DRAFT_INVALID')}
}
export function validateApplicationDraftRetentionProof(proof:ApplicationDraftRetentionProof,expected:Pick<ApplicationDraftRetentionInput,'appId'|'operationId'|'candidateId'|'backup'>):ApplicationDraftRetention{
 let verified:ApplicationDraftRetention,authority:NonNullable<ReturnType<typeof issued.get>>
 try{
  const captured=issued.get(proof);if(!captured)return fail('APPLICATION_DRAFT_PROOF_INVALID');authority=captured
  const selected=z.object({appId:z.uuid(),operationId:z.uuid(),candidateId:z.uuid(),backup:rootIdentitySchema}).strict().parse(expected)
  if(canonical(selected)!==canonical(authority.expected))fail('APPLICATION_DRAFT_PROOF_INVALID')
  verified=applicationDraftRetentionSchema.parse(proof.retention);for(const row of verified.snapshots)validateDraftSnapshot(row.snapshot)
  if(digest(canonical(verified))!==authority.fingerprint)fail('APPLICATION_DRAFT_PROOF_INVALID')
 }catch{return fail('APPLICATION_DRAFT_PROOF_INVALID')}
 // A DTO method can be replaced; only the original issuing closure grants the
 // read evidence. It checks actual source files and the exact cold owner.
 authority.assertCurrent();return structuredClone(verified)
}
/** Source identity is private issuance data, never inferred from snapshot rows
 * or caller DTOs. The producer retains it for exact authoritative-root binding. */
export function validateApplicationDraftRetentionSource(proof:ApplicationDraftRetentionProof,expected:Pick<ApplicationDraftRetentionInput,'appId'|'operationId'|'candidateId'|'backup'>):RootIdentity|null{validateApplicationDraftRetentionProof(proof,expected);return structuredClone(issued.get(proof)!.current)}
export async function persistApplicationDraftRetention(proof:ApplicationDraftRetentionProof,expected:Pick<ApplicationDraftRetentionInput,'appId'|'operationId'|'candidateId'|'backup'>,additionalOwner?:()=>void):Promise<PersistedApplicationDraftRetentionProof>{
 const retention=validateApplicationDraftRetentionProof(proof,expected),originalAuthority=issued.get(proof)!,authority=additionalOwner?{...originalAuthority,guard:()=>{assertOwner(originalAuthority.guard);assertOwner(additionalOwner)}}:originalAuthority,destination=authority.expected.backup
 const prior=authority.observations.find(value=>value.root.path===destination.path&&value.name===retentionName)
 if(!prior)fail('APPLICATION_DRAFT_PROOF_INVALID')
 const checked=()=>{assertOwner(authority.guard);for(const root of authority.roots)assertDirectoryImmediately(root);for(const value of authority.observations)finalFile(value);assertOwner(authority.guard)}
 try{
  await writeApplicationMetadata(destination,retentionName,JSON.stringify(retention),{expectedTarget:prior.file?{...prior.file.identity,...prior.file.revision}:undefined,beforeRename:checked,immediately:checked})
  const next=await observe(destination,retentionName,limits.bytes,authority.guard)
  if(!next.file||!next.bytes||canonical(parsePrior(next,expected.appId))!==canonical(retention))fail('APPLICATION_DRAFT_CHANGED')
  const observations=authority.observations.map(value=>value===prior?next:value)
  const assertCurrent=()=>{assertOwner(authority.guard);try{for(const root of authority.roots)assertDirectoryImmediately(root);for(const value of observations)finalFile(value)}catch{fail('APPLICATION_DRAFT_CHANGED')}assertOwner(authority.guard)}
  assertCurrent();const saved={retention:structuredClone(retention),file:structuredClone(next.file),assertCurrent}
  persisted.set(saved,{fingerprint:digest(canonical({retention:saved.retention,file:saved.file})),assertCurrent,authority:{...authority,observations}});return saved
 }catch(cause){if(cause instanceof ApplicationRestoreDraftError)throw cause;fail('APPLICATION_DRAFT_CHANGED')}
}
/** Original journals now live in the retention file. Install an empty data-only
 * journal before enabling the candidate; no queued request/save/approval crosses
 * this boundary. The private persisted grant alone may rebase this one file. */
export async function installInertApplicationDraftJournal(proof:PersistedApplicationDraftRetentionProof):Promise<PersistedApplicationDraftRetentionProof>{
 const retention=validatePersistedApplicationDraftRetention(proof),authority=persisted.get(proof)!.authority,destination=authority.expected.backup
 const prior=authority.observations.find(value=>value.root.path===destination.path&&value.name==='drafts.json')
 if(!prior)fail('APPLICATION_DRAFT_PROOF_INVALID')
 try{
  const snapshot=validateDraftSnapshot({version:1,revision:0,createdAt:retention.createdAt,autosaves:[],sources:{},issues:[]}),body={version:1,revision:1,sessionId:randomUUID(),digest:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),snapshot}
  const checked=()=>{validatePersistedApplicationDraftRetention(proof)}
  await writeApplicationMetadata(destination,'drafts.json',JSON.stringify(body),{expectedTarget:prior.file?{...prior.file.identity,...prior.file.revision}:undefined,beforeRename:checked,immediately:checked})
  const next=await observe(destination,'drafts.json',limits.bytes+65536,authority.guard)
  if(!next.file||canonical(await new DraftJournal(destination.path).read())!==canonical(snapshot))fail('APPLICATION_DRAFT_CHANGED')
  const observations=authority.observations.map(value=>value===prior?next:value)
  const assertCurrent=()=>{assertOwner(authority.guard);try{for(const root of authority.roots)assertDirectoryImmediately(root);for(const value of observations)finalFile(value)}catch{fail('APPLICATION_DRAFT_CHANGED')}assertOwner(authority.guard)}
  assertCurrent();const saved={retention:structuredClone(retention),file:structuredClone(proof.file),assertCurrent}
  persisted.set(saved,{fingerprint:digest(canonical({retention:saved.retention,file:saved.file})),assertCurrent,authority:{...authority,observations}});return saved
 }catch(cause){if(cause instanceof ApplicationRestoreDraftError)throw cause;fail('APPLICATION_DRAFT_CHANGED')}
}
export function validatePersistedApplicationDraftRetention(proof:PersistedApplicationDraftRetentionProof):ApplicationDraftRetention{
 const authority=persisted.get(proof)
 if(!authority||digest(canonical({retention:proof.retention,file:proof.file}))!==authority.fingerprint)fail('APPLICATION_DRAFT_PROOF_INVALID')
 authority.assertCurrent();return structuredClone(proof.retention)
}
