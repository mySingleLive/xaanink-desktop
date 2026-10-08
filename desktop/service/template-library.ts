import { createHash } from "node:crypto"
import { z } from "zod"
import type { Prisma, PromptTemplate } from "../../src/generated/prisma/client"
import { globalPrisma } from "../../src/lib/db"
import { PROMPT_TEMPLATES, type SeedPromptTemplate } from "../../prisma/seed-templates"
import { WIZARD_TEMPLATES } from "../../src/lib/creation-wizard/templates"
import type { WizardTemplate } from "../../src/lib/creation-wizard/taxonomy"
import { extractPromptVariables } from "../../src/lib/prompts/variables"
import { clearPromptCache } from "../../src/lib/prompts/cache"
import { MAX_TEMPLATE_FILE_BYTES, promptInputSchema, wizardInputSchema, templateDocumentSchema, templateImportChoiceSchema, templateSourceSchema, type TemplateDocument, type TemplateImportPreview, type TemplateImportChoice, type TemplateLibrarySnapshot, type LocalPromptItem, type LocalWizardItem } from "../shared/template-library"

const LIBRARY_KEY = "desktop.template-library.v1"
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const metadataSchema = z.object({ schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), promptDefaults: z.array(z.object({ key: z.string(), hash: digestSchema }).strict()), promptSources: z.array(z.object({ key: z.string(), source: templateSourceSchema }).strict()), wizardTemplates: z.array(wizardInputSchema.extend({ version: z.number().int().positive(), source: templateSourceSchema, defaultHash: digestSchema.optional() }).strict()) }).strict()
type Metadata = z.infer<typeof metadataSchema>
type Tx = Prisma.TransactionClient
type PromptInput = z.infer<typeof promptInputSchema>
const updatePromptSchema = promptInputSchema.omit({ key: true }).partial().strict().refine(value => Object.keys(value).length > 0)
export class TemplateLibraryError extends Error { constructor(readonly code: string) { super(code); this.name = "TemplateLibraryError" } }
function fail(code: string): never { throw new TemplateLibraryError(code) }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue }
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key, stable(item)])) : value }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex") }
function promptBody(row: Pick<PromptTemplate,"key"|"name"|"content"|"variables"|"enabled">) { return { key: row.key, name: row.name, content: row.content, variables: z.array(z.string()).parse(row.variables).sort(), enabled: row.enabled } }
function wizardBody(row: {template: WizardTemplate; enabled: boolean}) { return {template: row.template, enabled: row.enabled} }
function metadata(value: unknown): Metadata { const parsed = metadataSchema.safeParse(value); if (!parsed.success) fail("TEMPLATE_LIBRARY_INVALID"); const result = parsed.data; for (const list of [result.promptDefaults.map(p=>p.key), result.promptSources.map(p=>p.key), result.wizardTemplates.map(p=>p.template.id)]) if (new Set(list).size !== list.length) fail("TEMPLATE_LIBRARY_INVALID"); return result }
function promptView(row: PromptTemplate, state: Metadata): LocalPromptItem { return { id: row.id, key: row.key, name: row.name, content: row.content, variables: z.array(z.string()).parse(row.variables), version: row.version, enabled: row.enabled, updatedAt: row.updatedAt.toISOString(), source: state.promptSources.find(p=>p.key===row.key)?.source ?? "user" } }
function wizardView(row: Metadata["wizardTemplates"][number]): LocalWizardItem { return {template:structuredClone(row.template),version:row.version,enabled:row.enabled,source:row.source} }
async function snapshot(tx: Tx, targetType: "PromptTemplate"|"WizardTemplate", targetId: string, version: number, body: unknown, reason: string) { await tx.contentVersion.create({data:{targetType,targetId,version,snapshot:json(body),reason}}) }

/** Global local inbox only. All edits, history and catalog CAS commit together. */
export class LocalTemplateLibrary {
  private prompts: readonly SeedPromptTemplate[]
  private wizardTemplates: readonly WizardTemplate[]
  constructor(defaults: { prompts?: readonly SeedPromptTemplate[]; wizardTemplates?: readonly WizardTemplate[] } = {}) { this.prompts = defaults.prompts ?? PROMPT_TEMPLATES; this.wizardTemplates = defaults.wizardTemplates ?? WIZARD_TEMPLATES }
  private normalizePrompt(input: unknown): PromptInput & {variables: string[]} {
    const parsed = promptInputSchema.safeParse(input); if (!parsed.success) fail("TEMPLATE_INPUT_INVALID")
    const data=parsed.data, variables=extractPromptVariables(data.content)
    if (data.variables && (new Set(data.variables).size!==data.variables.length || [...data.variables].sort().join("\0")!==[...variables].sort().join("\0"))) fail("TEMPLATE_VARIABLES_INVALID")
    const required=this.prompts.find(p=>p.key===data.key)?.variables
    if (required && [...required].sort().join("\0")!==[...variables].sort().join("\0")) fail("TEMPLATE_VARIABLES_INVALID")
    return {...data,variables}
  }
  async ensureReady(): Promise<void> { const row=await globalPrisma.systemConfig.findUnique({where:{key:LIBRARY_KEY}}); if (row) metadata(row.value); else await this.initialize() }
  async initialize(): Promise<void> {
    let changed=false
    await globalPrisma.$transaction(async tx=>{
      const prior=await tx.systemConfig.findUnique({where:{key:LIBRARY_KEY}})
      const state: Metadata=prior?metadata(prior.value):{schemaVersion:1,revision:0,promptDefaults:[],promptSources:[],wizardTemplates:[]}
      for (const template of this.prompts) {
        const input=this.normalizePrompt({...template,enabled:true}), nextHash=hash(promptBody(input)), old=await tx.promptTemplate.findUnique({where:{key:input.key}})
        const baseline=state.promptDefaults.find(p=>p.key===input.key), origin=state.promptSources.find(p=>p.key===input.key)
        if (!old) { await tx.promptTemplate.create({data:input}); if(origin)origin.source="builtin";else state.promptSources.push({key:input.key,source:"builtin"}); changed=true }
        else if (baseline && origin?.source==="builtin" && hash(promptBody(old))===baseline.hash && baseline.hash!==nextHash) {
          await snapshot(tx,"PromptTemplate",old.id,old.version,promptBody(old),"更新精确旧内置默认")
          await tx.promptTemplate.update({where:{id:old.id,version:old.version},data:{...input,version:old.version+1}});changed=true
        } else if(!origin) { state.promptSources.push({key:input.key,source:hash(promptBody(old))===nextHash?"builtin":"customized"});changed=true }
        if(!baseline){state.promptDefaults.push({key:input.key,hash:nextHash});changed=true}else if(baseline.hash!==nextHash){baseline.hash=nextHash;changed=true}
      }
      for(const template of this.wizardTemplates){
        const input=wizardInputSchema.parse({template,enabled:true}),nextHash=hash(wizardBody(input)),old=state.wizardTemplates.find(p=>p.template.id===template.id)
        if(!old){state.wizardTemplates.push({...input,version:1,source:"builtin",defaultHash:nextHash});changed=true}
        else if(old.source==="builtin"&&old.defaultHash&&hash(wizardBody(old))===old.defaultHash&&old.defaultHash!==nextHash){
          await snapshot(tx,"WizardTemplate",template.id,old.version,wizardView(old),"更新精确旧内置创作模板")
          old.template=structuredClone(template);old.enabled=true;old.version++;changed=true
        }
        if(old&&old.defaultHash!==nextHash){old.defaultHash=nextHash;changed=true}
      }
      if(!prior||changed){state.revision++;if(prior){const result=await tx.systemConfig.updateMany({where:{key:LIBRARY_KEY,value:{equals:json(prior.value)}},data:{value:json(state)}});if(result.count!==1)fail("TEMPLATE_LIBRARY_CONFLICT")}else await tx.systemConfig.create({data:{key:LIBRARY_KEY,value:json(state)}})}
    },{timeout:15000})
    if(changed)clearPromptCache()
  }
  private async mutate<T>(run:(tx:Tx,state:Metadata)=>Promise<{value:T;changed:boolean}>,expectedRevision?:number,guard?:()=>void):Promise<T>{
    guard?.();await this.ensureReady()
    const value=await globalPrisma.$transaction(async tx=>{
      const prior=await tx.systemConfig.findUniqueOrThrow({where:{key:LIBRARY_KEY}}),state=metadata(prior.value)
      if(expectedRevision!==undefined&&state.revision!==expectedRevision)fail("TEMPLATE_LIBRARY_CONFLICT")
      const result=await run(tx,state)
      if(result.changed){state.revision++;const cas=await tx.systemConfig.updateMany({where:{key:LIBRARY_KEY,value:{equals:json(prior.value)}},data:{value:json(state)}});if(cas.count!==1)fail("TEMPLATE_LIBRARY_CONFLICT")}
      guard?.();return result.value
    },{timeout:15000})
    clearPromptCache();return value
  }
  private async readSnapshot(tx:Tx,state:Metadata):Promise<TemplateLibrarySnapshot>{return{revision:state.revision,prompts:(await tx.promptTemplate.findMany({orderBy:{key:"asc"}})).map(row=>promptView(row,state)),wizardTemplates:state.wizardTemplates.map(wizardView)}}
  async list(): Promise<TemplateLibrarySnapshot> { await this.ensureReady();return globalPrisma.$transaction(async tx=>this.readSnapshot(tx,metadata((await tx.systemConfig.findUniqueOrThrow({where:{key:LIBRARY_KEY}})).value))) }
  private async addPrompt(tx:Tx,state:Metadata,input:PromptInput & {variables:string[]}):Promise<LocalPromptItem>{
    if(await tx.promptTemplate.findUnique({where:{key:input.key}}))fail("TEMPLATE_ID_CONFLICT")
    const row=await tx.promptTemplate.create({data:input});state.promptSources.push({key:input.key,source:"user"});return promptView(row,state)
  }
  async createPrompt(input:unknown,guard?:()=>void):Promise<LocalPromptItem>{const parsed=this.normalizePrompt(input);return this.mutate(async(tx,state)=>({value:await this.addPrompt(tx,state,parsed),changed:true}),undefined,guard)}
  private async editPrompt(tx:Tx,state:Metadata,id:string,version:number,input:unknown):Promise<LocalPromptItem>{
    const existing=await tx.promptTemplate.findUnique({where:{id}});if(!existing)fail("TEMPLATE_NOT_FOUND");if(existing.version!==version)fail("TEMPLATE_VERSION_CONFLICT")
    const update=updatePromptSchema.safeParse(input);if(!update.success)fail("TEMPLATE_INPUT_INVALID")
    const parsed=this.normalizePrompt({key:existing.key,name:update.data.name??existing.name,content:update.data.content??existing.content,enabled:update.data.enabled??existing.enabled,...(update.data.variables?{variables:update.data.variables}:{})})
    await snapshot(tx,"PromptTemplate",id,version,promptBody(existing),"作者本地编辑")
    const row=await tx.promptTemplate.update({where:{id,version},data:{...parsed,version:version+1}})
    const origin=state.promptSources.find(p=>p.key===row.key);if(origin&&origin.source!=="user")origin.source="customized"
    return promptView(row,state)
  }
  async updatePrompt(id:string,version:number,input:unknown,guard?:()=>void):Promise<LocalPromptItem>{if(!Number.isSafeInteger(version)||version<1)fail("TEMPLATE_VERSION_CONFLICT");return this.mutate(async(tx,state)=>({value:await this.editPrompt(tx,state,id,version,input),changed:true}),undefined,guard)}
  async removePrompt(id:string,version:number,guard?:()=>void):Promise<void>{return this.mutate(async(tx,state)=>{
    const row=await tx.promptTemplate.findUnique({where:{id}});if(!row)fail("TEMPLATE_NOT_FOUND");if(row.version!==version)fail("TEMPLATE_VERSION_CONFLICT")
    if(state.promptDefaults.some(p=>p.key===row.key))fail("BUILTIN_TEMPLATE_PROTECTED")
    await snapshot(tx,"PromptTemplate",id,version,promptBody(row),"删除本地用户副本");await tx.promptTemplate.delete({where:{id,version}});state.promptSources=state.promptSources.filter(p=>p.key!==row.key);return{value:undefined,changed:true}
  },undefined,guard)}
  private async putWizard(tx:Tx,state:Metadata,input:unknown,version?:number):Promise<LocalWizardItem>{
    const parsed=wizardInputSchema.safeParse(input);if(!parsed.success)fail("TEMPLATE_INPUT_INVALID")
    const existing=state.wizardTemplates.find(p=>p.template.id===parsed.data.template.id)
    if(existing){if(existing.version!==version)fail("TEMPLATE_VERSION_CONFLICT");await snapshot(tx,"WizardTemplate",existing.template.id,existing.version,wizardView(existing),"作者本地编辑创作模板");existing.template=parsed.data.template;existing.enabled=parsed.data.enabled;existing.version++;if(existing.source!=="user")existing.source="customized";return wizardView(existing)}
    if(version!==undefined)fail("TEMPLATE_NOT_FOUND")
    const row={...parsed.data,version:1,source:"user" as const};state.wizardTemplates.push(row);return wizardView(row)
  }
  async saveWizard(input:unknown,version?:number,guard?:()=>void):Promise<LocalWizardItem>{return this.mutate(async(tx,state)=>({value:await this.putWizard(tx,state,input,version),changed:true}),undefined,guard)}
  async removeWizard(id:string,version:number,guard?:()=>void):Promise<void>{return this.mutate(async(tx,state)=>{const row=state.wizardTemplates.find(p=>p.template.id===id);if(!row)fail("TEMPLATE_NOT_FOUND");if(row.version!==version)fail("TEMPLATE_VERSION_CONFLICT");if(row.defaultHash)fail("BUILTIN_TEMPLATE_PROTECTED");await snapshot(tx,"WizardTemplate",id,version,wizardView(row),"删除本地创作模板副本");state.wizardTemplates=state.wizardTemplates.filter(p=>p.template.id!==id);return{value:undefined,changed:true}},undefined,guard)}
  async export():Promise<TemplateDocument>{const state=await this.list();return templateDocumentSchema.parse({format:"xaanink-local-templates",schemaVersion:1,prompts:state.prompts.map(({key,name,content,variables,enabled,version,source})=>({key,name,content,variables,enabled,version,source})),wizardTemplates:state.wizardTemplates})}
  private parseDocument(value:unknown):TemplateDocument{
    let text:string;try{text=typeof value==="string"?value:JSON.stringify(value);if(new TextEncoder().encode(text).byteLength>MAX_TEMPLATE_FILE_BYTES)fail("TEMPLATE_IMPORT_INVALID");value=JSON.parse(text)}catch{fail("TEMPLATE_IMPORT_INVALID")}
    const parsed=templateDocumentSchema.safeParse(value);if(!parsed.success)fail("TEMPLATE_IMPORT_INVALID")
    const result=parsed.data
    if(new Set(result.prompts.map(p=>p.key)).size!==result.prompts.length||new Set(result.wizardTemplates.map(p=>p.template.id)).size!==result.wizardTemplates.length)fail("TEMPLATE_IMPORT_INVALID")
    try{for(const row of result.prompts){const {version:_version,source:_source,...body}=row;this.normalizePrompt(body)}}catch{fail("TEMPLATE_IMPORT_INVALID")}
    return result
  }
  private entries(document:TemplateDocument,state:TemplateLibrarySnapshot):TemplateImportPreview["entries"]{return[...document.prompts.map(p=>{const old=state.prompts.find(item=>item.key===p.key);return{kind:"prompt" as const,id:p.key,name:p.name,conflict:!!old,existingVersion:old?.version??null,incomingVersion:p.version}}),...document.wizardTemplates.map(p=>{const old=state.wizardTemplates.find(item=>item.template.id===p.template.id);return{kind:"wizard" as const,id:p.template.id,name:p.template.title,conflict:!!old,existingVersion:old?.version??null,incomingVersion:p.version}})]}
  async preview(value:unknown):Promise<TemplateImportPreview>{const document=this.parseDocument(value),state=await this.list();return{baseRevision:state.revision,document,entries:this.entries(document,state)}}
  async apply(preview:Pick<TemplateImportPreview,"baseRevision"|"document">,choices:TemplateImportChoice[],guard?:()=>void):Promise<TemplateLibrarySnapshot>{
    if(!Number.isSafeInteger(preview.baseRevision)||preview.baseRevision<0)fail("TEMPLATE_IMPORT_INVALID")
    const document=this.parseDocument(preview.document),parsed=z.array(templateImportChoiceSchema).safeParse(choices);if(!parsed.success)fail("TEMPLATE_IMPORT_CHOICES_INVALID")
    await this.mutate(async(tx,state)=>{
      const current=await this.readSnapshot(tx,state),entries=this.entries(document,current),ids=parsed.data.map(c=>`${c.kind}\0${c.id}`)
      if(new Set(ids).size!==ids.length||ids.length!==entries.length||entries.some(e=>!ids.includes(`${e.kind}\0${e.id}`)))fail("TEMPLATE_IMPORT_CHOICES_INVALID")
      let changed=false
      for(const entry of entries){
        const choice=parsed.data.find(c=>c.kind===entry.kind&&c.id===entry.id)!
        if(choice.action==="keep")continue
        if(choice.action==="replace"&&!entry.conflict||choice.action==="add"&&entry.conflict||choice.action==="copy"&&!choice.copyId||choice.action!=="copy"&&choice.copyId)fail("TEMPLATE_IMPORT_CHOICES_INVALID")
        if(entry.kind==="prompt"){
          const imported=document.prompts.find(p=>p.key===entry.id)!,{version:_version,source:_source,...body}=imported
          if(choice.action==="replace"){const old=current.prompts.find(p=>p.key===entry.id)!;await this.editPrompt(tx,state,old.id,old.version,bodyWithoutKey(body))}
          else {
            const key=choice.action==="copy"?choice.copyId!:body.key
            if(await tx.promptTemplate.findUnique({where:{key}}))fail("TEMPLATE_ID_CONFLICT")
            await this.addPrompt(tx,state,this.normalizePrompt({...body,key}))
          }
        }else{
          const imported=document.wizardTemplates.find(p=>p.template.id===entry.id)!,id=choice.action==="copy"?choice.copyId!:imported.template.id
          if(choice.action!=="replace"&&state.wizardTemplates.some(p=>p.template.id===id))fail("TEMPLATE_ID_CONFLICT")
          await this.putWizard(tx,state,{template:{...imported.template,id},enabled:imported.enabled},choice.action==="replace"?entry.existingVersion!:undefined)
        }
        changed=true
      }
      return{value:undefined,changed}
    },preview.baseRevision,guard)
    return this.list()
  }
}
function bodyWithoutKey(input:PromptInput){const {key:_key,...body}=input;return body}
export const localTemplateLibrary = new LocalTemplateLibrary()
