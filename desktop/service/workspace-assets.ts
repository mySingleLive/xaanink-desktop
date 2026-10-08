import {constants} from "node:fs"
import {lstat,mkdir,open,realpath,unlink,readdir} from "node:fs/promises"
import {join} from "node:path"
import {createHash,randomUUID} from "node:crypto"
import sharp from "sharp"
import {workspaceImagePattern as filenamePattern} from "../shared/workspace"
/** Work-scoped image storage, constructed only from an owned workspace path. */
export interface StoredWorkspaceImage {id:string;filename:string;mime:string}
interface Identity {path:string;device:bigint;inode:bigint}
const MAX_BYTES=10*1024*1024
const formats={png:"image/png",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif"} as const
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex")
async function directory(path:string):Promise<Identity>{const info=await lstat(path,{bigint:true});if(!info.isDirectory()||info.isSymbolicLink())throw Error("作品图片目录无效");return{path:await realpath(path),device:info.dev,inode:info.ino}}
function same(a:Identity,b:Identity){return a.path===b.path&&a.device===b.device&&a.inode===b.inode}
export class WorkspaceAssets {
 private initial:Promise<Identity>
 private assets:Identity|undefined
 private created=new Map<string,{sha256:string;device:bigint;inode:bigint}>()
 private mutations:Promise<unknown>=Promise.resolve()
 constructor(readonly root:string,readonly options:{beforeWrite?:()=>Promise<void>;beforeDirectorySync?:()=>Promise<void>}={}){this.initial=directory(root);void this.initial.catch(()=>{})}
 private async current(create=false){
  const expected=await this.initial,actual=await directory(this.root)
  if(!same(expected,actual))throw Error("作品图片目录身份已变化")
  const path=join(expected.path,"assets")
  if(create)try{await mkdir(path,{mode:0o700})}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error}
  const assets=await directory(path)
  if(this.assets&&!same(this.assets,assets))throw Error("作品图片目录身份已变化")
  this.assets=assets;return assets
 }
 private serialize<T>(operation:()=>Promise<T>){const p=this.mutations.then(operation);this.mutations=p.catch(()=>{});return p}
 save(input:Buffer,claimedMime?:string):Promise<StoredWorkspaceImage>{const bytes=Buffer.from(input);return this.serialize(()=>this.saveImage(bytes,claimedMime))}
 private async saveImage(input:Buffer,claimedMime?:string):Promise<StoredWorkspaceImage>{
  if(!input.length||input.length>MAX_BYTES)throw Error("图片须为1字节至10MiB")
  const bytes=Buffer.from(input)
  let format:keyof typeof formats
  try{
   const image=sharp(bytes,{limitInputPixels:40_000_000,failOn:"warning",animated:true}),metadata=await image.metadata();format=metadata.format as keyof typeof formats
   if(!formats[format]||claimedMime&&formats[format]!==claimedMime||!metadata.width||!metadata.height||metadata.width*metadata.height>40_000_000)throw Error("image format")
   await image.raw().toBuffer()
  }catch{throw Error("图片类型或内容无效，请选择可解码的PNG、JPEG、WebP、GIF")}
  const id=randomUUID(),filename=`${id}.${format==="jpeg"?"jpg":format}`,assets=await this.current(true)
  await this.options.beforeWrite?.();await this.current()
  const file=await open(join(assets.path,filename),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
  let written:{device:bigint;inode:bigint}
  try{await this.current();await file.writeFile(bytes);await file.sync();const identity=await file.stat({bigint:true});written={device:identity.dev,inode:identity.ino}}finally{await file.close()}
  await this.options.beforeDirectorySync?.()
  if(process.platform!=="win32"){const handle=await open(assets.path,constants.O_RDONLY|constants.O_NOFOLLOW);try{await handle.sync()}finally{await handle.close()}}
  await this.current()
  const verified=await this.readVerified(filename)
  if(digest(verified.bytes)!==digest(bytes)||verified.identity.device!==written.device||verified.identity.inode!==written.inode)throw Error("作品图片写入后内容已变化")
  this.created.set(filename,{sha256:digest(bytes),...written})
  return{id,filename,mime:formats[format]}
 }
 async read(filename:string):Promise<{bytes:Buffer;mime:string}>{const {bytes,mime}=await this.readVerified(filename);return{bytes,mime}}
 private async readVerified(filename:string):Promise<{bytes:Buffer;mime:string;identity:{device:bigint;inode:bigint}}>{
  if(!filenamePattern.test(filename))throw Error("图片标识无效")
  const assets=await this.current(),path=join(assets.path,filename),before=await lstat(path,{bigint:true})
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(MAX_BYTES)||before.size===0n)throw Error("图片文件无法安全读取")
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)
  try{
   const opened=await file.stat({bigint:true});if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.nlink!==1n)throw Error("图片文件已变化")
   const bytes=await file.readFile();await this.current()
   const after=await lstat(path,{bigint:true});if(after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||after.nlink!==1n||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||bytes.length!==Number(opened.size))throw Error("图片文件已变化")
   return{bytes,mime:filename.endsWith(".jpg")?"image/jpeg":`image/${filename.split(".").at(-1)}`,identity:{device:opened.dev,inode:opened.ino}}
  }finally{await file.close()}
 }
 /** Lock order is assets, then database. No SQL is run by an asset mutation. */
 snapshot<T>(capture:(files:{filename:string;bytes:Buffer}[])=>Promise<T>):Promise<T>{return this.serialize(async()=>{
  const assets=await this.current(true),names=await readdir(assets.path);if(names.length>10000)throw Error("作品资源目录条目过多")
  const files:{filename:string;bytes:Buffer}[]=[];let total=0
  for(const filename of names.sort())if(filenamePattern.test(filename)){
   const file=await this.readVerified(filename);total+=file.bytes.length
   if(files.length>=4096||total>256*1024*1024)throw Error("作品附件超过单次备份限制，原数据已保留")
   files.push({filename,bytes:file.bytes})
  }
  const result=await capture(files);await this.current();return result
 })}
 removeCreated(filename:string):Promise<void>{return this.serialize(()=>this.removeImage(filename))}
 private async removeImage(filename:string):Promise<void>{
  const expected=this.created.get(filename);if(!expected)throw Error("图片文件不属于本次写入，归属无法确认")
  const assets=await this.current(),file=await this.readVerified(filename)
  if(digest(file.bytes)!==expected.sha256||file.identity.device!==expected.device||file.identity.inode!==expected.inode)throw Error("图片内容或身份已变化，原文件已保留")
  await this.current()
  const final=await lstat(join(assets.path,filename),{bigint:true})
  if(!final.isFile()||final.isSymbolicLink()||final.nlink!==1n||final.dev!==expected.device||final.ino!==expected.inode)throw Error("图片身份已变化，原文件已保留")
  await unlink(join(assets.path,filename));this.created.delete(filename)
 }
}
