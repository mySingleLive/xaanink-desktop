import { dispatchTemplateRequest } from "../../../service/template-dispatcher"
export const dynamic = "force-dynamic"
export async function GET(request?:Request) { return (await dispatchTemplateRequest(request??new Request("https://local.invalid/api/admin/prompts")))! }
export async function POST(request:Request) { return (await dispatchTemplateRequest(request))! }
