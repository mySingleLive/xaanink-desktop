import { NextResponse } from "next/server"
import { z } from "zod"

import {
  getMaxNetworkRetries,
  MAX_MAX_NETWORK_RETRIES,
  MIN_MAX_NETWORK_RETRIES,
  setMaxNetworkRetries,
} from "@/lib/ai/network-retry"

import { forbidden, requireAdmin, serverError } from "../lib"
import { costConfigSchema, getCostConfig, setCostConfig } from "@/lib/ai/cost-config"

export const dynamic = "force-dynamic"

const putSchema = z.object({
  /** AI 生成的最大网络重试次数（0=关闭自动重试，默认 5） */
  maxNetworkRetries: z
    .number()
    .int("必须是整数")
    .min(MIN_MAX_NETWORK_RETRIES, `最小为 ${MIN_MAX_NETWORK_RETRIES}`)
    .max(MAX_MAX_NETWORK_RETRIES, `最大为 ${MAX_MAX_NETWORK_RETRIES}`).optional(),
  costGovernance: costConfigSchema.optional(),
}).refine(value => value.maxNetworkRetries !== undefined || value.costGovernance !== undefined, "请提供要修改的配置")

/** 读取系统配置（当前仅 AI 网络重试次数；缺省值在服务端兜底，未配置时返回默认值） */
export async function GET() {
  const session = await requireAdmin()
  if (!session) return forbidden()

  try {
    const [maxNetworkRetries, costGovernance] = await Promise.all([getMaxNetworkRetries(), getCostConfig()])
    return NextResponse.json({ maxNetworkRetries, costGovernance })
  } catch {
    return serverError("配置读取失败")
  }
}

/** 更新系统配置 */
export async function PUT(request: Request) {
  const session = await requireAdmin()
  if (!session) return forbidden()

  const body = await request.json().catch(() => null)
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 }
    )
  }

  try {
    if (parsed.data.maxNetworkRetries !== undefined) await setMaxNetworkRetries(parsed.data.maxNetworkRetries)
    if (parsed.data.costGovernance) await setCostConfig(parsed.data.costGovernance)
    return NextResponse.json({ maxNetworkRetries: await getMaxNetworkRetries(), costGovernance: await getCostConfig() })
  } catch {
    return serverError("配置保存失败")
  }
}
