import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { transformSync } from "esbuild"
import { defaultState, settingsSchema, parseContextWindow, type PublicModel } from "../../desktop/core/settings"
import { presetsFor } from "../../desktop/shared/model-catalog"
import { modelChoices, excludedBuiltinModel } from "../../desktop/shared/builtin-model-catalog"

// Executes the real editors with isolated hook instances and controlled IPC.
// It does not stand in for Base UI focus trapping, native pickers or Electron.
type Props = Record<string, any>
type Element = { type: string | ((props: Props) => unknown); props: Props; key?: string }
type Hook = { value?: any; deps?: unknown[]; cleanup?: void | (() => void) }
const textModel: PublicModel = { id: "00000000-0000-4000-8000-000000000101", name: "专项文本模型", provider: "deepseek", protocol: "openai", endpoint: "https://api.deepseek.com", modelId: modelChoices("deepseek", "TEXT", null).find(model => model.available !== false)!.id, kind: "TEXT", contextWindow: 128000, enabled: true, thinkingLevels: [], defaultThinking: "default", authRevision: 1, keyMask: "••••" }
const imageModel: PublicModel = { ...textModel, id: "00000000-0000-4000-8000-000000000102", name: "专项图片模型", kind: "IMAGE", provider: "openai", endpoint: "https://api.openai.com/v1", modelId: "gpt-image-1" }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function text(value: unknown): string { if (Array.isArray(value)) return value.map(text).join(""); if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children); return typeof value === "string" || typeof value === "number" ? String(value) : "" }
function editor(file: "ProfileSettings" | "ModelConfigurationDialog", exportName: string, props: Props, options: { models?: PublicModel[]; choose?: (id: string, acceptedDraftId?: string | null) => Promise<any>; cancelSelection?: (input: { sessionId: string; draftId?: string | null }) => void; discover?: (id: string) => Promise<any>; test?: (id: string) => Promise<any> } = {}) {
  const state = { ...structuredClone(defaultState), models: options.models ?? [] }, canceled: string[] = [], selectionCanceled: string[] = [], selectionRestores: Array<{ sessionId: string; draftId?: string | null }> = [], acceptedSelections: Array<{ sessionId: string; draftId?: string | null }> = [], saves: any[] = [], choices: string[] = [], tests: string[] = [], discoveries: string[] = []
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { desktop: {
    chooseAvatar: async (id: string, acceptedDraftId?: string | null) => { choices.push(id); acceptedSelections.push({ sessionId: id, draftId: acceptedDraftId }); return options.choose?.(id, acceptedDraftId) ?? null }, cancelAvatar: async (id: string) => { canceled.push(id) },
    cancelAvatarSelection: async (input: { sessionId: string; draftId?: string | null }) => { selectionCanceled.push(input.sessionId); selectionRestores.push(input); options.cancelSelection?.(input) },
    discoverModels: async (id: string) => { discoveries.push(id); return options.discover?.(id) }, testModel: async (id: string) => { tests.push(id); return options.test?.(id) }, cancelModelConfiguration: async (id: string) => { canceled.push(id) },
  } } })
  const contexts = new Map<string, { hooks: Hook[]; cursor: number }>(); let current!: { hooks: Hook[]; cursor: number }; let changed = false, mounted = true; let surfaces: Array<{ element: Element; name: string; disabled: boolean }> = []
  const effects: Array<() => void> = []
  const react = {
    useState(initial: any) { const n = current.cursor++, hook = current.hooks[n] ?? (current.hooks[n] = { value: typeof initial === "function" ? initial() : initial }); return [hook.value, (next: any) => { const value = typeof next === "function" ? next(hook.value) : next; if (!Object.is(value, hook.value)) { hook.value = value; changed = true } }] },
    useRef(initial: any) { const n = current.cursor++; return (current.hooks[n] ?? (current.hooks[n] = { value: { current: initial } })).value },
    useEffect(callback: () => void | (() => void), deps: unknown[]) { const n = current.cursor++, hook = current.hooks[n] ?? (current.hooks[n] = {}); if (!hook.deps || deps.some((value, index) => !Object.is(value, hook.deps![index]))) { hook.deps = deps; effects.push(() => { hook.cleanup?.(); hook.cleanup = callback() }) } },
  }
  const module = { exports: {} as Record<string, (props: Props) => unknown> }, primitives = (names: string[]) => Object.fromEntries(names.map(name => [name, name]))
  new Function("module", "exports", "require", transformSync(readFileSync(new URL(`../../src/components/desktop/${file}.tsx`, import.meta.url), "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code)(module, module.exports, (name: string) => {
    if (name === "react") return react
    if (name === "react/jsx-runtime") return { jsx: (type: Element["type"], props: Props, key?: string) => ({ type, props, key }), jsxs: (type: Element["type"], props: Props, key?: string) => ({ type, props, key }), Fragment: "Fragment" }
    if (name === "lucide-react") return new Proxy({}, { get: (_target, key) => String(key) })
    if (name === "@/components/ui/dialog") return primitives(["Dialog", "DialogContent", "DialogTitle", "DialogDescription"])
    if (name === "@/components/ui/button") return primitives(["Button"])
    if (name === "@/components/ui/input") return primitives(["Input"])
    if (name === "./ModelChoiceSelect") return primitives(["ModelChoiceSelect"])
    if (name === "@desktop/core/settings") return { settingsSchema, parseContextWindow }
    if (name === "@desktop/shared/model-catalog") return { presetsFor }
    if (name === "@desktop/shared/builtin-model-catalog") return { modelChoices, excludedBuiltinModel }
    if (name === "@/stores/desktop") return { useDesktopStore: (select: (value: unknown) => unknown) => select({ bootstrap: state }), saveDesktopModel: async (draft: any) => { saves.push(draft) }, saveDesktopProfile: async (...args: any[]) => { saves.push(args) } }
    throw new Error(`Unexpected editor dependency: ${name}`)
  })
  assert.equal(typeof module.exports[exportName], "function", `${exportName} must be exported for shared real-editor use`)
  function render() {
    if (!mounted) { surfaces = []; return }
    for (let n = 0; n < 16; n++) {
      changed = false; surfaces = []; const visited = new Set<string>()
      function visit(value: unknown, path: string, disabled = false): void {
        if (Array.isArray(value)) { value.forEach((child, index) => visit(child, `${path}/${index}`, disabled)); return }
        if (!value || typeof value !== "object" || !("props" in value)) return
        const element = value as Element
        if (typeof element.type === "function") { component(element.type, element.props, `${path}/${element.type.name}:${element.key ?? ""}`, disabled); return }
        if (element.type === "Dialog" && !element.props.open) return
        const ownDisabled = disabled || !!element.props.disabled, surface = { element, name: String(element.props["aria-label"] ?? element.props.label ?? text(element.props.children)), disabled: ownDisabled }
        surfaces.push(surface); const ref = element.props.ref
        if (typeof ref === "function") ref({ focus() {} }); else if (ref) ref.current = { focus() {} }
        visit(element.props.children, path, ownDisabled)
      }
      function component(type: (props: Props) => unknown, input: Props, path: string, disabled = false) { const before = current; current = contexts.get(path) ?? { hooks: [], cursor: 0 }; contexts.set(path, current); visited.add(path); current.cursor = 0; const value = type(input); current = before; visit(value, path, disabled) }
      component(module.exports[exportName], props, "root")
      for (const [path, context] of contexts) if (!visited.has(path)) { context.hooks.forEach(hook => hook.cleanup?.()); contexts.delete(path) }
      while (effects.length) effects.shift()!()
      if (!changed) return
    }
    throw new Error("Editor did not settle")
  }
  function find(name: string) { render(); const control = surfaces.find(surface => ["Button", "button", "Input", "select", "ModelChoiceSelect"].includes(String(surface.element.type)) && surface.name === name); assert.ok(control, `Visible editor control: ${name}`); return control }
  function call(name: string, handler: string, value?: unknown) { const control = find(name); if (!control.disabled) { assert.equal(typeof control.element.props[handler], "function"); void control.element.props[handler](value) }; render() }
  render()
  return { state, canceled, selectionCanceled, selectionRestores, acceptedSelections, saves, choices, tests, discoveries, find, all: () => { render(); return surfaces }, click: (name: string) => call(name, "onClick"), fill: (name: string, value: string) => call(name, "onChange", { target: { value } }), select: (name: string, value: string) => call(name, "onChange", find(name).element.type === "select" ? { target: { value } } : value), openChoice: (name: string) => call(name, "onOpen"), setProps(next: Props) { Object.assign(props, next); render() }, dismiss() { render(); const dialog = surfaces.find(surface => surface.element.type === "Dialog"); assert.ok(dialog); dialog.element.props.onOpenChange(false); render() }, async settle() { for (let n = 0; n < 12; n++) await Promise.resolve(); render() }, finish() { mounted = false; for (const context of contexts.values()) context.hooks.forEach(hook => hook.cleanup?.()); if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window") } }
}

test("ONB editor: profile Continue uses one supplied atomic transaction and successful save is not exit", async () => {
  const pending = deferred<void>(), submissions: any[] = []; let saved = 0, closed = 0
  const ui = editor("ProfileSettings", "ProfileEditorDialog", { title: "填写用户信息", submitLabel: "继续", onClose: () => closed++, onSaved: () => saved++, onSubmit: (...args: any[]) => { submissions.push(args); return pending.promise } })
  try {
    ui.fill("笔名", "  引导作者  "); ui.click("继续"); ui.click("继续"); ui.dismiss()
    assert.equal(submissions.length, 1); assert.equal(submissions[0][1].penName, "引导作者"); assert.equal(ui.saves.length, 0); assert.equal(closed, 0); assert.equal(ui.find("笔名").disabled, true)
    pending.resolve(); await ui.settle(); assert.equal(saved, 1); assert.equal(closed, 0)
  } finally { ui.finish() }
})
test("ONB editor: profile suspension and failed confirmation retain fields, avatar session and retry", async () => {
  const avatar = { draftId: "00000000-0000-4000-8000-000000000200", previewDataUrl: "data:image/png;base64,Zml4dHVyZQ==" }; let fail = true; const submissions: any[] = []
  const ui = editor("ProfileSettings", "ProfileEditorDialog", { open: true, submitLabel: "继续", onClose() {}, onSubmit: async (...args: any[]) => { submissions.push(args); if (fail) throw new Error("资料保存失败") } }, { choose: async () => avatar })
  try {
    ui.fill("笔名", "保留的署名"); ui.click("选择头像"); await ui.settle(); const id = ui.choices[0]
    ui.setProps({ open: false }); assert.equal(ui.canceled.includes(id), false); ui.setProps({ open: true }); assert.equal(ui.find("笔名").element.props.value, "保留的署名")
    ui.click("继续"); await ui.settle(); assert.equal(ui.find("笔名").element.props.value, "保留的署名"); assert.ok(ui.all().some(surface => surface.element.props.role === "alert")); assert.equal(submissions[0][2], avatar.draftId)
    fail = false; ui.click("继续"); await ui.settle(); assert.equal(submissions[1][0], id); assert.equal(submissions[1][2], avatar.draftId)
  } finally { ui.finish() }
})
function custom(ui: ReturnType<typeof editor>) { ui.select("供应商", "custom"); ui.fill("供应商名称", "测试供应商"); ui.select("协议", "openai"); ui.fill("展示名称", "测试模型"); ui.fill("Base URL", "https://fixture.invalid/v1"); ui.fill("模型 ID", "fixture-text"); ui.fill("API Key", "public-onboarding-fixture-key") }
test("ONB editor: model Continue saves a single frozen draft, failed retry preserves input and original editor still saves", async () => {
  const pending = deferred<void>(), submitted: any[] = []; let closed = 0, changed = 0, pendingRequest = true
  const ui = editor("ModelConfigurationDialog", "ModelConfigurationDialog", { kind: "TEXT", onClose: () => closed++, onboarding: { onSubmit: (draft: any) => { submitted.push(draft); return pendingRequest ? pending.promise : Promise.resolve() }, onSelectExisting: async () => {}, onBack() {}, onDraftChanged: () => changed++ } })
  try {
    custom(ui); assert.ok(changed > 0); ui.click("继续"); ui.click("继续"); ui.dismiss(); assert.equal(submitted.length, 1); assert.equal(ui.saves.length, 0); assert.equal(closed, 0); assert.equal(ui.find("API Key").disabled, true)
    pending.reject(new Error("模型保存失败")); await ui.settle(); assert.equal(ui.find("API Key").element.props.value, "public-onboarding-fixture-key"); assert.ok(ui.all().some(surface => surface.element.props.role === "alert"))
    pendingRequest = false; ui.click("继续"); await ui.settle(); assert.equal(submitted.length, 2); assert.deepEqual(submitted[1], submitted[0]); assert.equal(closed, 0)
  } finally { ui.finish() }
  const ordinary = editor("ModelConfigurationDialog", "ModelConfigurationDialog", { kind: "TEXT", onClose: () => closed++ })
  try { custom(ordinary); ordinary.click("保存模型"); await ordinary.settle(); assert.equal(ordinary.saves.length, 1); assert.equal(closed, 1) } finally { ordinary.finish() }
})
test("ONB editor: existing models are explicitly single selected, filtered, and reused without credentials or provider calls", async () => {
  const selected: string[] = [], submitted: any[] = []
  const ui = editor("ModelConfigurationDialog", "ModelConfigurationDialog", { kind: "TEXT", onClose() {}, onboarding: { onSubmit: async (draft: any) => { submitted.push(draft) }, onSelectExisting: async (id: string) => { selected.push(id) } } }, { models: [textModel, imageModel, { ...textModel, id: "00000000-0000-4000-8000-000000000103", enabled: false }] })
  try {
    ui.click("选择已有模型"); assert.equal(ui.find("已配置模型").element.props.value, null); assert.deepEqual(ui.find("已配置模型").element.props.options.map((item: any) => item.id), [textModel.id])
    ui.click("继续"); await ui.settle(); assert.equal(selected.length, 0); ui.select("已配置模型", textModel.id); ui.click("继续"); await ui.settle(); assert.deepEqual(selected, [textModel.id]); assert.equal(submitted.length, 0); assert.equal(ui.tests.length, 0); assert.equal(ui.discoveries.length, 0); assert.equal(ui.all().some(surface => surface.name === "API Key"), false)
  } finally { ui.finish() }
})
test("ONB editor: confirmed model is edited with the same id; suspension cancels test and ignores late output without clearing Key", async () => {
  const pending = deferred<any>(), submissions: any[] = []
  const ui = editor("ModelConfigurationDialog", "ModelConfigurationDialog", { kind: "TEXT", model: textModel, open: true, onClose() {}, onboarding: { onSubmit: async (draft: any) => { submissions.push(draft) }, onSelectExisting: async () => {} } }, { models: [textModel], test: () => pending.promise })
  try {
    ui.fill("API Key", "public-onboarding-fixture-key"); ui.click("测试连接"); assert.equal(ui.tests.length, 1); const id = ui.tests[0]
    ui.setProps({ open: false }); assert.ok(ui.canceled.includes(id)); pending.resolve({ ok: true, durationMs: 10 }); await ui.settle(); ui.setProps({ open: true }); assert.equal(ui.find("API Key").element.props.value, "public-onboarding-fixture-key"); assert.equal(ui.all().some(surface => surface.element.type === "DialogTitle" && surface.name === "连接测试结果"), false)
    ui.click("继续"); await ui.settle(); assert.equal(submissions[0].id, textModel.id)
  } finally { ui.finish() }
})
test("ONB editor: built-in providers put DeepSeek and domestic options first without unsupported image providers", () => {
  assert.deepEqual(presetsFor("TEXT").map(preset => preset.id), ["deepseek", "alibaba", "moonshot", "zai", "xiaomi", "minimax", "tencent", "bytedance", "openai", "anthropic", "google", "xai", "custom"])
  assert.deepEqual(presetsFor("IMAGE").map(preset => preset.id), ["alibaba", "zai", "minimax", "tencent", "bytedance", "openai", "google", "xai", "custom"])
})
test("ONB editor: uncertain durable confirmation freezes profile fields and avatar while allowing the exact retry", async () => {
  const submissions: any[] = []
  const ui = editor("ProfileSettings", "ProfileEditorDialog", { submitLabel: "继续", confirmationPending: true, onBack() {}, onClose() {}, onRetry: async () => { submissions.push("retry") }, onSubmit: async () => { throw Error("Pending retry must not submit the avatar session again") } })
  try { assert.equal(ui.find("笔名").disabled, true); assert.equal(ui.find("邮件").disabled, true); assert.equal(ui.find("选择头像").disabled, true); assert.equal(ui.find("返回").disabled, true); assert.equal(ui.find("暂时退出引导").disabled, false); assert.equal(ui.find("继续").disabled, false); ui.click("继续"); await ui.settle(); assert.equal(submissions.length, 1) } finally { ui.finish() }
})
test("ONB editor: uncertain model confirmation freezes credentials and selection while Continue can reconcile the same id", async () => {
  const submissions: any[] = []
  const ui = editor("ModelConfigurationDialog", "ModelConfigurationDialog", { kind: "TEXT", model: textModel, onClose() {}, onboarding: { confirmationPending: true, onBack() {}, onSkip() {}, onRetry: async () => { submissions.push("retry") }, onSubmit: async () => { throw Error("Pending retry must bypass model validation") }, onSelectExisting: async () => {} } }, { models: [textModel] })
  try { assert.equal(ui.find("供应商").disabled, true); assert.equal(ui.find("供应商").element.props.disabled, true); assert.equal(ui.find("API Key").disabled, true); assert.equal(ui.find("选择已有模型").disabled, true); assert.equal(ui.find("返回").disabled, true); assert.equal(ui.find("跳过").disabled, true); assert.equal(ui.find("测试连接").disabled, true); assert.equal(ui.find("暂时退出引导").disabled, false); assert.equal(ui.find("继续").disabled, false); ui.click("继续"); await ui.settle(); assert.deepEqual(submissions, ["retry"]) } finally { ui.finish() }
})
test("ONB editor: a suspended old test cannot clear the busy guard or replace a newer test result", async () => {
  const old = deferred<any>(), fresh = deferred<any>(); let count = 0
  const ui = editor("ModelConfigurationDialog", "ModelConfigurationDialog", { kind: "TEXT", model: textModel, open: true, onClose() {}, onboarding: { onSubmit: async () => {}, onSelectExisting: async () => {} } }, { models: [textModel], test: () => count++ === 0 ? old.promise : fresh.promise })
  try {
    ui.click("测试连接"); ui.setProps({ open: false }); ui.setProps({ open: true }); ui.click("测试连接"); old.resolve({ ok: true, durationMs: 9999 }); await ui.settle(); assert.equal(ui.find("测试中…").disabled, true); assert.equal(ui.find("继续").disabled, true)
    fresh.resolve({ ok: true, durationMs: 1234 }); await ui.settle(); assert.equal(ui.find("继续").disabled, false); assert.ok(ui.all().some(surface => surface.element.type === "DialogDescription" && surface.name.includes("1.2 秒"))); assert.equal(ui.all().some(surface => surface.name.includes("10.0 秒")), false)
  } finally { ui.finish() }
})
test("ONB editor: suspension cancels discovery and a late catalog cannot repopulate the editor", async () => {
  const pending = deferred<any>()
  const ui = editor("ModelConfigurationDialog", "ModelConfigurationDialog", { kind: "TEXT", model: textModel, open: true, onClose() {}, onboarding: { onSubmit: async () => {}, onSelectExisting: async () => {} } }, { models: [textModel], discover: () => pending.promise })
  try {
    ui.fill("API Key", "public-onboarding-fixture-key"); ui.openChoice("可用模型"); assert.equal(ui.discoveries.length, 1); ui.setProps({ open: false }); assert.ok(ui.canceled.includes(ui.discoveries[0])); pending.resolve({ ok: true, complete: true, models: [], warnings: ["late-catalog-fixture"], checkedAt: new Date().toISOString() }); await ui.settle(); ui.setProps({ open: true }); assert.equal(ui.find("API Key").element.props.value, "public-onboarding-fixture-key"); assert.equal(ui.all().some(surface => surface.name.includes("late-catalog-fixture")), false)
  } finally { ui.finish() }
})
test("ONB editor: failed Back keeps the same avatar session and a suspended chooser cannot apply a late preview", async () => {
  const pending = deferred<any>(), submissions: any[] = []; let backs = 0
  const ui = editor("ProfileSettings", "ProfileEditorDialog", { open: true, submitLabel: "继续", onBack: () => { backs++ }, onClose() {}, onSubmit: async (...args: any[]) => { submissions.push(args) } }, { choose: () => pending.promise })
  try {
    ui.fill("笔名", "继续保留"); ui.click("选择头像"); const id = ui.choices[0]; ui.click("返回"); assert.equal(backs, 1); assert.equal(ui.canceled.includes(id), false)
    ui.setProps({ open: false }); assert.deepEqual(ui.selectionCanceled, [id]); pending.resolve({ draftId: "00000000-0000-4000-8000-000000000203", previewDataUrl: "data:image/png;base64,bGF0ZQ==" }); await ui.settle(); ui.setProps({ open: true }); assert.equal(ui.all().some(surface => surface.element.type === "img" && surface.element.props.src === "data:image/png;base64,bGF0ZQ=="), false)
    ui.click("继续"); await ui.settle(); assert.equal(submissions[0][0], id); assert.equal(submissions[0][1].penName, "继续保留"); assert.equal(submissions[0][2], undefined)
  } finally { ui.finish() }
})
for (const kind of ["TEXT", "IMAGE"] as const) test(`ONB editor: ${kind} new model committed before an error retries without duplicate validation or another draft save`, async () => {
  const retry = deferred<void>(); let attempts = 0, retries = 0
  const callbacks = { confirmationPending: false, onSubmit: async (draft: any) => { attempts++; const { apiKey: _privateKey, ...publicDraft } = draft; ui.state.models.push({ ...publicDraft, id: kind === "TEXT" ? textModel.id : imageModel.id, authRevision: 1, keyMask: "••••" }); throw Error("写入待确认") }, onSelectExisting: async () => {}, onRetry: () => { retries++; return retry.promise } }
  const ui = editor("ModelConfigurationDialog", "ModelConfigurationDialog", { kind, onClose() {}, onboarding: callbacks })
  try {
    custom(ui); ui.click("继续"); await ui.settle(); assert.equal(attempts, 1); assert.equal(ui.state.models.length, 1); ui.setProps({ onboarding: { ...callbacks, confirmationPending: true } }); ui.click("继续"); ui.click("继续"); assert.equal(retries, 1); assert.equal(attempts, 1); retry.resolve(); await ui.settle(); assert.equal(ui.all().some(surface => surface.element.props.role === "alert"), false)
  } finally { ui.finish() }
})
for (const reason of ["exit", "dismiss", "back", "skip"] as const) test(`ONB editor: ${reason} remains available during a connection test and cancels late output`, async () => {
  const pending = deferred<any>(); let exited = 0, backed = 0, skipped = 0
  const ui = editor("ModelConfigurationDialog", "ModelConfigurationDialog", { kind: "TEXT", model: textModel, onClose: () => exited++, onboarding: { onSubmit: async () => {}, onSelectExisting: async () => {}, onBack: () => backed++, onSkip: () => skipped++ } }, { models: [textModel], test: () => pending.promise })
  try {
    ui.click("测试连接"); const id = ui.tests[0]; assert.equal(ui.find("继续").disabled, true)
    if (reason === "exit") ui.click("暂时退出引导"); else if (reason === "dismiss") ui.dismiss(); else if (reason === "back") ui.click("返回"); else ui.click("跳过")
    assert.ok(ui.canceled.includes(id)); assert.equal(exited + backed + skipped, 1); pending.resolve({ ok: true, durationMs: 1111 }); await ui.settle(); assert.equal(ui.all().some(surface => surface.element.type === "DialogTitle" && surface.name === "连接测试结果"), false)
  } finally { ui.finish() }
})
test("ONB editor: a cancelled test's late finally cannot unlock a later model save", async () => {
  const tested = deferred<any>(), saved = deferred<void>(); let submissions = 0
  const ui = editor("ModelConfigurationDialog", "ModelConfigurationDialog", { kind: "TEXT", model: textModel, onClose() {}, onboarding: { onSubmit: () => { submissions++; return saved.promise }, onSelectExisting: async () => {}, onBack() {} } }, { models: [textModel], test: () => tested.promise })
  try {
    ui.click("测试连接"); ui.click("返回"); ui.click("继续"); assert.equal(submissions, 1); tested.resolve({ ok: true, durationMs: 10 }); await ui.settle(); assert.equal(ui.find("继续").disabled, true); assert.equal(ui.find("返回").disabled, true); ui.click("继续"); assert.equal(submissions, 1); saved.resolve(); await ui.settle()
  } finally { ui.finish() }
})
test("ONB editor: accepted avatar A survives staged but unaccepted B when suspension restores the accepted draft", async () => {
  const accepted = { draftId: "00000000-0000-4000-8000-000000000210", previewDataUrl: "data:image/png;base64,YXZhdGFyLUE=" }, candidate = { draftId: "00000000-0000-4000-8000-000000000211", previewDataUrl: "data:image/png;base64,YXZhdGFyLUI=" }
  const pending = deferred<any>(), submissions: any[] = []; let count = 0, staged: string | null = null
  const ui = editor("ProfileSettings", "ProfileEditorDialog", { open: true, submitLabel: "继续", onClose() {}, onSubmit: async (...args: any[]) => { submissions.push(args); assert.equal(args[2], staged) } }, {
    choose: async () => { if (count++ === 0) { staged = accepted.draftId; return accepted }; staged = candidate.draftId; return pending.promise },
    cancelSelection: input => { staged = input.draftId ?? null },
  })
  try {
    ui.click("选择头像"); await ui.settle(); assert.equal(ui.acceptedSelections[0].draftId, null)
    ui.click("选择头像"); assert.equal(staged, candidate.draftId); assert.equal(ui.acceptedSelections[1].draftId, accepted.draftId)
    ui.setProps({ open: false }); assert.equal(ui.selectionRestores[0].draftId, accepted.draftId); assert.equal(staged, accepted.draftId)
    pending.resolve(candidate); await ui.settle(); ui.setProps({ open: true }); assert.ok(ui.all().some(surface => surface.element.type === "img" && surface.element.props.src === accepted.previewDataUrl)); assert.equal(ui.all().some(surface => surface.element.type === "img" && surface.element.props.src === candidate.previewDataUrl), false)
    ui.click("继续"); await ui.settle(); assert.equal(submissions.length, 1); assert.equal(submissions[0][2], accepted.draftId)
  } finally { ui.finish() }
})
