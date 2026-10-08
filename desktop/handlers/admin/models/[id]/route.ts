import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/db"
import { encrypt } from "@/lib/crypto"
import {
  badRequest,
  forbidden,
  maskApiKey,
  notFound,
  requireAdmin,
  serverError,
} from "../../lib"

export const dynamic = "force-dynamic"

const updateModelSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    provider: z
      .enum(["openai", "anthropic", "deepseek", "kimi", "qwen", "zhipu", "openai-compatible"])
      .optional(),
    modelId: z.string().trim().min(1).max(200).optional(),
    apiKey: z.string().trim().min(1).max(500).optional(),
    baseUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https?:\/\//.test(v), "Base URL 必须以 http(s):// 开头")
      .optional(),
    tier: z.enum(["NORMAL", "ADVANCED"]).optional(),
    kind: z.enum(["TEXT", "IMAGE"]).optional(),
    inputCostPer1k: z.number().min(0).optional(),
    outputCostPer1k: z.number().min(0).optional(),
    contextWindow: z.number().int().positive("上下文窗口必须为正整数").optional(),
    free: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "没有要更新的字段" })

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin()
  if (!session) return forbidden()

  try {
    const { id } = await params
    const body = await request.json()
    const parsed = updateModelSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "参数不合法")
    }
    const { apiKey, baseUrl, ...rest } = parsed.data

    const existing = await prisma.aIModel.findUnique({ where: { id } })
    if (!existing) return notFound("模型不存在")

    const updated = await prisma.aIModel.update({
      where: { id },
      data: {
        ...rest,
        ...(baseUrl !== undefined ? { baseUrl: baseUrl || null } : {}),
        // 仅当传入了新 key 才重新加密，否则保留原密文
        ...(apiKey ? { apiKeyEncrypted: encrypt(apiKey) } : {}),
      },
    })

    return NextResponse.json({
      model: {
        id: updated.id,
        name: updated.name,
        provider: updated.provider,
        modelId: updated.modelId,
        apiKeyMasked: maskApiKey(updated.apiKeyEncrypted),
        baseUrl: updated.baseUrl,
        tier: updated.tier,
        kind: updated.kind,
        inputCostPer1k: updated.inputCostPer1k,
        outputCostPer1k: updated.outputCostPer1k,
        contextWindow: updated.contextWindow,
        free: updated.free,
        enabled: updated.enabled,
        createdAt: updated.createdAt,
      },
    })
  } catch {
    return serverError("更新模型失败")
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin()
  if (!session) return forbidden()

  try {
    const { id } = await params
    const existing = await prisma.aIModel.findUnique({ where: { id } })
    if (!existing) return notFound("模型不存在")

    // 删除模型会级联删除用量记录，已有用量时只允许停用
    const usageCount = await prisma.usageRecord.count({ where: { modelId: id } })
    if (usageCount > 0) {
      return badRequest("该模型已产生用量记录，无法删除，请改为停用")
    }

    await prisma.aIModel.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return serverError("删除模型失败")
  }
}
