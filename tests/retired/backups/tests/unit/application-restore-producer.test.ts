import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,realpath,mkdir,writeFile,readdir,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {reSealApplicationRestoreWithProof,type PreparedApplicationRestoreProof} from '../../desktop/service/database/application-restore'
import {prepareApplicationDraftRetention} from '../../desktop/core/application-restore-drafts'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {allowedManagedFile} from '../../desktop/core/root-ownership'
import {ownedRootFile} from '../../desktop/core/root-inventory-paths'
async function fixture(){const root=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-application-producer35-'))),candidateId=randomUUID(),appId=randomUUID(),path=join(root,candidateId);await mkdir(path);await writeFile(join(path,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}));await writeFile(join(path,'unrelated.txt'),'never claim or delete this');const directory=await directoryIdentity(path),drafts=await prepareApplicationDraftRetention({appId,operationId:randomUUID(),candidateId,current:null,backup:directory},()=>{}),raw:PreparedApplicationRestoreProof={candidate:{format:'xuanxiang-application-candidate',schemaVersion:1,id:candidateId,appId,backupId:randomUUID(),backupChecksum:'0'.repeat(64),createdAt:'2026-10-08T00:00:00.000Z',phase:'ready',directory,engine:{pglite:'0.5.8',postgresMajor:17},migrations:[],files:[],directories:[],checksum:'0'.repeat(64)},tree:{files:[],directories:[]}};return{root,path,raw,drafts,close:()=>rm(root,{recursive:true,force:true})}}
// Provenance refusal uses actual producer entry and filesystem, with an engine
// trap to prove it rejects before any candidate DB open. No health PASS here.
for(const variant of['raw','serialized-clone','foreign-prototype'])test(`AP35 ${variant} cannot masquerade as a producer-issued candidate or mutate a native-selected directory`,async t=>{
 const f=await fixture();let opened=0;try{t.mock.method(PGlite,'create',async()=>{opened++;throw Error('must not open fabricated candidate')});const raw=variant==='serialized-clone'?JSON.parse(JSON.stringify(f.raw)):variant==='foreign-prototype'?Object.assign(Object.create({producer:true}),f.raw):f.raw;await assert.rejects(reSealApplicationRestoreWithProof(raw,f.drafts),cause=>cause instanceof Error&&cause.message==='APPLICATION_RESTORE_PROOF_INVALID'&&!Object.hasOwn(cause,'cause'));assert.equal(opened,0);assert.deepEqual(await readdir(f.path),['unrelated.txt','xuanxiang-app.json']);assert.equal(await readFile(join(f.path,'unrelated.txt'),'utf8'),'never claim or delete this')}finally{await f.close()}
})
test('AP35 exact application draft artifact belongs to closed application inventory while adjacent foreign names remain unowned',()=>{
 for(const accepts of [allowedManagedFile,ownedRootFile]){assert.equal(accepts('application-restore-drafts.json'),true);for(const path of['application-restore-drafts.json.old','application-restore-drafts-other.json','application-restore-drafts.json/foreign','foreign/application-restore-drafts.json'])assert.equal(accepts(path),false)}
})
