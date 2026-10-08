import assert from 'node:assert/strict'
import {test} from 'node:test'
import {downloadManuscript} from '../../src/lib/manuscript-export'

test('EXP83-04 the actual xuanxiang app origin with a missing preload bridge cannot fall back to browser download',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');let downloads=0
 Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{protocol:'xaanink:',hostname:'app'},desktop:undefined}})
 t.mock.method(URL,'createObjectURL',()=>{downloads++;throw Error('browser fallback reached')})
 try{await assert.rejects(downloadManuscript(new Blob(['正文']),'正文.md'),/桌面保存/);assert.equal(downloads,0)}
 finally{t.mock.restoreAll();if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window')}
})
