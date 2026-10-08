import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,realpath,mkdir,symlink,unlink,rm,readFile,writeFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Workspaces} from '../../desktop/service/workspaces'
import {DirectoryAuthority} from '../../desktop/main/directory-authority'

async function namespaceFixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xx-namespace95-'))),original=join(base,'original'),replacement=join(base,'replacement'),alias=join(base,'root-alias'),path=join(replacement,'backups/application/selected')
 await mkdir(original);await mkdir(path,{recursive:true});await symlink(original,alias,'dir')
 const authority=new DirectoryAuthority(),grant=await authority.issue(path,'open-work','independent95'),selection=await authority.consume(grant.id,'open-work','independent95'),works=new Workspaces(alias,'/unused-migrations')
 let shifted=false;const internals=works as unknown as {catalog:{read():Promise<{revision:number;value:unknown[]}>};connect():Promise<never>;validateWorkDatabase():Promise<void>}
 internals.catalog.read=async()=>{if(!shifted){shifted=true;await unlink(alias);await symlink(replacement,alias,'dir')}return{revision:0,value:[]}}
 const swap=async()=>{if(!shifted){shifted=true;await unlink(alias);await symlink(replacement,alias,'dir')}}
 return{base,alias,path,works,selection,internals,swap,close:async()=>{await works.close();await rm(base,{recursive:true,force:true})}}
}

test('AB95-N01 a root alias retargeted during catalog read cannot authorize creating inside the current backup namespace',async()=>{const r=await namespaceFixture();try{
 let engineCalls=0;r.internals.connect=async()=>{engineCalls++;throw Error('ENGINE_SHOULD_NOT_OPEN')}
 await assert.rejects(r.works.create(r.selection,{title:'保留应用备份命名空间',requestId:'independent95-root-shift'}),/APPLICATION_BACKUP_WORK_NAMESPACE_OVERLAP|APPLICATION_BACKUP_ROOT_CHANGED/)
 assert.deepEqual(await readdir(r.path),[]);assert.equal(engineCalls,0)
}finally{await r.close()}})

test('AB95-N02 open rechecks the namespace after database validation before catalog registration',async()=>{const r=await namespaceFixture();try{
 const bytes=JSON.stringify({schemaVersion:1,id:randomUUID(),novelId:'novel-independent95',phase:'ready',title:'已有作品',requestId:'independent95-open',requestHash:'a'.repeat(64),createdAt:new Date().toISOString()});await writeFile(join(r.path,'xuanxiang-work.json'),bytes)
 let connected=false;r.internals.validateWorkDatabase=async()=>{await r.swap()};r.internals.connect=async()=>{connected=true;throw Error('ENGINE_SHOULD_NOT_OPEN')}
 await assert.rejects(r.works.open(r.selection),/APPLICATION_BACKUP_WORK_NAMESPACE_OVERLAP|APPLICATION_BACKUP_ROOT_CHANGED/)
 assert.equal(connected,false);assert.equal(await readFile(join(r.path,'xuanxiang-work.json'),'utf8'),bytes)
}finally{await r.close()}})
