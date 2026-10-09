import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { transformSync } from "esbuild"
import { ShortcutDispatcher } from "../../desktop/core/shortcut-dispatch"
import * as keys from "../../desktop/core/shortcuts"
import { buildMonacoCommandCatalog, createMonacoCommandTarget, type MonacoAction, type MonacoEditorTarget, type MonacoRuntime } from "../../src/lib/desktop/monaco-commands"
import { CommandTargets } from "../../src/lib/desktop/command-targets"
import { commandScope } from "../../src/lib/desktop/command-scope"
import { platformCommands } from "../../desktop/shared/command-registry"

function fixture(overrides: Record<string, string[]> = {}, options: { now?: () => number; includeText?: boolean } = {}) {
  class Element extends EventTarget { isConnected = true; closest(selector: string) { return selector.includes(".monaco-editor") ? this : null }; matches() { return false } }
  const target = new Element(), document = Object.assign(new EventTarget(), { querySelector: () => null }), window = new EventTarget()
  const calls: string[] = [], actions: MonacoAction[] = ["actions.find", "editor.action.unitHigh"].map(id => ({ id, label: id, isSupported: () => true, run: async () => { calls.push(id) } }))
  const runtime: MonacoRuntime = { version: "0.56.0", keyName: () => "F", command: () => ({}), contextMatches: () => true, actions,
    bindings: actions.map((action, index) => ({ command: action.id, keybinding: { chords: [{ keyCode: 36, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }] }, when: { serialize: () => "editorTextFocus" }, weight1: 100 + index * 100 })) }
  const monacoCommands = buildMonacoCommandCatalog(runtime, "darwin")
  const commands = [...(options.includeText ? platformCommands("darwin").filter(command => command.scope === "text") : []), ...monacoCommands], bus = new CommandTargets<HTMLElement | null>()
  const model = {}, dom = { isConnected: true, getClientRects: () => [{}], contains: (value: unknown) => value === target } as unknown as HTMLElement
  const editor: MonacoEditorTarget = { getDomNode: () => dom, getModel: () => model, getRawOptions: () => ({ readOnly: false }), getSupportedActions: () => actions, getAction: id => actions.find(action => action.id === id) ?? null, focus() {}, trigger() {} }
  const cleanup: Array<() => void> = [bus.register(createMonacoCommandTarget(editor, runtime, monacoCommands))]
  const bootstrap = { platform: "darwin", settings: { shortcuts: { darwin: overrides, win32: {} } } }
  const dependencies: Record<string, unknown> = {
    react: { useEffect(effect: () => () => void) { cleanup.push(effect()) } }, sonner: { toast: { info() {}, error() {} } },
    "@/stores/desktop": { useDesktopStore: { getState: () => ({ bootstrap }) }, updateDesktopSettings: async () => {} },
    "@/stores/tabs": { useTabsStore: { getState: () => ({ activeTabId: null }) } },
    "@desktop/core/shortcut-dispatch": { ShortcutDispatcher: class extends ShortcutDispatcher { constructor() { super(options.now) } } }, "@desktop/core/shortcuts": keys,
    "@/lib/desktop/command-runtime": { desktopCommandCatalog: () => commands, desktopCommandTargets: bus, desktopCommandTarget: () => target, desktopEditorTarget: () => target, rememberDesktopCommandTarget() {} },
    "@/lib/desktop/use-command-target": { useDesktopCommands() {} },
    "@/lib/desktop/input-commands": { installInputCommands: () => () => {}, installInputContextMenu: () => () => {}, isAPIKeyControl: () => false },
    "@/lib/desktop/native-text-edits": { nativeTextEdits: () => ({ run() {}, dispose() {} }) },
    "@/lib/desktop/composer-text-commands": { installComposerTextCommands: () => () => {} },
    "@/lib/desktop/command-scope": { commandScope },
  }
  const original = ["window", "document", "HTMLElement"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  Object.defineProperty(globalThis, "window", { configurable: true, value: window }); Object.defineProperty(globalThis, "document", { configurable: true, value: document }); Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Element })
  try {
    const module = { exports: {} as { DesktopCommandController(): void } }
    const code = transformSync(readFileSync(new URL("../../src/components/desktop/DesktopCommandController.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code
    new Function("module", "exports", "require", code)(module, module.exports, (name: string) => { if (name in dependencies) return dependencies[name]; throw Error(`Unexpected dependency ${name}`) })
    module.exports.DesktopCommandController()
  } catch (error) { while (cleanup.length) cleanup.pop()!(); restore(); throw error }
  function restore() { for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name) } }
  return { calls, target, bus,
    setOverrides(next: Record<string, string[]>) { bootstrap.settings.shortcuts.darwin = next },
    menu(id: string) { const event = new Event("desktop:command"); Object.defineProperty(event, "detail", { value: id }); window.dispatchEvent(event) },
    key(properties: Record<string, unknown> = {}) { const event = new Event("keydown", { cancelable: true }); Object.defineProperties(event, Object.fromEntries(Object.entries({ target, key: "f", code: "KeyF", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, keyCode: 70, ...properties }).map(([name, value]) => [name, { value }]))); window.dispatchEvent(event); return event },
    async settle() { for (let n = 0; n < 8; n++) await Promise.resolve() },
    dispose() { while (cleanup.length) cleanup.pop()!(); restore() },
  }
}
test("MONACOCTRL48-01: untouched native default predicates and weights remain with the installed resolver", async () => {
  const f = fixture()
  try { assert.equal(f.key().defaultPrevented, false); await f.settle(); assert.deepEqual(f.calls, []) } finally { f.dispose() }
})
test("MONACOCTRL48-02: adding a secondary custom binding does not swallow the preserved native default", async () => {
  const f = fixture({ "md.find": ["Cmd+F", "Cmd+Alt+Shift+F"] })
  try {
    assert.equal(f.key().defaultPrevented, false, "default Cmd+F still belongs to native conditional/weighted resolution")
    assert.equal(f.key({ altKey: true, shiftKey: true }).defaultPrevented, true)
    await f.settle(); assert.deepEqual(f.calls, ["actions.find"], "only the new custom stroke executes through the hub")
  } finally { f.dispose() }
})
test("MONACOCTRL48-03: a native Markdown menu command cannot target a nested ordinary input but retains preview ownership", async () => {
  const f = fixture(), opened: string[] = []
  const remove = f.bus.register({ owner: {}, accepts: target => target === (f.target as unknown as HTMLElement), commands: { "md.reference": () => { opened.push("reference") } } })
  try {
    f.target.closest = selector => selector.includes('.monaco-editor') || selector.includes('input,textarea,') ? f.target : null
    f.menu("md.reference"); await f.settle()
    assert.deepEqual(opened, [], "the ordinary comment draft must not apply a retained manuscript reference")
    f.target.closest = selector => selector.includes('.desktop-markdown-editor') ? f.target : null
    f.menu("md.reference"); await f.settle()
    assert.deepEqual(opened, ["reference"], "an actual preview remains a valid Markdown command target")
  } finally { remove(); f.dispose() }
})
test("MONACOCTRL48-04: a secondary chord's later stroke cannot shadow a retained native standalone default", async () => {
  const f = fixture({ "md.find": ["Cmd+F", "Cmd+K Cmd+F"] })
  try {
    assert.equal(f.key().defaultPrevented, false, "without a pending chord, retained Cmd+F must use native when/weight resolution")
    await f.settle(); assert.deepEqual(f.calls, [])
    assert.equal(f.key({ key: "k", code: "KeyK" }).defaultPrevented, true)
    assert.equal(f.key().defaultPrevented, true)
    await f.settle(); assert.deepEqual(f.calls, ["actions.find"], "Cmd+F completes the secondary chord after its explicit first stroke")
  } finally { f.dispose() }
})
test("MONACOCTRL48-05: expired or configuration-invalidated chord tails return the retained standalone key to Monaco", async () => {
  const bindings = { "md.find": ["Cmd+F", "Cmd+K Cmd+F"] }
  for (const invalidation of ["timeout", "configuration"]) {
    let now = 100
    const f = fixture(bindings, { now: () => now })
    try {
      assert.equal(f.key({ key: "k", code: "KeyK" }).defaultPrevented, true)
      if (invalidation === "timeout") now += 3000
      else f.setOverrides({ ...bindings, "monaco.editor.action.unitHigh": ["Cmd+F", "F9"] })
      assert.equal(f.key().defaultPrevented, false, `${invalidation} invalidates a chord before deciding to intercept its tail`)
      await f.settle(); assert.deepEqual(f.calls, [])
    } finally { f.dispose() }
  }
})
test("MONACOCTRL48-06: preview default copy and selectAll reach the body owner instead of native DOM copying", async () => {
  const f = fixture({}, { includeText: true }), executed: string[] = []
  const remove = f.bus.register({ owner: {}, accepts: target => target === (f.target as unknown as HTMLElement), commands: {
    "text.copy": () => { executed.push("filtered-copy") }, "text.selectAll": () => { executed.push("body-selectAll") },
    "text.paste": { enabled: () => false, run: () => { executed.push("forbidden-paste") } },
  } })
  try {
    f.target.closest = selector => selector.includes('.desktop-markdown-editor') ? f.target : null
    assert.equal(f.key({ key: "c", code: "KeyC" }).defaultPrevented, true)
    assert.equal(f.key({ key: "a", code: "KeyA" }).defaultPrevented, true)
    assert.equal(f.key({ key: "v", code: "KeyV" }).defaultPrevented, false, "read-only preview does not acquire mutation ownership")
    await f.settle(); assert.deepEqual(executed, ["filtered-copy", "body-selectAll"])
  } finally { remove(); f.dispose() }
})
test("MONACOCTRL48-07: explicit empty preview copy bindings remain empty while ordinary inputs retain native copying", async () => {
  const f = fixture({ "text.copy": [] }, { includeText: true }), executed: string[] = []
  const remove = f.bus.register({ owner: {}, accepts: target => target === (f.target as unknown as HTMLElement), commands: { "text.copy": () => { executed.push("copy") } } })
  try {
    f.target.closest = selector => selector.includes('.desktop-markdown-editor') ? f.target : null
    assert.equal(f.key({ key: "c", code: "KeyC" }).defaultPrevented, true, "removing the native default blocks the old key without executing")
    await f.settle(); assert.deepEqual(executed, [])
    f.setOverrides({})
    f.target.closest = selector => selector.includes('input,textarea,') || selector.includes('.desktop-markdown-editor') ? f.target : null
    assert.equal(f.key({ key: "c", code: "KeyC" }).defaultPrevented, false, "a nested ordinary input is not a preview body command")
    await f.settle(); assert.deepEqual(executed, [])
  } finally { remove(); f.dispose() }
})
