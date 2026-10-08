import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Worker} from 'node:worker_threads'
import {writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {once} from 'node:events'
import {build} from 'esbuild'
import {entryFixture,executingEntry} from '../fixtures/application-restore-entry'
test('ENTRY36-T01 actual Node worker receives private executing context, settles malformed-package failure and physically exits with zero engines',{timeout:20000},async()=>{
 const f=await entryFixture()
 try{
  const actual=await executingEntry(f),before=await readFile(join(f.boot,'data-root.json')),bundle=await build({entryPoints:['desktop/service/application-restore-worker.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false}),path=join(f.root,'cold-worker.cjs')
  // Instrument only this isolated bundle. No PG may be opened in this run;
  // the selected receipt deliberately has no data directory.
  const instrumentation=`const projectRequire=require('node:module').createRequire(${JSON.stringify(join(process.cwd(),'package.json'))});let engineCreates=0;require=id=>{const value=projectRequire(id);if(id==='@electric-sql/pglite')value.PGlite.create=async()=>{engineCreates++;throw Object.assign(Error('unexpected engine'),{code:'TEST_ENGINE_FORBIDDEN'})};return value};const testPort=projectRequire('node:worker_threads').parentPort,send=testPort.postMessage.bind(testPort);testPort.postMessage=value=>send({...value,testEngineCreates:engineCreates});\n`
  await writeFile(path,instrumentation+bundle.outputFiles[0].text)
  const worker=new Worker(path,{workerData:{kind:'application-restore36',request:actual.request,layout:actual.layout,migrationsPath:'/unused',revocation:new SharedArrayBuffer(4)}}),exited=once(worker,'exit'),messages:Record<string,unknown>[]=[]
  worker.on('message',value=>messages.push(value));const[code]=await exited;assert.equal(code,0);assert.equal(messages.at(-1)?.type,'failed');assert.equal(messages.at(-1)?.testEngineCreates,0);assert.equal(messages.some(row=>row.type==='complete'),false)
  assert.deepEqual(await readFile(join(f.boot,'data-root.json')),before);assert.equal(actual.manager.inspect().request?.phase,'executing');await actual.manager.cancelExecution(actual.handle)
 }finally{await f.close()}
})
