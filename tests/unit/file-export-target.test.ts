import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,writeFile,symlink,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {guardFileExportTarget} from '../../desktop/main/file-export-target'
async function fixture(run:(p:{base:string;app:string;bootstrap:string;work:string;outside:string})=>Promise<void>){const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-export-target-'))),p={base,app:join(base,'app'),bootstrap:join(base,'bootstrap'),work:join(base,'work'),outside:join(base,'outside')};try{for(const path of [p.app,p.bootstrap,p.work,p.outside])await mkdir(path);await run(p)}finally{await rm(base,{recursive:true,force:true})}}
test('manuscripts may be exported within a work but never overwrite application, manifest, lock, database, backup or candidate internals',()=>fixture(async p=>{
 const roots={dataRoots:[p.app,p.bootstrap],workRoots:[p.work]}
 for(const target of [join(p.outside,'正文.md'),join(p.work,'全文.docx'),join(p.base,'application-neighbor.pdf')])await guardFileExportTarget(target,roots)
 for(const name of ['xuanxiang-work.json','XUANXIANG-STORAGE.JSON','xuanxiang-storage-required.json','database/value.md','assets/cover.txt','backups/value.json','snapshots/receipt.json','.xuanxiang-lock/owner.json','.xuanxiang-restores/id/value.json','.xuanxiang-preserved/id/value.json']){await mkdir(join(p.work,name,'..'),{recursive:true});await assert.rejects(guardFileExportTarget(join(p.work,name),roots))}
 for(const root of [p.app,p.bootstrap])await assert.rejects(guardFileExportTarget(join(root,'普通名字.md'),roots))
}))
test('directory aliases and unregistered work/application markers cannot bypass protected data boundaries',()=>fixture(async p=>{
 const alias=join(p.base,'alias');await symlink(p.app,alias);await assert.rejects(guardFileExportTarget(join(alias,'state.json'),{dataRoots:[p.app],workRoots:[]}))
 await writeFile(join(p.work,'xuanxiang-work.json'),'broken marker still protects data');await mkdir(join(p.work,'database'));await assert.rejects(guardFileExportTarget(join(p.work,'database','doc.txt'),{dataRoots:[],workRoots:[]}));await guardFileExportTarget(join(p.work,'自己的正文.md'),{dataRoots:[],workRoots:[]})
 await writeFile(join(p.app,'xuanxiang-app.json'),'broken marker still protects data');await assert.rejects(guardFileExportTarget(join(p.app,'any.json'),{dataRoots:[],workRoots:[]}))
}))
test('unknown permission or canonicalization failures cannot silently allow a save; missing registered work roots still preserve normal neighboring exports',()=>fixture(async p=>{
 await assert.rejects(guardFileExportTarget('relative.md',{dataRoots:[],workRoots:[]}))
 await assert.rejects(guardFileExportTarget(join(p.base,'missing','file.txt'),{dataRoots:[],workRoots:[]}))
 await guardFileExportTarget(join(p.outside,'document.md'),{dataRoots:[join(p.base,'gone-root')],workRoots:[join(p.base,'gone-work')]})
}))
