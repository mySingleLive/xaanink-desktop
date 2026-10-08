import {readApplicationBrand} from '../core/brand-names'
import {BRAND_NAMES} from '../shared/brand-names'
import type {RootIdentity} from "../core/data-root"
import {lstat,opendir} from "node:fs/promises"
import {join} from "node:path"
import {z} from "zod"
import {assertDirectory,directoryIdentity,managedPath,readMetadata,rootMarkerSchema,rootIdentitySchema,within} from "../core/root-ownership"

import {ownedRootFile,ownedRootDirectory,closedRootCatalogSchema} from "../core/root-inventory-paths"
import {inspectApplicationBackupInventory,ApplicationBackupInventoryGuardError,type ApplicationBackupInventory} from "../core/application-backup-inventory"
import {ROOT_MIGRATION_LIMITS as limits} from "../core/root-inventory-limits"
import {assertDirectoryImmediately} from "../core/application-backup-files"

export interface RootInventory {files:string[];directories:string[];bytes:number;preserved:string[]}
const containers=new Set(['backups','backups/application','backups/application/packages','backups/application/staging','backups/application/validation'])
/** Caller must hold the stable instance lock after the previous process exited. */
export async function collectClosedRootFiles(root:RootIdentity,assertClosed:()=>void|Promise<void>,options:{includeApplicationBackups?:boolean}={}):Promise<RootInventory>{
 root=Object.freeze(rootIdentitySchema.parse(structuredClone(root)))
 const guard=async()=>{await assertClosed();await assertDirectory(root);await assertClosed()}
 await guard()
 const brand=await readApplicationBrand(root),marker=brand.value
 const catalog=closedRootCatalogSchema.parse(await readMetadata(join(root.path,"catalog.json")))
 const works=catalog.value.map(work=>work.path)
 const files:string[]=[],directories:string[]=[],preserved:string[]=[],packages:ApplicationBackupInventory[]=[];let bytes=0,visited=0
 const bounds=()=>{if(files.length>limits.files||directories.length>limits.directories||visited>limits.entries||preserved.length>limits.entries||!Number.isSafeInteger(bytes))throw Error("OWNERSHIP_INVENTORY_TOO_LARGE")}
 async function scan(relative:string){
  await guard()
  const absolute=join(root.path,relative)
  if(works.some(path=>within(absolute,path))){preserved.push(relative);return}
  const directory=await directoryIdentity(relative?await managedPath(root,relative):root.path)
  const entries=await opendir(absolute)
  try{
  await assertDirectory(directory)
  for await(const entry of entries){
   ++visited;bounds()
   const name=relative?`${relative}/${entry.name}`:entry.name,path=join(root.path,name)
   if(works.some(work=>within(path,work))){preserved.push(name);continue}
   if(name==='backups'&&options.includeApplicationBackups===false){preserved.push(name);continue}
   if(relative==='backups/application/staging'||relative==='backups/application/validation'){preserved.push(name);continue}
   if(relative==='backups/application/packages'){
    if(!z.uuid().safeParse(entry.name).success){preserved.push(name);continue}
    await guard();await assertDirectory(directory)
    let packageInventory:ApplicationBackupInventory
    try{packageInventory=await inspectApplicationBackupInventory(await directoryIdentity(await managedPath(root,name)),marker.id,entry.name,guard)}
    catch(error){if(error instanceof ApplicationBackupInventoryGuardError)throw error;await guard();preserved.push(name);continue}
    files.push(name+'/xuanxiang-app-backup.json',...packageInventory.receipt.files.map(file=>name+'/data/'+file.path))
    directories.push(name,name+'/data',...packageInventory.receipt.directories.map(path=>name+'/data/'+path))
    bytes+=packageInventory.receipt.bytes+Number(packageInventory.metadata.size);visited+=packageInventory.receipt.files.length+packageInventory.receipt.directories.length+2
    packages.push(packageInventory);bounds();continue
   }
   if(BRAND_NAMES.some(names=>name==="inbox/"+names.lock)||name==="inbox/database/postmaster.pid")throw Error("SOURCE_NOT_CLOSED")
   const container=containers.has(name),isFile=ownedRootFile(name),isDir=ownedRootDirectory(name)||container
   if(!isFile&&!isDir){preserved.push(name);continue}
   await guard();await assertDirectory(directory);const info=await lstat(await managedPath(root,name))
   if(container&&(info.isSymbolicLink()||!info.isDirectory())){preserved.push(name);continue}
   if(info.isSymbolicLink()||isFile&&!info.isFile()||isDir&&!info.isDirectory()||isFile&&info.nlink!==1)throw Error("SOURCE_UNSAFE")
   if(isDir){directories.push(name);bounds();await scan(name)}
   else{files.push(name);bytes+=info.size;bounds()}
  }
  }finally{await entries.close().catch(error=>{if(error?.code!=='ERR_DIR_CLOSED')throw error})}
 }
 await scan("");await guard();brand.assertCurrent();assertDirectoryImmediately(root);for(const pkg of packages)pkg.assertUnchanged();bounds()
 if(![brand.filename,"catalog.json"].every(name=>files.includes(name)))throw Error("OWNERSHIP_INCOMPLETE")
 return{files:files.sort(),directories:directories.sort(),bytes,preserved:preserved.sort()}
}
