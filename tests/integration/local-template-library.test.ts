import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Workspaces } from "../../desktop/service/workspaces"
import { LocalTemplateLibrary } from "../../desktop/service/template-library"
import { globalPrisma } from "../../src/lib/db"
import { PROMPT_TEMPLATES } from "../../prisma/seed-templates"
import { WIZARD_TEMPLATES } from "../../src/lib/creation-wizard/templates"
import { DEFAULT_FILTERS, visibleTemplates } from "../../src/lib/creation-wizard/filter"
import { renderPrompt, invalidatePromptCache } from "../../src/lib/prompts/render"
import { extractPromptVariables } from "../../src/lib/prompts/variables"
import type { TemplateDocument } from "../../desktop/shared/template-library"

async function fixture(run: (library: LocalTemplateLibrary, works: Workspaces) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "xuanxiang-templates-tdd-")), works = new Workspaces(join(base, "app"), join(process.cwd(), "prisma/migrations"))
  try { await works.initialize(); await works.runWithGlobal("inbox", () => run(new LocalTemplateLibrary(), works)) }
  finally { invalidatePromptCache(); await works.close(); await rm(base, { recursive: true, force: true }) }
}
const custom = { key: "user.test", name: "作者提示词", content: "写 {{subject}} 与 {{foo-bar}}", enabled: true }
const document = (prompts: TemplateDocument["prompts"] = [], wizardTemplates: TemplateDocument["wizardTemplates"] = []): TemplateDocument => ({ format: "xuanxiang-local-templates", schemaVersion: 1, prompts, wizardTemplates })

test("TPL15-01 original bundled prompt and all 401 wizard templates are initialized once in the global local library", async () => fixture(async library => {
  await library.initialize(); const first = await library.list(); await library.initialize(); const second = await library.list()
  assert.equal(first.prompts.length, PROMPT_TEMPLATES.length); assert.equal(first.wizardTemplates.length, WIZARD_TEMPLATES.length)
  assert.deepEqual(second, first); assert.equal(first.prompts[0].source, "builtin")
  assert.deepEqual(first.wizardTemplates.find(row => row.template.id === WIZARD_TEMPLATES[0].id)?.template, WIZARD_TEMPLATES[0])
}))
test("TPL15-02 original prompt saves use CAS and preserve the prior version; render cache sees a saved edit immediately", async () => fixture(async library => {
  const first = await library.createPrompt(custom)
  assert.equal(await renderPrompt(first.key, {subject:"甲", "foo-bar":"乙"}), "写 甲 与 乙")
  const saved = await library.updatePrompt(first.id, first.version, { content:"新写 {{subject}} 与 {{foo-bar}}" })
  assert.equal(saved.version, 2); assert.equal(saved.source, "user")
  assert.equal(await renderPrompt(first.key, {subject:"甲", "foo-bar":"乙"}), "新写 甲 与 乙")
  const prior = await globalPrisma.contentVersion.findFirstOrThrow({where:{targetType:"PromptTemplate",targetId:first.id,version:1}})
  assert.equal((prior.snapshot as {content:string}).content,custom.content)
}))
test("TPL15-03 stale prompt version never overrides the latest draft or creates another history entry", async () => fixture(async library => {
  const first = await library.createPrompt(custom); await library.updatePrompt(first.id,1,{name:"最新名称"})
  await assert.rejects(library.updatePrompt(first.id,1,{content:"旧编辑"}),{code:"TEMPLATE_VERSION_CONFLICT"})
  assert.equal((await library.list()).prompts.find(p=>p.id===first.id)?.name,"最新名称")
  assert.equal(await globalPrisma.contentVersion.count({where:{targetId:first.id}}),1)
}))
test("TPL15-04 bundled variable contract and declared variables are validated before a write", async () => fixture(async library => {
  const before = await library.list(), builtin = before.prompts.find(p=>p.key==="chat.system")!
  await assert.rejects(library.updatePrompt(builtin.id,builtin.version,{content:"缺变量"}),{code:"TEMPLATE_VARIABLES_INVALID"})
  await assert.rejects(library.createPrompt({...custom,variables:["different"]}),{code:"TEMPLATE_VARIABLES_INVALID"})
  assert.deepEqual(await library.list(),before)
}))
test("TPL15-05 saving a user copy keeps its original separate, extracts the same variable syntax and rejects duplicate keys", async () => fixture(async library => {
  const created = await library.createPrompt({...custom,variables:extractPromptVariables(custom.content)})
  assert.equal(created.source,"user"); assert.equal(created.version,1); assert.deepEqual(created.variables,["subject","foo-bar"])
  await assert.rejects(library.createPrompt(custom),{code:"TEMPLATE_ID_CONFLICT"})
}))
test("TPL15-06 new bundled defaults replace only exact previous defaults, keep customized/disabled templates and record history", async () => fixture(async library => {
  const first=await library.list(), original=PROMPT_TEMPLATES[0], modified=PROMPT_TEMPLATES[1]
  const changed=first.prompts.find(p=>p.key===modified.key)!
  await library.updatePrompt(changed.id,changed.version,{content:changed.content+"\n作者自定义",enabled:false})
  const nextDefaults=PROMPT_TEMPLATES.map(p=>p.key===original.key?{...p,content:p.content+"\n新版默认"}:p.key===modified.key?{...p,content:p.content+"\n供应默认更新"}:p)
  await new LocalTemplateLibrary({prompts:nextDefaults,wizardTemplates:WIZARD_TEMPLATES}).initialize()
  const after=await library.list(), replaced=after.prompts.find(p=>p.key===original.key)!, kept=after.prompts.find(p=>p.key===modified.key)!
  assert.equal(replaced.content,original.content+"\n新版默认"); assert.equal(replaced.version,2)
  assert.equal(kept.content,changed.content+"\n作者自定义"); assert.equal(kept.enabled,false); assert.equal(kept.source,"customized")
  assert.equal(await globalPrisma.contentVersion.count({where:{targetId:replaced.id}}),1)
}))
test("TPL15-07 builtins are not deleted by user-copy deletion; deletion retains the user version snapshot", async () => fixture(async library => {
  const initial=await library.list(), builtin=initial.prompts[0]
  await assert.rejects(library.removePrompt(builtin.id,builtin.version),{code:"BUILTIN_TEMPLATE_PROTECTED"})
  const copy=await library.createPrompt(custom);await library.removePrompt(copy.id,copy.version)
  assert.ok(!(await library.list()).prompts.some(p=>p.id===copy.id));assert.equal(await globalPrisma.contentVersion.count({where:{targetId:copy.id}}),1)
}))
test("TPL15-08 portable exports contain only templates, versions and source; no global settings/models/credentials are exported", async () => fixture(async library => {
  await library.createPrompt(custom);await globalPrisma.systemConfig.create({data:{key:"unrelated.private",value:{apiKey:"never-export-fixture",endpoint:"https://private.invalid"}}})
  const exported=await library.export(), json=JSON.stringify(exported)
  assert.deepEqual(Object.keys(exported).sort(),["format","prompts","schemaVersion","wizardTemplates"])
  assert.doesNotMatch(json,/never-export-fixture|private\.invalid|apiKeyEncrypted|unrelated.private/)
  assert.equal(exported.wizardTemplates.length,401);assert.ok(exported.prompts.some(p=>p.key===custom.key&&p.version===1))
}))
test("TPL15-09 invalid JSON shape, credentials, duplicate IDs and missing variables reject import before changing the original library", async () => fixture(async library => {
  const before=await library.list(), row={...custom,version:1,source:"user" as const}
  for(const bad of [{...document(),apiKey:"not-a-template"},document([row,row]),document([{...row,key:"chat.system",content:"invalid",variables:[]}])])await assert.rejects(library.preview(bad),{code:"TEMPLATE_IMPORT_INVALID"})
  assert.deepEqual(await library.list(),before)
}))
test("TPL15-10 preview is read-only; conflicts default to keep unless explicit replace/copy is accepted", async () => fixture(async library => {
  const created=await library.createPrompt(custom),before=await library.list(), incoming=document([{...custom,content:"导入 {{subject}} 与 {{foo-bar}}",version:9,source:"user"}])
  const preview=await library.preview(incoming);assert.equal(preview.entries[0].conflict,true);assert.deepEqual(await library.list(),before)
  await library.apply(preview,[{kind:"prompt",id:custom.key,action:"keep"}]);assert.deepEqual(await library.list(),before)
  await library.apply(preview,[{kind:"prompt",id:custom.key,action:"copy",copyId:"user.imported"}])
  const copy=(await library.list()).prompts.find(p=>p.key==="user.imported")!;assert.equal(copy.source,"user");assert.equal(copy.version,1)
  const next=await library.preview(incoming);await library.apply(next,[{kind:"prompt",id:custom.key,action:"replace"}])
  const replacement=(await library.list()).prompts.find(p=>p.id===created.id)!;assert.equal(replacement.version,2);assert.equal(replacement.content,incoming.prompts[0].content)
}))
test("TPL15-11 import CAS blocks a stale preview without overwriting an intervening user edit", async () => fixture(async library => {
  const created=await library.createPrompt(custom),preview=await library.preview(document([{...custom,version:1,source:"user"}]))
  await library.updatePrompt(created.id,1,{name:"校验后新名称"});const after=await library.list()
  await assert.rejects(library.apply(preview,[{kind:"prompt",id:custom.key,action:"replace"}]),{code:"TEMPLATE_LIBRARY_CONFLICT"});assert.deepEqual(await library.list(),after)
}))
test("TPL15-12 cancellation during a local atomic save rolls back templates, history and library revision; retry is explicit", async () => fixture(async library => {
  const created=await library.createPrompt(custom),preview=await library.preview(document([{...custom,content:"新 {{subject}} {{foo-bar}}",version:1,source:"user"}])),before=await library.list()
  let checks=0;await assert.rejects(library.apply(preview,[{kind:"prompt",id:custom.key,action:"replace"}],()=>{if(++checks===2)throw Error("cancelled local import")}),/cancelled local import/)
  assert.deepEqual(await library.list(),before);assert.equal(await globalPrisma.contentVersion.count({where:{targetId:created.id}}),0)
  await library.apply(preview,[{kind:"prompt",id:custom.key,action:"replace"}]);assert.equal((await library.list()).prompts.find(p=>p.id===created.id)?.version,2)
}))
test("TPL15-13 local wizard copies retain original filter semantics and prompt data; disabling removes them from active consumption", async () => fixture(async library => {
  const template={...WIZARD_TEMPLATES[0],id:"user-wizard",title:"作者创作卡",prompt:"我的主题草稿"}
  const row=await library.saveWizard({template,enabled:true});assert.equal(row.source,"user");assert.equal(row.version,1)
  const corpus=(await library.list()).wizardTemplates.filter(p=>p.enabled).map(p=>p.template)
  assert.ok(visibleTemplates(template.cat,{...DEFAULT_FILTERS,channel:"男频"},corpus).some(p=>p.id===template.id))
  assert.ok(!visibleTemplates(template.cat,{...DEFAULT_FILTERS,channel:"女频"},corpus).some(p=>p.id===template.id))
  await library.saveWizard({template,enabled:false},1);assert.equal((await library.list()).wizardTemplates.find(p=>p.template.id===template.id)?.version,2)
  assert.ok(!(await library.list()).wizardTemplates.filter(p=>p.enabled).some(p=>p.template.id===template.id))
  assert.equal(await globalPrisma.contentVersion.count({where:{targetType:"WizardTemplate",targetId:template.id}}),1)
}))
test("TPL15-14 wizard default upgrade protects customized content and old versions while untouched defaults advance", async () => fixture(async library => {
  await library.initialize();const a=WIZARD_TEMPLATES[0],b=WIZARD_TEMPLATES[1]
  await library.saveWizard({template:{...b,prompt:"作者保留的卡片"},enabled:true},1)
  const next=WIZARD_TEMPLATES.map(t=>t.id===a.id?{...t,prompt:t.prompt+"新版"}:t.id===b.id?{...t,prompt:t.prompt+"替换"}:t)
  await new LocalTemplateLibrary({prompts:PROMPT_TEMPLATES,wizardTemplates:next}).initialize()
  const after=await new LocalTemplateLibrary({prompts:PROMPT_TEMPLATES,wizardTemplates:next}).list()
  assert.equal(after.wizardTemplates.find(p=>p.template.id===a.id)?.version,2)
  assert.equal(after.wizardTemplates.find(p=>p.template.id===b.id)?.template.prompt,"作者保留的卡片")
  assert.equal(after.wizardTemplates.find(p=>p.template.id===b.id)?.source,"customized")
}))
test("TPL15-15 all import rows require explicit choices and copy IDs are validated before an atomic batch", async () => fixture(async library => {
  const created=await library.createPrompt(custom),before=await library.list(),preview=await library.preview(document([{...custom,version:1,source:"user"}], [{template:{...WIZARD_TEMPLATES[0],id:"user-mixed"},enabled:true,version:1,source:"user"}]))
  await assert.rejects(library.apply(preview,[{kind:"prompt",id:custom.key,action:"replace"}]),{code:"TEMPLATE_IMPORT_CHOICES_INVALID"})
  await assert.rejects(library.apply(preview,[{kind:"prompt",id:custom.key,action:"copy",copyId:"chat.system"},{kind:"wizard",id:"user-mixed",action:"add"}]),{code:"TEMPLATE_ID_CONFLICT"})
  assert.deepEqual(await library.list(),before);assert.equal(await globalPrisma.contentVersion.count({where:{targetId:created.id}}),0)
}))

test("TPL15-16 rendering accepts only owned strings, including empty strings, and never inherited or coerced runtime values", async () => fixture(async library => {
  await library.createPrompt({key:"user.owned-value",name:"变量边界",content:"前{{value}}后"})
  await assert.rejects(renderPrompt("user.owned-value",Object.create({value:"继承文本"})),/缺少变量：value/)
  for(const value of [null,42,{toString:()=>"不应隐式转换"}]){
    await assert.rejects(renderPrompt("user.owned-value",{value} as unknown as Record<string,string>),/缺少变量：value/)
  }
  assert.equal(await renderPrompt("user.owned-value",{value:""}),"前后")
  assert.equal(await renderPrompt("user.owned-value",Object.assign(Object.create(null),{value:"自有文本"})),"前自有文本后")
}))
