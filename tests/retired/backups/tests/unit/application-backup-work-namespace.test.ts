import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,rm,readFile,writeFile,readdir,realpath,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Workspaces} from '../../desktop/service/workspaces'
import {DirectoryAuthority} from '../../desktop/main/directory-authority'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {prisma} from '../../src/lib/db'
async function selected(path:string){const authority=new DirectoryAuthority(),grant=await authority.issue(path,'open-work','unit27');return authority.consume(grant.id,'open-work','unit27')}
function manifest(){return{schemaVersion:1,id:randomUUID(),novelId:'unit-novel',phase:'ready',title:'原作品',requestId:'unit27-original',requestHash:'original',createdAt:new Date().toISOString()}}
async function fixture(){const base=await realpath(await mkdtemp(join(tmpdir(),'xx-worknamespace27-'))),root=join(base,'app');await mkdir(join(root,'backups/application'),{recursive:true});return{base,root,works:new Workspaces(root,'/unused-migrations')}}
test('AN27-01 create rejects equal, ancestor and descendant application-backup namespace before any manifest or engine write',async()=>{
 for(const relative of ['backups/application','backups','backups/application/new-work']){
  const r=await fixture(),path=join(r.root,relative),calls:string[]=[];await mkdir(path,{recursive:true});const before=await readdir(path);(r.works as any).connect=async()=>{calls.push('engine');throw Error('ENGINE_SHOULD_NOT_OPEN')}
  try{await assert.rejects(r.works.create(await selected(path),{title:'拒绝重叠',requestId:'namespace-create'}),/APPLICATION_BACKUP_WORK_NAMESPACE_OVERLAP/);assert.deepEqual(await readdir(path),before);assert.deepEqual(calls,[]);await assert.rejects(readFile(join(path,'xuanxiang-work.json')),/ENOENT/)}finally{await r.works.close();await rm(r.base,{recursive:true,force:true})}
 }
})
test('AN27-02 open rejects a real work manifest in overlapping namespace before database lookup or registration',async()=>{
 for(const relative of ['backups/application','backups','backups/application/existing-work']){
  const r=await fixture(),path=join(r.root,relative),calls:string[]=[];await mkdir(path,{recursive:true});const original=JSON.stringify(manifest());await writeFile(join(path,'xuanxiang-work.json'),original);(r.works as any).validateWorkDatabase=async()=>{calls.push('validate')};(r.works as any).connect=async()=>{calls.push('engine');throw Error('ENGINE_SHOULD_NOT_OPEN')}
  try{await assert.rejects(r.works.open(await selected(path)),/APPLICATION_BACKUP_WORK_NAMESPACE_OVERLAP/);assert.deepEqual(calls,[]);assert.equal(await readFile(join(path,'xuanxiang-work.json'),'utf8'),original);assert.deepEqual(await r.works.list(),[])}finally{await r.works.close();await rm(r.base,{recursive:true,force:true})}
 }
})
test('AN27-03 previously catalogued overlapping work remains readable through ordinary list/run without namespace recategorization',async()=>{
 const r=await fixture(),path=join(r.root,'backups/application/historical-work');await mkdir(path);const old=manifest(),proof=await directoryIdentity(path),record={id:old.id,path,identity:{device:proof.device,inode:proof.inode},novelId:old.novelId,title:old.title,requestId:old.requestId,requestHash:old.requestHash,createdAt:old.createdAt},catalog=JSON.stringify({schemaVersion:1,revision:3,value:[record]})
 await writeFile(join(r.root,'catalog.json'),catalog);const engine={closed:false,close:async()=>{engine.closed=true}},db={$disconnect:async()=>{},novel:{findMany:async()=>[{id:old.novelId,title:'旧作品仍可读'}]}};(r.works as any).slots.set(old.id,{active:0,lastUsed:0,connection:Promise.resolve({db,engine,assets:{},unlock:async()=>{}})})
 try{assert.deepEqual(await r.works.list(),[record]);assert.deepEqual(await r.works.run(old.id,()=>prisma.novel.findMany()),[{id:old.novelId,title:'旧作品仍可读'}]);assert.equal(await readFile(join(r.root,'catalog.json'),'utf8'),catalog)}finally{await r.works.close();await rm(r.base,{recursive:true,force:true})}
})
test('AN27-04 a normal sibling work can still register through actual open and persist its catalog',async()=>{
 const r=await fixture(),path=join(r.root,'backups/other-work');await mkdir(path);const original=manifest();await writeFile(join(path,'xuanxiang-work.json'),JSON.stringify(original));let closed=false,unlocked=false;(r.works as any).validateWorkDatabase=async()=>{};(r.works as any).connect=async()=>({db:{novel:{findFirst:async()=>({id:original.novelId,title:'合法作品'}),count:async()=>1},$disconnect:async()=>{}},engine:{close:async()=>{closed=true}},unlock:async()=>{unlocked=true}})
 try{const opened=await r.works.open(await selected(path));assert.equal(opened.id,original.id);assert.equal(opened.title,'合法作品');assert.equal((await r.works.list())[0].path,path);assert.equal(closed,true);assert.equal(unlocked,true)}finally{await r.works.close();await rm(r.base,{recursive:true,force:true})}
})
test('AN27-05 canonical native selection cannot bypass the reserved namespace through an application-root alias',async()=>{
 const r=await fixture(),alias=join(r.base,'root-alias');await symlink(r.root,alias,'dir');const works=new Workspaces(alias,'/unused-migrations'),path=join(r.root,'backups/application/new-work');await mkdir(path);let opened=false;(works as any).connect=async()=>{opened=true;throw Error('must not open')}
 try{await assert.rejects(works.create(await selected(path),{title:'路径别名不能绕过',requestId:'alias-work'}),/APPLICATION_BACKUP_WORK_NAMESPACE_OVERLAP/);assert.equal(opened,false);assert.deepEqual(await readdir(path),[])}finally{await works.close();await r.works.close();await rm(r.base,{recursive:true,force:true})}
})
