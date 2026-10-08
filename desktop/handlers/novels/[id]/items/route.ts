import { NextResponse } from "next/server"

import type { Prisma } from "@/generated/prisma/client"
import { createItem, ItemLevelValidationError, listItems } from "@/lib/services/item"

import { firstIssueMessage, getOwnedNovel } from "../lib"
import { itemSchema } from "./item-schema"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const items = await listItems(id)
  return NextResponse.json({ items })
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = itemSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const item = await createItem(id, {
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
