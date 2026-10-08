import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { toErrorResponse } from "@/lib/ai/errors"
import { skipChatInteraction } from "@/lib/services/chat-turn"
export async function POST(request: Request, ctx: { params: Promise<{ turnId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 })
  const input = z.object({ id: z.string(), revision: z.number().int().positive(), action: z.literal("skip") }).safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: "交互参数不合法" }, { status: 400 })
  try { return NextResponse.json(await skipChatInteraction(session.user.id, (await ctx.params).turnId, input.data.id, input.data.revision)) }
  catch (error) { return toErrorResponse(error) }
}
