import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,readFileSync,symlinkSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {assertNoLegacyBackupRecovery} from '../../desktop/main/legacy-recovery-preflight'
import {rootMaintenanceRequired} from '../../desktop/main/root-maintenance-preflight'
async function fixture(){
 const base=realpathSync(mkdtempSync(join(tmpdir(),'xuanxiang-backup-removal-'))),boot=join(base,'bootstrap'),root=join(base,'data')
 mkdirSync(boot);mkdirSync(root)
 const identity=await directoryIdentity(root)
 writeFileSync(join(boot,'data-root.json'),JSON.stringify({schemaVersion:1,revision:1,rootId:randomUUID(),migrationId:null,root:identity})+'\n')
 return{base,boot,root}
}
test('no legacy record and completed work barrier permit ordinary startup without writes',async()=>{
 const f=await fixture(),path=join(f.root,'restore-draft-barrier.json')
 assertNoLegacyBackupRecovery(f.boot,()=>{})
 writeFileSync(path,JSON.stringify({schemaVersion:1,revision:2,active:null})+'\n')
 const before=readFileSync(path);assertNoLegacyBackupRecovery(f.boot,()=>{})
 assert.deepEqual(readFileSync(path),before);assert.deepEqual(readdirSync(f.root),['restore-draft-barrier.json'])
})
test('pending legacy work restore fails closed before engines, preserving exact files',async()=>{
 const f=await fixture(),path=join(f.root,'restore-draft-barrier.json')
 writeFileSync(path,JSON.stringify({schemaVersion:1,revision:1,active:{token:randomUUID(),workId:randomUUID(),candidateId:randomUUID(),createdAt:new Date().toISOString(),outcome:{status:'pending'}}}))
 const before=readFileSync(path)
 assert.throws(()=>assertNoLegacyBackupRecovery(f.boot,()=>{}),/LEGACY_BACKUP_RECOVERY_PENDING/)
 assert.deepEqual(readFileSync(path),before);assert.deepEqual(readdirSync(f.root),['restore-draft-barrier.json'])
})
test('malformed and symlink legacy controls never get acknowledged, deleted or rewritten',async()=>{
 const f=await fixture(),path=join(f.root,'restore-draft-barrier.json')
 writeFileSync(path,'not-json');const before=readFileSync(path)
 assert.throws(()=>assertNoLegacyBackupRecovery(f.boot,()=>{}),/LEGACY_BACKUP_RECOVERY/);assert.deepEqual(readFileSync(path),before)
 const other=await fixture();symlinkSync(path,join(other.root,'restore-draft-barrier.json'))
 assert.throws(()=>assertNoLegacyBackupRecovery(other.boot,()=>{}),/LEGACY_BACKUP_RECOVERY/);assert.deepEqual(readFileSync(path),before)
})
test('unrecognized app recovery control is held without automatic execution',async()=>{
 const f=await fixture(),path=join(f.boot,'application-recovery-request.json');writeFileSync(path,'{}')
 const before=readFileSync(path);assert.throws(()=>assertNoLegacyBackupRecovery(f.boot,()=>{}),/LEGACY_BACKUP_RECOVERY/);assert.deepEqual(readFileSync(path),before)
})
test('ordinary migration triage retains authority over its own pending or invalid journal',async()=>{
 const f=await fixture(),path=join(f.boot,'root-migration.json');writeFileSync(path,'{}')
 writeFileSync(join(f.boot,'root-migration-request.json'),'{}')
 const before=readFileSync(path)
 assert.equal(rootMaintenanceRequired(f.boot),true)
 assert.doesNotThrow(()=>assertNoLegacyBackupRecovery(f.boot,()=>{}))
 assert.deepEqual(readFileSync(path),before)
})
