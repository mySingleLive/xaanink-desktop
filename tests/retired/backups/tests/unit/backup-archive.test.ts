import assert from 'node:assert/strict'
import {test} from 'node:test'
import {gzipSync} from 'node:zlib'
import {validateEngineArchive} from '../../desktop/service/database/backup-archive'
function tar(name:string,type='0',data=Buffer.from('18\n')){
 const head=Buffer.alloc(512);head.write(name);head.write('0000600\0',100);head.write('0000000\0',108);head.write('0000000\0',116);head.write(data.length.toString(8).padStart(11,'0')+'\0',124);head.fill(32,148,156);head.write(type,156);head.write('ustar\0',257);head.write('00',263)
 const sum=head.reduce((a,b)=>a+b,0);head.write(sum.toString(8).padStart(6,'0')+'\0 ',148)
 return Buffer.concat([head,data,Buffer.alloc((512-data.length%512)%512),Buffer.alloc(1024)])
}
test('archive preflight accepts a bounded PGlite-style gzip tar with matching PostgreSQL major',async()=>{
 const input=gzipSync(tar('/PG_VERSION'));const bytes=await validateEngineArchive(input,18);assert.deepEqual(bytes,tar('/PG_VERSION'))
})
test('archive preflight rejects traversal, links, duplicate names, forged size/checksum, wrong version and trailing payload',async()=>{
 for(const path of ['/../outside','/base/../../outside','//PG_VERSION','C:/PG_VERSION','/base\\outside'])await assert.rejects(validateEngineArchive(gzipSync(tar(path)),18))
 for(const type of ['1','2','3','4','x','L'])await assert.rejects(validateEngineArchive(gzipSync(tar('/PG_VERSION',type)),18))
 const duplicate=Buffer.concat([tar('/PG_VERSION').subarray(0,1024),tar('/PG_VERSION')]);await assert.rejects(validateEngineArchive(gzipSync(duplicate),18))
 const checksum=tar('/PG_VERSION');checksum[20]^=1;await assert.rejects(validateEngineArchive(gzipSync(checksum),18))
 await assert.rejects(validateEngineArchive(gzipSync(tar('/PG_VERSION','0',Buffer.from('19\n'))),18))
 await assert.rejects(validateEngineArchive(gzipSync(Buffer.concat([tar('/PG_VERSION'),Buffer.from('trailing')])),18))
 await assert.rejects(validateEngineArchive(Buffer.from('not gzip'),18))
})
