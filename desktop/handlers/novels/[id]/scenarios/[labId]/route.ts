import { NextResponse } from "next/server"
import { z } from "zod"

import { deleteScenarioLab, getScenarioLabDetail, updateScenarioLab } from "@/lib/services/scenario-lab"
import {
  SCENARIO_CAST_MAX,
  SCENARIO_PREMISE_MAX,
  SCENARIO_SCENES_MAX,
} from "@/lib/scenario-lab"

import { firstIssueMessage, getOwnedNovel } from "../../lib"
import { getOwnedScenarioLab, toScenarioErrorResponse } from "../lib"

type RouteContext = { params: Promise<{ id: string; labId: string }> }

const patchScenarioSchema = z
  .object({
    title: z.string().trim().min(1, "试验场需要起个名字").max(100).optional(),
    cast: z
      .array(
        z.object({
          characterId: z.string().trim().min(1),
          control: z.enum(["ai", "user"]).default("ai"),
        })
      )
      .max(SCENARIO_CAST_MAX)
      .optional(),
    sceneIds: z.array(z.string().trim().min(1)).max(SCENARIO_SCENES_MAX).optional(),
    premise: z.string().trim().max(SCENARIO_PREMISE_MAX).optional(),
    /** 样文手动编辑保存 */
    prose: z.string().max(100000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "没有需要更新的字段" })

/** 详情：lab + 全部回合 + 主干节点 + 分镜卡（面板一次取齐） */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id, labId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const owned = await getOwnedScenarioLab(labId, id)
  if (!owned) {
    return NextResponse.json({ error: "情景试验场不存在" }, { status: 404 })
  }

  const detail = await getScenarioLabDetail(labId)
  if (!detail) {
    return NextResponse.json({ error: "情景试验场不存在" }, { status: 404 })
  }
  return NextResponse.json({
    scenario: detail.lab,
    turns: detail.turns,
    nodes: detail.nodes,
    cards: detail.cards,
  })
}

/** 改配置（标题/参演名单/场景/开场剧情）或保存样文 */
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, labId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const owned = await getOwnedScenarioLab(labId, id)
  if (!owned) {
    return NextResponse.json({ error: "情景试验场不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchScenarioSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const scenario = await updateScenarioLab(labId, parsed.data)
    return NextResponse.json({ scenario })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}

/** 删试验场：事务内级联删回合/节点/分镜卡 */
export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, labId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const owned = await getOwnedScenarioLab(labId, id)
  if (!owned) {
    return NextResponse.json({ error: "情景试验场不存在" }, { status: 404 })
  }

  try {
    await deleteScenarioLab(labId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}
