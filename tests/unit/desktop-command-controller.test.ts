import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { transformSync } from "esbuild"
import { ShortcutDispatcher } from "../../desktop/core/shortcut-dispatch"
import * as shortcutKeys from "../../desktop/core/shortcuts"
import { platformCommands } from "../../desktop/shared/command-registry"
import { CommandTargets, type CommandHandler } from "../../src/lib/desktop/command-targets"
import { commandScope } from "../../src/lib/desktop/command-scope"

// Execute the real Controller's event listeners with bounded DOM/hooks and
// target ownership. This is not browser event ordering or native menu proof.
class ElementFixture extends EventTarget {
  isConnected = true
  inDialog = false
  constructor(readonly kind: "input" | "editor" | "button") { super() }
  closest(selector: string) {
    if (this.inDialog && selector.includes('role="dialog"')) return this
    if (this.kind === "editor" && (selector.includes(".monaco-editor") || selector.includes(".desktop-markdown-editor"))) return this
    if (this.kind === "input" && selector.includes('input,textarea,')) return this
    return null
  }
  matches(selector: string) { return this.kind === "input" && selector.split(',').some(part => part.trim() === "input") }
  getClientRects() { return [0] }
}
class DocumentFixture extends EventTarget {
  modal = false; recording = false
  querySelector(selector: string) {
    if (selector.includes("data-desktop-recording")) return this.recording ? {} : null
    if (selector.includes('role="dialog"')) return this.modal ? {} : null
    return null
  }
}

function fixture(overrides: Record<string, string[]> = {}) {
  const document = new DocumentFixture(), window = new EventTarget()
  const target = new ElementFixture("input"), editor = new ElementFixture("editor")
  const bus = new CommandTargets<ElementFixture | null>(), calls: string[] = [], cleanup: Array<() => void> = []
  let remembered: ElementFixture | null = target
  const bootstrap = { platform: "darwin", settings: { shortcuts: { darwin: overrides, win32: {} } } }
  const stateStore = Object.assign(() => { throw Error("Unexpected selector") }, { getState: () => ({ bootstrap }) })
  const dependencies: Record<string, unknown> = {
    react: { useEffect(effect: () => () => void) { cleanup.push(effect()) } },
    sonner: { toast: { info() {}, error() {} } },
    "@/stores/desktop": { useDesktopStore: stateStore, updateDesktopSettings: async () => {} },
    "@/stores/tabs": { useTabsStore: { getState: () => ({ activeTabId: null }) } },
    "@desktop/core/shortcut-dispatch": { ShortcutDispatcher },
    "@desktop/core/shortcuts": shortcutKeys,
    "@/lib/desktop/input-commands": { installInputCommands: () => () => {} },
    "@/lib/desktop/native-text-edits": { nativeTextEdits: () => ({ run() {}, dispose() {} }) },
    "@/lib/desktop/composer-text-commands": { installComposerTextCommands: () => () => {} },
    "@/lib/desktop/command-scope": { commandScope },
    "@/lib/desktop/command-runtime": {
      desktopCommandCatalog: () => platformCommands("darwin"), desktopCommandTargets: bus,
      desktopCommandTarget: () => remembered, desktopEditorTarget: () => editor,
      rememberDesktopCommandTarget: (next: ElementFixture) => { remembered = next },
    },
    "@/lib/desktop/use-command-target": {
      useDesktopCommands(commands: Record<string, CommandHandler>) {
        cleanup.push(bus.register({ owner: {}, accepts: () => true, commands }))
      },
    },
  }
  const original = ["window", "document", "HTMLElement"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  Object.defineProperty(globalThis, "window", { configurable: true, value: window })
  Object.defineProperty(globalThis, "document", { configurable: true, value: document })
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: ElementFixture })
  const module = { exports: {} as { DesktopCommandController: () => null } }
  const source = transformSync(readFileSync(new URL("../../src/components/desktop/DesktopCommandController.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code
  new Function("module", "exports", "require", source)(module, module.exports, (name: string) => {
    if (name in dependencies) return dependencies[name]
    throw Error(`Unexpected dependency: ${name}`)
  })
  module.exports.DesktopCommandController()
  cleanup.push(bus.register({ owner: target, accepts: next => next === target, commands: { "input.confirm": () => { calls.push("confirm") }, "text.copy": () => { calls.push("copy") } } }))
  cleanup.push(bus.register({ owner: editor, accepts: next => next === editor, commands: { "file.save": () => { calls.push("save") } } }))
  function key(key: string, code: string, properties: Record<string, unknown> = {}) {
    const event = new Event("keydown", { cancelable: true })
    Object.defineProperties(event, Object.fromEntries(Object.entries({ target, key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, keyCode: 0, ...properties }).map(([name, value]) => [name, { value }])))
    window.dispatchEvent(event)
    return event
  }
  function menu(id: string) {
    const event = new Event("desktop:command")
    Object.defineProperty(event, "detail", { value: id }); window.dispatchEvent(event)
  }
  return {
    document, target, calls, key, menu,
    async settle() { for (let n = 0; n < 8; n++) await Promise.resolve() },
    dispose() {
      while (cleanup.length) cleanup.pop()!()
      for (const [name, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
  }
}

test("CTRL46-01: an IME event invalidates an unfinished custom chord before composition ends", async () => {
  const f = fixture({ "input.confirm": ["Cmd+K C"] })
  try {
    assert.equal(f.key("k", "KeyK", { metaKey: true }).defaultPrevented, true)
    f.key("Process", "KeyX", { isComposing: true, keyCode: 229 })
    f.key("c", "KeyC"); await f.settle()
    assert.deepEqual(f.calls, [])
  } finally { f.dispose() }
})

test("CTRL46-02: an intervening untouched native key cancels an unfinished chord", async () => {
  const f = fixture({ "input.confirm": ["Cmd+K C"] })
  try {
    f.key("k", "KeyK", { metaKey: true })
    assert.equal(f.key("x", "KeyX").defaultPrevented, false, "untouched input still receives its native key")
    f.key("c", "KeyC"); await f.settle()
    assert.deepEqual(f.calls, [])
  } finally { f.dispose() }
})

test("CTRL46-03: native menu events cannot execute a background editor command through an active dialog or recording", async () => {
  const f = fixture()
  try {
    f.document.modal = true; f.menu("file.save"); await f.settle()
    assert.deepEqual(f.calls, [])
    f.document.modal = false; f.document.recording = true; f.menu("file.save"); await f.settle()
    assert.deepEqual(f.calls, [])
    f.document.recording = false; f.menu("file.save"); await f.settle()
    assert.deepEqual(f.calls, ["save"], "the same visible owner works when no modal barrier exists")
  } finally { f.dispose() }
})

test("CTRL46-04: pressing a modifier before the next chord stroke preserves the valid sequence", async () => {
  const f = fixture({ "input.confirm": ["Cmd+K Cmd+C"] })
  try {
    f.key("k", "KeyK", { metaKey: true })
    assert.equal(f.key("Meta", "MetaLeft", { metaKey: true }).defaultPrevented, false)
    f.key("c", "KeyC", { metaKey: true }); await f.settle()
    assert.deepEqual(f.calls, ["confirm"])
  } finally { f.dispose() }
})

test("CTRL46-05: another component consuming a key invalidates an unfinished chord", async () => {
  const f = fixture({ "input.confirm": ["Cmd+K C"] })
  try {
    f.key("k", "KeyK", { metaKey: true })
    f.key("Escape", "Escape", { defaultPrevented: true })
    f.key("c", "KeyC"); await f.settle()
    assert.deepEqual(f.calls, [])
  } finally { f.dispose() }
})

test("CTRL46-06: a dialog's own input keeps menu copy while recording still blocks it", async () => {
  const f = fixture()
  try {
    f.document.modal = true; f.target.inDialog = true
    f.menu("text.copy"); await f.settle(); assert.deepEqual(f.calls, ["copy"])
    f.document.recording = true
    f.menu("text.copy"); await f.settle(); assert.deepEqual(f.calls, ["copy"])
  } finally { f.dispose() }
})
