import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { toErrorResponse } from "@/lib/ai/errors"
import { cancelChatTurn } from "@/lib/services/chat-turn"
export async function POST(_request: Request, ctx: { params: Promise<{ turnId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 })
  try { return NextResponse.json(await cancelChatTurn(session.user.id, (await ctx.params).turnId)) }
  catch (error) { return toErrorResponse(error) }
}
