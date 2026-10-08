import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, realpath, rm, lstat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { Workspaces } from "../../desktop/service/workspaces"
import { LocalDispatcher } from "../../desktop/service/dispatcher"
import { LocalTemplateLibrary } from "../../desktop/service/template-library"
import { globalPrisma, prisma } from "../../src/lib/db"
import { WIZARD_TEMPLATES } from "../../src/lib/creation-wizard/templates"
import type { LocalRequest } from "../../desktop/shared/ipc"

async function fixture(run:(library:LocalTemplateLibrary,dispatcher:LocalDispatcher,works:Workspaces,base:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-template-dispatch-tdd-")),works=new Workspaces(join(root,"app"),join(process.cwd(),"prisma/migrations"))
 try{await works.initialize();await works.runWithGlobal("inbox",async()=>{const library=new LocalTemplateLibrary();await library.initialize();await run(library,new LocalDispatcher(works),works,root)})}
 finally{await works.close();await rm(root,{recursive:true,force:true})}
}
const item={key:"user.route",name:"本地模板",content:"写 {{subject}}",variables:["subject"]}
const doc={format:"xuanxiang-local-templates",schemaVersion:1,prompts:[{...item,enabled:true,version:1,source:"user"}],wizardTemplates:[]}
function request(path:string,method:LocalRequest["method"]="GET",body?:unknown):LocalRequest{return{version:1,id:randomUUID(),path,method,headers:{"content-type":"application/json"},...(body===undefined?{}:{body:Array.from(new TextEncoder().encode(JSON.stringify(body)))})}}
async function call(dispatcher:LocalDispatcher,path:string,method:LocalRequest["method"]="GET",body?:unknown,signal=new AbortController().signal){const response=await dispatcher.handle(request(path,method,body),signal);return{status:response.status,data:await response.json() as any}}

test("TPD15-01 retained PromptsClient GET returns globally persisted versions/source and library revision",async()=>fixture(async(_library,dispatcher)=>{
 const response=await call(dispatcher,"/api/admin/prompts");assert.equal(response.status,200);assert.ok(Number.isInteger(response.data.revision));assert.ok(response.data.prompts.every((p:any)=>p.source==="builtin"&&p.version===1))
}))
test("TPD15-02 retained PATCH requires a matching client version; old edit and builtin deletion cannot damage newer data",async()=>fixture(async(library,dispatcher)=>{
 const created=await call(dispatcher,"/api/admin/prompts","POST",item);assert.equal(created.status,201)
 const id=created.data.prompt.id,path=`/api/admin/prompts/${id}`
 assert.equal((await call(dispatcher,path,"PATCH",{name:"旧稿",expectedVersion:0})).status,409)
 const saved=await call(dispatcher,path,"PATCH",{name:"新稿",expectedVersion:1});assert.equal(saved.status,200);assert.equal(saved.data.prompt.version,2)
 assert.equal((await call(dispatcher,path,"PATCH",{name:"迟到稿",expectedVersion:1})).status,409)
 assert.equal((await library.list()).prompts.find(p=>p.id===id)?.name,"新稿")
 const builtin=(await library.list()).prompts.find(p=>p.key==="chat.system")!;assert.equal((await call(dispatcher,`/api/admin/prompts/${builtin.id}`,"DELETE",{expectedVersion:builtin.version})).status,409)
 assert.equal(await globalPrisma.contentVersion.count({where:{targetId:id}}),1)
}))
test("TPD15-03 desktop wizard commands persist the original WizardTemplate shape and expose only enabled cards for consumption",async()=>fixture(async(_library,dispatcher)=>{
 const template={...WIZARD_TEMPLATES[0],id:"user-route-wizard",title:"本地向导卡"}
 const created=await call(dispatcher,"/api/templates/wizard","POST",{template,enabled:true});assert.equal(created.status,201);assert.equal(created.data.template.version,1)
 const active=await call(dispatcher,"/api/templates/wizard?enabled=true");assert.equal(active.status,200);assert.ok(active.data.templates.some((p:any)=>p.template.id===template.id))
 const saved=await call(dispatcher,`/api/templates/wizard/${template.id}`,"PATCH",{template,enabled:false,expectedVersion:1});assert.equal(saved.status,200)
 assert.ok(!(await call(dispatcher,"/api/templates/wizard?enabled=true")).data.templates.some((p:any)=>p.template.id===template.id))
}))
test("TPD15-04 local import is preview-only until explicit choices are submitted and export contains no unrelated settings",async()=>fixture(async(library,dispatcher)=>{
 const before=await library.list(),preview=await call(dispatcher,"/api/templates/import","POST",{action:"preview",document:doc})
 assert.equal(preview.status,200);assert.deepEqual(await library.list(),before)
 assert.equal((await call(dispatcher,"/api/templates/import","POST",{action:"apply",preview:preview.data.preview,choices:[]})).status,400)
 assert.equal((await call(dispatcher,"/api/templates/import","POST",{action:"apply",preview:preview.data.preview,choices:[{kind:"prompt",id:item.key,action:"add"}]})).status,200)
 const exported=await call(dispatcher,"/api/templates/export");assert.equal(exported.status,200);assert.equal(exported.data.document.format,"xaanink-local-templates");assert.ok(exported.data.document.prompts.some((p:any)=>p.key===item.key))
}))
test("TPD15-05 a cancelled local request never creates a template or a version snapshot",async()=>fixture(async(library,dispatcher)=>{
 const before=await library.list(),abort=new AbortController();abort.abort()
 const response=await call(dispatcher,"/api/admin/prompts","POST",item,abort.signal);assert.equal(response.status,409);assert.equal(response.data.code,"TEMPLATE_OPERATION_CANCELLED")
 assert.deepEqual(await library.list(),before)
}))
test("TPD15-06 a work-scoped template call still edits the global inbox only, without per-work template copies",async()=>fixture(async(library,_dispatcher,works,base)=>{
 const folder=await realpath(await mkdtemp(join(base,"work-"))),stat=await lstat(folder,{bigint:true})
  const work=await works.create({path:folder,device:stat.dev.toString(),inode:stat.ino.toString()}, {title:"隔离本地作品",requestId:randomUUID()})
  await works.runWithGlobal(work.id,async()=>{await library.createPrompt(item);assert.equal(await globalPrisma.promptTemplate.count({where:{key:item.key}}),1);assert.equal(await prisma.promptTemplate.count(),0)})
}))
