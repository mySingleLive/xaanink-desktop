import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {ConversationTransferLedger} from '../../desktop/service/conversation-ledger'
import {ConversationTransfers,type ConversationTransferHost} from '../../desktop/service/conversation-transfer'
import {conversationDigest} from '../../desktop/service/conversation-bundle'

function fixture(error:Error){
 const source={version:1 as const,conversationId:'chat',userId:'local-author' as const,workspaceId:'missing-work',novelId:'novel',revision:1,historicalTransfers:[],deleted:false}
 const location={...source,deleted:true,revision:2},deletion={version:1,source,revision:2,phase:'committed'}
 const ledger={deletions:async()=>[deletion],deletion:async()=>deletion,location:async()=>location,journals:async()=>[]} as unknown as ConversationTransferLedger
 const host={withWorkspace:async()=>{throw error}} as unknown as ConversationTransferHost
 return{manager:new ConversationTransfers(host,ledger),location,deletion}
}
test('CHAT34-X01: boot preserves an exact committed deletion tombstone when its original directory is missing and reports pending cleanup',{timeout:15000},async()=>{
 const f=fixture(Object.assign(Error('missing original source'),{code:'ENOENT'})),result=await f.manager.recover()
 assert.deepEqual(result,[{operationId:'delete:'+conversationDigest('chat'),phase:'pending',code:'CONVERSATION_DELETION_PENDING'}]);assert.equal(f.location.deleted,true);assert.equal(f.deletion.phase,'committed')
})
test('CHAT34-X02: deletion recovery cannot silently tolerate unrelated database corruption',{timeout:15000},async()=>{
 const f=fixture(Error('unrecognized database corruption'));await assert.rejects(f.manager.recover(),/清理尚未完成|corruption/);assert.equal(f.deletion.phase,'committed')
})
