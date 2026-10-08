import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {checkpointFixture} from '../fixtures/application-restore-checkpoint'
import {ApplicationRestoreCheckpointSession} from '../../desktop/main/application-restore-checkpoint-session'
import {ApplicationRestoreDraftBarrier} from '../../desktop/main/application-restore-draft-barrier'
import {DraftJournal} from '../../desktop/main/draft-journal'

const controller=(f:Awaited<ReturnType<typeof checkpointFixture>>)=>new ApplicationRestoreCheckpointSession({root:f.path,journal:f.journal,journalOwner:f.journalOwner,requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})

test('main checkpoint writes the full actual journal and immutable first attestation before allowing the second checkpoint to consume protection',{timeout:20000},async()=>{
 const f=await checkpointFixture()
 try{
  const session=controller(f);assert.equal(session.blocked,true)
  const notice=await session.notice();assert.equal(notice.token,f.retained.retention.barrier.token)
  assert.deepEqual((await session.read())!.sources.recovery,{version:1,items:f.items})
  const first=await session.persist(f.snapshot(21));await session.confirm('first',notice.token,first)
  assert.equal(session.blocked,true);assert.equal(f.requests.startup().request?.firstCheckpoint?.receipt.clientRevision,21)
  const barrier=new ApplicationRestoreDraftBarrier(f.path,f.journal,{assertOwner:f.assertOwner});assert.equal((await barrier.inspect())!.barrier.phase,'checkpointed')
  await assert.rejects(session.confirm('complete',notice.token,first))
  const second=await session.persist(f.snapshot(22));await session.confirm('complete',notice.token,second)
  assert.ok(second.revision>first.revision);assert.equal(session.blocked,false);assert.equal(f.requests.startup().mode,'normal');assert.equal((await barrier.inspect())!.barrier.phase,'complete')
  assert.deepEqual((await f.journal.read())!.sources.recovery,{version:1,items:f.items})
 }finally{await f.close()}
})

test('incomplete recovery or repeated client receipt is rejected before replacing the protected journal',{timeout:20000},async()=>{
 const f=await checkpointFixture()
 try{
  const session=controller(f),initial=await readFile(join(f.path,'drafts.json')),bad=f.snapshot(1);bad.sources.recovery.items.pop()
  await assert.rejects(session.persist(bad));assert.deepEqual(await readFile(join(f.path,'drafts.json')),initial)
  const first=await session.persist(f.snapshot(10)),before=await readFile(join(f.path,'drafts.json'))
  await assert.rejects(session.persist(f.snapshot(10)));assert.deepEqual(await readFile(join(f.path,'drafts.json')),before);assert.equal(session.blocked,true)
  await assert.rejects(session.confirm('first','00000000-0000-4000-8000-000000000000',first))
 }finally{await f.close()}
})

test('capture waits actual journal→barrier→request first flight and cannot deadlock the inner original journal writer',{timeout:20000},async()=>{
 const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();let held=false
 const f=await checkpointFixture({async beforeRename(){if(!held){held=true;entered.resolve();await resume.promise}}}),session=controller(f),first=session.persist(f.snapshot(30))
 try{
  await entered.promise;let captured=false;const pending=f.gate.acquire().then(value=>{captured=true;return value})
  await new Promise(setImmediate);assert.equal(captured,false);resume.resolve();await first
  const token=await pending;assert.ok(f.requests.startup().request?.firstCheckpoint);assert.equal(captured,true)
  let secondDone=false;const second=session.persist(f.snapshot(31)).then(()=>{secondDone=true});await new Promise(setImmediate);assert.equal(secondDone,false);f.gate.release(token);await second;assert.equal(session.blocked,false)
 }finally{resume.resolve();await first.catch(()=>{});f.gate.revoke();await session.flush();await f.close()}
})

test('a cold checkpointed session uses a new actual first/second pair without overwriting the old core first checkpoint',{timeout:20000},async()=>{
 const f=await checkpointFixture()
 try{
  const old=controller(f);await old.persist(f.snapshot(40))
  const core=new ApplicationRestoreDraftBarrier(f.path,f.journal,{assertOwner:f.assertOwner}),first=(await core.inspect())!.barrier.firstCheckpoint
  const newJournal=new DraftJournal(f.path,{withWrite:run=>f.gate.write(run)});newJournal.activate('reopened')
  const fresh=new ApplicationRestoreCheckpointSession({root:f.path,journal:newJournal,journalOwner:'reopened',requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})
  assert.equal((await fresh.notice()).afterRevision,40)
  await assert.rejects(fresh.persist(f.snapshot(40)))
  await fresh.persist(f.snapshot(41));assert.deepEqual((await core.inspect())!.barrier.firstCheckpoint,first)
  await fresh.persist(f.snapshot(42));assert.equal(fresh.blocked,false);assert.equal(f.requests.startup().mode,'normal')
 }finally{await f.close()}
})

test('owner revocation during actual first IO preserves source and cannot complete or consume application recovery',{timeout:20000},async()=>{
 const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>(),f=await checkpointFixture({async beforeRename(){entered.resolve();await resume.promise}}),source=await readFile(join(f.source,'drafts.json')),session=controller(f),pending=session.persist(f.snapshot(10))
 try{
  await entered.promise;f.revoke();resume.resolve();await assert.rejects(pending)
  assert.equal(session.blocked,true);assert.equal(f.requests.startup().mode,'protected');assert.deepEqual(await readFile(join(f.source,'drafts.json')),source)
 }finally{resume.resolve();await pending.catch(()=>{});await session.flush();await f.close()}
})

test('an already complete core barrier with a failed consumed publish requires two new-session receipts and preserves the original complete barrier bytes',{timeout:20000},async()=>{
 let deny=false
 const f=await checkpointFixture({}, {async beforeRename(kind){if(deny&&kind==='phase')throw Error('controlled phase publication failure')}})
 try{
  const old=controller(f);await old.persist(f.snapshot(50));deny=true
  await assert.rejects(old.persist(f.snapshot(51)));assert.equal(old.blocked,true)
  const before=await f.retentionBytes(),barrier=new ApplicationRestoreDraftBarrier(f.path,f.journal,{assertOwner:f.assertOwner});assert.equal((await barrier.inspect())!.barrier.phase,'complete')
  deny=false;const journal=new DraftJournal(f.path,{withWrite:run=>f.gate.write(run)});journal.activate('complete-reopened')
  const fresh=new ApplicationRestoreCheckpointSession({root:f.path,journal,journalOwner:'complete-reopened',requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})
  assert.equal((await fresh.notice()).afterRevision,51)
  await fresh.persist(f.snapshot(52));assert.equal(f.requests.startup().request?.firstCheckpoint?.kind,'completed-barrier-restart')
  await fresh.persist(f.snapshot(53));assert.equal(fresh.blocked,false);assert.deepEqual(await f.retentionBytes(),before)
 }finally{await f.close()}
})
