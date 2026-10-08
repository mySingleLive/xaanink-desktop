import {constants} from 'node:fs'
import {lstat,mkdir,open,readdir,realpath,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {z} from 'zod'
import {assertDirectory,directoryIdentity,hashRegular,sameIdentity,syncDirectory} from './root-ownership'
import type {RootIdentity} from './data-root'
import {workManifestSchema,workspaceImagePattern,type WorkManifest} from '../shared/workspace'

const magic=Buffer.from('XAANINK_BACKUP\x01\n'),MAX_HEADER=1024*1024,MAX_PACKAGE=512*1024*1024
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const part=z.object({bytes:z.number().int().positive().max(MAX_PACKAGE),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
const engineSchema=z.object({pglite:z.string().max(40),postgres:z.string().max(80),migrations:z.array(z.object({id:z.string().min(1).max(200),checksum:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(1000)}).strict()
const metadataSchema=z.object({schemaVersion:z.literal(1),id:z.uuid(),createdAt:z.iso.datetime(),work:workManifestSchema,engine:engineSchema,database:part,assets:z.array(part.extend({filename:z.string().regex(workspaceImagePattern)}).strict()).max(4096)}).strict()
type Metadata=z.infer<typeof metadataSchema>
export interface BackupSnapshot {work:WorkManifest;engine:z.infer<typeof engineSchema>;database:Uint8Array;assets:{filename:string;bytes:Uint8Array}[]}
export interface BackupReceipt {id:string;workId:string;createdAt:string;title:string;bytes:number;assetCount:number;sha256:string}
export interface BackupRead {receipt:BackupReceipt;snapshot:BackupSnapshot}
interface Options {beforeVerify?:(path:string)=>Promise<void>;beforePrune?:(path:string)=>Promise<void>;now?:()=>number}
function validateMetadata(value:unknown,workId:string,compatibility:{pglite:string;postgresMajor:number}):Metadata{
 const m=metadataSchema.parse(value)
 if(m.work.id!==workId||m.work.phase!=='ready'||!m.work.novelId)throw Error('备份作品身份不匹配')
 if(m.engine.pglite!==compatibility.pglite||Number(m.engine.postgres.split('.')[0])!==compatibility.postgresMajor)throw Error('备份引擎版本不兼容，原数据已保留')
 if(new Set(m.assets.map(x=>x.filename)).size!==m.assets.length||new Set(m.engine.migrations.map(x=>x.id)).size!==m.engine.migrations.length)throw Error('备份清单存在重复项')
 return m
}
/** One worker owns a store. Unrecognized, damaged and externally replaced files are never pruned. */
export class WorkBackups {
 private initial:Promise<RootIdentity>
 private directory:RootIdentity|undefined
 private queue:Promise<unknown>=Promise.resolve()
 constructor(readonly root:string,readonly workId:string,readonly compatibility:{pglite:string;postgresMajor:number},readonly options:Options={}){
  z.uuid().parse(workId);this.initial=realpath(root).then(directoryIdentity);void this.initial.catch(()=>{})
 }
 private serialize<T>(operation:()=>Promise<T>){const p=this.queue.then(operation);this.queue=p.catch(()=>{});return p}
 private async guard(create=false):Promise<RootIdentity>{
  const root=await this.initial;await assertDirectory(root)
  const path=join(root.path,'backups')
  if(create)try{await mkdir(path,{mode:0o700})}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}
  const actual=await directoryIdentity(path)
  if(this.directory&&!sameIdentity(this.directory,actual))throw Error('备份目录身份已变化')
  this.directory=actual;await assertDirectory(root);return actual
 }
 private async readFile(id:string):Promise<{bytes:Buffer;metadata:Metadata;identity:{device:string;inode:string}}>{
  z.uuid().parse(id);const dir=await this.guard(),path=join(dir.path,`${id}.xxbackup`),before=await lstat(path,{bigint:true})
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(MAX_PACKAGE)||before.size<BigInt(magic.length+4))throw Error('备份文件无法安全读取')
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)
  try{
   const opened=await file.stat({bigint:true})
   if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.nlink!==1n)throw Error('备份文件身份已变化')
   // Read an exact bounded snapshot, including an extra-byte check if the file grew.
   const bytes=Buffer.alloc(Number(opened.size));let at=0
   while(at<bytes.length){const {bytesRead}=await file.read(bytes,at,bytes.length-at,at);if(!bytesRead)throw Error('备份文件不完整');at+=bytesRead}
   if((await file.read(Buffer.alloc(1),0,1,at)).bytesRead)throw Error('备份文件已变化')
   const after=await lstat(path,{bigint:true});await this.guard()
   if(after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||after.nlink!==1n||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs)throw Error('备份文件已变化')
   if(!bytes.subarray(0,magic.length).equals(magic)||bytes.length<magic.length+4+32)throw Error('备份格式无法识别')
   if(sha(bytes.subarray(0,-32))!==bytes.subarray(-32).toString('hex'))throw Error('备份整体校验失败')
   const size=bytes.readUInt32BE(magic.length),start=magic.length+4
   if(size>MAX_HEADER||size===0||start+size>=bytes.length)throw Error('备份清单长度无效')
   const metadata=validateMetadata(JSON.parse(bytes.subarray(start,start+size).toString('utf8')),this.workId,this.compatibility)
   if(metadata.id!==id)throw Error('备份标识不匹配')
   let cursor=start+size
   for(const item of [metadata.database,...metadata.assets]){const end=cursor+item.bytes;if(end>bytes.length-32||sha(bytes.subarray(cursor,end))!==item.sha256)throw Error('备份内容校验失败');cursor=end}
   if(cursor!==bytes.length-32)throw Error('备份包含清单外数据')
   return{bytes,metadata,identity:{device:String(opened.dev),inode:String(opened.ino)}}
  }finally{await file.close()}
 }
 private receipt(bytes:Buffer,m:Metadata):BackupReceipt{return{id:m.id,workId:m.work.id,createdAt:m.createdAt,title:m.work.title,bytes:bytes.length,assetCount:m.assets.length,sha256:sha(bytes)}}
 private async listFiles():Promise<(BackupReceipt&{identity:{device:string;inode:string}})[]>{
  let dir:RootIdentity;try{dir=await this.guard()}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&!this.directory)return[];throw error}
  const entries=await readdir(dir.path);if(entries.length>10000)throw Error('备份目录条目过多，请先整理目录')
  const rows:(BackupReceipt&{identity:{device:string;inode:string}})[]=[]
  for(const name of entries){if(!name.endsWith('.xxbackup')||!z.uuid().safeParse(name.slice(0,-9)).success)continue
   try{const file=await this.readFile(name.slice(0,-9));rows.push({...this.receipt(file.bytes,file.metadata),identity:file.identity})}catch{await this.guard()}
  }
  return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))
 }
 list():Promise<BackupReceipt[]>{return this.serialize(async()=>(await this.listFiles()).map(({identity:_identity,...receipt})=>receipt))}
 read(id:string):Promise<BackupRead>{return this.serialize(async()=>{
  const {bytes,metadata:m}=await this.readFile(id);let at=magic.length+4+bytes.readUInt32BE(magic.length)
  const take=(length:number)=>{const b=Buffer.from(bytes.subarray(at,at+length));at+=length;return b}
  return{receipt:this.receipt(bytes,m),snapshot:{work:m.work,engine:m.engine,database:take(m.database.bytes),assets:m.assets.map(a=>({filename:a.filename,bytes:take(a.bytes)}))}}
 })}
 create(snapshot:BackupSnapshot,retention:number,protectedBackupIds:readonly string[]=[]):Promise<BackupReceipt&{retainedFiles:string[]}>{
  // Copy caller buffers before any await: a live caller cannot change the sealed snapshot.
  const data={work:structuredClone(snapshot.work),engine:structuredClone(snapshot.engine),database:Buffer.from(snapshot.database),assets:snapshot.assets.map(a=>({filename:a.filename,bytes:Buffer.from(a.bytes)}))}
  const protection=[...protectedBackupIds]
  return this.serialize(async()=>{
   z.number().int().min(1).max(1000).parse(retention)
   const pinned=new Set(z.array(z.uuid()).max(1000).parse(protection))
   const previous=await this.listFiles(),createdAt=new Date(Math.max(this.options.now?.()??Date.now(),...previous.map(r=>Date.parse(r.createdAt)+1))).toISOString(),id=randomUUID()
   const metadata=validateMetadata({schemaVersion:1,id,createdAt,work:data.work,engine:data.engine,database:{bytes:data.database.length,sha256:sha(data.database)},assets:data.assets.map(a=>({filename:a.filename,bytes:a.bytes.length,sha256:sha(a.bytes)}))},this.workId,this.compatibility)
   const header=Buffer.from(JSON.stringify(metadata)),length=magic.length+4+header.length+data.database.length+data.assets.reduce((sum,a)=>sum+a.bytes.length,0)+32
   if(header.length>MAX_HEADER||length>MAX_PACKAGE)throw Error('备份超过单份512MiB限制，原数据已保留')
   const dir=await this.guard(true),path=join(dir.path,`${id}.xxbackup`),file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600),size=Buffer.alloc(4);size.writeUInt32BE(header.length)
   let owned:{device:string;inode:string},sealedHash:string
   try{await this.guard();const s=await file.stat({bigint:true});owned={device:String(s.dev),inode:String(s.ino)};const hash=createHash('sha256');for(const bytes of [magic,size,header,data.database,...data.assets.map(a=>a.bytes)]){hash.update(bytes);await file.writeFile(bytes)}const complete=hash.copy(),footer=hash.digest();sealedHash=complete.update(footer).digest('hex');await file.writeFile(footer);await file.sync()}finally{await file.close()}
   await this.guard();await syncDirectory(dir.path);await this.options.beforeVerify?.(path)
   const verified=await this.readFile(id)
   if(!sameIdentity(verified.identity,owned!)||sha(verified.bytes)!==sealedHash!)throw Error('新备份身份或内容已变化，旧备份已保留')
   const receipt=this.receipt(verified.bytes,verified.metadata),retainedFiles:string[]=[]
   const verifyNew=async()=>{const current=await this.readFile(id);if(!sameIdentity(current.identity,owned!)||sha(current.bytes)!==receipt.sha256)throw Error('新备份已变化，旧备份已保留')}
   // Prune only prior validated receipts, after validating the durable new file.
   for(const old of previous.filter(old=>!pinned.has(old.id)).slice(retention-1)){
    const oldPath=join(dir.path,`${old.id}.xxbackup`)
    try{
     const candidate=await this.readFile(old.id);if(!sameIdentity(candidate.identity,old.identity)||sha(candidate.bytes)!==old.sha256)throw Error('changed backup')
     await this.options.beforePrune?.(oldPath);await this.guard()
     const current=await hashRegular(oldPath,()=>this.guard().then(()=>{}));if(!sameIdentity(current.identity,candidate.identity)||current.sha256!==old.sha256)throw Error('changed backup')
     await verifyNew()
     await this.guard();const final=await lstat(oldPath,{bigint:true})
     if(!final.isFile()||final.isSymbolicLink()||final.nlink!==1n||String(final.dev)!==old.identity.device||String(final.ino)!==old.identity.inode||String(final.size)!==current.revision.size||String(final.mtimeNs)!==current.revision.mtimeNs||String(final.ctimeNs)!==current.revision.ctimeNs)throw Error('changed backup')
     await unlink(oldPath);await syncDirectory(dir.path)
    }catch{retainedFiles.push(`${old.id}.xxbackup`)}
   }
   await verifyNew();return{...receipt,retainedFiles}
  })
 }
}
