import assert from 'node:assert/strict'
import {test} from 'node:test'
import {RootMigrationHandoff} from '../../desktop/main/root-migration-handoff'
const deferred=()=>Promise.withResolvers<void>()
function fixture(){
 const calls:string[]=[],target={path:'/selected',device:'1',inode:'2'};let flow!:RootMigrationHandoff;let closed=false;let owner=true
 const requests={async prepare(nonce:string,proof:unknown){assert.deepEqual(proof,target);flow.assertOwner(nonce);calls.push('prepare');return{requestId:'request',ownerNonce:nonce}},async arm(nonce:string,id:string){flow.assertOwner(nonce);assert.equal(closed,true);assert.equal(id,'request');calls.push('arm');return{}},async cancel(id:string,nonce:string){assert.equal(id,'request');assert.ok(nonce);calls.push('cancel');return{receiptId:'receipt',requestId:id}},async acknowledgeResult(id:string,receipt:string){assert.equal(id,'request');assert.equal(receipt,'receipt');calls.push('ack');return true}}
 const options={requests,async choose(){calls.push('choose');return target},async confirm(){calls.push('confirm');return true},assertOwner(){if(!owner)throw Error('owner gone')},async close(){calls.push('flush');closed=true;await flow.armClosed();assert.equal(flow.commit(),true);return true},restart(){calls.push('restart')}}
 flow=new RootMigrationHandoff(options as never)
 return{flow,calls,options,loseOwner:()=>{owner=false}}
}
test('native selection and confirmation precede durable prepare; close flush precedes arm and restart',async()=>{const f=fixture();assert.equal(await f.flow.start(),true);assert.deepEqual(f.calls,['choose','confirm','prepare','flush','arm','restart']);assert.equal(f.flow.commit(),false)})
test('cancelled native picker has no request, flush or restart',async()=>{const f=fixture();f.options.choose=async()=>null as never;assert.equal(await f.flow.start(),false);assert.deepEqual(f.calls,[])})
test('declined confirmation has no durable request or close',async()=>{const f=fixture();f.options.confirm=async()=>false;assert.equal(await f.flow.start(),false);assert.deepEqual(f.calls,['choose'])})
test('failed close durably cancels its own prepared request before clearing flow',async()=>{const f=fixture();f.options.close=async()=>false;assert.equal(await f.flow.start(),false);assert.deepEqual(f.calls,['choose','confirm','prepare','cancel','ack']);assert.throws(()=>f.flow.assertOwner('old'),/MIGRATION_OWNER_EXPIRED/)})
test('arm failure does not restart and cancellation is awaited',async()=>{const f=fixture();f.options.requests.arm=async()=>{throw Error('arm failed')};await assert.rejects(f.flow.start(),/arm failed/);assert.deepEqual(f.calls,['choose','confirm','prepare','flush','cancel','ack'])})
test('concurrent clicks share one native picker and expired picker owner is rejected',async()=>{const f=fixture(),picked=deferred();f.options.choose=async()=>{f.calls.push('choose');await picked.promise;return{path:'/selected',device:'1',inode:'2'}};const one=f.flow.start(),two=f.flow.start();assert.equal(one,two);await Promise.resolve();f.loseOwner();picked.resolve();await assert.rejects(one,/owner gone/);assert.deepEqual(f.calls,['choose'])})
