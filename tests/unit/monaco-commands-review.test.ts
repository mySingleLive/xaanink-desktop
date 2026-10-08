import assert from "node:assert/strict"
import { test } from "node:test"
import { buildMonacoCommandCatalog, createMonacoCommandTarget, type MonacoAction, type MonacoEditorTarget, type MonacoRuntime } from "../../src/lib/desktop/monaco-commands"
import { markdownFormats } from "../../src/lib/desktop/markdown-actions"
import { CommandTargets } from "../../src/lib/desktop/command-targets"
import { bindingConflicts, editBinding } from "../../desktop/core/shortcuts"
import { commandScope } from "../../src/lib/desktop/command-scope"
import { installInputCommands } from "../../src/lib/desktop/input-commands"

const expression = (value: string) => ({ serialize: () => value })
function runtime(): MonacoRuntime {
  return { version: "0.56.0", actions: [], bindings: [], keyName: () => "Enter", command: () => ({}), contextMatches: () => true }
}

test("MONACO48-01: restoring an editor's focus cannot authorize a command against its replacement model", async () => {
  const r = runtime(); r.actions = [{ id: "editor.action.fixture", label: "Fixture" }]
  const target = { closest(selector: string) { return selector === '.monaco-editor' || selector === 'input,textarea,[contenteditable="true"]' ? this : null }, matches(selector: string) { return selector.split(',').includes('.inputarea') } } as unknown as HTMLElement, first = {}, replacement = {}, edited: unknown[] = []
  let model = first
  const dom = { isConnected: true, getClientRects: () => [{}], contains: (value: unknown) => value === target } as unknown as HTMLElement
  const action: MonacoAction = { id: "editor.action.fixture", label: "Fixture", isSupported: () => true, run: async () => { edited.push(model) } }
  const editor: MonacoEditorTarget = { getDomNode: () => dom, getModel: () => model, getRawOptions: () => ({ readOnly: false }), getSupportedActions: () => [action], getAction: () => action,
    focus() { model = replacement }, trigger() { throw Error("Unexpected core command") } }
  const bus = new CommandTargets<HTMLElement | null>()
  bus.register(createMonacoCommandTarget(editor, r, buildMonacoCommandCatalog(r, "darwin")))
  assert.equal(bus.enabled("monaco.editor.action.fixture", target), true, "the original manuscript target must be authorized before restoring focus")
  await bus.execute("monaco.editor.action.fixture", target)
  assert.deepEqual(edited, [], "the original retained selection does not belong to the newly installed manuscript model")
})

test("MONACO48-02: editing a default preserves mutually exclusive registered when branches", () => {
  const r = runtime(), keybinding = { chords: [{ keyCode: 3, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }] }
  r.bindings = [
    { command: "unit.contextual", commandArgs: { branch: "popup" }, keybinding, when: expression("popupVisible"), weight1: 200 },
    { command: "unit.contextual", commandArgs: { branch: "plain" }, keybinding, when: expression("!popupVisible"), weight1: 100 },
  ]
  const rows = buildMonacoCommandCatalog(r, "darwin"), popup = rows.find(row => (row.monacoArgs as { branch: string }).branch === "popup")!
  const conflicts = bindingConflicts(rows, {}, popup.id, "Enter", 0)
  assert.deepEqual(conflicts, [], "opposite when predicates can never both activate")
  const next = editBinding(rows, {}, popup.id, "Enter", 0)
  assert.deepEqual(next[popup.id], ["Enter"])
  const plain = rows.find(row => row.id !== popup.id)!
  assert.equal(Object.hasOwn(next, plain.id), false, "saving the popup branch never deletes the normal branch")
})

test("MONACO48-03: supported custom format action instance IDs never create duplicate per-editor commands", () => {
  const r = runtime(); r.actions = markdownFormats.map(([id, label]) => ({ id, label }))
  const supported = markdownFormats.map(([id, label]) => ({ id: `editor-7:${id}`, label, isSupported: () => true, run: async () => {} }))
  const rows = buildMonacoCommandCatalog(r, "darwin", supported)
  assert.deepEqual(rows.map(row => row.id).sort(), markdownFormats.map(([id]) => id).sort())
  assert.ok(rows.every(row => row.monacoId === row.id), "getAction uses the descriptor ID rather than its internal editor prefix")
})
test("MONACO48-04: all installed editor surfaces including readonly IME fallback retain one manuscript owner, while comments use the input owner", async () => {
  const r = runtime(), action: MonacoAction = { id: "editor.action.clipboardCopyAction", label: "Copy", isSupported: () => true, run: async () => { manuscriptCopies++ } }
  let manuscriptCopies = 0, inputCopies = 0
  r.actions = [action]
  const document = Object.assign(new EventTarget(), { activeElement: null as HTMLElement | null }), model = {}, nodes: HTMLElement[] = []
  const dom = { isConnected: true, getClientRects: () => [{}], contains: (value: unknown) => nodes.includes(value as HTMLElement) } as unknown as HTMLElement
  const control = (surface: string) => {
    const node = { tagName: "TEXTAREA", isConnected: true, ownerDocument: document, disabled: false, readOnly: surface === "ime-text-area", value: "稿", selectionStart: 0, selectionEnd: 1,
      closest(selector: string) { return selector === '.monaco-editor' ? dom : selector === 'input,textarea,[contenteditable="true"]' || selector.split(',').includes(`.${surface}`) ? this : null },
      matches(selector: string) { return selector.split(',').includes(`.${surface}`) },
      focus() { document.activeElement = this as unknown as HTMLElement },
      setSelectionRange(this: { selectionStart: number; selectionEnd: number }, start: number, end: number) { this.selectionStart = start; this.selectionEnd = end },
    } as unknown as HTMLElement
    nodes.push(node); return node
  }
  const editor: MonacoEditorTarget = { getDomNode: () => dom, getModel: () => model, getRawOptions: () => ({ readOnly: false }), getSupportedActions: () => [action], getAction: () => action, focus() {}, trigger() { throw Error("Unexpected core trigger") } }
  const hub = new CommandTargets<HTMLElement | null>()
  const removeMonaco = hub.register(createMonacoCommandTarget(editor, r, buildMonacoCommandCatalog(r, "darwin")))
  const removeInput = installInputCommands({ document: document as unknown as Document, registerTarget: target => hub.register(target), nativeEdit: () => { inputCopies++ } })
  try {
    for (const surface of ["inputarea", "native-edit-context", "ime-text-area"]) {
      const node = control(surface); document.activeElement = node
      assert.equal(commandScope(node), "markdown", surface)
      assert.equal(hub.enabled("text.copy", node), true, `${surface} has exactly one enabled owner`)
      assert.equal(await hub.execute("text.copy", node), true)
    }
    assert.equal(manuscriptCopies, 3); assert.equal(inputCopies, 0)
    const comment = control("comment-composer"); document.activeElement = comment
    assert.equal(commandScope(comment), "input")
    assert.equal(await hub.execute("text.copy", comment), true)
    assert.equal(inputCopies, 1); assert.equal(manuscriptCopies, 3)
  } finally { removeInput(); removeMonaco() }
})
test("MONACO48-05: a still-mounted manuscript hidden by pane CSS cannot receive a captured or new command", async () => {
  let visible = true, edits = 0
  const r = runtime(), model = {}, target = { closest: (selector: string) => selector === '.monaco-editor' ? dom : null, matches: () => false } as unknown as HTMLElement
  const dom = { isConnected: true, getClientRects: () => visible ? [{}] : [], contains: (value: unknown) => value === target } as unknown as HTMLElement
  const action: MonacoAction = { id: "editor.action.fixture", label: "Fixture", isSupported: () => true, run: async () => { edits++ } }
  r.actions = [action]
  const editor: MonacoEditorTarget = { getDomNode: () => dom, getModel: () => model, getRawOptions: () => ({ readOnly: false }), getSupportedActions: () => [action], getAction: () => action, focus() {}, trigger() {} }
  const hub = new CommandTargets<HTMLElement | null>()
  const remove = hub.register(createMonacoCommandTarget(editor, r, buildMonacoCommandCatalog(r, "darwin")))
  try {
    const captured = hub.capture("monaco.editor.action.fixture", target); assert.ok(captured)
    visible = false
    assert.equal(await captured(), false, "a hidden but connected owner is no longer the visible command recipient")
    assert.equal(await hub.execute("monaco.editor.action.fixture", target), false)
    assert.equal(edits, 0)
    visible = true
    assert.equal(await hub.execute("monaco.editor.action.fixture", target), true)
    assert.equal(edits, 1)
  } finally { remove() }
})
