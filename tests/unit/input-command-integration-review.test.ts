import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"
import { transformSync } from "esbuild"
import { ShortcutDispatcher } from "../../desktop/core/shortcut-dispatch"
import * as keys from "../../desktop/core/shortcuts"
import catalog from "../../desktop/shared/commands.json"
import { platformCommands } from "../../desktop/shared/command-registry"
import { CommandTargets } from "../../src/lib/desktop/command-targets"
import { installInputCommands } from "../../src/lib/desktop/input-commands"
import { nativeTextEdits } from "../../src/lib/desktop/native-text-edits"
import { commandScope } from "../../src/lib/desktop/command-scope"

// Real Controller/input/main function bodies, controlled IPC delivery and DOM.
// A queued WebContents edit records its actual focused recipient. This does not
// prove Electron clipboard permission, Chromium history or native event order.
class Control extends EventTarget {
  tagName = "INPUT"; type = "text"; isConnected = true; disabled = false; readOnly = false
  selectionStart = 0; selectionEnd = 0; selectionDirection: "none" = "none"
  constructor(readonly ownerDocument: DocumentFixture, public value: string) { super() }
  closest(selector: string) { return selector.includes('input,textarea,') ? this : null }
  matches(selector: string) { return selector.includes(":disabled") ? this.disabled : selector.split(',').some(part => part.trim() === "input") }
  focus() { this.ownerDocument.activeElement = this }
  setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end }
}
class DocumentFixture extends EventTarget {
  activeElement: Control | null = null; edits: Control[] = []
  querySelector() { return null }
  queryCommandSupported() { return true }
  execCommand(command: string, _ui = false, text?: string) {
    assert.ok(command === "paste" || command === "insertText")
    const recipient = this.activeElement!; this.edits.push(recipient)
    recipient.value += command === "insertText" ? text : " + clipboard"; return true
  }
}
test("INPUT46-01: a paste captured for input A never mutates later-focused input B after IPC delivery", async () => {
  const document = new DocumentFixture(), a = new Control(document, "A"), b = new Control(document, "B")
  const window = new EventTarget() as EventTarget & { desktop: { command(id: string): Promise<void>; readClipboardText(): Promise<string> } }
  const queued: Array<() => Promise<void>> = [], cleanup: Array<() => void> = [], bus = new CommandTargets<HTMLElement | null>()
  a.focus()
  const main = readFileSync(new URL("../../desktop/main/index.ts", import.meta.url), "utf8")
  const syntax = ts.createSourceFile("main.ts", main, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "executeCommand")
  assert.ok(declaration)
  const code = transformSync(declaration.getText(syntax), { loader: "ts", format: "cjs" }).code
  const execute = new Function("commands", "window", `${code};return executeCommand;`)(catalog, { webContents: { paste: () => document.execCommand("paste") } }) as (id: string, fromRenderer: boolean) => Promise<void>
  let reads = 0
  window.desktop = {
    command: id => new Promise<void>((resolve, reject) => queued.push(async () => { try { await execute(id, true); resolve() } catch (error) { reject(error) } })),
    readClipboardText: () => { reads++; return new Promise<string>(resolve => queued.push(async () => { resolve(" + clipboard") })) },
  }
  const bootstrap = { platform: "darwin", settings: { shortcuts: { darwin: {}, win32: {} } } }
  const dependencies: Record<string, unknown> = {
    react: { useEffect(effect: () => () => void) { cleanup.push(effect()) } },
    sonner: { toast: { info() {}, error() {} } },
    "@/stores/desktop": { useDesktopStore: { getState: () => ({ bootstrap }) }, updateDesktopSettings: async () => {} },
    "@/stores/tabs": { useTabsStore: { getState: () => ({ activeTabId: null }) } },
    "@desktop/core/shortcut-dispatch": { ShortcutDispatcher }, "@desktop/core/shortcuts": keys,
    "@/lib/desktop/input-commands": { installInputCommands: (options: Parameters<typeof installInputCommands>[0]) => installInputCommands({ ...options, registerTarget: target => bus.register(target) }) },
    "@/lib/desktop/native-text-edits": { nativeTextEdits },
    "@/lib/desktop/composer-text-commands": { installComposerTextCommands: () => () => {} },
    "@/lib/desktop/command-scope": { commandScope },
    "@/lib/desktop/command-runtime": { desktopCommandCatalog: () => platformCommands("darwin"), desktopCommandTargets: bus, desktopCommandTarget: () => a, desktopEditorTarget: () => null, rememberDesktopCommandTarget() {} },
    "@/lib/desktop/use-command-target": { useDesktopCommands() {} },
  }
  const original = ["window", "document", "HTMLElement"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  Object.defineProperty(globalThis, "window", { configurable: true, value: window })
  Object.defineProperty(globalThis, "document", { configurable: true, value: document })
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Control })
  try {
    const module = { exports: {} as { DesktopCommandController(): void } }
    const controller = transformSync(readFileSync(new URL("../../src/components/desktop/DesktopCommandController.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code
    new Function("module", "exports", "require", controller)(module, module.exports, (name: string) => { if (name in dependencies) return dependencies[name]; throw Error(`Unexpected dependency ${name}`) })
    module.exports.DesktopCommandController()
    const event = new Event("desktop:command"); Object.defineProperty(event, "detail", { value: "text.paste" }); window.dispatchEvent(event)
    assert.equal(reads, 1, "the validated A command must reach the clipboard read bridge")
    b.focus()
    while (queued.length) await queued.shift()!()
    for (let n = 0; n < 8; n++) await Promise.resolve()
    assert.equal(b.value, "B", "a delayed native operation must never use the newly focused input")
    assert.ok(document.edits.every(recipient => recipient === a), "a paste may execute synchronously for A or cancel; B is never authorized")
  } finally {
    while (cleanup.length) cleanup.pop()!()
    for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name) }
  }
})
