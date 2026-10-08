import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspaces } from '../../desktop/service/workspaces'
import { LocalTemplateLibrary } from '../../desktop/service/template-library'
import { LocalDispatcher } from '../../desktop/service/dispatcher'
import { globalPrisma } from '../../src/lib/db'
import { renderPrompt, invalidatePromptCache } from '../../src/lib/prompts/render'
import { PROMPT_TEMPLATES } from '../../prisma/seed-templates'
import { WIZARD_TEMPLATES } from '../../src/lib/creation-wizard/templates'
import { randomUUID } from 'node:crypto'
import type { TemplateDocument } from '../../desktop/shared/template-library'

async function fixture(run:(library:LocalTemplateLibrary,works:Workspaces)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'xuanxiang-template-review-')),works=new Workspaces(join(root,'data'),join(process.cwd(),'prisma/migrations'))
  try{await works.initialize();await works.runWithGlobal('inbox',()=>run(new LocalTemplateLibrary(),works))}
  finally{invalidatePromptCache();await works.close();await rm(root,{recursive:true,force:true})}
}

test('TPL79-01: prototype names are missing variables unless explicitly supplied as own string values',async()=>fixture(async library=>{
  await library.createPrompt({key:'user.prototype',name:'合法变量',content:'{{toString}} {{constructor}} {{__proto__}}'})
  await assert.rejects(renderPrompt('user.prototype'),/缺少变量/)
  const values:Record<string,string>=Object.fromEntries([['toString','方法'],['constructor','构造'],['__proto__','原型']])
  assert.equal(await renderPrompt('user.prototype',values),'方法 构造 原型')
}))

test('TPL79-02: an invalid last copy collision rolls back earlier replacements, insertions, history and revision in one actual database transaction',async()=>fixture(async library=>{
  const current=await library.createPrompt({key:'user.original',name:'原稿',content:'原始文本'})
  await library.saveWizard({template:{...WIZARD_TEMPLATES[0],id:'user.existing'},enabled:true})
  const before=await library.list(),histories=await globalPrisma.contentVersion.count()
  const document:TemplateDocument={format:'xuanxiang-local-templates',schemaVersion:1,prompts:[{key:current.key,name:'替换',content:'新文本',version:900,source:'builtin',enabled:true},{key:'user.new',name:'新行',content:'新内容',version:900,source:'builtin',enabled:true}],wizardTemplates:[{template:{...WIZARD_TEMPLATES[0],id:'user.incoming'},version:900,source:'builtin',enabled:true}]}
  const preview=await library.preview(document)
  await assert.rejects(library.apply(preview,[{kind:'prompt',id:current.key,action:'replace'},{kind:'prompt',id:'user.new',action:'add'},{kind:'wizard',id:'user.incoming',action:'copy',copyId:'user.existing'}]),{code:'TEMPLATE_ID_CONFLICT'})
  assert.deepEqual(await library.list(),before);assert.equal(await globalPrisma.contentVersion.count(),histories)
  await library.apply(preview,[{kind:'prompt',id:current.key,action:'replace'},{kind:'prompt',id:'user.new',action:'add'},{kind:'wizard',id:'user.incoming',action:'copy',copyId:'user.actual-copy'}])
  const after=await library.list()
  assert.equal(after.prompts.find(p=>p.key==='user.new')?.source,'user');assert.equal(after.prompts.find(p=>p.key===current.key)?.version,2)
  assert.equal(after.wizardTemplates.find(p=>p.template.id==='user.actual-copy')?.version,1)
}))

test('TPL79-03: pre-metadata legacy defaults and disabled edits are inferred without overwriting user text on repeated seed',async()=>fixture(async _library=>{
  const pristine=PROMPT_TEMPLATES[0],modified=PROMPT_TEMPLATES[1]
  await globalPrisma.promptTemplate.create({data:{...pristine,enabled:true}})
  await globalPrisma.promptTemplate.create({data:{...modified,content:modified.content+'\n本地作者旧稿',enabled:false,version:7}})
  const library=new LocalTemplateLibrary();await library.initialize();await library.initialize()
  const rows=(await library.list()).prompts
  assert.equal(rows.find(p=>p.key===pristine.key)?.source,'builtin')
  const kept=rows.find(p=>p.key===modified.key)!
  assert.equal(kept.content,modified.content+'\n本地作者旧稿');assert.equal(kept.enabled,false);assert.equal(kept.version,7);assert.equal(kept.source,'customized')
}))

test('TPL79-04: renderer-like request without trusted database identity cannot read or mutate templates',async()=>{
  const root=await mkdtemp(join(tmpdir(),'xuanxiang-template-no-context-')),works=new Workspaces(join(root,'data'),join(process.cwd(),'prisma/migrations'))
  try{
    await works.initialize();const dispatcher=new LocalDispatcher(works)
    const response=await dispatcher.handle({version:1,id:randomUUID(),path:'/api/templates/export',method:'GET',headers:{}},new AbortController().signal)
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'无权限访问'})
  }finally{await works.close();await rm(root,{recursive:true,force:true})}
})

test('TPL79-05: an unknown local template GET remains a safe404, without demanding a JSON body from a read-only request',async()=>fixture(async(_library,works)=>{
  const response=await new LocalDispatcher(works).handle({version:1,id:randomUUID(),path:'/api/templates/not-a-command',method:'GET',headers:{}},new AbortController().signal)
  assert.equal(response.status,404)
  const body=await response.json();assert.deepEqual(body,{error:'本地模板命令不存在'})
}))
