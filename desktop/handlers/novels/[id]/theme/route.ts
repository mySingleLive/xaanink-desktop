import { NextResponse } from "next/server"
import { ContentError } from "@/lib/content-errors"
import { z } from "zod"

import { getTheme, upsertTheme, themeInputSchema } from "@/lib/services/theme"

import { firstIssueMessage, getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const themeSchema = themeInputSchema.extend({ expectedVersion: z.number().int().min(0).optional(), operationId: z.string().min(1).max(200).optional() })

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const theme = await getTheme(id)
  return NextResponse.json({ theme })
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = themeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  const { expectedVersion, operationId, ...data } = parsed.data
  try {
    const theme = await upsertTheme(id, data, { source: "author", userId: result.novel.userId, expectedVersion, operationId })
    return NextResponse.json({ theme })
  } catch (error) {
    if (error instanceof ContentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    throw error
  }
}
