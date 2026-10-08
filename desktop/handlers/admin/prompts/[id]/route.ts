import { dispatchTemplateRequest } from "../../../../service/template-dispatcher"
export const dynamic = "force-dynamic"
export async function PATCH(request:Request,_context:{params:Promise<{id:string}>}) { return (await dispatchTemplateRequest(request))! }
export async function DELETE(request:Request,_context:{params:Promise<{id:string}>}) { return (await dispatchTemplateRequest(request))! }
