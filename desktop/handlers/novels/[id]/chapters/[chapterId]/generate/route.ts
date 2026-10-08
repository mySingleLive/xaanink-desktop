import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import {
  ChapterNotReadyError,
  getChapter,
  consumeChapterGeneration,
  prepareChapterGeneration,
} from "@/lib/services/chapter"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"
import { mutationInput } from "../history-api"

type RouteContext = { params: Promise<{ id: string; chapterId: string }> }

const generateSchema = z.object({
  guidance: z.string().trim().max(2000).optional(),
  /** 本章目标字数；不传用服务层默认值（服务层还会再做一次区间夹取） */
  wordCount: z.number().int().min(800).max(8000).optional(),
})

/**
 * 草稿、候选和提交回执分别发送 SSE 事件。断连中止上游生成；
 * 可捕获的半截输出保留为不可采用候选，已完成的事务以保存回执为准。
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, chapterId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const chapter = await getChapter(chapterId)
  if (!chapter || chapter.volume.novelId !== id) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = generateSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const input = mutationInput(body)
    const abort = new AbortController()
    const prepared = await prepareChapterGeneration(chapterId, result.session.user.id, {
      ...input,
      guidance: parsed.data.guidance,
      wordCount: parsed.data.wordCount,
      abortSignal: AbortSignal.any([request.signal, abort.signal]),
    })

    const encoder = new TextEncoder()
    let connected = true
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const event = (type: string, data: unknown) => {
          if (connected) { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`)) } catch { connected = false } }
        }
        try {
          const generated = await consumeChapterGeneration(prepared, delta => event("draft-delta", { delta }))
          event("candidate-ready", generated.candidate)
          if (generated.receipt) event("content-committed", generated.receipt)
        } catch {
          event("error", { code: "PERSISTENCE_FAILED", message: "生成稿保存失败，原稿保留，请重试" })
        } finally { if (connected) controller.close() }
      },
      cancel() { connected = false; abort.abort() },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (err) {
    if (err instanceof ChapterNotReadyError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return toErrorResponse(err)
  }
}
