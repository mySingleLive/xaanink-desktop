import {constants} from 'node:fs'
import {lstat,mkdir,open,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import sharp from 'sharp'
import {PGlite} from '@electric-sql/pglite'
import {WorkBackups} from '../../core/work-backups'
import {atomicWrite} from '../../core/versioned-store'
import {assertDirectory,directoryIdentity,hashRegular,managedPath,readMetadata,rootIdentitySchema,sameIdentity,syncDirectory} from '../../core/root-ownership'
import type {RootIdentity} from '../../core/data-root'
import {workManifestSchema,workspaceImagePattern} from '../../shared/workspace'
import {LOCAL_AUTHOR_ID} from '../context'
import type {Migration} from './migrations'
import {validateEngineArchive} from './backup-archive'
import {localImageRequest} from '../../shared/local-images'

interface WorkIdentity {id:string;novelId:string;path:string;identity:{device:string;inode:string}}
const fileSchema=z.object({path:z.string().min(1).max(1024),size:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/),identity:z.object({device:z.string(),inode:z.string()}).strict()}).strict()
const receiptSchema=z.object({schemaVersion:z.literal(1),id:z.uuid(),workId:z.uuid(),novelId:z.string().min(1),backupId:z.uuid(),backupSha256:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.iso.datetime(),phase:z.enum(['ready','cancelled']),directory:rootIdentitySchema,files:z.array(fileSchema).max(25000),directories:z.array(rootIdentitySchema).max(5000)}).strict()
export type RestoreCandidate=z.infer<typeof receiptSchema>
async function workRoot(work:WorkIdentity){
 const root=await directoryIdentity(work.path);if(!sameIdentity(root,work.identity))throw Error('作品目录身份已变化')
 const manifest=workManifestSchema.parse(await readMetadata(join(root.path,'xuanxiang-work.json')))
 if(manifest.id!==work.id||manifest.novelId!==work.novelId||manifest.phase!=='ready')throw Error('恢复作品身份不匹配')
 return root
}
async function container(root:RootIdentity,create=false){
 await assertDirectory(root);const path=join(root.path,'.xuanxiang-restores')
 if(create)try{await mkdir(path,{mode:0o700})}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}
 const directory=await directoryIdentity(path);await assertDirectory(root);return directory
}
async function inventory(directory:RootIdentity){
 const files:z.infer<typeof fileSchema>[]=[],directories:RootIdentity[]=[]
 async function walk(relative:string){
  await assertDirectory(directory);const current=await directoryIdentity(await managedPath(directory,relative));directories.push(current)
  if(directories.length>5000)throw Error('恢复候选目录过多')
  const entries=await readdir(current.path);await assertDirectory(current)
  for(const name of entries.sort()){
   const path=`${relative}/${name}`,absolute=await managedPath(directory,path),info=await lstat(absolute)
   if(info.isSymbolicLink())throw Error('恢复候选包含符号链接')
   if(info.isDirectory())await walk(path)
   else{if(!info.isFile()||info.nlink!==1||files.length>=25000)throw Error('恢复候选文件无效');const file=await hashRegular(absolute,()=>assertDirectory(directory));files.push({path,size:file.size,sha256:file.sha256,identity:file.identity})}
  }
 }
 await walk('database');await walk('assets');return{files,directories}
}
async function validateDatabase(engine:PGlite,work:WorkIdentity,migrations:Migration[],expected:{id:string;checksum:string}[],assets:Set<string>,postgres:string){
 const actualVersion=(await engine.query<{server_version:string}>('SHOW server_version')).rows[0].server_version
 if(actualVersion.split('.')[0]!==postgres.split('.')[0])throw Error('恢复候选数据库引擎不兼容')
 const installed=(await engine.query<{id:string;checksum:string}>('SELECT id,checksum FROM "_desktop_migrations" ORDER BY id')).rows
 const ordered=(rows:{id:string;checksum:string}[])=>rows.map(r=>`${r.id}:${r.checksum}`).sort()
 if(JSON.stringify(ordered(installed))!==JSON.stringify(ordered(expected))||JSON.stringify(ordered(installed))!==JSON.stringify(ordered(migrations)))throw Error('恢复候选数据库版本或结构不匹配')
 const novels=(await engine.query<{id:string;userId:string}>('SELECT id,"userId" FROM "Novel"')).rows
 if(novels.length!==1||novels[0].id!==work.novelId||novels[0].userId!==LOCAL_AUTHOR_ID)throw Error('恢复候选数据库与作品不匹配')
 const users=(await engine.query<{id:string}>('SELECT id FROM "User"')).rows
 if(!users.some(user=>user.id===LOCAL_AUTHOR_ID))throw Error('恢复候选缺少本地作者')
 const scenes=new Map((await engine.query<{id:string;novelId:string}>('SELECT id,"novelId" FROM "Scene"')).rows.map(scene=>[scene.id,scene]))
 const sceneImages=new Map((await engine.query<{id:string;sceneId:string;kind:string;filename:string;url:string}>('SELECT id,"sceneId",kind,filename,url FROM "SceneImage"')).rows.map(image=>[image.id,image]))
 for(const image of sceneImages.values())if(!assets.has(image.filename)||scenes.get(image.sceneId)?.novelId!==work.novelId||image.url!==`/api/novels/${work.novelId}/scenes/${image.sceneId}/images/${image.id}/asset`||!localImageRequest(image.url))throw Error('恢复候选缺少场景附件或图片引用无效')
 const columns=[['Novel','coverUrl'],['Character','avatarUrl'],['Character','portraitUrl'],['CharacterImage','url'],['NovelCoverImage','url'],['Item','iconUrl'],['ItemImage','url'],['Scene','exteriorImageUrl'],['Scene','interiorImageUrl'],['SceneImage','url']] as const
 for(const [table,column]of columns){
  const rows=(await engine.query<{id:string;url:string|null}>(`SELECT id,"${column}" AS url FROM "${table}" WHERE "${column}" IS NOT NULL`)).rows
  for(const row of rows){const {url}=row
   if(url?.startsWith('/_desktop/assets/')){const image=localImageRequest(url);if(image?.kind!=='work'||image.workspaceId!==work.id||!assets.has(image.filename))throw Error('恢复候选缺少作品附件或引用其他作品')}
   else if(url?.startsWith('/api/novels/')){
    const local=localImageRequest(url),parts=url.split('/'),image=sceneImages.get(parts[7])
    if(local?.kind!=='scene'||parts[3]!==work.novelId||!image||image.sceneId!==parts[5]||!assets.has(image.filename)||table==='Scene'&&(row.id!==image.sceneId||image.kind!==(column==='exteriorImageUrl'?'exterior':'interior'))||table==='SceneImage'&&row.id!==image.id)throw Error('恢复候选场景图片引用无效')
   }
  }
 }
}
/** Import a checked package into a new sibling storage generation. Never opens or writes the current database. */
export async function prepareWorkRestore(work:WorkIdentity,backups:WorkBackups,backupId:string,migrations:Migration[]):Promise<RestoreCandidate>{
 const root=await workRoot(work),backup=await backups.read(backupId),snapshot=backup.snapshot
 if(snapshot.work.id!==work.id||snapshot.work.novelId!==work.novelId||backup.receipt.workId!==work.id)throw Error('备份不属于当前作品')
 const archive=await validateEngineArchive(snapshot.database,Number(snapshot.engine.postgres.split('.')[0]))
 const parent=await container(root,true),id=randomUUID(),path=join(parent.path,id)
 await assertDirectory(parent);await mkdir(path,{mode:0o700});const directory=await directoryIdentity(path);await assertDirectory(root);await assertDirectory(parent)
 await mkdir(join(path,'assets'),{mode:0o700});let engine:PGlite|undefined
 try{
  engine=await PGlite.create({dataDir:join(path,'database'),loadDataDir:new Blob([new Uint8Array(archive)],{type:'application/x-tar'}),relaxedDurability:false})
  await validateDatabase(engine,work,migrations,snapshot.engine.migrations,new Set(snapshot.assets.map(a=>a.filename)),snapshot.engine.postgres)
  for(const asset of snapshot.assets){
   if(!workspaceImagePattern.test(asset.filename))throw Error('恢复附件文件名无效')
   const image=sharp(Buffer.from(asset.bytes),{limitInputPixels:40_000_000,failOn:'warning',animated:true}),metadata=await image.metadata(),format=asset.filename.endsWith('.jpg')?'jpeg':asset.filename.split('.').at(-1)
   if(metadata.format!==format)throw Error('恢复附件格式不匹配');await image.raw().toBuffer()
   await assertDirectory(directory);const file=await open(await managedPath(directory,`assets/${asset.filename}`),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
   try{await file.writeFile(asset.bytes);await file.sync()}finally{await file.close()}
  }
  await engine.close();engine=undefined
  await assertDirectory(root);await assertDirectory(parent);const listing=await inventory(directory)
  const receipt=receiptSchema.parse({schemaVersion:1,id,workId:work.id,novelId:work.novelId,backupId,backupSha256:backup.receipt.sha256,createdAt:new Date().toISOString(),phase:'ready',directory,...listing})
  for(const dir of listing.directories)await syncDirectory(dir.path)
  await atomicWrite(join(path,'xuanxiang-candidate.json'),JSON.stringify(receipt),{beforeRename:async()=>{await assertDirectory(root);await assertDirectory(parent);await assertDirectory(directory)}})
  await syncDirectory(parent.path)
  return await verifyWorkRestore(work,id)
 }finally{await engine?.close()}
}
async function receiptFor(work:WorkIdentity,id:string){
 z.uuid().parse(id);const root=await workRoot(work),parent=await container(root),directory=await directoryIdentity(join(parent.path,id)),receipt=receiptSchema.parse(await readMetadata(join(directory.path,'xuanxiang-candidate.json')))
 if(receipt.id!==id||receipt.workId!==work.id||receipt.novelId!==work.novelId||receipt.directory.path!==directory.path||!sameIdentity(receipt.directory,directory))throw Error('恢复候选身份已变化')
 await assertDirectory(root);await assertDirectory(parent);return{root,parent,directory,receipt}
}
export async function verifyWorkRestore(work:WorkIdentity,id:string):Promise<RestoreCandidate>{
 const {receipt,directory}=await receiptFor(work,id);if(receipt.phase!=='ready')throw Error('恢复候选已取消')
 const listing=await inventory(directory)
 if(JSON.stringify(listing.files)!==JSON.stringify(receipt.files)||JSON.stringify(listing.directories)!==JSON.stringify(receipt.directories))throw Error('恢复候选校验失败，候选内容已变化')
 const entries=(await readdir(directory.path)).sort();if(JSON.stringify(entries)!==JSON.stringify(['assets','database','xuanxiang-candidate.json']))throw Error('恢复候选包含未知内容')
 return receipt
}
/** Cancellation retains the isolated bytes. The host must serialize activation and cancellation. */
export async function cancelWorkRestore(work:WorkIdentity,id:string,isActive:()=>Promise<boolean>):Promise<void>{
 const {root,parent,directory,receipt}=await receiptFor(work,id)
 if(await isActive())throw Error('候选已经启用，不能作为未启用恢复取消')
 await atomicWrite(join(directory.path,'xuanxiang-candidate.json'),JSON.stringify({...receipt,phase:'cancelled'}),{beforeRename:async()=>{await assertDirectory(root);await assertDirectory(parent);await assertDirectory(directory);if(await isActive())throw Error('候选已经启用')}})
}
