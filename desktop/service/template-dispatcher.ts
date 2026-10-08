import { z } from "zod"
import { auth } from "../../src/lib/auth"
import { localTemplateLibrary, TemplateLibraryError } from "./template-library"
import { templateDocumentSchema, templateImportChoiceSchema } from "../shared/template-library"

const expected=z.number().int().positive()
const messages:Record<string,string>={TEMPLATE_VERSION_CONFLICT:"模板版本已变化，请重新加载。",TEMPLATE_LIBRARY_CONFLICT:"模板版本已变化，请重新预览。",TEMPLATE_VARIABLES_INVALID:"请保留该模板的完整变量，并检查变量声明。",TEMPLATE_ID_CONFLICT:"该模板标识已存在，请更换另存标识。",BUILTIN_TEMPLATE_PROTECTED:"内置模板不能删除，可停用或另存为用户模板。",TEMPLATE_NOT_FOUND:"本地模板不存在。",TEMPLATE_IMPORT_INVALID:"模板文件格式、大小或变量不合法。",TEMPLATE_IMPORT_CHOICES_INVALID:"请为每个导入条目选择有效的处理方式。",TEMPLATE_INPUT_INVALID:"模板内容不合法。",TEMPLATE_OPERATION_CANCELLED:"模板操作已取消。",TEMPLATE_LIBRARY_INVALID:"本地模板库无法读取，请保留原数据后重试。"}
export function templateErrorResponse(error:unknown):Response{
 const code=error instanceof TemplateLibraryError?error.code:"TEMPLATE_OPERATION_FAILED"
 const status=["TEMPLATE_VERSION_CONFLICT","TEMPLATE_LIBRARY_CONFLICT","TEMPLATE_ID_CONFLICT","BUILTIN_TEMPLATE_PROTECTED","TEMPLATE_OPERATION_CANCELLED"].includes(code)?409:code==="TEMPLATE_NOT_FOUND"?404:code.endsWith("INVALID")&&code!=="TEMPLATE_LIBRARY_INVALID"?400:500
 return Response.json({error:messages[code]??"本地模板操作未完成，请重试。",code},{status})
}
/** Compatibility paths are local command identifiers, never HTTP destinations. */
export async function dispatchTemplateRequest(request:Request):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname,method=request.method
 const promptItem=path.match(/^\/api\/admin\/prompts\/([^/]+)$/),wizardItem=path.match(/^\/api\/templates\/wizard\/([^/]+)$/)
 if(path!=="/api/admin/prompts"&&!promptItem&&!path.startsWith("/api/templates/"))return null
 const guard=()=>{if(request.signal.aborted)throw new TemplateLibraryError("TEMPLATE_OPERATION_CANCELLED")}
 try{
  guard();if(!(await auth())?.user)return Response.json({error:"无权限访问"},{status:403});guard()
  if(path==="/api/admin/prompts"&&method==="GET"){const state=await localTemplateLibrary.list();guard();return Response.json({prompts:state.prompts,revision:state.revision})}
  if(path==="/api/templates/library"&&method==="GET"){const state=await localTemplateLibrary.list();guard();return Response.json(state)}
  if(path==="/api/templates/export"&&method==="GET"){const document=await localTemplateLibrary.export();guard();return Response.json({document})}
  if(path==="/api/templates/wizard"&&method==="GET"){const state=await localTemplateLibrary.list();guard();return Response.json({templates:url.searchParams.get("enabled")==="true"?state.wizardTemplates.filter(p=>p.enabled):state.wizardTemplates,revision:state.revision})}
  const writeCommand=method==="POST"&&["/api/admin/prompts","/api/templates/wizard","/api/templates/import"].includes(path)
    ||(!!promptItem||!!wizardItem)&&["PATCH","DELETE"].includes(method)
  if(!writeCommand)return Response.json({error:"本地模板命令不存在"},{status:404})
  let body:unknown;try{body=await request.json()}catch{throw new TemplateLibraryError("TEMPLATE_INPUT_INVALID")};guard()
  if(path==="/api/admin/prompts"&&method==="POST")return Response.json({prompt:await localTemplateLibrary.createPrompt(body,guard)},{status:201})
  if(promptItem){
   const id=decodeURIComponent(promptItem[1]),raw=z.object({expectedVersion:expected}).passthrough().safeParse(body)
   if(!raw.success)throw new TemplateLibraryError("TEMPLATE_VERSION_CONFLICT")
   const {expectedVersion,...update}=raw.data
   if(method==="PATCH")return Response.json({prompt:await localTemplateLibrary.updatePrompt(id,expectedVersion,update,guard)})
   if(method==="DELETE"){if(Object.keys(update).length)throw new TemplateLibraryError("TEMPLATE_INPUT_INVALID");await localTemplateLibrary.removePrompt(id,expectedVersion,guard);return Response.json({ok:true})}
  }
  if(path==="/api/templates/wizard"&&method==="POST")return Response.json({template:await localTemplateLibrary.saveWizard(body,undefined,guard)},{status:201})
  if(wizardItem){
   const id=decodeURIComponent(wizardItem[1]),raw=z.object({expectedVersion:expected}).passthrough().safeParse(body)
   if(!raw.success)throw new TemplateLibraryError("TEMPLATE_VERSION_CONFLICT")
   const {expectedVersion,...update}=raw.data
   if(method==="PATCH"){if(!update.template||typeof update.template!=="object"||("id"in update.template&&update.template.id!==id))throw new TemplateLibraryError("TEMPLATE_INPUT_INVALID");return Response.json({template:await localTemplateLibrary.saveWizard(update,expectedVersion,guard)})}
   if(method==="DELETE"){if(Object.keys(update).length)throw new TemplateLibraryError("TEMPLATE_INPUT_INVALID");await localTemplateLibrary.removeWizard(id,expectedVersion,guard);return Response.json({ok:true})}
  }
  if(path==="/api/templates/import"&&method==="POST"){
   const schema=z.discriminatedUnion("action",[z.object({action:z.literal("preview"),document:z.unknown()}).strict(),z.object({action:z.literal("apply"),preview:z.object({baseRevision:z.number().int().nonnegative(),document:templateDocumentSchema,entries:z.array(z.unknown()).optional()}).strict(),choices:z.array(templateImportChoiceSchema)}).strict()])
   const data=schema.safeParse(body);if(!data.success)throw new TemplateLibraryError("TEMPLATE_IMPORT_INVALID")
   if(data.data.action==="preview"){const preview=await localTemplateLibrary.preview(data.data.document);guard();return Response.json({preview})}
   return Response.json(await localTemplateLibrary.apply(data.data.preview,data.data.choices,guard))
  }
  return Response.json({error:"本地模板命令不存在"},{status:404})
 }catch(error){return templateErrorResponse(error)}
}
