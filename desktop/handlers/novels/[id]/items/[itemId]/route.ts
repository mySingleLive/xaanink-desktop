import { NextResponse } from "next/server"

import type { Prisma } from "@/generated/prisma/client"
import { deleteItem, getItem, ItemLevelValidationError, updateItem } from "@/lib/services/item"

import { firstIssueMessage, getOwnedNovel } from "../../lib"
import { patchItemSchema } from "../item-schema"

type RouteContext = { params: Promise<{ id: string; itemId: string }> }

async function getOwnedItem(itemId: string, novelId: string) {
  const item = await getItem(itemId)
  if (!item || item.novelId !== novelId) return null
  return item
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, itemId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedItem(itemId, id)
  if (!existing) {
    return NextResponse.json({ error: "物品不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchItemSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const item = await updateItem(itemId, {
      ...parsed.data,
      aliases: parsed.data.aliases as Prisma.InputJsonValue,
      tags: parsed.data.tags as Prisma.InputJsonValue,
      levels: parsed.data.levels as Prisma.InputJsonValue,
      effects: parsed.data.effects as Prisma.InputJsonValue,
      attributes: parsed.data.attributes as Prisma.InputJsonValue,
    })
    return NextResponse.json({ item })
  } catch (err) {
    if (err instanceof ItemLevelValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, itemId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedItem(itemId, id)
  if (!existing) {
    return NextResponse.json({ error: "物品不存在" }, { status: 404 })
  }

  await deleteItem(itemId)
  return NextResponse.json({ ok: true })
}
