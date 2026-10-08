import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { transformSync } from "esbuild"

// Execute the actual imported component callbacks with controlled React hooks,
// store and HTTP completion. This is an isolated component regression, not a
// browser/Electron acceptance test.
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const settle = () => new Promise<void>(resolve => setImmediate(resolve))
function controlledPicker() {
  const state = {
    accountId: "local-author", conversationId: "conversation-a", draftId: "draft-a",
    modelChoice: { modelId: "old-a", effort: null as string | null }, modelChoiceExplicit: true,
    modelEffortMemory: {} as Record<string, string>,
    setModelChoice(choice: { modelId: string; effort: string | null }) { state.modelChoice = choice; state.modelChoiceExplicit = true },
    rememberModelChoice() {}, rememberModelEffort() {},
  }
  const models = ["model-2", "model-3"].map(id => ({ id, name: id, provider: "openai", modelId: id, contextWindow: 0, free: false, thinkingEfforts: [] }))
  const refs: Array<{ current: unknown }> = []; let cursor = 0
  const effects: Array<() => unknown> = []
  const output = { exports: {} as { ModelPicker(): unknown } }
  const code = transformSync(readFileSync(new URL("../../src/components/chat/ModelPicker.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code
  const elements = new Proxy({}, { get: (_target, name) => String(name) })
  const store = Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state })
  new Function("module", "exports", "require", code)(output, output.exports, (name: string) => {
    if (name === "react") return {
      useState: (value: unknown) => [value, () => {}], useEffect: (action: () => unknown) => effects.push(action),
      useRef: (value: unknown) => refs[cursor++] ?? (refs[cursor - 1] = { current: value }), useCallback: (fn: unknown) => fn,
    }
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) }
    if (name === "@tanstack/react-query") return { useQuery: () => ({ data: { defaultModelId: null, models } }) }
    if (name === "@/stores/chat") return { useChatStore: store }
    if (name === "@/lib/utils") return { cn: () => "" }
    if (name === "@/components/chat/ui-events") return { CHAT_OPEN_MODEL_PICKER_EVENT: "open-picker" }
    if (name === "sonner") return { toast: { error() {} } }
    return elements
  })
  function nodes(value: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
    if (Array.isArray(value)) return value.flatMap(nodes)
    if (value && typeof value === "object" && "props" in value) { const node = value as { type: unknown; props: Record<string, unknown> }; return [node, ...nodes(node.props.children)] }
    return []
  }
  function render() {
    cursor = 0; effects.length = 0
    const result = nodes(output.exports.ModelPicker())
    for (const run of effects) run()
    return result.filter(node => node.type === "DropdownMenuItem" && typeof node.props.onClick === "function")
  }
  return { state, render }
}
async function withGlobals(run: () => Promise<void>) {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch")
  try { Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true }); await run() }
  finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor); else Reflect.deleteProperty(globalThis, "window")
    if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor)
  }
}

test("picker PATCH failure from a previous conversation cannot roll back the current conversation model", async () => withGlobals(async () => {
  const patch = deferred<Response>(); const requests: string[] = []
  globalThis.fetch = async url => { requests.push(String(url)); return patch.promise }
  const picker = controlledPicker(); const first = picker.render()[0]
  ;(first.props.onClick as () => void)(); assert.equal(picker.state.modelChoice.modelId, "model-2")
  picker.state.conversationId = "conversation-b"; picker.state.draftId = "draft-b"; picker.state.modelChoice = { modelId: "saved-b", effort: null }; picker.render()
  patch.resolve(new Response(JSON.stringify({ error: "rejected fixture" }), { status: 409 })); await settle()
  assert.deepEqual(requests, ["/api/chat/conversations/conversation-a"])
  assert.equal(picker.state.modelChoice.modelId, "saved-b")
}))

test("earlier picker PATCH failure cannot erase a later successful explicit choice", async () => withGlobals(async () => {
  const firstPatch = deferred<Response>(); let requests = 0
  globalThis.fetch = async () => ++requests === 1 ? firstPatch.promise : new Response(null, { status: 204 })
  const picker = controlledPicker()
  ;(picker.render()[0].props.onClick as () => void)()
  ;(picker.render()[1].props.onClick as () => void)(); await settle()
  assert.equal(picker.state.modelChoice.modelId, "model-3")
  firstPatch.resolve(new Response(JSON.stringify({ error: "rejected fixture" }), { status: 409 })); await settle()
  assert.equal(requests, 2); assert.equal(picker.state.modelChoice.modelId, "model-3")
}))

test("two consecutive picker failures restore the last confirmed model rather than an unsaved optimistic selection", async () => withGlobals(async () => {
  const firstPatch = deferred<Response>(); let requests = 0
  globalThis.fetch = async () => ++requests === 1 ? firstPatch.promise : new Response(JSON.stringify({ error: "second rejected" }), { status: 409 })
  const picker = controlledPicker()
  ;(picker.render()[0].props.onClick as () => void)()
  ;(picker.render()[1].props.onClick as () => void)()
  firstPatch.resolve(new Response(JSON.stringify({ error: "first rejected" }), { status: 409 })); await settle()
  assert.equal(requests, 2); assert.equal(picker.state.modelChoice.modelId, "old-a")
}))

test("later picker failure restores a successfully persisted preceding selection", async () => withGlobals(async () => {
  const firstPatch = deferred<Response>(); let requests = 0
  globalThis.fetch = async () => ++requests === 1 ? firstPatch.promise : new Response(JSON.stringify({ error: "second rejected" }), { status: 409 })
  const picker = controlledPicker()
  ;(picker.render()[0].props.onClick as () => void)()
  ;(picker.render()[1].props.onClick as () => void)()
  firstPatch.resolve(new Response(null, { status: 204 })); await settle()
  assert.equal(requests, 2); assert.equal(picker.state.modelChoice.modelId, "model-2")
}))

test("picker request from the first visit cannot roll back an A to B to A navigation", async () => withGlobals(async () => {
  const patch = deferred<Response>(); globalThis.fetch = async () => patch.promise
  const picker = controlledPicker()
  ;(picker.render()[0].props.onClick as () => void)()
  picker.state.conversationId = "conversation-b"; picker.state.draftId = "draft-b"; picker.state.modelChoice = { modelId: "saved-b", effort: null }; picker.render()
  picker.state.conversationId = "conversation-a"; picker.state.draftId = "draft-a"; picker.state.modelChoice = { modelId: "saved-a-new", effort: null }; picker.render()
  patch.resolve(new Response(JSON.stringify({ error: "rejected fixture" }), { status: 409 })); await settle()
  assert.equal(picker.state.modelChoice.modelId, "saved-a-new")
}))
