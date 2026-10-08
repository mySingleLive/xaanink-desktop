import test from 'node:test'
import assert from 'node:assert/strict'
import {ChatSessionRepository,chatSessionKey,emptyChatSession} from '../../src/lib/chat-session'

test('BRAND-S01: existing session drafts retain their text and future saves use the new namespace',()=>{
 const account='fixture-author',entry={...emptyChatSession(),draft:'keep xuanxiang-written author text'},oldKey=`xuanxiang-chat-session:v1:${account}`
 const map=new Map([[oldKey,JSON.stringify({version:1,activeKey:entry.draftId,drafts:{[entry.draftId]:entry}})]])
 const store={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>map.set(key,value),removeItem:(key:string)=>map.delete(key)}
 const repository=new ChatSessionRepository(account,store)
 assert.deepEqual(repository.read().entry,entry);assert.equal(chatSessionKey(account),`xaanink-chat-session:v1:${account}`)
 const old=map.get(oldKey);assert.equal(repository.save(entry),null)
 assert.ok(map.has(chatSessionKey(account)));assert.equal(map.get(oldKey),old)
 assert.deepEqual(new ChatSessionRepository(account,store).read().entry,entry)
 repository.clear();assert.equal(map.has(oldKey),false);assert.equal(map.has(chatSessionKey(account)),false)
})

test('BRAND-S02: unreadable current state never falls back to stale legacy drafts or gets overwritten',()=>{
 const account='fixture-author',entry=emptyChatSession(),newKey=`xaanink-chat-session:v1:${account}`,oldKey=`xuanxiang-chat-session:v1:${account}`
 const map=new Map([[newKey,'broken-json'],[oldKey,JSON.stringify({version:1,activeKey:entry.draftId,drafts:{[entry.draftId]:entry}})]])
 const store={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>map.set(key,value),removeItem:(key:string)=>map.delete(key)}
 const repository=new ChatSessionRepository(account,store)
 assert.ok(repository.read().error);assert.equal(repository.read().entry,null);assert.ok(repository.save(entry));assert.equal(map.get(newKey),'broken-json')
})
