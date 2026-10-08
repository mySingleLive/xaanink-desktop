import { NextResponse } from "next/server"
import { z } from "zod"

import { createScenarioLab, listScenarioLabs } from "@/lib/services/scenario-lab"
import {
  SCENARIO_CAST_MAX,
  SCENARIO_PREMISE_MAX,
  SCENARIO_SCENES_MAX,
} from "@/lib/scenario-lab"

import { firstIssueMessage, getOwnedNovel } from "../lib"
import { toScenarioErrorResponse } from "./lib"

type RouteContext = { params: Promise<{ id: string }> }

const castMemberSchema = z.object({
  characterId: z.string().trim().min(1),
  control: z.enum(["ai", "user"]).default("ai"),
})

const createScenarioSchema = z.object({
  title: z.string().trim().min(1, "试验场需要起个名字").max(100),
  cast: z.array(castMemberSchema).max(SCENARIO_CAST_MAX).optional(),
  sceneIds: z.array(z.string().trim().min(1)).max(SCENARIO_SCENES_MAX).optional(),
  premise: z.string().trim().max(SCENARIO_PREMISE_MAX).optional(),
})

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const scenarios = await listScenarioLabs(id)
  return NextResponse.json({ scenarios })
}

/** 建试验场（可顺带带上初始配置；配置也可之后在面板里补） */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = createScenarioSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const scenario = await createScenarioLab(id, parsed.data)
    return NextResponse.json({ scenario })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}
