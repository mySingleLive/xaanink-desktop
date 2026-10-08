import { NextResponse } from "next/server"
import { z } from "zod"

import { AttributeTarget, AttributeValueType } from "@/generated/prisma/enums"
import {
  createAttributeDefinition,
  listAttributeDefinitions,
} from "@/lib/services/attribute"

import { firstIssueMessage, getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const attributeSchema = z
  .object({
    name: z.string().trim().min(1, "属性名称不能为空").max(50),
    description: z.string().max(2000).default(""),
    targets: z
      .array(z.enum(AttributeTarget))
      .min(1, "至少选择一个适用对象")
      .max(3),
    valueType: z.enum(AttributeValueType).default("TEXT"),
    options: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  })
  .refine((data) => data.valueType === "SELECT" || data.options.length === 0, {
    message: "仅选项类型可设置可选值",
  })
  .refine((data) => data.valueType !== "SELECT" || data.options.length >= 2, {
    message: "选项类型至少需要两个可选值",
  })

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const definitions = await listAttributeDefinitions(id)
  return NextResponse.json({ definitions })
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = attributeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  const definition = await createAttributeDefinition(id, parsed.data)
  return NextResponse.json({ definition })
}
