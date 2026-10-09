import { simulateStreamingMiddleware, wrapLanguageModel, type LanguageModel } from "ai"
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"

/** One real non-streaming generation, delivered through the existing SDK
 * stream contract. No queued text/tool event outlives cancellation or the
 * main process's current model authorization. */
export function authorizedNonStreamingModel(model: Exclude<LanguageModel, string>, assertAuthorization: () => Promise<void>) {
  return authorizeModelOutput(nonStreamingModel(model), assertAuthorization)
}
export function nonStreamingModel(model: Exclude<LanguageModel, string>) {
  return wrapLanguageModel({ model, middleware: simulateStreamingMiddleware() })
}
/** Place this outside every event-producing transform, including the tool
 * compatibility decoder, whose finish step can enqueue multiple events. */
export function authorizeModelOutput(model: Exclude<LanguageModel, string>, assertAuthorization: () => Promise<void>) {
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: "v4",
    wrapStream: async ({ doStream, params }) => {
      const check = async () => { params.abortSignal?.throwIfAborted(); await assertAuthorization(); params.abortSignal?.throwIfAborted() }
      await check()
      const result = await doStream()
      try { await check() } catch (error) { await result.stream.cancel(error).catch(() => undefined); throw error }
      const reader = result.stream.getReader()
      let ended = false, released = false
      const release = () => { if (!released) { released = true; reader.releaseLock() } }
      return { ...result, stream: new ReadableStream<LanguageModelV4StreamPart>({
        async pull(controller) {
          try {
            await check(); if (ended) return
            const next = await reader.read(); await check(); if (ended) return
            if (next.done) { ended = true; release(); controller.close() }
            else controller.enqueue(next.value)
          } catch (error) {
            if (ended) return
            ended = true; await reader.cancel(error).catch(() => undefined); release(); controller.error(error)
          }
        },
        async cancel(reason) { if (!ended) { ended = true; try { await reader.cancel(reason) } finally { release() } } },
      }, { highWaterMark: 0 }) }
    },
    wrapGenerate: async ({ doGenerate, params }) => {
      params.abortSignal?.throwIfAborted(); await assertAuthorization()
      const result = await doGenerate()
      params.abortSignal?.throwIfAborted(); await assertAuthorization(); params.abortSignal?.throwIfAborted()
      return result
    },
  } })
}
