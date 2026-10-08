import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { streamGeneration } from "@/lib/ai/generate"
import { auth } from "@/lib/auth"

const bodySchema = z.object({
  prompt: z.string().trim().min(1, "prompt 不能为空").max(20000, "prompt 过长"),
})

/**
 * 生成链路自测端点：直接用用户输入的 prompt 走 NORMAL 模型的流式生成全链路
 * （额度校验 → 模型解析 → 流式生成 → 用量记录），不走提示词模板。
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "参数不合法" },
        { status: 400 }
      )
    }

    const result = await streamGeneration({
      userId: session.user.id,
      tier: "NORMAL",
      prompt: parsed.data.prompt,
      action: "test.generate",
    })
    return result.toTextStreamResponse()
  } catch (err) {
    return toErrorResponse(err)
  }
}
