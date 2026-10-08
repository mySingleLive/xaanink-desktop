import { snapshotForRecord } from "@desktop/service/models"
import { acquireLongTask, runInsideLongTask, withLongTask } from "@/lib/long-task"
import { streamText } from "ai"
import type { z } from "zod"

import { currentChatExecution } from "@/lib/chat-execution"
import { waitWithAbort } from "@/lib/abortable-stream"
import type { ModelTier } from "@/generated/prisma/client"
import { getMaxNetworkRetries, runWithNetworkRetry } from "@/lib/ai/network-retry"
import { getModelForUser, type ResolvedModel } from "@/lib/ai/provider"
import { renderPrompt } from "@/lib/prompts/render"
import { checkQuota, recordUsage } from "@/lib/quota"
import { storyDraftText } from "@/lib/story-draft"

interface GenerateBaseOptions {
  userId: string
  novelId?: string
  /** Retained signature only; desktop never routes by platform tier. */
  tier?: ModelTier
  /** Review boundaries declare their role; no action-name guessing or text fallback. */
  role?: "text" | "review"
  /** 用量记录的场景标识，如 outline.generate / chapter.generate */
  action: string
  abortSignal?: AbortSignal
  /** 服务层固定评审配置后注入，不能来自路由/工具参数。 */
  resolvedModel?: ResolvedModel
  /** 子生成仅透出创作文本预览，评审和内部推理不发送到内容面板。 */
  preview?: boolean
}

/** 提示词来源：模板 key + 变量，或直接给完整 prompt */
export type PromptSource =
  | { promptKey: string; vars?: Record<string, string> }
  | { prompt: string }

export type GenerateOptions = GenerateBaseOptions & PromptSource

export interface GenerateResult {
  text: string
  promptTokens: number
  completionTokens: number
  cost: number
  finishReason?: string
}

export interface GenerateJSONResult<T> {
  data: T
  promptTokens: number
  completionTokens: number
  cost: number
  finishReason?: string
}

async function resolvePrompt(source: PromptSource): Promise<string> {
  if ("prompt" in source) {
    return source.prompt
  }
  return renderPrompt(source.promptKey, source.vars ?? {})
}

/**
 * 一次性文本生成：checkQuota → 选模型 → 渲染提示词 → 调用 → 记录用量。
 */
export function generateText(opts: GenerateOptions): Promise<GenerateResult> {
  const executionSignal = currentChatExecution()?.signal
  const signal = opts.abortSignal && executionSignal ? AbortSignal.any([opts.abortSignal, executionSignal]) : opts.abortSignal ?? executionSignal
  return withLongTask(() => generateTextInSlot(opts), signal)
}
async function generateTextInSlot(opts: GenerateOptions): Promise<GenerateResult> {
  const execution = currentChatExecution()
  const signals = [opts.abortSignal, execution?.signal].filter((signal): signal is AbortSignal => !!signal)
  const abortSignal = AbortSignal.any(signals)
  await checkQuota(opts.userId)
  const { model, modelRecord, providerOptions } = opts.resolvedModel ?? await getModelForUser(opts.userId, { tier: opts.tier, role: opts.role, fetch: currentChatExecution()?.networkRetry?.fetch })
  const prompt = await resolvePrompt(opts)

  // 网络断连透明重试（见 lib/ai/network-retry.ts；次数后台可配，缺省 5）：
  // 关闭 SDK 内建重试，计数统一由外层包装承担
  const callModel = async () => {
    let raw = "", previewAt = 0
    const progress = opts.preview ? execution?.progress : undefined
    progress?.({ storyDraft: { text: "" } })
    let streamError: unknown
    const stream = streamText({ onError: ({ error }) => { streamError = error }, model, prompt, providerOptions, maxRetries: 0, abortSignal, onChunk: ({ chunk }) => {
      if (!progress || chunk.type !== "text-delta") return
      raw += chunk.text
      if (Date.now() - previewAt >= 120) { previewAt = Date.now(); progress?.({ storyDraft: { text: storyDraftText(raw) } }) }
    } })
    const [text, usage, finishReason] = await waitWithAbort(Promise.all([stream.text, stream.usage, stream.finishReason]), abortSignal).catch(error => {
      abortSignal.throwIfAborted()
      // SDK 的结果 promise 可能以 NoOutput 拒绝；保留 onError 已捕获的原供应商故障。
      throw streamError ?? error
    })
    abortSignal.throwIfAborted()
    if (streamError) throw streamError
    progress?.({ storyDraft: { text: storyDraftText(text) } })
    return { text, usage, finishReason }
  }
  const result = await runWithNetworkRetry(callModel, {
    maxRetries: execution?.networkRetry?.maxRetries ?? await getMaxNetworkRetries(),
    shouldRetry: execution?.networkRetry?.canRetry,
    signal: abortSignal,
    onRetry: execution?.networkRetry?.notify ?? (({ retryNumber, maxRetries }) =>
      console.warn(
        `[generate] 网络错误，进行第 ${retryNumber}/${maxRetries} 次重试（action=${opts.action}）`
      )),
  })
  const promptTokens = result.usage.inputTokens ?? 0
  const completionTokens = result.usage.outputTokens ?? 0
  const cost = result.usage.inputTokens === undefined && result.usage.outputTokens === undefined ? 0 : await recordUsage({
    userId: opts.userId,
    novelId: opts.novelId,
    modelId: modelRecord.id,
    modelSnapshot: snapshotForRecord(modelRecord),
    action: opts.action,
    promptTokens,
    completionTokens,
  })

  return { text: result.text, promptTokens, completionTokens, cost, finishReason: result.finishReason }
}

/**
 * 流式文本生成：同 generateText 链路，返回 AI SDK 的 StreamTextResult。
 * 调用方用 result.toTextStreamResponse() / toUIMessageStreamResponse() 输出。
 * 用量在 onFinish 回调里记录（失败仅记日志，不影响流）。
 */
export async function streamGeneration(opts: GenerateOptions) {
  await checkQuota(opts.userId)
  const { model, modelRecord, providerOptions } = opts.resolvedModel ?? await getModelForUser(opts.userId, { tier: opts.tier, role: opts.role, fetch: currentChatExecution()?.networkRetry?.fetch })
  const prompt = await resolvePrompt(opts)

  const executionSignal = currentChatExecution()?.signal
  const signal = opts.abortSignal && executionSignal ? AbortSignal.any([opts.abortSignal, executionSignal]) : opts.abortSignal ?? executionSignal
  const release = await acquireLongTask(signal)
  try {
  const result = runInsideLongTask(() => streamText({
    model,
    prompt,
    providerOptions,
    abortSignal: signal,
    maxRetries: 0,
    onFinish: async (event) => {
      try {
        if (event.usage.inputTokens === undefined && event.usage.outputTokens === undefined) return
        await recordUsage({
          userId: opts.userId,
          novelId: opts.novelId,
          modelId: modelRecord.id,
    modelSnapshot: snapshotForRecord(modelRecord),
          action: opts.action,
          promptTokens: event.usage.inputTokens ?? 0,
          completionTokens: event.usage.outputTokens ?? 0,
        })
      } catch (err) {
        console.error(`[generate] 记录用量失败（action=${opts.action}）：`, err)
      }
    },
  }))
  // SDK finishReason resolves before the awaited onFinish callback. Keep the
  // database lease until stream flush and its final usage transaction settle.
  void Promise.resolve(result.consumeStream()).then(release, release)

  return result
  } catch (error) { release(); throw error }
}

const JSON_OUTPUT_INSTRUCTION =
  "\n\n请严格按要求的结构输出结果：只输出一个 JSON 代码块（```json ... ```）或纯 JSON，不要输出任何解释性文字。"

/**
 * 结构化生成：generateText 后从输出中提取 JSON（兼容 ```json 代码块与纯 JSON），
 * 再用 zod 校验。用于大纲生成等结构化输出场景。
 * 提取或校验失败抛 Error。
 */
export async function generateJSON<T>(
  opts: GenerateOptions & { schema: z.ZodType<T> },
  deps?: { generateText: typeof generateText }
): Promise<GenerateJSONResult<T>> {
  const { schema, ...rest } = opts
  const prompt = (await resolvePrompt(rest)) + JSON_OUTPUT_INSTRUCTION
  const generate = deps?.generateText ?? generateText
  let correction = ""
  let promptTokens = 0
  let completionTokens = 0
  let cost = 0
  // 格式错误允许一次重新生成；每次仍走配额、取消与用量记录，不重放外层写入工具。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await generate({ ...rest, prompt: prompt + correction })
    promptTokens += result.promptTokens
    completionTokens += result.completionTokens
    cost += result.cost
    try {
      if (result.finishReason && result.finishReason !== "stop") throw new StructuredGenerationError("incomplete")
      return { data: parseJsonOutput(result.text, schema), promptTokens, completionTokens, cost, finishReason: result.finishReason }
    } catch (error) {
      if (!(error instanceof StructuredGenerationError) || attempt === 1) throw error
      correction = `\n\n上一次输出未通过结构校验（${error.message}）。${error.feedback.length ? `具体字段要求：${error.feedback.join("；")}。` : ""}请重新生成完整、闭合的 JSON，严格保留要求的字段与类型，不要加入解释或 Markdown 之外的内容。`
    }
  }
  throw new StructuredGenerationError("invalid_json")
}

export class StructuredGenerationError extends Error {
  constructor(readonly kind: "invalid_json" | "invalid_schema" | "incomplete", readonly invalidFields: string[] = [], readonly feedback: string[] = []) {
    super(kind === "incomplete" ? "模型输出未完整结束" : kind === "invalid_json" ? "模型未返回可解析的 JSON" : `模型返回结构不完整${invalidFields.length ? `（${invalidFields.join("、")}）` : ""}`)
    this.name = "StructuredGenerationError"
  }
}

export function parseJsonOutput<T>(text: string, schema: z.ZodType<T>): T {
  const candidates: string[] = []
  let invalidFields: string[] | undefined
  let feedback: string[] = []

  // 1. ```json ... ``` 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) {
    candidates.push(fence[1].trim())
  }

  // 2. 首个 {/[ 到末尾 }/] 的截取
  const start = text.search(/[{[]/)
  if (start >= 0) {
    const tail = text.slice(start)
    const end = Math.max(tail.lastIndexOf("}"), tail.lastIndexOf("]"))
    if (end >= 0) {
      candidates.push(tail.slice(0, end + 1))
    }
  }

  // 3. 原文兜底
  candidates.push(text.trim())

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const parsed = schema.safeParse(JSON.parse(candidate))
      if (parsed.success) return parsed.data
      // 只保存结构路径，不将模型原文、请求头或凭证带入错误日志。
      invalidFields = parsed.error.issues.slice(0, 6).map(issue => issue.path.join(".").slice(0, 100))
      feedback = parsed.error.issues.slice(0, 6).map(issue => `${issue.path.join(".").slice(0, 100)}: ${issue.message.slice(0, 250)}`)
    } catch {
      // 尝试下一个候选
    }
  }
  throw new StructuredGenerationError(invalidFields ? "invalid_schema" : "invalid_json", invalidFields, feedback)
}
