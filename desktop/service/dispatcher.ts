import { routes } from "./routes.generated"
import { requestSchema, type LocalRequest } from "../shared/ipc"
import type { Workspaces } from "./workspaces"
import { prisma } from "../../src/lib/db"
import { LOCAL_AUTHOR_ID } from "./context"
import {ContentError} from '../../src/lib/content-errors'
import {conversationTransfersFor} from './conversation-runtime'
import type {ConversationTransfers} from './conversation-transfer'
import {getDatabaseContext} from './context'
import { dispatchTemplateRequest } from "./template-dispatcher"
export type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>
export function matchRoute(path: string, method: string) {
  const segments = new URL(path, "https://local.invalid").pathname.split("/")
  for (const row of routes) {
    if (!row.methods.includes(method)) continue
    const pattern = row.path.split("/"); const params: Record<string, string> = {}
    if (pattern.length !== segments.length) continue
    if (pattern.every((part, index) => {
      if (part.startsWith("[")) { params[part.slice(1, -1)] = decodeURIComponent(segments[index]); return !!segments[index] }
      return part === segments[index]
    })) return { row, params }
  }
  return null
}
export class LocalDispatcher {
  constructor(readonly works: Workspaces,private readonly transfers:ConversationTransfers|undefined=conversationTransfersFor(works)) {}
  async workspaceFor(input: LocalRequest): Promise<string> {
    input = requestSchema.parse(input)
    const match = matchRoute(input.path, input.method)
    if (!match || match.row.scope === "global") return "inbox"
    const url = new URL(input.path, "https://local.invalid")
    const records = await this.works.list()
    let body: Record<string, unknown> = {}
    if (input.body?.length && input.headers["content-type"]?.includes("json")) {
      try { const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(input.body))); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed } catch {}
    }
    const { scope } = match.row
    const novelId = scope === "novel" ? match.params.id : scope === "conversations" ? url.searchParams.get("novelId") : scope === "chat" ? body.novelId : undefined
    const conversationId = scope === "conversation" ? match.params.id : scope === "chat" ? body.conversationId : undefined
    const entityId = scope === "turn" ? match.params.turnId : scope === "subagent" ? match.params.id : conversationId
    if (typeof entityId === "string" && entityId) {
      const indexed=scope==='turn'?await this.transfers?.ledger.entity('turn',entityId):scope==='subagent'?await this.transfers?.ledger.entity('subagent',entityId):null
      const location=await this.transfers?.ledger.location(indexed?.conversationId??(scope!=='turn'&&scope!=='subagent'?entityId:''))
      if(location){
        if(location.deleted&&!(scope==='conversation'&&input.method==='DELETE'))throw new ContentError('CONVERSATION_NOT_FOUND','会话不存在',404)
        if(typeof novelId==='string'&&novelId&&location.novelId!==novelId)throw new ContentError('CONVERSATION_LOCATION_CHANGED','会话与作品不匹配')
        if(indexed?.historicalWorkspaceId&&indexed.historicalWorkspaceId!==location.workspaceId){if(input.method!=='GET')throw new ContentError('HISTORICAL_TASK_READ_ONLY','旧作品任务仅可查看',410);return indexed.historicalWorkspaceId}
        return location.workspaceId
      }
      const hits:{workspaceId:string;conversationId?:string;novelId?:string|null}[]=[]
      for (const id of ['inbox',...records.map(row=>row.id)]) {
        const found=await this.works.run(id,async()=>{
          if(scope==='turn')return prisma.chatTurn.findFirst({where:{id:entityId,userId:LOCAL_AUTHOR_ID},select:{id:true,conversationId:true}})
          if(scope==='subagent')return prisma.subAgentRun.findFirst({where:{id:entityId},select:{id:true,conversationId:true,novelId:true}})
          return prisma.conversation.findFirst({where:{id:entityId,userId:LOCAL_AUTHOR_ID},select:{id:true,novelId:true}})
        })
        if(found)hits.push({workspaceId:id,conversationId:'conversationId'in found?found.conversationId??undefined:entityId,novelId:'novelId'in found?found.novelId:undefined})
      }
      if(hits.length>1)throw new ContentError('CONVERSATION_AUTHORITY_AMBIGUOUS','会话存在多份未确认副本，原数据已保留')
      if(!hits.length)throw new ContentError('CONVERSATION_NOT_FOUND','会话或任务不在本地作品中',404)
      const hit=hits[0]
      if(typeof novelId==='string'&&novelId&&hit.novelId!==novelId)throw new ContentError('CONVERSATION_LOCATION_CHANGED','会话与作品不匹配')
      if(this.transfers&&hit.conversationId){
        const owned=await this.works.run(hit.workspaceId,()=>this.transfers!.current(hit.conversationId!))
        if(scope==='turn'||scope==='subagent')await this.transfers.ledger.indexEntity(owned.conversationId,scope==='turn'?'turn':'subagent',entityId,scope==='subagent'?hit.workspaceId:undefined)
        return owned.workspaceId
      }
      return hit.workspaceId
    }
    if (typeof novelId === "string" && novelId) {
      const work = records.find(row => row.novelId === novelId)
      if (!work) throw new Error("作品未关联到本地目录")
      return work.id
    }
    return "inbox"
  }

  async handle(input: LocalRequest, signal: AbortSignal): Promise<Response> {
    input = requestSchema.parse(input)
    const url = new URL(input.path, "https://local.invalid")
    if (url.pathname === "/api/admin/prompts" || url.pathname.startsWith("/api/admin/prompts/") || url.pathname.startsWith("/api/templates/")) {
      return (await dispatchTemplateRequest(new Request(url, {method:input.method,headers:input.headers,body:input.body?.length?Uint8Array.from(input.body):undefined,signal})))!
    }
    if (input.method === "GET" && url.pathname === "/api/novels") {
      const novels = (await Promise.all((await this.works.list()).map(row => this.works.run(row.id, () => prisma.novel.findMany({ where: { userId: LOCAL_AUTHOR_ID, status: { not: "DELETED" } }, select: { id: true, title: true, coverUrl: true, status: true, currentStage: true, createdAt: true, updatedAt: true } }))))).flat()
      return Response.json({ novels: novels.sort((a,b) => b.updatedAt.getTime() - a.updatedAt.getTime()) })
    }
    if (input.method === "GET" && url.pathname === "/api/chat/conversations") {
      const locations=this.transfers?await this.transfers.ledger.locations?.()??[]:[]
      const workspaceIds = [...new Set(["inbox", ...(await this.works.list()).map(row => row.id),...locations.filter(row=>!row.deleted).map(row=>row.workspaceId)])]
      const reads = await Promise.allSettled(workspaceIds.map(id => this.works.run(id, () => prisma.conversation.findMany({
        where: { userId: LOCAL_AUTHOR_ID }, orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, novelId: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
      }))))
      const unavailable=reads.flatMap((read,index)=>read.status==='rejected'?[workspaceIds[index]]:[])
      for(let index=0;index<reads.length;index++)if(reads[index].status==='rejected'&&(!this.transfers||locations.some(row=>!row.deleted&&row.workspaceId===workspaceIds[index])))throw (reads[index] as PromiseRejectedResult).reason
      const groups=reads.map(read=>read.status==='fulfilled'?read.value:[])
      for(const location of locations.filter(row=>!row.deleted))if(!groups[workspaceIds.indexOf(location.workspaceId)]?.some(row=>row.id===location.conversationId&&row.novelId===location.novelId))throw new ContentError('CONVERSATION_AUTHORITY_UNAVAILABLE','会话权威目录或记录暂不可用',410)
      const conversations=[]
      for(let index=0;index<groups.length;index++)for(const row of groups[index]){
        let location=await this.transfers?.ledger.location(row.id)
        if(this.transfers&&!location){if(unavailable.length)throw new ContentError('CONVERSATION_AUTHORITY_UNAVAILABLE','部分会话目录暂不可用，原数据已保留',410);if(groups.flat().filter(value=>value.id===row.id).length>1)throw new ContentError('CONVERSATION_AUTHORITY_AMBIGUOUS','会话存在多份未确认副本，原数据已保留');location=await this.works.run(workspaceIds[index],()=>this.transfers!.current(row.id))}
        if(location&&(location.deleted||location.workspaceId!==workspaceIds[index]))continue
        if(url.searchParams.get('novelId')&&row.novelId!==url.searchParams.get('novelId'))continue
        conversations.push(row)
      }
      return Response.json({ conversations: conversations.sort((a,b) => b.updatedAt.getTime() - a.updatedAt.getTime()) })
    }
    // Global model mutations belong to the main-process vault, not this legacy route.
    if (url.pathname.startsWith("/api/admin/models")) return Response.json({ error: "请在桌面设置中管理模型" }, { status: 400 })
    const match = matchRoute(input.path, input.method)
    if (!match) return Response.json({ error: "本地命令不存在" }, { status: 404 })
    const module = await match.row.load() as Record<string, RouteHandler>
    const request = new Request(url, { method: input.method, headers: input.headers, body: input.body?.length ? Uint8Array.from(input.body) : undefined, signal })
    const invoke=()=>module[input.method](request,{params:Promise.resolve(match.params)})
    if(!this.transfers)return invoke()
    const scope=match.row.scope
    if(scope==='conversation'&&input.method==='DELETE')return invoke()
    let conversationId:string|undefined
    if(scope==='conversation')conversationId=match.params.id
    else if(scope==='chat'&&input.body?.length){try{const body=JSON.parse(new TextDecoder().decode(Uint8Array.from(input.body)));if(typeof body?.conversationId==='string')conversationId=body.conversationId}catch{}}
    else if(scope==='turn'){const row=await getDatabaseContext().database.chatTurn.findFirst({where:{id:match.params.turnId,userId:LOCAL_AUTHOR_ID},select:{conversationId:true}});conversationId=row?.conversationId}
    // Historical subagent/SOP tasks stay read-only in their original work.
    // They cannot inherit the new work's candidate/approval execution scope.
    return conversationId?this.transfers.bind(conversationId,invoke):invoke()
  }
}
