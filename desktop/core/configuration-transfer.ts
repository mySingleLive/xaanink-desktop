import {createHash} from "node:crypto"
import {z} from "zod"
import {modelSchema,settingsSchema,generalSettingsInputSchema,type Settings,type PublicModel} from "./settings"
import {editBinding,validShortcut,type ShortcutCommand} from "./shortcuts"
import {RevisionConflict} from "./versioned-store"
import {isValidThinkingEffort} from "../../src/lib/ai/thinking-effort"

// This main-process-only module has no disk, credential, network or registry-discovery access.
export const MAX_CONFIGURATION_BYTES=4*1024*1024
type Platform="darwin"|"win32"
export interface ConfigurationSnapshot {revision:number;settings:Settings;models:ReadonlyArray<PublicModel>}
export type ModelSelectionPath="/agent/textModelId"|"/agent/reviewModelId"|"/agent/imageModelId"
export interface TrustedShortcutCatalog {resolved:boolean;commands:ReadonlyArray<ShortcutCommand>}
export type TrustedShortcutCatalogs=Partial<Record<Platform,TrustedShortcutCatalog>>
export interface ConfigurationImportChoices {selectedPaths:string[];modelBindings?:Partial<Record<ModelSelectionPath,string|null>>;thinkingOverride?:string}
const referenceSchema=modelSchema.pick({id:true,name:true,provider:true,providerName:true,protocol:true,modelId:true,kind:true})
export type ConfigurationModelReference=z.infer<typeof referenceSchema>
export interface ConfigurationImportChange {readonly path:string;readonly before:unknown;readonly incoming:unknown}
export interface ConfigurationImportIssue {readonly path:string;readonly code:string;readonly message:string}
export interface ConfigurationImportPlan {
 readonly baseRevision:number
 readonly changes:ReadonlyArray<ConfigurationImportChange>
 readonly issues:ReadonlyArray<ConfigurationImportIssue>
 readonly modelReferences:ReadonlyArray<ConfigurationModelReference>
 readonly catalogResolved:Readonly<Record<Platform,boolean>>
 readonly excluded:ReadonlyArray<string>
}
const errorMessages:Record<string,string>={
 INVALID_JSON:"配置文件不是有效 JSON",UNSUPPORTED_VERSION:"此配置文件版本尚不支持",INVALID_SCHEMA:"配置文件格式不正确或含不可导入的字段",
 CONFIG_TOO_LARGE:"配置文件超过 4 MiB",INVALID_SNAPSHOT:"当前设置快照无效",INVALID_PLAN:"请重新预览配置文件",
 INVALID_SELECTION:"所选内容不属于本次预览",MODEL_MAPPING_REQUIRED:"请选择本机已保存的模型或明确清除此默认模型",
 MODEL_UNAVAILABLE:"所选本机模型不可用或类型不匹配",THINKING_UNAVAILABLE:"请明确选择新模型支持的思考选项",
 CATALOG_UNAVAILABLE:"本机快捷键命令目录尚未就绪",COMMAND_UNKNOWN:"此快捷键命令不在本机命令目录中",SHORTCUT_CONFLICT:"快捷键与本机命令冲突或属于保留绑定",
}
export class ConfigurationTransferError extends Error {
 constructor(readonly code:string){super(errorMessages[code]??"配置操作失败");this.name="ConfigurationTransferError"}
}
const fail=(code:string):never=>{throw new ConfigurationTransferError(code)}
const forbiddenIds=new Set(["__proto__","prototype","constructor"])
const namespaceSchema=settingsSchema.shape.shortcuts.shape.darwin.superRefine((values,context)=>{
 if(Object.keys(values).length>5000)context.addIssue({code:"custom",message:"Too many overrides"})
 for(const [id,bindings] of Object.entries(values)){
  if(!id.length||id.length>240||forbiddenIds.has(id)||bindings.some(key=>!validShortcut(key)))context.addIssue({code:"custom",message:"Invalid binding"})
 }
})
const portableSettingsSchema=settingsSchema.extend({
 general:generalSettingsInputSchema.omit({defaultParent:true}).transform(({restoreSession})=>({restoreSession})),
 user:settingsSchema.shape.user.omit({avatarAssetId:true}),
 shortcuts:settingsSchema.shape.shortcuts.extend({darwin:namespaceSchema,win32:namespaceSchema}),
})
const modelPaths:ModelSelectionPath[]=["/agent/textModelId","/agent/reviewModelId","/agent/imageModelId"]
const fileSchema=z.object({
 format:z.enum(["xuanxiang-settings","xaanink-settings"]),version:z.literal(1),exportedAt:z.iso.datetime(),
 settings:portableSettingsSchema,modelReferences:z.array(referenceSchema).max(1000),
}).strict().superRefine((file,context)=>{
 const references=new Map(file.modelReferences.map(reference=>[reference.id,reference]))
 if(references.size!==file.modelReferences.length)context.addIssue({code:"custom",message:"Duplicate model reference"})
 for(const path of modelPaths){
  const key=path.slice("/agent/".length) as "textModelId"|"reviewModelId"|"imageModelId"
  const id=file.settings.agent[key],reference=id?references.get(id):undefined
  if(reference&&reference.kind!==(key==="imageModelId"?"IMAGE":"TEXT"))context.addIssue({code:"custom",message:"Mismatched model reference"})
 }
})
type ConfigurationFile=z.infer<typeof fileSchema>
const snapshotSchema=z.object({
 revision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),settings:settingsSchema,
 models:z.array(modelSchema.omit({encryptedKey:true})).max(1000),
}).strict()
function checkedSnapshot(current:ConfigurationSnapshot):ConfigurationSnapshot{
 const parsed=snapshotSchema.safeParse(current)
 if(!parsed.success||new Set(parsed.data.models.map(model=>model.id)).size!==parsed.data.models.length)return fail("INVALID_SNAPSHOT")
 return parsed.data
}
const excluded=Object.freeze(["general.defaultParent","dataRoot","user.avatarAssetId","models.endpoint","models.apiKey","models.encryptedKey","models.keyMask","models.authRevision","models.enabled"])
const choicesSchema=z.object({
 selectedPaths:z.array(z.string().max(600)).max(11000),
 modelBindings:z.object({"/agent/textModelId":z.string().max(200).nullable().optional(),"/agent/reviewModelId":z.string().max(200).nullable().optional(),"/agent/imageModelId":z.string().max(200).nullable().optional()}).strict().optional(),
 thinkingOverride:z.string().max(30).optional(),
}).strict()
interface InternalChange extends ConfigurationImportChange {parts:string[]}
interface InternalPlan {fingerprint:string;changes:InternalChange[]}
const plans=new WeakMap<ConfigurationImportPlan,InternalPlan>()
function fingerprint(current:ConfigurationSnapshot):string{
 return createHash("sha256").update(JSON.stringify({...current,models:[...current.models].sort((a,b)=>a.id.localeCompare(b.id))})).digest("hex")
}
function freeze<T>(value:T):T{
 if(value&&typeof value==="object"){
  for(const item of Object.values(value))freeze(item)
  Object.freeze(value)
 }
 return value
}
function pointer(parts:string[]):string{return "/"+parts.map(part=>part.replaceAll("~","~0").replaceAll("/","~1")).join("/")}
function same(a:unknown,b:unknown):boolean{return JSON.stringify(a)===JSON.stringify(b)}
function parseFile(text:string):ConfigurationFile{
 if(typeof text!=="string")return fail("INVALID_JSON")
 if(Buffer.byteLength(text,"utf8")>MAX_CONFIGURATION_BYTES)return fail("CONFIG_TOO_LARGE")
 let value:unknown
 try{value=JSON.parse(text)}catch{return fail("INVALID_JSON")}
 if(value&&typeof value==="object"&&"version" in value&&value.version!==1)return fail("UNSUPPORTED_VERSION")
 // Reject dangerous own keys before Zod's record traversal can discard __proto__.
 const namespaces=(value as {settings?:{shortcuts?:unknown}}|null)?.settings?.shortcuts
 if(namespaces&&typeof namespaces==="object")for(const platform of ["darwin","win32"]){
  const entries=(namespaces as Record<string,unknown>)[platform]
  if(entries&&typeof entries==="object"&&Object.keys(entries).some(id=>forbiddenIds.has(id)))return fail("INVALID_SCHEMA")
 }
 const parsed=fileSchema.safeParse(value)
 if(!parsed.success)return fail("INVALID_SCHEMA")
 return parsed.data
}
function catalogResolved(platform:Platform,catalogs:TrustedShortcutCatalogs):boolean{
 const catalog=catalogs[platform]
 return !!catalog?.resolved&&new Set(catalog.commands.map(command=>command.id)).size===catalog.commands.length
}
function trustedCommands(platform:Platform,catalogs:TrustedShortcutCatalogs):ShortcutCommand[]{
 if(!catalogResolved(platform,catalogs))return fail("CATALOG_UNAVAILABLE")
 return structuredClone([...catalogs[platform]!.commands])
}
function validateShortcut(change:InternalChange,settings:Settings,catalogs:TrustedShortcutCatalogs):void{
 const platform=change.parts[1] as Platform,id=change.parts[2],commands=trustedCommands(platform,catalogs)
 const target=commands.find(command=>command.id===id)
 if(!target)return fail("COMMAND_UNKNOWN")
 if(target.locked)return fail("SHORTCUT_CONFLICT")
 // Start the target empty; all other rows already contain the final reviewed merge.
 // This checks aliases, chord prefixes, scopes, defaults and locked/system keys without transfer.
 let checked={...settings.shortcuts[platform],[id]:[] as string[]}
 try{for(const binding of settings.shortcuts[platform][id])checked=editBinding(commands,checked,id,binding)}
 catch{return fail("SHORTCUT_CONFLICT")}
}
function writeChange(settings:Settings,change:InternalChange,value:unknown):void{
 const group=settings[change.parts[0] as keyof Settings] as unknown as Record<string,unknown>
 if(change.parts[0]==="shortcuts"){
  const namespace=group[change.parts[1]] as Record<string,unknown>
  namespace[change.parts[2]]=structuredClone(value)
 }else group[change.parts[1]]=structuredClone(value)
}
/** Export only portable preferences and descriptive model references, never authorization. */
export function exportConfiguration(current:ConfigurationSnapshot):string{
 const parsed=settingsSchema.safeParse(current.settings)
 if(!parsed.success)return fail("INVALID_SNAPSHOT")
 const {defaultParent:_path,...general}=parsed.data.general,{avatarAssetId:_avatar,...user}=parsed.data.user
 const references=current.models.map(model=>({id:model.id,name:model.name,provider:model.provider,...(model.providerName===undefined?{}:{providerName:model.providerName}),protocol:model.protocol,modelId:model.modelId,kind:model.kind}))
 const file=fileSchema.safeParse({format:"xaanink-settings",version:1,exportedAt:new Date().toISOString(),settings:{...parsed.data,general,user},modelReferences:references})
 if(!file.success)return fail("INVALID_SCHEMA")
 const text=JSON.stringify(file.data,null,2)+"\n"
 if(Buffer.byteLength(text,"utf8")>MAX_CONFIGURATION_BYTES)return fail("CONFIG_TOO_LARGE")
 return text
}
/** Main retains this exact plan object; a renderer receives its serializable display data only. */
export function prepareConfigurationImport(json:string,current:ConfigurationSnapshot,catalogs:TrustedShortcutCatalogs={}):ConfigurationImportPlan{
 const file=parseFile(json),baseline=checkedSnapshot(current),changes:InternalChange[]=[],issues:ConfigurationImportIssue[]=[]
 for(const group of ["general","user","agent","appearance"] as const){
  for(const [key,value] of Object.entries(file.settings[group])){
   const before=(baseline.settings[group] as Record<string,unknown>)[key]
   if(!same(before,value))changes.push({path:pointer([group,key]),parts:[group,key],before:structuredClone(before),incoming:structuredClone(value)})
  }
 }
 for(const platform of ["darwin","win32"] as const)for(const [id,value] of Object.entries(file.settings.shortcuts[platform])){
  const namespace=baseline.settings.shortcuts[platform]
  const before=Object.hasOwn(namespace,id)?namespace[id]:undefined
  if(!same(before,value))changes.push({path:pointer(["shortcuts",platform,id]),parts:["shortcuts",platform,id],before:structuredClone(before),incoming:structuredClone(value)})
 }
 const fullMerge=structuredClone(baseline.settings)
 for(const change of changes)writeChange(fullMerge,change,change.incoming)
 for(const change of changes){
  if(modelPaths.includes(change.path as ModelSelectionPath)&&change.incoming!==null)issues.push({path:change.path,code:"MODEL_MAPPING_REQUIRED",message:errorMessages.MODEL_MAPPING_REQUIRED})
  if(change.parts[0]==="shortcuts")try{validateShortcut(change,fullMerge,catalogs)}catch(error){
   if(!(error instanceof ConfigurationTransferError))throw error
   issues.push({path:change.path,code:error.code,message:error.message})
  }
 }
 const plan:ConfigurationImportPlan=freeze({
  baseRevision:baseline.revision,changes:changes.map(({parts:_parts,...display})=>display),issues,
  modelReferences:structuredClone(file.modelReferences),catalogResolved:{darwin:catalogResolved("darwin",catalogs),win32:catalogResolved("win32",catalogs)},excluded:[...excluded],
 })
 plans.set(plan,{fingerprint:fingerprint(baseline),changes})
 return plan
}
/** Resolve reviewed choices only. The caller still must commit with repository revision CAS. */
export function resolveConfigurationImport(plan:ConfigurationImportPlan,current:ConfigurationSnapshot,choices:ConfigurationImportChoices,catalogs:TrustedShortcutCatalogs={}):Settings{
 const internal=plans.get(plan)
 if(!internal)return fail("INVALID_PLAN")
 const baseline=checkedSnapshot(current)
 if(baseline.revision!==plan.baseRevision||fingerprint(baseline)!==internal.fingerprint)throw new RevisionConflict()
 const parsed=choicesSchema.safeParse(choices)
 if(!parsed.success)return fail("INVALID_SELECTION")
 const selected=new Set(parsed.data.selectedPaths)
 if(selected.size!==parsed.data.selectedPaths.length||[...selected].some(path=>!internal.changes.some(change=>change.path===path)))return fail("INVALID_SELECTION")
 for(const path of Object.keys(parsed.data.modelBindings??{}))if(!selected.has(path))return fail("INVALID_SELECTION")
 if(parsed.data.thinkingOverride!==undefined&&!selected.has("/agent/thinking")&&!selected.has("/agent/textModelId"))return fail("INVALID_SELECTION")
 const next=structuredClone(baseline.settings),reviewed=internal.changes.filter(change=>selected.has(change.path))
 for(const change of reviewed){
  if(modelPaths.includes(change.path as ModelSelectionPath)){
   const path=change.path as ModelSelectionPath,bindings=parsed.data.modelBindings
   if(change.incoming!==null&&(!bindings||!Object.hasOwn(bindings,path)))return fail("MODEL_MAPPING_REQUIRED")
   const id=bindings&&Object.hasOwn(bindings,path)?bindings[path]:null
   if(id!==null){
    const model=baseline.models.find(model=>model.id===id)
    if(!model?.enabled||model.kind!==(path==="/agent/imageModelId"?"IMAGE":"TEXT"))return fail("MODEL_UNAVAILABLE")
   }
   writeChange(next,change,id)
  }else writeChange(next,change,change.incoming)
 }
 if(parsed.data.thinkingOverride!==undefined)next.agent.thinking=parsed.data.thinkingOverride
 if(selected.has("/agent/thinking")||selected.has("/agent/textModelId")||parsed.data.thinkingOverride!==undefined){
  const textModel=baseline.models.find(model=>model.id===next.agent.textModelId)
  if(next.agent.thinking!=="default"&&(!textModel?.enabled||textModel.kind!=="TEXT"||!textModel.thinkingLevels.includes(next.agent.thinking)||!isValidThinkingEffort(textModel.provider,textModel.modelId,next.agent.thinking)))return fail("THINKING_UNAVAILABLE")
 }
 for(const change of reviewed)if(change.parts[0]==="shortcuts")validateShortcut(change,next,catalogs)
 const result=settingsSchema.safeParse(next)
 if(!result.success)return fail("INVALID_SELECTION")
 return result.data
}
