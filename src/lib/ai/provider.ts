import { createAnthropic } from "@ai-sdk/anthropic"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"
import type { SharedV4ProviderOptions } from "@ai-sdk/provider"
import type { AIModel, ModelTier } from "@/generated/prisma/client"
import { currentChatExecution } from "@/lib/chat-execution"
import { assertModelAuthorization, bindModelFetch, localModelFetch, localModelRecord, resolveLocalModel, snapshotForRecord } from "@desktop/service/models"
import { officialModel } from "@desktop/shared/provider-capabilities"
import { authorizeModelOutput, nonStreamingModel } from "./nonstreaming-model"
import { toolCompatibleModel } from "./tool-compatible-model"
import { modelResponseTimeoutFetch } from "./timeouts"
import { buildThinkingProviderOptions } from "./thinking-effort"
import { providerFamily } from "./provider-family"
import { taskDefaults } from "@desktop/service/task-defaults"
import { modelIdForRole } from "@desktop/shared/task-defaults"
import { ContentError } from "@/lib/content-errors"

export interface GetModelForUserOptions {
  /** Retained service signature; desktop authorization never uses Web plan tiers. */
  tier?: ModelTier
  fetch?: typeof fetch
  conversationId?: string
  ignoreChatSession?: boolean
  role?: "text" | "review"
  thinkingEffort?: string | null
}
export interface ResolvedModel { model: LanguageModel; modelRecord: AIModel; providerOptions?: SharedV4ProviderOptions }

export async function getModelForUser(userId: string, opts: GetModelForUserOptions = {}): Promise<ResolvedModel> {
  const execution = currentChatExecution()
  if (!opts.ignoreChatSession && opts.role !== "review" && execution?.userId === userId && execution.resolvedModel) return execution.resolvedModel
  const defaults = execution?.userId === userId && execution.taskDefaults ? execution.taskDefaults : await taskDefaults()
  const record = localModelRecord(await resolveLocalModel(userId, opts.role ?? "text", modelIdForRole(defaults, opts.role ?? "text")))
  return instantiateModel(record, { ...opts, ...(opts.role !== "review" && opts.thinkingEffort === undefined ? { thinkingEffort: defaults.thinking === "default" ? null : defaults.thinking } : {}) })
}
export function withLightReviewThinking(resolved: ResolvedModel): ResolvedModel {
  const snapshot = snapshotForRecord(resolved.modelRecord)
  const effort = snapshot.thinkingLevels.find(level => level !== "default")
  return effort ? { ...resolved, providerOptions: providerOptionsForThinking(snapshot, effort) } : resolved
}
function providerOptionsForThinking(snapshot: ReturnType<typeof snapshotForRecord>, effort: string | null) {
  if (effort !== null && !snapshot.thinkingLevels.includes(effort)) throw new ContentError("MODEL_THINKING_UNSUPPORTED", "所选模型不支持此任务的思考强度，请调整思考设置或选择其他模型", 428)
  const options = buildThinkingProviderOptions(snapshot.provider, effort, snapshot.modelId)
  if (effort !== null && !options) throw new ContentError("MODEL_THINKING_UNSUPPORTED", "所选模型的思考强度尚不支持当前协议，请调整思考设置或选择其他模型", 428)
  return options
}
/** Review uses the author's explicit review configuration, with no substitute model. */
export async function resolveModelForUser(userId: string, opts: GetModelForUserOptions = {}): Promise<ResolvedModel> {
  return withLightReviewThinking(await getModelForUser(userId, { ...opts, role: "review", ignoreChatSession: true }))
}
export async function getModelByIdForUser(userId: string, modelId: string | null, opts: GetModelForUserOptions = {}): Promise<ResolvedModel> {
  const model = await resolveLocalModel(userId, "text", modelId)
  return instantiateModel(localModelRecord(model), opts)
}
/** Legacy callers now resolve only the user-configured desktop default. */
export function getAutoModelForUser(userId: string, opts: GetModelForUserOptions = {}) { return getModelForUser(userId, { ...opts, role: "text", ignoreChatSession: true }) }
export async function resolveDefaultModelRecord(userId: string, opts: GetModelForUserOptions = {}): Promise<AIModel> {
  const execution = currentChatExecution()
  const defaults = execution?.userId === userId && execution.taskDefaults ? execution.taskDefaults : await taskDefaults()
  return localModelRecord(await resolveLocalModel(userId, opts.role ?? "text", modelIdForRole(defaults, opts.role ?? "text")))
}
export function instantiateModel(modelRecord: AIModel, opts: GetModelForUserOptions = {}): ResolvedModel {
  const snapshot = snapshotForRecord(modelRecord)
  // null/default retains the author's model-default choice in task records,
  // while the call uses the saved model effort. Explicit historical efforts
  // are never silently lowered when a model's supported levels change.
  const selectedEffort = opts.thinkingEffort == null || opts.thinkingEffort === "default" ? snapshot.defaultThinking : opts.thinkingEffort
  const effort = selectedEffort === "default" ? null : selectedEffort
  let providerOptions = providerOptionsForThinking(snapshot, effort)
  const fetch = bindModelFetch(snapshot, modelResponseTimeoutFetch(opts.fetch ?? localModelFetch))
  // An inert SDK placeholder; main removes this header and injects the OS-protected key.
  const sdkEndpoint = snapshot.protocol === "anthropic" && !new URL(snapshot.endpoint).pathname.replace(/\/+$/, "").endsWith("/v1") ? snapshot.endpoint.replace(/\/+$/, "") + "/v1" : snapshot.endpoint
  const openaiProtocol = snapshot.protocol === "openai" && ["openai", "custom"].includes(snapshot.provider)
  const capability = officialModel(openaiProtocol ? "openai" : snapshot.provider, snapshot.modelId)
  // The installed SDK has no access_programs option; add this documented
  // field only to the exact approved model's Responses requests.
  const sdkFetch: typeof fetch = openaiProtocol && capability?.accessProgram ? (url, init) => {
    if (new URL(String(url)).pathname.endsWith("/responses") && typeof init?.body === "string") return fetch(url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), access_programs: { cyber: capability.accessProgram } }) })
    return fetch(url, init)
  } : fetch
  const options = { apiKey: "desktop-main-vault", baseURL: sdkEndpoint, fetch: sdkFetch }
  if (openaiProtocol && capability?.wire === "responses") providerOptions = { ...providerOptions, openai: { ...providerOptions?.openai, store: false } }
  let model = snapshot.protocol === "anthropic" ? createAnthropic(options)(snapshot.modelId)
    : ["deepseek", "kimi", "zhipu"].includes(providerFamily(snapshot.provider)) ? createDeepSeek(options)(snapshot.modelId)
    : openaiProtocol && capability?.wire === "responses" ? createOpenAI(options).responses(snapshot.modelId)
    : createOpenAI(options).chat(snapshot.modelId)
  const nonstreaming = openaiProtocol && capability?.streaming === false
  if (nonstreaming) model = nonStreamingModel(model)
  model = toolCompatibleModel(model as Exclude<LanguageModel, string>, snapshot.id)
  if (nonstreaming) model = authorizeModelOutput(model, () => assertModelAuthorization(snapshot))
  return { model, modelRecord, providerOptions }
}
