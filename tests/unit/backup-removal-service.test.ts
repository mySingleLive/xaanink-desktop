import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,mkdir,readFile,writeFile,readdir,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID,createHash} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {PGlite} from '@electric-sql/pglite'
import {Workspaces} from '../../desktop/service/workspaces'
import {directoryIdentity} from '../../desktop/core/root-ownership'

const migrations=join(process.cwd(),'prisma/migrations')
async function fixture(){const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-backup-removal-service-'))),root=join(base,'app'),works=new Workspaces(root,migrations);await works.initialize();console.log('Retained service removal fixture:',base);return{base,root,works}}
function actualRpc(){
 const syntax=ts.createSourceFile('index.ts',readFileSync('desktop/service/index.ts','utf8'),ts.ScriptTarget.Latest,true);let callback=''
 const scan=(node:ts.Node)=>{if(ts.isNewExpression(node)&&node.expression.getText(syntax)==='RpcPeer')callback=node.arguments![1].getText(syntax);ts.forEachChild(node,scan)};scan(syntax);assert(callback)
 const events:string[]=[],works={close:async()=>{events.push('close')},protectedDirectories:async()=>['/work']}
 class RemovedControl{async handle(){events.push('removed-backup-command');return{type:'removed-command-was-called'}}}
 const dependencies={ready:Promise.resolve(),works,responses:new Map(),starting:new Map(),pendingStarts:new Set(),localAttemptCount:()=>0,cancel:async()=>{},closedWorkLeaseTarget:async(_works:unknown,_data:unknown,guard:()=>void)=>{guard();return'closed-target'},WorkBackupControl:RemovedControl,ApplicationBackupControl:RemovedControl}
 const factory=new Function(...Object.keys(dependencies),transformSync(`let closing=false,closedForMaintenance=false;return ${callback}`,{loader:'ts'}).code)
 return{events,run:factory(...Object.values(dependencies)) as (method:string,input?:unknown)=>Promise<unknown>}
}

test('BR-S01 actual worker rejects both canceled backup RPCs without invoking a control or invalidating normal closed-work evidence',async()=>{
 const f=actualRpc();assert.equal(await f.run('ready'),true);assert.equal(await f.run('close'),true)
 for(const method of ['work-backup','application-backup'])await assert.rejects(f.run(method,{type:'list'}),/未知本地服务命令/)
 assert.deepEqual(f.events,['close']);assert.equal(await f.run('closed-work-lease-target','work'),'closed-target');assert.deepEqual(await f.run('protected-directories'),['/work'])
})
test('BR-S02 actual Workspaces has no callable backup/restore business methods or per-work backup cache',async()=>{
 const f=await fixture();try{for(const name of ['applicationBackups','backupStore','backups','readBackup','backup','prepareRestore','cancelRestore','activateRestore'])assert.equal(typeof (f.works as unknown as Record<string,unknown>)[name],'undefined',name);assert.equal('backupStores' in f.works,false)}finally{await f.works.close()}
})
test('BR-S03 actual create and open reject application root, inbox and managed descendants before manifest, catalog or engine writes',async()=>{
 for(const action of ['create','open'] as const)for(const relative of ['inbox/new-work','', 'backups/application/new-work','session/new-work']){
  const f=await fixture(),path=join(f.root,relative);await mkdir(path,{recursive:true});const before=await readdir(path),catalog=await readFile(join(f.root,'catalog.json')),events:string[]=[]
  ;(f.works as unknown as {connect:()=>Promise<never>}).connect=async()=>{events.push('engine');throw Error('NO_TEST_ENGINE')}
  try{const proof=await directoryIdentity(path),result=action==='create'?f.works.create(proof,{title:'不能嵌入受管区域',requestId:'removed-feature-boundary'}):f.works.open(proof);await assert.rejects(result,/WORKSPACE_APP_NAMESPACE_OVERLAP|APPLICATION_BACKUP_WORK_NAMESPACE_OVERLAP/);assert.deepEqual(events,[]);assert.deepEqual(await readdir(path),before);assert.deepEqual(await readFile(join(f.root,'catalog.json')),catalog)}finally{await f.works.close()}
 }
})
test('BR-S04 normal initialize/close preserves existing legacy backup, snapshot and control bytes without cleanup or creating a fresh backup directory',async()=>{
 const f=await fixture(),old=join(f.root,'backups/application/packages/old');await mkdir(old,{recursive:true});await writeFile(join(old,'author-backup.bin'),'previous backup bytes');await mkdir(join(f.root,'inbox/snapshots'));await writeFile(join(f.root,'inbox/snapshots/previous.tar.gz'),'previous snapshot bytes')
 const controls=join(f.root,'application-restore-drafts.json');await writeFile(controls,'old retained inert draft bytes');await f.works.close();const fresh=new Workspaces(f.root,migrations)
 try{await fresh.initialize();await fresh.close();assert.equal(await readFile(join(old,'author-backup.bin'),'utf8'),'previous backup bytes');assert.equal(await readFile(join(f.root,'inbox/snapshots/previous.tar.gz'),'utf8'),'previous snapshot bytes');assert.equal(await readFile(controls,'utf8'),'old retained inert draft bytes');const another=await fixture();try{await assert.rejects(readFile(join(another.root,'backups/anything')),{code:'ENOENT'});assert.equal((await readdir(another.root)).includes('backups'),false)}finally{await another.works.close()}}finally{await fresh.close()}
})
test('BR-S05 existing active WorkStorage candidate is still the actual read target; missing selected generation never falls back to the old original',async()=>{
 const f=await fixture(),path=join(f.base,'work'),id=randomUUID(),candidateId=randomUUID(),candidate=join(path,'.xuanxiang-restores',candidateId);await mkdir(candidate,{recursive:true});await writeFile(join(path,'xuanxiang-work.json'),JSON.stringify({schemaVersion:1,id,phase:'ready',novelId:'novel',title:'既有作品',requestId:'legacy-work',requestHash:'legacy-hash',createdAt:new Date().toISOString()}));await writeFile(join(path,'xuanxiang-storage-required.json'),JSON.stringify({schemaVersion:1,workId:id,required:true}))
 const directory=await directoryIdentity(candidate),state={schemaVersion:1,workId:id,revision:2,active:{kind:'candidate',id:candidateId,directory},previous:{active:{kind:'original'},backupId:randomUUID()}}
 const pointer=JSON.stringify({state,sha256:createHash('sha256').update(JSON.stringify(state)).digest('hex')});await writeFile(join(path,'xuanxiang-storage.json'),pointer)
 const internal=f.works as unknown as {dataPath:(path:string)=>Promise<string>};try{assert.equal(await internal.dataPath(path),candidate);assert.equal(await readFile(join(path,'xuanxiang-storage.json'),'utf8'),pointer);const replaced={...state,active:{...state.active,directory:{...directory,inode:String(BigInt(directory.inode)+1n)}}};await writeFile(join(path,'xuanxiang-storage.json'),JSON.stringify({state:replaced,sha256:createHash('sha256').update(JSON.stringify(replaced)).digest('hex')}));await assert.rejects(internal.dataPath(path));assert.equal(await readFile(join(path,'xuanxiang-work.json'),'utf8').then(Boolean),true)}finally{await f.works.close()}
})
test('BR-S06 actual connect delegates schema migration transaction and rollback without dumpDataDir or before-upgrade files (SQL protocol double, no PG)',async context=>{
 for(const failure of [false,true]){
  const f=await fixture(),path=join(f.root,'inbox'),database=join(path,'database'),events:string[]=[];await mkdir(database);await writeFile(join(database,'PG_VERSION'),'protocol fixture, not a health claim')
  const engine={closed:false,dumpDataDir:async()=>{events.push('dump');return new Blob(['old generated backup'])},query:async(sql:string)=>({rows:sql.includes('to_regclass')?[{table:'_desktop_migrations'}]:sql.includes('server_version')?[{version:'17.0'}]:[]}),transaction:async(run:(tx:unknown)=>Promise<unknown>)=>{events.push('begin');try{const result=await run({exec:async()=>{},query:async(sql:string)=>{if(sql==='SELECT 1'&&failure)throw Error('TEST_SCHEMA_FAILURE');if(sql==='SELECT 1')events.push('schema');return{rows:[]}}});events.push('commit');return result}catch(error){events.push('rollback');throw error}},close:async()=>{engine.closed=true;events.push('close')}}
  const mock=context.mock.method(PGlite,'create',async()=>engine as unknown as PGlite),sql='SELECT 1',internal=f.works as unknown as {migrations:Array<{id:string;sql:string;checksum:string}>;connect:(path:string,create:boolean)=>Promise<{db:{$disconnect:()=>Promise<void>};engine:PGlite;unlock:()=>Promise<void>}>}
  internal.migrations=[{id:'removal-schema',sql,checksum:createHash('sha256').update(sql).digest('hex')}]
  try{if(failure)await assert.rejects(internal.connect(path,false),/TEST_SCHEMA_FAILURE/);else{const connection=await internal.connect(path,false);await connection.db.$disconnect();await connection.engine.close();await connection.unlock()}
   assert.equal(events.filter(row=>row==='dump').length,0);assert.equal(events.includes(failure?'rollback':'commit'),true);assert.equal(events.includes(failure?'commit':'rollback'),false);assert.equal((await readdir(path)).includes('snapshots'),false);assert.equal(engine.closed,true);await assert.rejects(readFile(join(path,'.xaanink-lock/owner.json')),{code:'ENOENT'})
  }finally{mock.mock.restore();await f.works.close()}
 }
})
test('BR-S07 actual new-work resource preparation creates assets only, without backup or snapshot directories (reservation/engine boundary doubles)',async()=>{
 const f=await fixture(),path=join(f.base,'new-work');await mkdir(path);const events:string[]=[]
 const internal=f.works as unknown as {creationReservations:{reserve:()=>Promise<void>;complete:()=>Promise<void>};connect:()=>Promise<never>}
 internal.creationReservations={reserve:async()=>{events.push('reserve')},complete:async()=>{events.push('complete')}}
 internal.connect=async()=>{events.push('engine-boundary');throw Error('NO_TEST_ENGINE_AFTER_RESOURCE_CREATION')}
 try{await assert.rejects(f.works.create(await directoryIdentity(path),{title:'正常资源目录',requestId:'no-backup-resource-creation'}),/NO_TEST_ENGINE_AFTER_RESOURCE_CREATION/);assert.equal((await readdir(path)).includes('assets'),true);assert.equal((await readdir(path)).includes('backups'),false);assert.equal((await readdir(path)).includes('snapshots'),false);assert.deepEqual(events,['reserve','engine-boundary']);assert.equal((await f.works.list()).length,0)}finally{await f.works.close()}
})
