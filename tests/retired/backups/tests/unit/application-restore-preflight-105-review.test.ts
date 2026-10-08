import assert from 'node:assert/strict'
import {test} from 'node:test'
import fs from 'node:fs'
import {link,rename,mkdir,writeFile,readFile,mkdtemp,realpath,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {checkpointFixture} from '../fixtures/application-restore-checkpoint'
import {applicationRestorePreflight} from '../../desktop/main/application-restore-preflight'

test('AR105-P01 a hardlinked application barrier is unknown protection and cannot be admitted or rewritten',{timeout:15000},async()=>{
 const f=await checkpointFixture()
 try{const path=join(f.path,'application-restore-drafts.json'),second=join(f.base,'retained-second-link');await link(path,second);const before=await readFile(path);assert.equal(applicationRestorePreflight(f.boot,()=>{}).startup.mode,'cold');assert.deepEqual(await readFile(path),before);assert.deepEqual(await readFile(second),before)}finally{await f.close()}
})

test('AR105-P02 an identity-lost activated root is cold and no foreign metadata is opened while inspecting its old authority',{timeout:15000},async t=>{
 const f=await checkpointFixture()
 try{
  await rename(f.path,f.path+'.old-owned');await mkdir(f.path);const foreign=join(f.path,'private-foreign.txt');await writeFile(foreign,'fictional foreign bytes stay untouched');const before=await readFile(foreign),originalOpen=fs.openSync;let foreignOpens=0
  t.mock.method(fs,'openSync',(...args:Parameters<typeof fs.openSync>)=>{if(String(args[0]).startsWith(f.path+'/')){foreignOpens++;throw Error('must not inspect foreign replacement')}return originalOpen(...args)})
  assert.equal(applicationRestorePreflight(f.boot,()=>{}).startup.mode,'cold');assert.equal(foreignOpens,0);assert.deepEqual(await readFile(foreign),before)
 }finally{await f.close()}
})

test('AR105-P03 unknown recovery namespace evidence in an otherwise fresh bootstrap is retained and blocks startup',{timeout:5000},async()=>{
 const boot=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review105-preflight-')))
 try{const path=join(boot,'.application-recovery-unknown.tmp'),bytes='uncommitted fixture must not be cleared';await writeFile(path,bytes);const before=await readdir(boot);const result=applicationRestorePreflight(boot,()=>{});assert.equal(result.startup.mode,'cold');assert.equal(result.startup.code,'HISTORY_INCOMPLETE');assert.equal(await readFile(path,'utf8'),bytes);assert.deepEqual(await readdir(boot),before)}finally{await rm(boot,{recursive:true,force:true})}
})
