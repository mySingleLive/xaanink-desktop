import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,readdir,rm,realpath,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Workspaces} from '../../desktop/service/workspaces'
import {createNovelOnce} from '../../src/lib/services/novel-create'
import {runInDatabaseContext} from '../../desktop/service/context'
import type {PrismaClient} from '../../src/generated/prisma/client'
import {ContentError} from '../../src/lib/content-errors'

test('CHAT34-G01: actual Workspaces.create sees revocation during selection IO before its first manifest/resources write',{timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-create-guard-')),entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>()
 let revoked=false,connects=0
 const work=join(root,'selected');await mkdir(work);const path=await realpath(work),info=await stat(path,{bigint:true})
 const works=new Workspaces(join(root,'app'),join(process.cwd(),'prisma/migrations'))
 const internal=works as unknown as {verifySelection:(value:unknown)=>Promise<string>;assertApplicationBackupWorkPath:(path:string)=>Promise<()=>void>;connect:()=>Promise<unknown>}
 internal.verifySelection=async()=>{entered.resolve();await resume.promise;return path}
 internal.assertApplicationBackupWorkPath=async()=>()=>{}
 internal.connect=async()=>{connects++;throw Error('Unexpected DB creation')}
 try{
  const operation=works.create({path,device:String(info.dev),inode:String(info.ino)},{title:'作者作品',requestId:'guard-operation34'},()=>{if(revoked)throw new ContentError('EXECUTION_REVOKED','原窗口已撤销')})
  await entered.promise;revoked=true;resume.resolve();await assert.rejects(operation,{code:'EXECUTION_REVOKED'})
  assert.deepEqual(await readdir(path),[]);assert.equal(connects,0)
 }finally{resume.resolve();await works.close();await rm(root,{recursive:true,force:true})}
})
test('CHAT34-G02: actual createNovelOnce guard after awaited original novel write aborts its whole transaction and idempotency receipt',{timeout:15000},async()=>{
 const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();let revoked=false,committed:string[]=[],planning=0,receipts=0
 const database={$transaction:async(run:(tx:unknown)=>Promise<unknown>)=>{
  const rows:string[]=[]
  const result=await run({$executeRaw:async()=>0,novelCreationRequest:{findUnique:async()=>null,create:async()=>{receipts++}},planningDocument:{create:async()=>{planning++}},novel:{create:async()=>{rows.push('novel');entered.resolve();await resume.promise;return{id:'novel',title:'作者作品',status:'ACTIVE',currentStage:'THEME',createdAt:new Date(),updatedAt:new Date()}}}})
  committed=rows;return result
 }} as unknown as PrismaClient
 const operation=runInDatabaseContext({workspaceId:'work',database,allowNovelCreation:true},()=>createNovelOnce('local-author',{title:'作者作品',requestId:'guard-operation34'},()=>{if(revoked)throw new ContentError('EXECUTION_REVOKED','原窗口已撤销')}))
 await entered.promise;revoked=true;resume.resolve();await assert.rejects(operation,{code:'EXECUTION_REVOKED'})
 assert.deepEqual(committed,[]);assert.equal(planning,0);assert.equal(receipts,0)
})
