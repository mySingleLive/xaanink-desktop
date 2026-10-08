import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/db"
import { encrypt } from "@/lib/crypto"
import {
  badRequest,
  forbidden,
  maskApiKey,
  requireAdmin,
  serverError,
} from "../lib"

export const dynamic = "force-dynamic"

const PROVIDERS = [
  "openai",
  "anthropic",
  "deepseek",
  "kimi",
  "qwen",
  "zhipu",
  "openai-compatible",
] as const

const modelSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空").max(100),
  provider: z.enum(PROVIDERS),
  modelId: z.string().trim().min(1, "模型 ID 不能为空").max(200),
  apiKey: z.string().trim().min(1, "API Key 不能为空").max(500),
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\//.test(v), "Base URL 必须以 http(s):// 开头")
    .optional(),
  tier: z.enum(["NORMAL", "ADVANCED"]).default("NORMAL"),
  kind: z.enum(["TEXT", "IMAGE"]).default("TEXT"),
  inputCostPer1k: z.number().min(0),
  outputCostPer1k: z.number().min(0),
  contextWindow: z.number().int().positive("上下文窗口必须为正整数").default(128000),
  /** 免费模型标记：用户态模型选择器在名称旁展示「免费」标签 */
  free: z.boolean().default(false),
  enabled: z.boolean().default(true),
})

export async function GET() {
  const session = await requireAdmin()
  if (!session) return forbidden()

  try {
    const models = await prisma.aIModel.findMany({
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        modelId: m.modelId,
        apiKeyMasked: maskApiKey(m.apiKeyEncrypted),
        baseUrl: m.baseUrl,
        tier: m.tier,
        kind: m.kind,
        inputCostPer1k: m.inputCostPer1k,
        outputCostPer1k: m.outputCostPer1k,
        contextWindow: m.contextWindow,
        free: m.free,
        enabled: m.enabled,
        createdAt: m.createdAt,
      })),
    })
  } catch {
    return serverError("模型列表加载失败")
  }
}

export async function POST(request: Request) {
  const session = await requireAdmin()
  if (!session) return forbidden()

  try {
    const body = await request.json()
    const parsed = modelSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "参数不合法")
    }
    const { apiKey, baseUrl, ...rest } = parsed.data

    const created = await prisma.aIModel.create({
      data: {
        ...rest,
        baseUrl: baseUrl || null,
        apiKeyEncrypted: encrypt(apiKey),
      },
    })

    return NextResponse.json(
      {
        model: {
          id: created.id,
          name: created.name,
          provider: created.provider,
          modelId: created.modelId,
          apiKeyMasked: maskApiKey(created.apiKeyEncrypted),
          baseUrl: created.baseUrl,
          tier: created.tier,
          kind: created.kind,
          inputCostPer1k: created.inputCostPer1k,
          outputCostPer1k: created.outputCostPer1k,
          contextWindow: created.contextWindow,
          free: created.free,
          enabled: created.enabled,
          createdAt: created.createdAt,
        },
      },
      { status: 201 }
    )
  } catch {
    return serverError("创建模型失败")
  }
}
