import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,writeFile,rm,realpath,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {closedWorkLeaseTarget} from '../../desktop/service/closed-work-lease-target'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {guardFileExportTarget} from '../../desktop/main/file-export-target'
async function fixture(run:(f:any)=>Promise<void>){const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-closed-target-'))),path=join(base,'work'),id=randomUUID();await mkdir(path);const root=await directoryIdentity(path),manifest={schemaVersion:1,id,phase:'ready',novelId:'local-novel',title:'本地作品',requestId:'create-id',requestHash:'hash',createdAt:new Date().toISOString()};await writeFile(join(path,'xuanxiang-work.json'),JSON.stringify(manifest));const record={id,path,identity:{device:root.device,inode:root.inode},novelId:manifest.novelId,title:manifest.title,requestId:manifest.requestId,requestHash:manifest.requestHash,createdAt:manifest.createdAt};try{await run({base,path,id,root,manifest,record})}finally{await rm(base,{recursive:true,force:true})}}
test('a closed trusted catalog grants only the exact registered work directory without opening its engine',()=>fixture(async f=>{
 let closed=false,reads=0;const guard=()=>{if(!closed)throw Error('NOT_CLOSED')},works={list:async()=>{reads++;return[f.record]}}
 await assert.rejects(closedWorkLeaseTarget(works,f.id,guard),/NOT_CLOSED/);assert.equal(reads,0);closed=true
 assert.deepEqual(await closedWorkLeaseTarget(works,f.id,guard),f.root)
 await assert.rejects(closedWorkLeaseTarget(works,randomUUID(),guard),/NOT_REGISTERED/)
 await assert.rejects(closedWorkLeaseTarget(works,{workId:f.id,path:'/forged'},guard));assert.equal(reads,2)
 await rename(f.path,f.path+'-retained');await mkdir(f.path);await writeFile(join(f.path,'xuanxiang-work.json'),JSON.stringify(f.manifest));await assert.rejects(closedWorkLeaseTarget(works,f.id,guard),/CHANGED/)
}))
test('closing proof loss after catalog IO or a mismatched original manifest cannot yield a recovery capability',()=>fixture(async f=>{
 let closed=true;await assert.rejects(closedWorkLeaseTarget({list:async()=>{closed=false;return[f.record]}},f.id,()=>{if(!closed)throw Error('NOT_CLOSED')}),/NOT_CLOSED/)
 await writeFile(join(f.path,'xuanxiang-work.json'),JSON.stringify({...f.manifest,id:randomUUID()}));await assert.rejects(closedWorkLeaseTarget({list:async()=>[f.record]},f.id,()=>{}),/MISMATCH/)
}))
test('native exports protect persistent lease audit and its reserved temporary files, including an unregistered work',()=>fixture(async f=>{
 for(const filename of ['.xuanxiang-lease-recovery.json',`.xuanxiang-lease-recovery-${randomUUID()}.tmp`])await assert.rejects(guardFileExportTarget(join(f.path,filename),{dataRoots:[],workRoots:[]}))
 await guardFileExportTarget(join(f.path,'我的恢复说明.json'),{dataRoots:[],workRoots:[]})
}))
