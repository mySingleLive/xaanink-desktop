import {applicationNames} from "../core/brand-names"
import {randomUUID} from 'node:crypto'
import {constants,mkdirSync,renameSync,unlinkSync,lstatSync,realpathSync,opendirSync,readdirSync} from 'node:fs'
import {open} from 'node:fs/promises'
import {join,dirname,basename,isAbsolute,normalize} from 'node:path'
import {z} from 'zod'
import type {RootIdentity} from '../core/data-root'
import {directoryIdentity,sameIdentity,within,rootIdentitySchema,rootMarkerSchema} from '../core/root-ownership'
import {canonical,digest} from '../core/application-backup-files'
import {observeRootAuthority,assertRootAuthorityDirectory,assertRootAuthorityHost,readRootAuthority,syncRootAuthorityDirectory,type RootAuthorityObservation} from '../core/root-authority'
import {applicationRestoreRequestSnapshotSchema,applicationRestorePhaseRecordSchema,type ApplicationRestoreRequest} from '../shared/application-restore-request'
import {APPLICATION_RESTORE_LAYOUT_LIMITS as limits,applicationRestoreLayoutSchema,type ApplicationRestoreLayout,type AllocatedApplicationRestoreLayout} from '../shared/application-restore-layout'
import {catalogSchema} from '../service/workspaces'
const prefix='desktop-recovery-layout-',sha=z.string().regex(/^[a-f0-9]{64}$/),envelope=z.object({layout:applicationRestoreLayoutSchema,checksum:sha}).strict()
export interface NativeApplicationRestoreLayoutHandle{readonly layout:AllocatedApplicationRestoreLayout;assertCurrent():void}
interface Issued{bootstrap:RootIdentity;layout:AllocatedApplicationRestoreLayout;file:RootAuthorityObservation;guard:()=>void;flight:Promise<unknown>|null}
const issued=new WeakMap<object,Issued>(),flights=new Map<string,Promise<unknown>>()
function fail(code:string):never{throw Object.assign(Error(code),{code})}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b)
function filename(id:string){return `${prefix}${id}.json`}
function names(bootstrap:RootIdentity){assertRootAuthorityDirectory(bootstrap);const directory=opendirSync(bootstrap.path),result:string[]=[];let count=0;try{for(;;){const row=directory.readSync();if(!row)break;if(++count>limits.entries)fail('LAYOUT_LIMIT');if(row.name.startsWith(prefix)||row.name.startsWith('.desktop-recovery-layout-'))result.push(row.name)}}finally{directory.closeSync()}if(result.length>limits.records)fail('LAYOUT_LIMIT');return result.sort()}
function observe(bootstrap:RootIdentity,name:string){const observed=observeRootAuthority(bootstrap,name,limits.bytes)!;const parsed=envelope.parse(JSON.parse(observed.text));if(parsed.checksum!==digest(canonical(parsed.layout))||name!==filename(parsed.layout.id)||!same(parsed.layout.bootstrap,bootstrap))fail('LAYOUT_CHANGED');return{layout:parsed.layout,file:observed}}
function ancestry(layout:ApplicationRestoreLayout){assertRootAuthorityDirectory(layout.bootstrap);assertRootAuthorityDirectory(layout.base);if(!layout.parents)fail('LAYOUT_INCOMPLETE');for(const[key,parent]of Object.entries(layout.parents)){if(dirname(parent.path)!==layout.base.path||basename(parent.path)!==layout.names[key as keyof typeof layout.names])fail('LAYOUT_CHANGED');assertRootAuthorityDirectory(parent)}if(!same(readdirSync(layout.base.path).sort(),Object.values(layout.names).sort()))fail('LAYOUT_CHANGED')}
function createdDirectoryImmediately(path:string):RootIdentity{const info=lstatSync(path,{bigint:true});if(!isAbsolute(path)||!info.isDirectory()||info.isSymbolicLink()||realpathSync(path)!==path)fail('LAYOUT_CHANGED');const pinned=Object.freeze({path,device:String(info.dev),inode:String(info.ino)});assertRootAuthorityDirectory(pinned);return pinned}
function ancestorIdentities(path:string){const result:{device:string;inode:string}[]=[];for(let current=path;;current=dirname(current)){const info=lstatSync(current,{bigint:true});if(!info.isDirectory()||info.isSymbolicLink())fail('LAYOUT_ANCESTRY_UNSAFE');result.push({device:String(info.dev),inode:String(info.ino)});if(dirname(current)===current)break}return result}
function separated(base:RootIdentity,other:RootIdentity,originalSource=false){
 if(within(base.path,other.path)||within(other.path,base.path)||ancestorIdentities(base.path).some(identity=>sameIdentity(identity,other)))fail('LAYOUT_OVERLAP')
 if(originalSource){let info;try{info=lstatSync(other.path,{bigint:true})}catch(cause){if(['ENOENT','ENOTDIR'].includes((cause as NodeJS.ErrnoException).code??''))return;throw cause}if(!info.isDirectory()||info.isSymbolicLink()||!sameIdentity({device:String(info.dev),inode:String(info.ino)},other))return}
 assertRootAuthorityDirectory(other);if(ancestorIdentities(other.path).some(identity=>sameIdentity(identity,base)))fail('LAYOUT_OVERLAP')
}
function available(root:RootIdentity){try{const row=lstatSync(root.path,{bigint:true});return row.isDirectory()&&!row.isSymbolicLink()&&sameIdentity({device:String(row.dev),inode:String(row.ino)},root)}catch(cause){if(['ENOENT','ENOTDIR'].includes((cause as NodeJS.ErrnoException).code??''))return false;throw cause}}
/** Metadata only: capture registered physical work identities without opening
 * an inbox or work engine. Original identities still protect renamed roots. */
export function captureApplicationRestoreProtectedDirectories(bootstrap:RootIdentity,guard:()=>void):{directories:readonly RootIdentity[];assertCurrent():void}{
 const authority=readRootAuthority(bootstrap,guard),source=authority.pointer.root,present=available(source)
 if(!present)return Object.freeze({directories:Object.freeze([]),assertCurrent(){assertRootAuthorityHost(guard,'OWNER_EXPIRED');authority.assertCurrent();if(available(source))fail('LAYOUT_CATALOG_CHANGED')}})
 const marker=observeRootAuthority(source,applicationNames(source).appMarker,16*1024)!,owner=rootMarkerSchema.parse(JSON.parse(marker.text));if(owner.id!==authority.pointer.rootId||owner.phase!=='ready'||!owner.inboxReady)fail('LAYOUT_SOURCE_UNCONFIRMED')
 const observed=observeRootAuthority(source,'catalog.json',4*1024*1024)!,body=z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),value:catalogSchema.max(4096)}).strict().parse(JSON.parse(observed.text)),directories=body.value.map(row=>{
  if(!isAbsolute(row.path)||normalize(row.path)!==row.path)fail('LAYOUT_CATALOG_INVALID');return Object.freeze(rootIdentitySchema.parse({path:row.path,...row.identity}))
 })
 if(new Set(body.value.map(row=>row.id)).size!==body.value.length||new Set(body.value.map(row=>row.path)).size!==body.value.length)fail('LAYOUT_CATALOG_INVALID')
 const availability=directories.map(root=>available(root))
 const assertCurrent=()=>{assertRootAuthorityHost(guard,'OWNER_EXPIRED');authority.assertCurrent();assertRootAuthorityDirectory(source);if(!same(observeRootAuthority(source,applicationNames(source).appMarker,16*1024),marker)||!same(observeRootAuthority(source,'catalog.json',4*1024*1024),observed)||directories.some((root,index)=>available(root)!==availability[index]))fail('LAYOUT_CATALOG_CHANGED')}
 assertCurrent();return Object.freeze({directories:Object.freeze(directories),assertCurrent})
}
function grant(handle:NativeApplicationRestoreLayoutHandle){const state=issued.get(handle);if(!state)fail('LAYOUT_GRANT_INVALID');return state}
function assertGrant(state:Issued){assertRootAuthorityHost(state.guard,'OWNER_EXPIRED');ancestry(state.layout);const current=observe(state.bootstrap,filename(state.layout.id));if(!same(current.file,state.file)||!same(current.layout,state.layout))fail('LAYOUT_CHANGED')}
async function atomic(bootstrap:RootIdentity,layout:ApplicationRestoreLayout,expected:RootAuthorityObservation|null,guard:()=>void){
 const name=filename(layout.id),temporary=`.desktop-recovery-layout-${randomUUID()}.tmp`,text=JSON.stringify({layout,checksum:digest(canonical(layout))})+'\n';if(Buffer.byteLength(text)>limits.bytes)fail('LAYOUT_LIMIT')
 let handle:Awaited<ReturnType<typeof open>>|undefined,owned:RootAuthorityObservation|undefined,renamed=false
 const seal=()=>{assertRootAuthorityHost(guard,'OWNER_EXPIRED');assertRootAuthorityDirectory(bootstrap)}
 try{
  seal();handle=await open(join(bootstrap.path,temporary),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);seal();await handle.writeFile(text);seal();await handle.sync();seal();await handle.close();handle=undefined;seal()
  owned=observeRootAuthority(bootstrap,temporary,limits.bytes)!;if(owned.text!==text)fail('LAYOUT_CHANGED')
  const actual=observeRootAuthority(bootstrap,name,limits.bytes,true);if(!same(actual,expected))fail('LAYOUT_CHANGED');seal()
  if(!same(observeRootAuthority(bootstrap,temporary,limits.bytes),owned)||!same(observeRootAuthority(bootstrap,name,limits.bytes,true),expected))fail('LAYOUT_CHANGED')
  renameSync(join(bootstrap.path,temporary),join(bootstrap.path,name));renamed=true
  const published=observeRootAuthority(bootstrap,name,limits.bytes)!;if(!sameIdentity(published.proof,owned.proof)||published.text!==text)fail('LAYOUT_CHANGED');seal();await syncRootAuthorityDirectory(bootstrap);seal();if(!same(observeRootAuthority(bootstrap,name,limits.bytes),published))fail('LAYOUT_CHANGED');return published
 }catch(cause){if(renamed)fail('DURABILITY_UNCONFIRMED');throw cause}
 finally{await handle?.close().catch(()=>{});if(owned&&!renamed)try{if(same(observeRootAuthority(bootstrap,temporary,limits.bytes),owned))unlinkSync(join(bootstrap.path,temporary))}catch{/* preserve foreign bytes */}}
}
export function createNativeApplicationRestoreLayout(bootstrap:RootIdentity,base:RootIdentity,ownerNonce:string,sourceKind:ApplicationRestoreLayout['sourceKind'],guard:()=>void,blocked:readonly RootIdentity[]=[]):Promise<NativeApplicationRestoreLayoutHandle>{
 bootstrap=Object.freeze(rootIdentitySchema.parse(structuredClone(bootstrap)));base=Object.freeze(rootIdentitySchema.parse(structuredClone(base)));blocked=Object.freeze(blocked.map(root=>Object.freeze(rootIdentitySchema.parse(structuredClone(root)))))
 if(flights.has(bootstrap.path))return Promise.reject(Object.assign(Error('LAYOUT_BUSY'),{code:'LAYOUT_BUSY'}))
 const flight=Promise.resolve().then(async()=>{
  const captured=guard,native=()=>{assertRootAuthorityHost(captured,'OWNER_EXPIRED');assertRootAuthorityDirectory(bootstrap);assertRootAuthorityDirectory(base)};native();z.uuid().parse(ownerNonce)
  const created:RootIdentity[]=[],authority=readRootAuthority(bootstrap,native),protectedRoots=captureApplicationRestoreProtectedDirectories(bootstrap,native),seal=()=>{native();protectedRoots.assertCurrent();separated(base,bootstrap);separated(base,authority.pointer.root,true);for(const root of protectedRoots.directories)separated(base,root,true);for(const root of blocked)separated(base,root);for(const root of created)assertRootAuthorityDirectory(root)};seal()
  if(names(bootstrap).length>=limits.records||inspectApplicationRestoreLayouts(bootstrap).unknown||inspectApplicationRestoreLayouts(bootstrap).operationIds.length)fail('LAYOUT_PENDING')
  if(readdirSync(base.path).length)fail('LAYOUT_NOT_EMPTY')
  const initial:ApplicationRestoreLayout=applicationRestoreLayoutSchema.parse({version:1,id:randomUUID(),revision:1,bootstrap:structuredClone(bootstrap),base:structuredClone(base),ownerNonce,sourceKind,createdAt:new Date().toISOString(),phase:'allocating',names:{candidate:randomUUID(),raw:randomUUID(),before:randomUUID(),verify:randomUUID()},parents:null,binding:null})
  let file=await atomic(bootstrap,initial,null,()=>{seal();authority.assertCurrent();if(readdirSync(base.path).length)fail('LAYOUT_CHANGED')})
  const parents:Record<string,RootIdentity>={};for(const[key,id]of Object.entries(initial.names)){seal();authority.assertCurrent();if(!same(readdirSync(base.path).sort(),Object.values(parents).map(parent=>basename(parent.path)).sort()))fail('LAYOUT_CHANGED');const path=join(base.path,id);mkdirSync(path,{mode:0o700});const pinned=createdDirectoryImmediately(path);created.push(pinned);parents[key]=pinned;const observed=await directoryIdentity(path);seal();if(!same(observed,pinned))fail('LAYOUT_CHANGED')}
  await syncRootAuthorityDirectory(base);seal()
  const layout=applicationRestoreLayoutSchema.parse({...initial,revision:2,phase:'allocated',parents}) as AllocatedApplicationRestoreLayout
  file=await atomic(bootstrap,layout,file,()=>{seal();authority.assertCurrent();ancestry(layout)})
  const state:Issued={bootstrap:structuredClone(bootstrap),layout,file,guard:()=>{seal();authority.assertCurrent()},flight:null},handle:NativeApplicationRestoreLayoutHandle=Object.freeze({get layout(){return structuredClone(state.layout)},assertCurrent(){assertGrant(state)}});issued.set(handle,state);return handle
 });flights.set(bootstrap.path,flight);void flight.finally(()=>{if(flights.get(bootstrap.path)===flight)flights.delete(bootstrap.path)}).catch(()=>{});return flight
}
export function bindApplicationRestoreLayout(handle:NativeApplicationRestoreLayoutHandle,request:ApplicationRestoreRequest):Promise<AllocatedApplicationRestoreLayout>{
 let state:Issued;try{state=grant(handle)}catch(cause){return Promise.reject(cause)}if(state.flight)return Promise.reject(Error('LAYOUT_BUSY'))
 const flight=Promise.resolve().then(async()=>{assertGrant(state);if(state.layout.phase!=='allocated'||request.phase!=='prepared'||request.ownerNonce!==state.layout.ownerNonce||!same(request.parent,state.layout.parents.candidate)||request.history.length!==1)fail('LAYOUT_REQUEST_MISMATCH')
  const prepared=request.history[0],phase=observeRootAuthority(state.bootstrap,prepared.name,256*1024)!;if(!same(phase.proof,prepared.file))fail('LAYOUT_REQUEST_MISMATCH');const entry=applicationRestorePhaseRecordSchema.parse(JSON.parse(phase.text).record);if(entry.request.operationId!==request.operationId||entry.request.phase!=='prepared'||!same(entry.request.parent,request.parent))fail('LAYOUT_REQUEST_MISMATCH')
  const header=observeRootAuthority(state.bootstrap,'application-recovery-request.json',512*1024)!,head=JSON.parse(header.text),requests=applicationRestoreRequestSnapshotSchema.parse(head.state);if(digest(canonical(requests))!==head.checksum||!same(requests.operations.find(row=>row.operationId===request.operationId),request))fail('LAYOUT_REQUEST_MISMATCH')
  const layout=applicationRestoreLayoutSchema.parse({...state.layout,revision:3,phase:'bound',binding:{operationId:request.operationId,prepared}}) as AllocatedApplicationRestoreLayout
  const file=await atomic(state.bootstrap,layout,state.file,()=>{assertRootAuthorityHost(state.guard,'OWNER_EXPIRED');ancestry(state.layout);if(!same(observeRootAuthority(state.bootstrap,prepared.name,256*1024),phase)||!same(observeRootAuthority(state.bootstrap,'application-recovery-request.json',512*1024),header))fail('LAYOUT_REQUEST_MISMATCH')});state.layout=layout;state.file=file;assertGrant(state);return structuredClone(layout)
 });state.flight=flight;void flight.finally(()=>{if(state.flight===flight)state.flight=null}).catch(()=>{});return flight
}
function boundRequest(bootstrap:RootIdentity,layout:ApplicationRestoreLayout){
 if(layout.phase!=='bound'||!layout.binding||!layout.parents)fail('LAYOUT_INCOMPLETE')
 const header=observeRootAuthority(bootstrap,'application-recovery-request.json',512*1024)!,head=JSON.parse(header.text),state=applicationRestoreRequestSnapshotSchema.parse(head.state);if(digest(canonical(state))!==head.checksum)fail('LAYOUT_REQUEST_MISMATCH')
 const request=state.operations.find(row=>row.operationId===layout.binding!.operationId);if(!request||!same(request.parent,layout.parents.candidate)||request.ownerNonce!==layout.ownerNonce||!same(request.history[0],layout.binding.prepared))fail('LAYOUT_REQUEST_MISMATCH')
 const phase=observeRootAuthority(bootstrap,layout.binding.prepared.name,256*1024)!;if(!same(phase.proof,layout.binding.prepared.file))fail('LAYOUT_REQUEST_MISMATCH');const envelope=JSON.parse(phase.text),record=applicationRestorePhaseRecordSchema.parse(envelope.record);if(digest(canonical(record))!==envelope.checksum||record.request.phase!=='prepared'||record.request.operationId!==request.operationId||!same(record.request.parent,request.parent))fail('LAYOUT_REQUEST_MISMATCH');return request
}
export function inspectApplicationRestoreLayouts(bootstrap:RootIdentity,options:{allowed?:NativeApplicationRestoreLayoutHandle}={}):{operationIds:string[];unknown:boolean}{
 try{const operationIds:string[]=[],bound=new Set<string>();let unknown=false;const allowed=options.allowed&&issued.get(options.allowed)
  for(const name of names(bootstrap)){const current=observe(bootstrap,name);ancestry(current.layout);if(current.layout.phase!=='bound'){if(!allowed||!same(allowed.layout,current.layout)||!same(allowed.file,current.file)){unknown=true;continue}assertGrant(allowed);continue}const request=boundRequest(bootstrap,current.layout);if(bound.has(request.operationId))fail('LAYOUT_REQUEST_MISMATCH');bound.add(request.operationId);if(!['consumed','cancelled'].includes(request.phase))operationIds.push(request.operationId)}
  const header=observeRootAuthority(bootstrap,'application-recovery-request.json',512*1024,true)
  if(header){const envelope=JSON.parse(header.text),requests=applicationRestoreRequestSnapshotSchema.parse(envelope.state);if(digest(canonical(requests))!==envelope.checksum)fail('LAYOUT_REQUEST_MISMATCH');for(const request of requests.operations)if(!bound.has(request.operationId)){if(!allowed||request.phase!=='prepared'||request.ownerNonce!==allowed.layout.ownerNonce||!same(request.parent,allowed.layout.parents.candidate))unknown=true;else assertGrant(allowed)}}
  return{operationIds,unknown}
 }catch{return{operationIds:[],unknown:true}}
}
export function loadApplicationRestoreLayout(bootstrap:RootIdentity,request:ApplicationRestoreRequest):AllocatedApplicationRestoreLayout{
 const matches=names(bootstrap).map(name=>observe(bootstrap,name).layout).filter(row=>row.binding?.operationId===request.operationId);if(matches.length!==1)fail('LAYOUT_REQUEST_MISMATCH');const layout=matches[0];ancestry(layout);if(!same(boundRequest(bootstrap,layout),request))fail('LAYOUT_REQUEST_MISMATCH');return structuredClone(layout) as AllocatedApplicationRestoreLayout
}
export async function flushApplicationRestoreLayouts(bootstrap:RootIdentity,handle?:NativeApplicationRestoreLayoutHandle){await flights.get(bootstrap.path)?.catch(()=>{});if(handle)await issued.get(handle)?.flight?.catch(()=>{})}
