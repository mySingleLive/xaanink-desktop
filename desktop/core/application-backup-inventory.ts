import {BRAND_NAMES} from '../shared/brand-names'
import {applicationNames} from "./brand-names"
import {lstat,readdir,open} from 'node:fs/promises'
import {constants,readdirSync} from 'node:fs'
import {join,relative} from 'node:path'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import type {RootIdentity} from './data-root'
import {applicationBackupSchema,APPLICATION_BACKUP_LIMITS,type ApplicationBackup} from '../shared/application-backup'
import {rootIdentitySchema,assertDirectory,directoryIdentity,readMetadata,rootMarkerSchema,within} from './root-ownership'
import {canonical,digest,inspectTree,publicFiles,readBoundedBytes,assertDirectoryImmediately,assertTreeImmediately,assertFileImmediately,type StoredTree} from './application-backup-files'
import {ownedRootFile,ownedRootDirectory,closedRootCatalogSchema} from './root-inventory-paths'

export const APPLICATION_BACKUP_METADATA='xuanxiang-app-backup.json'
export class ApplicationBackupInventoryError extends Error{constructor(){super('APPLICATION_BACKUP_INVENTORY_INVALID')}}
export class ApplicationBackupInventoryGuardError extends Error{constructor(){super('APPLICATION_BACKUP_INVENTORY_GUARD_REJECTED')}}
export interface ApplicationBackupInventory{
 receipt:ApplicationBackup;directory:RootIdentity;data:RootIdentity;tree:StoredTree
 metadata:{device:string;inode:string;size:string;mtimeNs:string;ctimeNs:string;sha256:string}
 /** Current filesystem seal, not a portable receipt identity. */
 assertUnchanged():void
}
const applicationFile=(path:string)=>ownedRootFile(path)&&!path.startsWith('session/')&&!path.startsWith('inbox/snapshots/')&&!BRAND_NAMES.some(names=>path.startsWith(names.rootRecoveryPrefix))
const applicationDirectory=(path:string)=>ownedRootDirectory(path)&&path!=='session'&&!path.startsWith('session/')&&path!=='inbox/snapshots'&&!path.startsWith('inbox/snapshots/')
/** Read-only portable package recognition. No ApplicationBackups.inspect,
 * root inventory, database engine, promotion, retention or candidate replay. */
export async function inspectApplicationBackupInventory(input:RootIdentity,appId:string,id:string,guard:()=>void|Promise<void>):Promise<ApplicationBackupInventory>{
 const directory=Object.freeze(rootIdentitySchema.parse(structuredClone(input)))
 const check=async()=>{try{await guard()}catch{throw new ApplicationBackupInventoryGuardError()}}
 try{
  z.uuid().parse(id);z.uuid().parse(appId);await check();await assertDirectory(directory)
  const path=join(directory.path,APPLICATION_BACKUP_METADATA),before=await lstat(path,{bigint:true})
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n)throw Error('unsafe package metadata')
  const bytes=await readBoundedBytes(directory,APPLICATION_BACKUP_METADATA,APPLICATION_BACKUP_LIMITS.metadataBytes,check)
  new TextDecoder('utf8',{fatal:true}).decode(bytes)
  const receipt=applicationBackupSchema.parse(JSON.parse(bytes.toString('utf8'))),{checksum,...body}=receipt
  if(receipt.id!==id||receipt.appId!==appId||receipt.phase!=='verified'||checksum!==digest(canonical(body)))throw Error('unverified package')
  const paths=[...receipt.files.map(file=>file.path),...receipt.directories]
  if(new Set(paths.map(path=>path.toLowerCase())).size!==paths.length||receipt.files.some(file=>!applicationFile(file.path))||receipt.directories.some(path=>!applicationDirectory(path))||receipt.bytes!==receipt.files.reduce((sum,file)=>sum+file.size,0))throw Error('invalid package inventory')
  if(!(BRAND_NAMES.filter(names=>receipt.files.some(file=>file.path===names.appMarker)).length===1&&['catalog.json','inbox/database/PG_VERSION'].every(path=>receipt.files.some(file=>file.path===path))))throw Error('incomplete package')
  if(canonical((await readdir(directory.path)).sort())!==canonical(['data',APPLICATION_BACKUP_METADATA].sort()))throw Error('unknown package content')
  const data=await directoryIdentity(join(directory.path,'data')),tree=await inspectTree(data,async()=>{await check();await assertDirectory(directory)})
  if(canonical(publicFiles(tree.files))!==canonical(receipt.files)||canonical(tree.directories.map(d=>relative(data.path,d.path).split('\\').join('/')).sort())!==canonical(receipt.directories))throw Error('mismatched package data')
  const marker=rootMarkerSchema.parse(await readMetadata(join(data.path,applicationNames(data).appMarker)))
  if(marker.id!==appId||marker.phase!=='ready'||!marker.inboxReady)throw Error('foreign package marker')
  const works=closedRootCatalogSchema.parse(await readMetadata(join(data.path,'catalog.json'))).value.map(work=>work.path)
  if(tree.files.some(file=>works.some(work=>within(join(data.path,file.path),work)))||tree.directories.some(directory=>works.some(work=>within(directory.path,work))))throw Error('catalogued work is not application data')
  const pg=await open(join(data.path,'inbox/database/PG_VERSION'),constants.O_RDONLY|constants.O_NOFOLLOW)
  try{const buffer=Buffer.alloc(81),{bytesRead}=await pg.read(buffer,0,81,0);if(bytesRead>80||Number(buffer.subarray(0,bytesRead).toString('utf8').trim())!==receipt.engine.postgresMajor)throw Error('package engine mismatch')}finally{await pg.close()}
  const metadata={device:String(before.dev),inode:String(before.ino),size:String(before.size),mtimeNs:String(before.mtimeNs),ctimeNs:String(before.ctimeNs),sha256:createHash('sha256').update(bytes).digest('hex')}
  const assertUnchanged=()=>{
   assertDirectoryImmediately(directory);assertTreeImmediately(data,tree);assertFileImmediately(directory,APPLICATION_BACKUP_METADATA,metadata)
   if(canonical(readdirSync(directory.path).sort())!==canonical(['data',APPLICATION_BACKUP_METADATA].sort()))throw Error('changed package')
  }
  await check();await assertDirectory(directory);await assertDirectory(data);await check();assertUnchanged()
  return{receipt:structuredClone(receipt),directory,data,tree,metadata,assertUnchanged}
 }catch(error){if(error instanceof ApplicationBackupInventoryGuardError)throw error;throw new ApplicationBackupInventoryError()}
}
