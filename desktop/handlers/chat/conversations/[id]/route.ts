import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getChatTurn, selectMissingReviewModel } from "@/lib/services/chat-turn"
import { parseStagedSaveAction } from "@/lib/staged-save"
import { ContentError } from "@/lib/content-errors"
import { restoreTaskDefaults } from "@desktop/shared/task-defaults"
import {conversationLocation,conversationHistory,associateConversation,removeConversation} from "@desktop/service/conversation-runtime"
import {conversationAssociationCommandSchema} from "@desktop/shared/conversation-transfer"
import { reviewSelectionSchema } from '@desktop/shared/model-task'

type RouteContext = { params: Promise<{ id: string }> }

async function getOwnedConversation(id: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) }
  }
  const conversation = await prisma.conversation.findUnique({ where: { id } })
  if (!conversation || conversation.userId !== session.user.id) {
    return { error: NextResponse.json({ error: "会话不存在" }, { status: 404 }) }
  }
  return { conversation }
}

/** 会话详情（含全部消息，按时间升序） */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedConversation(id)
  if ("error" in result) return result.error

  const latest = await prisma.chatTurn.findFirst({ where: { conversationId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
  const turnState = latest ? await getChatTurn(result.conversation.userId, latest.id) : null
  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
  })
  const turns = await prisma.chatTurn.findMany({ where: { conversationId: id }, select: { id: true, interaction: true, action: true } })
  const attempts = await prisma.chatAttempt.findMany({ where: { turn: { conversationId: id } } })
  // 三阶段保存：turn.action 中的暂存批次随用户消息下发，历史气泡据此渲染芯片与悬停明细
  const mode = restoreTaskDefaults(latest?.defaultsSnapshot)?.mode ?? restoreTaskDefaults(result.conversation.defaultsSnapshot)?.mode ?? "standard"
  const location=await conversationLocation(id),history=await conversationHistory(id)
  return NextResponse.json({ conversation: { ...result.conversation, mode,locationRevision:location?.revision??0 }, messages: messages.map(message => ({ ...message, attempt: attempts.find(attempt => attempt.id === message.attemptId) ?? null, interaction: turns.find(turn => turn.id === message.turnId)?.interaction ?? null, stagedBatches: parseStagedSaveAction(turns.find(turn => turn.id === message.turnId)?.action)?.batches ?? null })), turnState,history })
}

const patchSchema = z.object({
  /** Explicit desktop model; null is unselected and cannot run a task. */
  modelId: z.string().nullable(),
  /** 思考强度档位；null=默认档 */
  thinkingEffort: z.string().nullable(),
}).strict()

/** 更新会话的模型选择（模型 + 思考强度）；后续轮次即按新选择生成 */
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedConversation(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  if (body?.type === 'review-selection') {
    const parsed = reviewSelectionSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: '审核模型选择参数不合法' }, { status: 400 })
    try {
      const conversation = await selectMissingReviewModel(result.conversation.userId, id, parsed.data)
      return NextResponse.json({ conversation })
    } catch (error) {
      return NextResponse.json({ error: error instanceof ContentError ? error.message : '未能保存审核模型选择，请重试', ...(error instanceof ContentError ? { code: error.code } : {}) }, { status: error instanceof ContentError ? error.status : 500 })
    }
  }
  if(body&&typeof body==='object'&&'targetNovelId'in body){
    const command=conversationAssociationCommandSchema.safeParse(body)
    if(!command.success||command.data.conversationId!==id)return NextResponse.json({error:'会话关联参数不合法'},{status:400})
    try{
      const location=await associateConversation(id,{operationId:command.data.operationId,novelId:command.data.targetNovelId,expectedLocationRevision:command.data.expectedLocationRevision})
      const conversation=await prisma.conversation.findUniqueOrThrow({where:{id}})
      return NextResponse.json({conversation:{...conversation,locationRevision:location.revision}})
    }catch(error){if(error instanceof ContentError)return NextResponse.json({error:error.message,code:error.code},{status:error.status});throw error}
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 }
    )
  }
  const { modelId, thinkingEffort } = parsed.data
  let savedModelId = modelId
  try {
    const { resolveLocalModel } = await import("@desktop/service/models")
    const model = await resolveLocalModel(result.conversation.userId, "text", modelId, "selection")
    if (thinkingEffort !== null && !model.thinkingLevels.includes(thinkingEffort)) return NextResponse.json({ error: "该模型不支持此思考强度" }, { status: 400 })
    savedModelId = model.id
  } catch (error) { return NextResponse.json({ error: error instanceof ContentError ? error.message : "请选择已添加且启用的文本模型", ...(error instanceof ContentError ? { code: error.code } : {}) }, { status: error instanceof ContentError ? error.status : 400 }) }

  const conversation = await prisma.conversation.update({
    where: { id },
    data: { modelId: savedModelId, thinkingEffort },
  })
  return NextResponse.json({ conversation })
}

/** 删除会话（消息级联删除） */
export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const session=await auth()
  if(!session?.user?.id)return NextResponse.json({error:'未登录'},{status:401})
  try{await removeConversation(id);return NextResponse.json({ok:true})}
  catch(error){if(error instanceof ContentError)return NextResponse.json({error:error.message,code:error.code},{status:error.status});throw error}
}
