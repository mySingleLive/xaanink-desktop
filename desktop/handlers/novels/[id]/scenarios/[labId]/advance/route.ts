import { NextResponse } from "next/server"
import { z } from "zod"

import { runScenarioTurn } from "@/lib/services/scenario-ai"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"
import { getOwnedScenarioLab, toScenarioErrorResponse } from "../../lib"

type RouteContext = { params: Promise<{ id: string; labId: string }> }

const advanceSchema = z
  .object({
    /** 旁观用户：以导演身份注入的推动指示 */
    direction: z.string().trim().min(1).max(2000).optional(),
    /** 扮演用户：以所演角色的身份说（say）/做（do） */
    act: z
      .object({
        kind: z.enum(["say", "do"]),
        content: z.string().trim().min(1).max(2000),
      })
      .optional(),
  })
  .refine((data) => !(data.direction && data.act), {
    message: "导演指示与角色行动只能二选一",
  })

/**
 * 推进一回合：N 个 actor agent 并行扮演 → 用户言行注入 → director 裁定 → check 把关。
 * body 可为 {}（旁观、无指示直接推进）。
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, labId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const owned = await getOwnedScenarioLab(labId, id)
  if (!owned) {
    return NextResponse.json({ error: "情景试验场不存在" }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) ?? {}
  const parsed = advanceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const turn = await runScenarioTurn({
      userId: result.session.user.id,
      novelId: id,
      labId,
      direction: parsed.data.direction,
      act: parsed.data.act,
    })
    return NextResponse.json({ turn })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}
