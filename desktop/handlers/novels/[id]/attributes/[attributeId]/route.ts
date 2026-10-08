import { NextResponse } from "next/server"
import { z } from "zod"

import { AttributeTarget, AttributeValueType } from "@/generated/prisma/enums"
import {
  deleteAttributeDefinition,
  getAttributeDefinition,
  updateAttributeDefinition,
} from "@/lib/services/attribute"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string; attributeId: string }> }

const patchAttributeSchema = z
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

async function getOwnedDefinition(attributeId: string, novelId: string) {
  const definition = await getAttributeDefinition(attributeId)
  if (!definition || definition.novelId !== novelId) return null
  return definition
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, attributeId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedDefinition(attributeId, id)
  if (!existing) {
    return NextResponse.json({ error: "属性不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchAttributeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  const definition = await updateAttributeDefinition(attributeId, parsed.data)
  return NextResponse.json({ definition })
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, attributeId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedDefinition(attributeId, id)
  if (!existing) {
    return NextResponse.json({ error: "属性不存在" }, { status: 404 })
  }

  await deleteAttributeDefinition(attributeId)
  return NextResponse.json({ ok: true })
}
