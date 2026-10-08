import assert from 'node:assert/strict'
import {test} from 'node:test'
import fs,{mkdtemp,mkdir,readFile,writeFile,rename,realpath,readdir,rm} from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {FileExports,type FileExportOptions} from '../../desktop/main/file-export'
import {guardFileExportTarget} from '../../desktop/main/file-export-target'

function request(text='作者真实导出字节'){return{id:randomUUID(),format:'md' as const,filename:'正文.md',bytes:new TextEncoder().encode(text)}}
async function fixture(run:(base:string)=>Promise<void>){const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-export-review83-')));try{await run(base)}finally{await rm(base,{recursive:true,force:true})}}
function options(target:string):FileExportOptions{return{assertOwner:()=>{},chooseSave:async()=>target,guardTarget:target=>guardFileExportTarget(target,{dataRoots:[],workRoots:[]})}}

test('EXP83-01 replacing the selected parent while final owned bytes are read must not ACK that different directory',async t=>fixture(async base=>{
 const selected=join(base,'selected'),old=join(base,'old-parent');await mkdir(selected);const target=join(selected,'正文.md'),originalOpen=fs.open;let replaced=false
 t.mock.method(fs,'open',async(...args:Parameters<typeof fs.open>)=>{
  if(args[0]===target&&!replaced){replaced=true;await rename(selected,old);await mkdir(selected);await rename(join(old,'正文.md'),target)}
  return originalOpen(...args)
 });syncBuiltinESMExports()
 try{
  const source=request(),result=await new FileExports(options(target)).save('owner:nonce',source)
  assert.equal(replaced,true);assert.deepEqual(new Uint8Array(await readFile(target)),source.bytes)
  assert.deepEqual(result,{id:source.id,status:'failed',code:'EXPORT_DURABILITY_UNCONFIRMED'})
 }finally{t.mock.restoreAll();syncBuiltinESMExports()}
}))

test('EXP83-02 a same-byte foreign replacement of the previously selected existing document is not overwritten',()=>fixture(async base=>{
 const target=join(base,'正文.md'),foreign=join(base,'foreign.md');await writeFile(target,'原稿')
 const service=new FileExports({...options(target),beforeRename:async()=>{await rename(target,foreign);await writeFile(target,'原稿')}}),source=request('导出草稿'),result=await service.save('owner',source)
 assert.deepEqual(result,{id:source.id,status:'failed',code:'EXPORT_TARGET_CHANGED'});assert.equal(await readFile(target,'utf8'),'原稿');assert.equal(await readFile(foreign,'utf8'),'原稿');assert.deepEqual((await readdir(base)).sort(),['foreign.md','正文.md'])
}))

test('EXP83-03 cancel after committed rename cannot release flush before physical directory-sync work has settled',()=>fixture(async base=>{
 const target=join(base,'正文.md'),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),source=request();let flushed=false
 const service=new FileExports({...options(target),beforeDirectorySync:async()=>{entered.resolve();await release.promise}}),saving=service.save('8:nonce',source)
 try{await entered.promise;service.cancelWindow('8:');const flush=service.flush().then(()=>{flushed=true});await new Promise(setImmediate);assert.equal(flushed,false);assert.deepEqual(new Uint8Array(await readFile(target)),source.bytes);release.resolve();const result=await saving;await flush;assert.deepEqual(result,{id:source.id,status:'failed',code:'EXPORT_DURABILITY_UNCONFIRMED'});assert.equal(flushed,true)}finally{release.resolve();await saving;await service.flush()}
}))
