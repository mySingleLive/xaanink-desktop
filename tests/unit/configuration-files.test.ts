import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {ConfigurationFiles} from "../../desktop/main/configuration-files"
import {ModelRepository} from "../../desktop/main/model-repository"
import {exportConfiguration,MAX_CONFIGURATION_BYTES} from "../../desktop/core/configuration-transfer"

async function fixture(run:(f:{root:string;repository:ModelRepository;files:ConfigurationFiles;source:string;destination:string;owner:string;setPicker:(fn:()=>Promise<string|null>)=>void;changeOwner:()=>void})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-config-files-")),source=join(root,"incoming.json"),destination=join(root,"export.json"),owner="window:session-1"
 let current=owner,picker:()=>Promise<string|null>=async()=>source
 const repository=new ModelRepository(join(root,"state.json"),{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},{replace(){},remove(){}})
 await repository.initialize();const incoming=await repository.read();incoming.settings.appearance.theme="ink";incoming.settings.user.penName="跨设备作者";await writeFile(source,exportConfiguration(incoming))
 const files=new ConfigurationFiles({repository,catalogs:{},assertOwner:value=>{if(value!==current)throw Error("窗口已变化")},chooseImport:()=>picker(),chooseExport:async()=>destination})
 try{await run({root,repository,files,source,destination,owner,setPicker:fn=>{picker=fn},changeOwner:()=>{current="other-window"}})}finally{files.cancel(owner);await files.flush();await rm(root,{recursive:true,force:true})}
}
test("native-selected import previews without writes and applies only selected fields via the existing repository CAS",()=>fixture(async f=>{
 const before=await f.repository.read(),preview=await f.files.preview(f.owner);assert.ok(preview)
 assert.deepEqual(await f.repository.read(),before)
 assert(preview.plan.changes.some(row=>row.path==="/appearance/theme"))
 const result=await f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]})
 assert.equal(result.settings.appearance.theme,"ink");assert.equal(result.settings.user.penName,before.settings.user.penName)
 await assert.rejects(f.files.apply(f.owner,preview.token,{selectedPaths:[]}),/预览|失效/)
}))
test("a preview token belongs to the exact window/session and cannot be replaced by a forged plan",()=>fixture(async f=>{
 const preview=(await f.files.preview(f.owner))!
 await assert.rejects(f.files.apply("other-window",preview.token,{selectedPaths:["/appearance/theme"]}),/窗口|预览|失效/)
 await assert.rejects(f.files.apply(f.owner,"forged-token",{selectedPaths:["/appearance/theme"]}),/预览|失效/)
 assert.equal((await f.repository.read()).revision,0)
}))
test("cancel or a newer picker invalidates older pending native selections and retained plans",()=>fixture(async f=>{
 const picker=Promise.withResolvers<string|null>();f.setPicker(()=>picker.promise)
 const pending=f.files.preview(f.owner);f.files.cancel(f.owner);picker.resolve(f.source)
 await assert.rejects(pending,/取消|失效/)
 f.setPicker(async()=>f.source);const first=(await f.files.preview(f.owner))!,second=(await f.files.preview(f.owner))!
 await assert.rejects(f.files.apply(f.owner,first.token,{selectedPaths:["/appearance/theme"]}),/预览|失效/)
 f.files.cancel(f.owner);await assert.rejects(f.files.apply(f.owner,second.token,{selectedPaths:["/appearance/theme"]}),/预览|失效/)
 assert.equal((await f.repository.read()).revision,0)
}))
test("settings changed after preview require a new explicit preview instead of overwriting them",()=>fixture(async f=>{
 const preview=(await f.files.preview(f.owner))!,state=await f.repository.read();state.settings.appearance.uiFontSize=18;await f.repository.updateSettings(state.revision,state.settings)
 await assert.rejects(f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]}),/变更|预览/)
 assert.equal((await f.repository.read()).settings.appearance.theme,"paper")
 assert.equal((await f.repository.read()).settings.appearance.uiFontSize,18)
}))
test("selected malformed, oversized, symlink and non-file imports cannot mutate settings",()=>fixture(async f=>{
 for(const bytes of [Buffer.from('{bad'),Buffer.alloc(MAX_CONFIGURATION_BYTES+1,32)]){await writeFile(f.source,bytes);await assert.rejects(f.files.preview(f.owner))}
 await rm(f.source);await symlink(f.destination,f.source);await writeFile(f.destination,"{}")
 await assert.rejects(f.files.preview(f.owner));await rm(f.source);await mkdir(f.source);await assert.rejects(f.files.preview(f.owner))
 assert.equal((await f.repository.read()).revision,0)
}))
test("configuration export is an atomic portable snapshot and does not expose keys or paths",()=>fixture(async f=>{
 assert.equal(await f.files.export(f.owner),true)
 const text=await readFile(f.destination,"utf8"),parsed=JSON.parse(text)
 assert.equal(parsed.format,"xaanink-settings");assert.equal(parsed.settings.appearance.theme,"paper")
 for(const word of ["encryptedKey","keyMask","apiKey","defaultParent","dataRoot","avatarAssetId",f.root])assert.equal(text.includes(word),false,word)
}))
test("cancelled native picker, changed window and symlink export preserve the selected destination",()=>fixture(async f=>{
 f.setPicker(async()=>null);assert.equal(await f.files.preview(f.owner),null)
 const other=join(f.root,"author.json");await writeFile(other,"author original");await symlink(other,f.destination)
 await assert.rejects(f.files.export(f.owner));assert.equal(await readFile(other,"utf8"),"author original")
 f.changeOwner();await assert.rejects(f.files.preview(f.owner),/窗口/)
}))
test("cancellation during repository preparation reaches the atomic commit guard and preserves the previous file",()=>fixture(async f=>{
 const preview=(await f.files.preview(f.owner))!,original=f.repository.updateSettings.bind(f.repository)
 f.repository.updateSettings=async(...args)=>{f.files.cancel(f.owner);return original(...args)}
 await assert.rejects(f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]}),/取消|失效/)
 assert.equal((await f.repository.read()).revision,0)
}))
test("a correctable preview selection error keeps the draft available for explicit correction without re-reading a file",()=>fixture(async f=>{
 const preview=(await f.files.preview(f.owner))!
 await assert.rejects(f.files.apply(f.owner,preview.token,{selectedPaths:["/unlisted/field"]}),/预览|所选/)
 assert.equal((await f.repository.read()).revision,0)
 assert.equal((await f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]})).settings.appearance.theme,"ink")
}))
