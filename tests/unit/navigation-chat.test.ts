import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { transformSync } from "esbuild"
import { ChatExecutionController } from "../../src/lib/chat-stream"
import { ChatSessionRepository, emptyChatSession, type ChatSessionEntry } from "../../src/lib/chat-session"
import { chatTaskOverrides, newChatChoices, restoreChatChoices } from "../../src/lib/desktop/chat-defaults"
import { defaultState } from "../../desktop/core/settings"
import { taskDefaultsSchema } from "../../desktop/shared/task-defaults"
import type { DesktopChatNavigation } from "../../src/lib/desktop/navigation-runtime"
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j }); return { promise, resolve, reject } }
function controlledHook(entries: ChatSessionEntry[] = []) {
  const repository = new ChatSessionRepository("author", { getItem: () => null, setItem() {}, removeItem() {} })
  for (const entry of entries) repository.save(entry)
  const state: Record<string, any> = { accountId: "author", conversationId: "old-chat", draftId: "old-draft", draft: "unsaved input", draftNovelId: "old-novel", queuedMessages: [{ id: "q-old", text: "queued input" }], queuePaused: false, recoveryStatus: "ready", pendingRequest: null, modelChoice: { modelId: "old-model", effort: null }, modelChoiceExplicit: true, mode: "standard", modeExplicit: true, isGenerating: false, setIsGenerating(value: boolean) { state.isGenerating = value }, requestChatFocus() { state.chatFocusNonce = (state.chatFocusNonce ?? 0) + 1 } }
  const store = { getState: () => ({ ...state }), setState: (value: Record<string, unknown> | ((s: typeof state) => Record<string, unknown>)) => Object.assign(state, typeof value === "function" ? value(state) : value) }
  const effects: Array<() => void | (() => void)> = [], setters: unknown[][] = [], errors: unknown[] = []
  let adapter: DesktopChatNavigation | null = null
  const code = transformSync(readFileSync(new URL("../../src/components/chat/use-agent-chat.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code
  const module = { exports: {} as { useAgentChat(id: string): { loadConversation(id: string, options?: { signal?: AbortSignal; preserveOnFailure?: boolean }): Promise<boolean>; resetConversation(novel: string | null): void } } }
  const deps: Record<string, unknown> = {
    react: { useState: (initial: any) => { const updates: unknown[] = []; setters.push(updates); let value = typeof initial === "function" ? initial() : initial; return [value, (next: any) => { value = typeof next === "function" ? next(value) : next; updates.push(value) }] }, useCallback: (fn: unknown) => fn, useEffect: (effect: () => void | (() => void)) => effects.push(effect), useRef: (current: unknown) => ({ current }) },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries() {}, clear() {} }) },
    "@/stores/chat": { useChatStore: store }, "@/stores/desktop": { useDesktopStore: { getState: () => ({ bootstrap: { settings: defaultState.settings } }) } },
    "@desktop/core/settings": { defaultState }, "@desktop/shared/task-defaults": { taskDefaultsSchema },
    "@/lib/desktop/chat-defaults": { chatTaskOverrides, newChatChoices, restoreChatChoices },
    "@/lib/chat-session": { ChatSessionRepository: function () { return repository }, browserSessionStorage: () => null },
    "@/lib/chat-stream": { ChatExecutionController }, "@/lib/chat-parts": { parseChatParts: () => [] },
    "@/lib/desktop/navigation-runtime": { registerDesktopChatNavigation: (next: DesktopChatNavigation) => { adapter = next; return () => { if (adapter === next) adapter = null } } },
    "sonner": { toast: { error: (error: unknown) => errors.push(error) } },
  }
  new Function("module", "exports", "require", code)(module, module.exports, (name: string) => deps[name] ?? {})
  const hook = module.exports.useAgentChat("author")
  function mountAdapter() { const effect = effects.find(fn => fn.toString().includes("registerDesktopChatNavigation")); assert.ok(effect, "the actual hook must register a navigation adapter"); const cleanup = effect(); assert.ok(adapter); return { adapter: adapter!, cleanup: typeof cleanup === "function" ? cleanup : () => {} } }
  return { state, hook, mountAdapter, errors, setters }
}
async function withFetch(run: () => Promise<void>) { const old = globalThis.fetch; try { await run() } finally { globalThis.fetch = old } }
function detail(id: string) { return { conversation: { id, novelId: "new-novel", modelId: null }, messages: [] } }
test("navigation 401/404 errors preserve the current conversation, input and queue", async () => withFetch(async () => {
  for (const status of [401, 404]) {
    globalThis.fetch = async () => new Response("{}", { status })
    const f = controlledHook(); assert.equal(await f.hook.loadConversation("missing", { preserveOnFailure: true }), false)
    assert.equal(f.state.conversationId, "old-chat"); assert.equal(f.state.draftId, "old-draft"); assert.equal(f.state.draft, "unsaved input")
    assert.deepEqual(f.state.queuedMessages, [{ id: "q-old", text: "queued input" }]); assert.equal(f.state.recoveryStatus, "ready")
  }
}))
test("a pre-aborted navigation performs no request or state transition", async () => withFetch(async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(detail("new-chat"))) }
  const f = controlledHook(), controller = new AbortController(); controller.abort()
  assert.equal(await f.hook.loadConversation("new-chat", { signal: controller.signal, preserveOnFailure: true }), false)
  assert.equal(calls, 0); assert.equal(f.state.conversationId, "old-chat"); assert.equal(f.state.queuePaused, false)
}))
test("cancelling while JSON is pending settles immediately and cannot later overwrite the current draft", async () => withFetch(async () => {
  const body = deferred<unknown>(), entered = deferred<void>()
  globalThis.fetch = async () => { const response = new Response("{}"); response.json = () => { entered.resolve(); return body.promise }; return response }
  const f = controlledHook(), controller = new AbortController(), old = f.hook.loadConversation("new-chat", { signal: controller.signal, preserveOnFailure: true })
  await entered.promise; controller.abort()
  const settled = await Promise.race([old, new Promise<string>(resolve => setTimeout(() => resolve("pending"), 30))])
  body.resolve(detail("new-chat")); await old
  assert.equal(settled, false); assert.equal(f.state.conversationId, "old-chat"); assert.equal(f.state.draft, "unsaved input")
  assert.equal(f.state.recoveryStatus, "ready"); assert.equal(f.errors.length, 0)
}))
test("old aborted completion cannot clear a newer load's restoring state", async () => withFetch(async () => {
  const first = deferred<Response>(), second = deferred<Response>(); let calls = 0
  globalThis.fetch = async () => ++calls === 1 ? first.promise : second.promise
  const f = controlledHook(), controller = new AbortController(), old = f.hook.loadConversation("first", { signal: controller.signal, preserveOnFailure: true })
  const current = f.hook.loadConversation("second", { preserveOnFailure: true }); controller.abort()
  first.resolve(new Response(JSON.stringify(detail("first")))); await old
  assert.equal(f.state.recoveryStatus, "restoring"); second.resolve(new Response(JSON.stringify(detail("second")))); assert.equal(await current, true)
  assert.equal(f.state.conversationId, "second"); assert.equal(f.state.recoveryStatus, "ready")
}))
test("restoring an unsent draft retains identity, pending local intent and explicit choices without sending", async () => withFetch(async () => {
  const saved: ChatSessionEntry = { ...emptyChatSession(), draftId: "saved-draft", novelId: "saved-novel", draft: "draft text", pendingNovelTitle: "pending title", novelCreationRequestId: "stable-request", modelChoice: { modelId: null, effort: null }, modelChoiceExplicit: true, mode: "plan", modeExplicit: true, queuedMessages: [{ id: "q", text: "do not send" }], pendingRequest: { clientRequestId: "p", body: "pending body" }, wasRunning: true }
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error("no request expected") }
  const f = controlledHook([saved]), owner = f.mountAdapter()
  try {
    const target = { kind: "draft", id: "saved-draft", accountId: "author" } as const
    assert.equal(owner.adapter.available(target), true); assert.equal(await owner.adapter.navigate(target, new AbortController().signal), true)
    assert.equal(f.state.conversationId, null); assert.equal(f.state.draftId, "saved-draft"); assert.equal(f.state.draftNovelId, "saved-novel")
    assert.equal(f.state.draft, "draft text"); assert.equal(f.state.novelCreationRequestId, "stable-request"); assert.equal(f.state.pendingNovelTitle, "pending title")
    assert.deepEqual(f.state.modelChoice, { modelId: null, effort: null }); assert.equal(f.state.modelChoiceExplicit, true); assert.equal(f.state.mode, "plan")
    assert.deepEqual(f.state.queuedMessages, saved.queuedMessages); assert.deepEqual(f.state.pendingRequest, saved.pendingRequest)
    assert.equal(f.state.queuePaused, true); assert.equal(f.state.suspendedExecution, true); assert.equal(calls, 0)
  } finally { owner.cleanup() }
}))
test("adapter disposal aborts in-flight load and a foreign-account/missing draft is unavailable", async () => withFetch(async () => {
  const pending = deferred<Response>(); let calls = 0
  globalThis.fetch = async () => { calls++; return pending.promise }
  const f = controlledHook(), owner = f.mountAdapter()
  assert.equal(owner.adapter.available({ kind: "draft", id: "missing", accountId: "author" }), false)
  assert.equal(owner.adapter.available({ kind: "conversation", id: "old-chat", accountId: "other" }), false)
  const move = owner.adapter.navigate({ kind: "conversation", id: "old-chat", accountId: "other" }, new AbortController().signal)
  assert.equal(await move, false); assert.equal(calls, 0)
  const saved = { ...emptyChatSession(), conversationId: "saved-chat", draftId: "saved-draft" }
  const next = controlledHook([saved]), registered = next.mountAdapter()
  const loading = registered.adapter.navigate({ kind: "conversation", id: "saved-chat", accountId: "author" }, new AbortController().signal)
  registered.cleanup(); const settled = await Promise.race([loading, new Promise<string>(resolve => setTimeout(() => resolve("pending"), 30))])
  pending.resolve(new Response(JSON.stringify(detail("saved-chat")))); await loading; owner.cleanup()
  assert.equal(settled, false); assert.equal(next.state.conversationId, "old-chat")
}))
test("a same-current conversation target only focuses and never resets or refetches its input", async () => withFetch(async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error("no request expected") }
  const f = controlledHook(), owner = f.mountAdapter()
  try {
    assert.equal(await owner.adapter.navigate({ kind: "conversation", id: "old-chat", accountId: "author" }, new AbortController().signal), true)
    assert.equal(calls, 0); assert.equal(f.state.draftId, "old-draft"); assert.equal(f.state.draft, "unsaved input"); assert.equal(f.state.chatFocusNonce, 1)
  } finally { owner.cleanup() }
}))
test("late failure after an owner change cannot toast or mark the new owner's restore complete", async () => withFetch(async () => {
  for (const preserveOnFailure of [false, true]) {
    const response = deferred<Response>(); globalThis.fetch = async () => response.promise
    const f = controlledHook(), old = f.hook.loadConversation("new-chat", { preserveOnFailure })
    f.state.conversationId = "new-owner-chat"; f.state.draftId = "new-owner-draft"; f.state.recoveryStatus = "restoring"
    response.reject(new Error("old network failure")); assert.equal(await old, false)
    assert.equal(f.state.recoveryStatus, "restoring"); assert.deepEqual(f.errors, [])
  }
}))
