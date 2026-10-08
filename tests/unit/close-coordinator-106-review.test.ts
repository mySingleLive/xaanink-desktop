import assert from 'node:assert/strict'
import {test} from 'node:test'
import {CloseCoordinator,type CloseOwner,type CloseServices} from '../../desktop/main/close-coordinator'

function fixture(overrides:Partial<CloseServices>={}){
 let owner:CloseOwner|null={owner:10,sessionId:'original-window'};const events:string[]=[]
 const services:CloseServices={current:()=>owner,async busy(){return false},async confirmStop(){return true},async stopTasks(){events.push('stop')},async flush(){events.push('flush')},async closeData(){events.push('data')},async failed(){events.push('failed');return'cancel'},async exportDraft(){events.push('export')},async commit(intent){events.push(intent)},release(){events.push('release')},...overrides}
 const close=new CloseCoordinator(services)
 return{events,close,setOwner(value:CloseOwner|null){owner=value}}
}

test('AR106-A01 quit promotion during an asynchronous window commit awaits both commits and never reflushes the disposed owner',{timeout:15000},async()=>{
 const windowEntered=Promise.withResolvers<void>(),windowRelease=Promise.withResolvers<void>(),quitEntered=Promise.withResolvers<void>(),quitRelease=Promise.withResolvers<void>()
 const f=fixture({async commit(intent){f.events.push(intent);if(intent==='window'){windowEntered.resolve();await windowRelease.promise;f.setOwner(null)}else{quitEntered.resolve();await quitRelease.promise}}})
 const first=f.close.request('window');await windowEntered.promise;const promoted=f.close.request('quit');assert.equal(promoted,first);assert(!f.events.includes('release'));windowRelease.resolve();await quitEntered.promise;assert(!f.events.includes('release'));assert.equal(f.events.filter(value=>value==='flush').length,1);quitRelease.resolve()
 assert.equal(await first,true);assert.equal(await promoted,true);assert.deepEqual(f.events,['stop','flush','data','window','quit','release'])
})

test('AR106-A02 a new renderer appearing during asynchronous window commit prevents a promoted quit from committing against that new lifetime',{timeout:15000},async()=>{
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),f=fixture({async commit(intent){f.events.push(intent);entered.resolve();await release.promise}}),first=f.close.request('window')
 await entered.promise;const promoted=f.close.request('quit');f.setOwner({owner:11,sessionId:'new-window'});release.resolve();assert.equal(await first,false);assert.equal(await promoted,false);assert.deepEqual(f.events,['stop','flush','data','window','release'])
})

test('AR106-A03 physical data close already acknowledged before failed asynchronous commit is not repeated during an explicit retry',{timeout:15000},async()=>{
 let attempts=0;const f=fixture({async commit(intent){f.events.push(intent);if(!attempts++){await Promise.resolve();throw Error('isolated async publication failure')}},async failed(){f.events.push('retry');return'retry'}})
 assert.equal(await f.close.request('quit'),true);assert.deepEqual(f.events,['stop','flush','data','quit','retry','quit','release']);assert.equal(f.events.filter(value=>value==='data').length,1);assert.equal(f.events.filter(value=>value==='flush').length,1)
})

test('AR106-A04 destroying the original renderer before a failing asynchronous commit returns false and cannot open retry/export against a disposed owner',{timeout:15000},async()=>{
 const f=fixture({async commit(intent){f.events.push(intent);f.setOwner(null);await Promise.resolve();throw Error('isolated session flush failure')}})
 assert.equal(await f.close.request('quit'),false);assert.deepEqual(f.events,['stop','flush','data','quit','release'])
})
