import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { transformSync } from "esbuild"
import { ChatExecutionController } from "../../src/lib/chat-stream"
import { chatTaskOverrides, newChatChoices, restoreChatChoices } from "../../src/lib/desktop/chat-defaults"
import { defaultState } from "../../desktop/core/settings"
import { taskDefaultsSchema, freezeTaskDefaults } from "../../desktop/shared/task-defaults"

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function gatedJson(body: ReturnType<typeof deferred<unknown>>, entered: ReturnType<typeof deferred<void>>, status = 200) {
  const response = new Response("{}", { status, headers: { "content-type": "application/json" } })
  response.json = () => { entered.resolve(); return body.promise }
  return response
}
function controlledHook() {
  const state: Record<string, any> = {
    accountId: "local-author", conversationId: "conversation-a", draftId: "draft-a", draftNovelId: "novel-a",
    recoveryStatus: "ready", modelChoice: { modelId: "model-a", effort: null }, modelChoiceExplicit: true,
    mode: "standard", modeExplicit: true, pendingRequest: null, draftAction: null, pendingQuestion: null,
    pendingPlan: null, isGenerating: false, queuedMessages: [], setIsGenerating(value: boolean) { state.isGenerating = value },
  }
  const store = { getState: () => ({ ...state }), setState: (value: Record<string, unknown> | ((s: typeof state) => Record<string, unknown>)) => Object.assign(state, typeof value === "function" ? value(state) : value) }
  const queryClient = { invalidateQueries() {}, clear() {} }
  const output = { exports: {} as { useAgentChat(id: string): { send(text: string, novel: string | null): Promise<boolean>; retryTurn(id: string): Promise<void>; resetConversation(novel: string | null): void } } }
  const code = transformSync(readFileSync(new URL("../../src/components/chat/use-agent-chat.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code
  class SilentPublisher { constructor(..._args: unknown[]) {} push() {} flush() {} dispose() {} }
  new Function("module", "exports", "require", code)(output, output.exports, (name: string) => {
    if (name === "react") return { useState: (initial: unknown) => { let value: any = typeof initial === "function" ? (initial as () => unknown)() : initial; return [value, (next: any) => { value = typeof next === "function" ? next(value) : next }] }, useCallback: (fn: unknown) => fn, useEffect() {}, useRef: (initial: unknown) => ({ current: initial }) }
    if (name === "@tanstack/react-query") return { useQueryClient: () => queryClient }
    if (name === "@/stores/chat") return { useChatStore: store }
    if (name === "@/stores/desktop") return { useDesktopStore: { getState: () => ({ bootstrap: { settings: defaultState.settings } }) } }
    if (name === "@desktop/core/settings") return { defaultState }
    if (name === "@desktop/shared/task-defaults") return { taskDefaultsSchema }
    if (name === "@/lib/desktop/chat-defaults") return { chatTaskOverrides, newChatChoices, restoreChatChoices }
    if (name === "@/lib/chat-session") return { ChatSessionRepository: class {}, browserSessionStorage: () => null }
    if (name === "@/lib/chat-stream") return { ChatExecutionController, startChatStream: (id: string) => ({ message: { id, role: "assistant", toolCalls: [] }, status: "running", writeStarted: false }), finalizeAttempt: (s: any, status: string) => ({ ...s, status }), reduceChatStream: (s: unknown) => s }
    if (name === "@/lib/chat-parts") return { FramePublisher: SilentPublisher, parseChatParts: () => [] }
    if (name === "@/lib/chat-protocol") return { connectionFeedback: () => "ok" }
    if (name === "@/lib/ai/error-classification") return { ERROR_TEXT: {}, classifyWireError: () => ({ message: "fixture" }) }
    if (name === "@/stores/staged-changes") return { useStagedChangesStore: { getState: () => ({ takeForSend: () => [], markSent() {} }) } }
    if (name === "@/stores/story-activity") return { useStoryActivityStore: { getState: () => ({ activity: null }), setState() {} } }
    if (name === "./types") return { WRITE_TOOLS: new Set(), TOOL_LABELS: {} }
    if (name === "./scene-receipts") return { applySceneCommitReceipt() {} }
    if (name === "sonner") return { toast: { error() {} } }
    return {}
  })
  const hook = output.exports.useAgentChat("local-author")
  return { state, hook }
}
async function withFetch(run: () => Promise<void>) { const prior = globalThis.fetch; try { await run() } finally { globalThis.fetch = prior } }
function turn(conversationId = "conversation-a") { return { turn: { id: "turn-a", conversationId, latestAttemptId: "attempt-a", status: "failed", interaction: null }, attempts: [], messages: [], recovery: { latest: true, canRetry: true, canResume: false, hasEffects: false, unknownExternal: false } } }

test("retry state lookup completed after a conversation switch cannot submit the old turn into the new conversation", async () => withFetch(async () => {
  const lookup = deferred<Response>(); const posts: unknown[] = []
  globalThis.fetch = async (url, init) => {
    if (String(url) === "/api/chat/turns/turn-a") return lookup.promise
    posts.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ code: "MODEL_NOT_SELECTED", error: "fixture" }), { status: 400 })
  }
  const f = controlledHook(); const running = f.hook.retryTurn("turn-a")
  f.state.conversationId = "conversation-b"; f.state.draftId = "draft-b"; f.state.draftNovelId = "novel-b"; f.state.modelChoice = { modelId: "model-b", effort: null }
  lookup.resolve(new Response(JSON.stringify(turn()))); await running
  assert.deepEqual(posts, []); assert.equal(f.state.conversationId, "conversation-b"); assert.equal(f.state.isGenerating, false)
}))

test("late accepted JSON body after reset cannot restore the cancelled conversation or overwrite the new draft", async () => withFetch(async () => {
  const body = deferred<unknown>(); const entered = deferred<void>()
  globalThis.fetch = async () => gatedJson(body, entered)
  const f = controlledHook(); const running = f.hook.send("hello", "novel-a"); await entered.promise
  f.hook.resetConversation("novel-b"); const newDraft = f.state.draftId
  body.resolve({ ...turn(), turn: { ...turn().turn, defaultsSnapshot: freezeTaskDefaults(defaultState.settings.agent, 1) } }); await running
  assert.equal(f.state.conversationId, null); assert.equal(f.state.draftId, newDraft); assert.equal(f.state.draftNovelId, "novel-b")
}))

test("retry lookup cannot resume after navigating away and returning to the same saved conversation and draft", async () => withFetch(async () => {
  const lookup = deferred<Response>(); const posts: unknown[] = []
  globalThis.fetch = async (url, init) => {
    if (String(url) === "/api/chat/turns/turn-a") return lookup.promise
    posts.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ error: "fixture" }), { status: 400 })
  }
  const f = controlledHook(); const running = f.hook.retryTurn("turn-a")
  f.hook.resetConversation("novel-b")
  f.state.conversationId = "conversation-a"; f.state.draftId = "draft-a"; f.state.draftNovelId = "novel-a"
  lookup.resolve(new Response(JSON.stringify(turn()))); await running
  assert.deepEqual(posts, []); assert.equal(f.state.isGenerating, false)
}))

test("late error JSON cannot clear a new draft's pending request", async () => withFetch(async () => {
  const body = deferred<unknown>(); const entered = deferred<void>()
  globalThis.fetch = async () => gatedJson(body, entered, 400)
  const f = controlledHook(); const running = f.hook.send("hello", "novel-a"); await entered.promise
  f.hook.resetConversation("novel-b"); const pending = { clientRequestId: "new-request", body: '{"message":"new draft"}' }; f.state.pendingRequest = pending
  body.resolve({ error: "old request rejected", code: "MODEL_NOT_SELECTED" }); await running
  assert.deepEqual(f.state.pendingRequest, pending); assert.equal(f.state.conversationId, null); assert.equal(f.state.draftNovelId, "novel-b")
}))

test("accepted defaults retain an explicit choice and mode changed while the submission body is pending", async () => withFetch(async () => {
  const body = deferred<unknown>(); const entered = deferred<void>()
  globalThis.fetch = async url => String(url) === "/api/chat" ? gatedJson(body, entered) : new Response(JSON.stringify(turn()))
  const f = controlledHook(); const running = f.hook.send("hello", "novel-a"); await entered.promise
  f.state.modelChoice = { modelId: "next-explicit-model", effort: "high" }; f.state.modelChoiceExplicit = true; f.state.mode = "plan"; f.state.modeExplicit = true
  body.resolve({ ...turn(), turn: { ...turn().turn, defaultsSnapshot: freezeTaskDefaults({ ...defaultState.settings.agent, textModelId: "accepted-model" }, 1) } }); await running
  assert.deepEqual(f.state.modelChoice, { modelId: "next-explicit-model", effort: "high" }); assert.equal(f.state.mode, "plan")
}))
