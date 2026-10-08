import assert from 'node:assert/strict'
import {test} from 'node:test'
import fsPromises from 'node:fs/promises'
import {readFile,writeFile,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {checkpointFixture} from '../fixtures/application-restore-checkpoint'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {ApplicationRestoreCheckpointSession} from '../../desktop/main/application-restore-checkpoint-session'
import {applicationRestorePreflight} from '../../desktop/main/application-restore-preflight'

const controller=(f:Awaited<ReturnType<typeof checkpointFixture>>)=>new ApplicationRestoreCheckpointSession({root:f.path,journal:f.journal,journalOwner:f.journalOwner,requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})

test('AR105-C01 protected journal read rechecks the exact operation retention after physical IO and cannot publish a stale bundle',{timeout:15000},async t=>{
 const f=await checkpointFixture(),session=controller(f),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),originalOpen=fsPromises.open;let held=false
 t.mock.method(fsPromises,'open',async(...args:Parameters<typeof fsPromises.open>)=>{const handle=await originalOpen(...args);if(!held&&String(args[0])===join(f.path,'drafts.json')){held=true;entered.resolve();await release.promise}return handle})
 const source=await readFile(join(f.source,'drafts.json')),pending=session.read()
 try{
  await entered.promise;const path=join(f.path,'application-restore-drafts.json'),retention=JSON.parse(await readFile(path,'utf8'));retention.operationId=randomUUID();const{checksum:_old,...body}=retention;retention.checksum=digest(canonical(body));await writeFile(path,JSON.stringify(retention));const changed=await readFile(path);release.resolve()
  await assert.rejects(pending,'a stale original token/operation cannot be published after a different retention replaced it during actual journal IO');assert.equal(session.blocked,true);assert.deepEqual(await readFile(path),changed);assert.deepEqual(await readFile(join(f.source,'drafts.json')),source);assert.equal(applicationRestorePreflight(f.boot,()=>{}).startup.mode,'cold')
 }finally{release.resolve();await pending.catch(()=>{});await session.flush();await f.close()}
})

test('AR105-C02 disposing the actual native owner while capture queues the checkpoint starts no physical write and leaves protection intact',{timeout:15000},async()=>{
 const f=await checkpointFixture(),session=controller(f)
 try{
  const before=await readFile(join(f.path,'drafts.json')),retention=await f.retentionBytes(),token=await f.gate.acquire(),pending=session.persist(f.snapshot(30));await new Promise(setImmediate);f.revoke();f.gate.release(token);await assert.rejects(pending);assert.equal(session.blocked,true);assert.deepEqual(await readFile(join(f.path,'drafts.json')),before);assert.deepEqual(await f.retentionBytes(),retention)
 }finally{f.gate.revoke();await session.flush();await f.close()}
})

test('AR105-C03 replacing the retention inode with identical bytes during a physical checkpoint cannot attest the first receipt',{timeout:15000},async()=>{
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>()
 const f=await checkpointFixture({async beforeRename(){entered.resolve();await release.promise}}),session=controller(f),pending=session.persist(f.snapshot(41))
 try{
  await entered.promise;const path=join(f.path,'application-restore-drafts.json'),before=await readFile(path);await rename(path,path+'.original');await writeFile(path,before);release.resolve()
  await assert.rejects(pending);assert.equal(session.blocked,true);assert.equal(f.requests.startup().request?.firstCheckpoint,undefined)
  assert.deepEqual(await readFile(path),before);assert.deepEqual(await readFile(path+'.original'),before)
  assert.equal(JSON.parse(before.toString()).barrier.phase,'protected')
  const stored=await f.journal.read();assert.deepEqual(stored!.sources.recovery,f.snapshot(41).sources.recovery,'a refused attestation must retain every inert recovery item even when its journal write already committed')
 }finally{release.resolve();await pending.catch(()=>{});await session.flush();await f.close()}
})
