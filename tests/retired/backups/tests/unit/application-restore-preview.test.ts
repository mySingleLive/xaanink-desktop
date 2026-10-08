import assert from 'node:assert/strict'
import {test} from 'node:test'
import {recoveryPreview} from '../../src/lib/desktop/recovery-preview'
import type {RecoveryItem} from '../../src/lib/desktop/draft-recovery'

const item=(value:unknown):RecoveryItem=>({id:'application:retained',source:'application',path:'operation/candidate/current/original',reason:'APPLICATION_RESTORED',createdAt:'2026-10-08T00:00:00.000Z',value})
const snapshot=(sources:Record<string,unknown>,autosaves:unknown[]=[])=>({version:1,revision:7,createdAt:'2026-10-08T00:00:00.000Z',autosaves,sources,issues:[]})

test('application recovery projects original editor, chat and comment text without exposing or executing saved request metadata',()=>{
 const original=item(snapshot({chat:{active:{draft:'最新未发送的文字',pendingRequest:{operationId:'private-operation',url:'/never-replay',approved:true}}},workspace:{tabs:[{title:'原作品正文',refId:'private-reference'}]},comments:{drafts:[{content:'未提交的评论',anchor:{quote:'原文引用'}}]},staged:{batches:{one:{label:'正文修改',changes:[{request:{method:'PATCH',url:'/private-target',body:{content:'尚未批准的段落',operationId:'private-operation'}}}]}}}},[{id:'e3c1377e-7712-4c98-a6c7-869304768741',draft:{pending:{value:{content:'编辑器中的新段落'},request:{url:'/never-save'}}}}])),before=structuredClone(original),preview=recoveryPreview(original)
 assert.equal(preview.meaningful,true)
 for(const text of['最新未发送的文字','未提交的评论','原文引用','尚未批准的段落','编辑器中的新段落','原作品正文'])assert.ok(preview.text.includes(text),text)
 for(const privateText of['private-operation','private-reference','/never-replay','/private-target','/never-save','approved'])assert.equal(preview.text.includes(privateText),false)
 assert.deepEqual(original,before)
})
test('application projection keeps the shared preview limit and original long snapshot intact',()=>{
 const original=item(snapshot({chat:{draft:'字'.repeat(200000)}})),preview=recoveryPreview(original)
 assert.equal(preview.meaningful,true);assert.equal(preview.truncated,true);assert.equal(preview.text.length,100000)
 assert.equal((original.value as any).sources.chat.draft.length,200000)
})
test('prior inert recovery projections remain readable while unknown application records retain the safe generic preview',()=>{
 const prior={id:'prior',source:'chat',path:'source',reason:'APPLICATION_RESTORED',createdAt:'2026-10-08T00:00:00.000Z',value:{draft:'更早保留的输入',request:{body:'never submit'}}}
 assert.ok(recoveryPreview(item(snapshot({recovery:{version:1,items:[prior]}}))).text.includes('更早保留的输入'))
 const unknown=recoveryPreview(item({request:{url:'/private-url',body:{prompt:'not a known draft'}}}))
 assert.equal(unknown.meaningful,false);assert.equal(unknown.text.includes('/private-url'),false)
})
