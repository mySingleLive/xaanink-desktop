import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { prisma } from "@/lib/db"
import { updateVolume } from "@/lib/services/outline"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; volumeId: string }> }

const patchSchema = z
  .object({
    title: z.string().trim().min(1, "卷名不能为空").max(100).optional(),
    summary: z.string().max(5000).optional(),
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .refine((data) => data.title !== undefined || data.summary !== undefined, { message: "没有需要更新的字段" })

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, volumeId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const volume = await prisma.volume.findUnique({ where: { id: volumeId } })
  if (!volume || volume.novelId !== id) {
    return NextResponse.json({ error: "卷不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const { expectedUpdatedAt, ...changes } = parsed.data
    const updated = await updateVolume(volumeId, changes, expectedUpdatedAt)
    return NextResponse.json({ volume: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
