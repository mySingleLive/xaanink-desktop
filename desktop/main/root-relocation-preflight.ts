import {applicationNames} from '../core/brand-names'
import {constants,lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,opendirSync,type BigIntStats} from 'node:fs'
import {join,isAbsolute} from 'node:path'
import {DataRootManager,type RootPointer} from '../core/data-root'
import {rootMarkerSchema} from '../core/root-ownership'
import {ROOT_RELOCATION_LIMITS as limits} from '../core/root-relocation'
export type RootRelocationPreflight={mode:'none'|'lost'|'blocked';pointer:RootPointer|null;code:string|null}
const missing=(error:unknown)=>(error as NodeJS.ErrnoException)?.code==='ENOENT'
function read(path:string,max:number):unknown{
 const before=lstatSync(path,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(max))throw Error('CONTROL_UNSAFE')
 let fd:number|undefined
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const opened=fstatSync(fd,{bigint:true});if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.mtimeNs!==before.mtimeNs||opened.ctimeNs!==before.ctimeNs)throw Error('CONTROL_CHANGED')
  const buffer=Buffer.alloc(max+1);let bytes=0;for(;;){const count=readSync(fd,buffer,bytes,max+1-bytes,null);if(!count)break;bytes+=count;if(bytes>max)throw Error('CONTROL_UNSAFE')}
  const after=fstatSync(fd,{bigint:true}),leaf=lstatSync(path,{bigint:true});if(bytes!==Number(opened.size)||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||!leaf.isFile()||leaf.nlink!==1n||leaf.dev!==opened.dev||leaf.ino!==opened.ino||leaf.size!==opened.size||leaf.mtimeNs!==opened.mtimeNs||leaf.ctimeNs!==opened.ctimeNs)throw Error('CONTROL_CHANGED')
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytes)))
 }finally{if(fd!==undefined)closeSync(fd)}
}
/** The first synchronous turn: no worker, fallback/adoption or session open. */
export function rootRelocationPreflight(bootstrap:string):RootRelocationPreflight{
 let pointer:RootPointer|null=null
 try{
  const boot=lstatSync(bootstrap,{bigint:true});if(!boot.isDirectory()||boot.isSymbolicLink()||realpathSync(bootstrap)!==bootstrap)throw Error('BOOTSTRAP_CHANGED')
  const pointerPath=join(bootstrap,'data-root.json');let info:BigIntStats|null=null;try{info=lstatSync(pointerPath,{bigint:true})}catch(error){if(!missing(error))throw error}
  if(!info){
   const directory=opendirSync(bootstrap);let entries=0,history=false
   try{for(;;){const entry=directory.readSync();if(!entry)break;if(++entries>limits.bootstrapEntries)throw Error('CONTROL_UNSAFE');if(['root-migration.json','root-migration-request.json'].includes(entry.name)||entry.name.startsWith('root-relocation-')||entry.name.startsWith('application-restore-'))history=true}}finally{directory.closeSync()}
   const after=lstatSync(bootstrap,{bigint:true});if(after.dev!==boot.dev||after.ino!==boot.ino||realpathSync(bootstrap)!==bootstrap)throw Error('BOOTSTRAP_CHANGED')
   return{mode:history?'blocked':'none',pointer:null,code:history?'POINTER_REQUIRED':null}
  }
  pointer=DataRootManager.parsePointer(read(pointerPath,limits.pointerBytes));if(!isAbsolute(pointer.root.path)||/[\x00-\x1f]/.test(pointer.root.path))throw Error('POINTER_INVALID')
  let root:BigIntStats|null=null;try{root=lstatSync(pointer.root.path,{bigint:true})}catch(error){if(!missing(error))throw error}
  const physicallyLost=!root||!root.isDirectory()||root.isSymbolicLink()||String(root.dev)!==pointer.root.device||String(root.ino)!==pointer.root.inode||realpathSync(pointer.root.path)!==pointer.root.path
  let code:string|null=null
  if(!physicallyLost){try{const marker=rootMarkerSchema.parse(read(join(pointer.root.path,applicationNames(pointer.root).appMarker),limits.markerBytes));if(marker.id!==pointer.rootId||marker.phase!=='ready'||!marker.inboxReady)throw Error('marker')}catch{code='ROOT_MARKER_INVALID'}}
  // Recheck authority file and fixed bootstrap after every source inspection.
  const after=lstatSync(bootstrap,{bigint:true}),leaf=lstatSync(pointerPath,{bigint:true});if(after.dev!==boot.dev||after.ino!==boot.ino||realpathSync(bootstrap)!==bootstrap||leaf.dev!==info.dev||leaf.ino!==info.ino||leaf.size!==info.size||leaf.mtimeNs!==info.mtimeNs||leaf.ctimeNs!==info.ctimeNs)throw Error('CONTROL_CHANGED')
  return{mode:code?'blocked':physicallyLost?'lost':'none',pointer,code:code??(physicallyLost?'ROOT_UNAVAILABLE':null)}
 }catch{return{mode:'blocked',pointer,code:pointer?'CONTROL_UNSAFE':'POINTER_INVALID'}}
}
