import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import { prisma } from "@/lib/db"
import {
  getScenarioLab,
  ScenarioCardNotFoundError,
  ScenarioCastError,
  ScenarioLabNotFoundError,
  ScenarioNodeNotFoundError,
  ScenarioStateError,
  type ScenarioLabDTO,
} from "@/lib/services/scenario-lab"

/** 试验场归属校验：不存在或不属于该小说返回 null（路由映射 404） */
export async function getOwnedScenarioLab(
  labId: string,
  novelId: string
): Promise<ScenarioLabDTO | null> {
  const lab = await getScenarioLab(labId)
  if (!lab || lab.novelId !== novelId) return null
  return lab
}

/** 主干情节点归属校验（node ∈ lab ∈ novel 逐级） */
export async function getOwnedScenarioNode(nodeId: string, labId: string, novelId: string) {
  const lab = await getOwnedScenarioLab(labId, novelId)
  if (!lab) return null
  const node = await prisma.scenarioNode.findUnique({ where: { id: nodeId } })
  if (!node || node.labId !== labId) return null
  return node
}

/** 分镜卡归属校验（card ∈ lab ∈ novel 逐级） */
export async function getOwnedScenarioCard(cardId: string, labId: string, novelId: string) {
  const lab = await getOwnedScenarioLab(labId, novelId)
  if (!lab) return null
  const card = await prisma.scenarioCard.findUnique({ where: { id: cardId } })
  if (!card || card.labId !== labId) return null
  return card
}

/** 情景试验场服务层错误 → HTTP 响应（NotFound 404 / 配置与状态 400 / 其余兜底） */
export function toScenarioErrorResponse(err: unknown): NextResponse {
  if (err instanceof ScenarioLabNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 })
  }
  if (err instanceof ScenarioNodeNotFoundError || err instanceof ScenarioCardNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 })
  }
  if (err instanceof ScenarioCastError || err instanceof ScenarioStateError) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
  return toErrorResponse(err)
}
