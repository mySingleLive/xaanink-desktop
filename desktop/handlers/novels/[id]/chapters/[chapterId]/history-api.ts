import { z } from "zod"
import { NextResponse } from "next/server"
import { getOwnedNovel } from "../../lib"
import { toErrorResponse } from "@/lib/ai/errors"
import { ContentError, requireVersion } from "@/lib/content-errors"
import type { ChapterScope } from "@/lib/services/chapter-history"

export type ChapterRouteContext = { params: Promise<{ id: string; chapterId: string; versionId?: string; candidateId?: string }> }
export const mutationSchema = z.object({ expectedVersion: z.number().int().positive(), operationId: z.string().min(1).max(140) })
export function mutationInput(body: unknown) {
  requireVersion((body as { expectedVersion?: unknown } | null)?.expectedVersion)
  const parsed = mutationSchema.safeParse(body)
  if (!parsed.success) throw new ContentError("INVALID_REQUEST", "请提供有效操作编号和版本", 400)
  return parsed.data
}
export function pagination(request: Request) {
  const params = new URL(request.url).searchParams
  return { cursor: params.get("cursor") ?? undefined, limit: params.has("limit") ? Number(params.get("limit")) : undefined }
}
export async function chapterRoute(ctx: ChapterRouteContext, action: (scope: ChapterScope, params: Awaited<ChapterRouteContext["params"]>) => Promise<unknown>) {
  const params = await ctx.params
  const owned = await getOwnedNovel(params.id)
  if ("error" in owned) return owned.error
  try { return NextResponse.json(await action({ userId: owned.session.user.id, novelId: params.id, chapterId: params.chapterId }, params)) }
  catch (error) { return toErrorResponse(error) }
}
