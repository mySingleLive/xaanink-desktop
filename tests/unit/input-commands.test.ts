import test from "node:test"
import assert from "node:assert/strict"
import { CommandTargets } from "../../src/lib/desktop/command-targets"
import { installInputCommands, type InputCommandOptions, type NativeInputEdit } from "../../src/lib/desktop/input-commands"
import catalog from "../../desktop/shared/commands.json"

// Bounded DOM substitute. Editing calls record native execCommand intent;
// this does not claim Chromium undo/IME/clipboard or OS keyboard acceptance.
class Control extends EventTarget {
  tagName = "INPUT"; type = "text"; value = ""; selectionStart: number | null = 0; selectionEnd: number | null = 0
  selectionDirection: "forward" | "backward" | "none" = "none"; isConnected = true; disabled = false; readOnly = false; excluded = false
  monaco = false; markdown = false; nativeSurface = false; nativeEditContext = false; imeSurface = false; composer = false
  constructor(readonly ownerDocument: DocumentFixture, value = "") { super(); this.value = value }
  closest(selector: string) {
    if (this.excluded && selector.includes("[data-desktop-recording]")) return this
    if (this.composer && selector.includes(".chat-composer-editable")) return this
    if (this.nativeSurface && selector.includes(".inputarea") || this.nativeEditContext && selector.includes(".native-edit-context")) return this
    if (this.imeSurface && selector.includes(".ime-text-area")) return this
    if (this.monaco && selector.includes(".monaco-editor")) return this
    if (this.markdown && selector.includes(".desktop-markdown-editor")) return this
    if (selector.includes('input,textarea,[contenteditable="true"]') && (this.tagName === "INPUT" || this.tagName === "TEXTAREA")) return this
    return null
  }
  matches(selector: string) { return selector === ":disabled" ? this.disabled : selector.includes(".inputarea") && this.nativeSurface || selector.includes(".native-edit-context") && this.nativeEditContext }
  focus() { this.ownerDocument.activeElement = this }
  setSelectionRange(start: number, end: number, direction: typeof this.selectionDirection = "none") { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction }
}
class DocumentFixture extends EventTarget {
  activeElement: Control | null = null
  defaultView = { Intl }
  calls: string[] = []; supported = true; failEdit = false
  queryCommandSupported() { return this.supported }
  execCommand(command: string) {
    this.calls.push(command); if (this.failEdit) return false
    const control = this.activeElement!
    if (command === "delete") { control.value = control.value.slice(0, control.selectionStart!) + control.value.slice(control.selectionEnd!); control.selectionEnd = control.selectionStart }
    return true
  }
}
function fixture(value = "", overrides: Partial<InputCommandOptions> = {}) {
  const document = new DocumentFixture(); const control = new Control(document, value); control.focus()
  const bus = new CommandTargets<HTMLElement | null>(); let registration: { commands: Record<string, unknown> } | undefined
  const dispose = installInputCommands({ document: document as unknown as Document, registerTarget: target => { registration = target; return bus.register(target) }, ...overrides })
  const target = (control: Control) => control as unknown as HTMLElement
  return { document, control, bus, dispose, get registration() { return registration }, execute: (id: string) => bus.execute(id, target(control)), enabled: (id: string) => bus.enabled(id, target(control)) }
}
function selection(control: Control) { return [control.selectionStart, control.selectionEnd, control.selectionDirection] }
function composition(document: DocumentFixture, control: Control, type: string) {
  const event = new Event(type); Object.defineProperty(event, "target", { value: control }); document.dispatchEvent(event)
}

test("registers every static ordinary input and shared text ID, no unrelated/editor handlers", () => {
  const f = fixture(); try {
    assert.deepEqual(Object.keys(f.registration?.commands ?? {}).sort(), catalog.commands.filter(c => c.id.startsWith("input.") || c.id.startsWith("text.")).map(c => c.id).sort())
  } finally { f.dispose() }
})
test("left/right and deletion use complete Unicode grapheme clusters", async () => {
  const value = "A👨‍👩‍👧‍👦éB"; const f = fixture(value)
  try {
    f.control.setSelectionRange(1, 1); assert.equal(await f.execute("input.right"), true); assert.equal(f.control.selectionStart, value.indexOf("e"))
    await f.execute("input.right"); assert.equal(f.control.selectionStart, value.length - 1)
    await f.execute("input.deletePrevious"); assert.equal(f.control.value, "A👨‍👩‍👧‍👦B"); assert.deepEqual(f.document.calls, ["delete"])
    await f.execute("input.left"); assert.equal(f.control.selectionStart, 1)
  } finally { f.dispose() }
})
test("plain arrow movement collapses selections without an extra character move", async () => {
  const f = fixture("abcdef"); try {
    f.control.setSelectionRange(2, 5, "backward"); await f.execute("input.left"); assert.deepEqual(selection(f.control).slice(0, 2), [2, 2])
    f.control.setSelectionRange(2, 5); await f.execute("input.right"); assert.deepEqual(selection(f.control).slice(0, 2), [5, 5])
  } finally { f.dispose() }
})
test("directional expansion keeps its anchor and contracts through it without resetting selection", async () => {
  const f = fixture("abcd"); try {
    f.control.setSelectionRange(2, 2); await f.execute("input.selectLeft"); assert.deepEqual(selection(f.control), [1, 2, "backward"])
    await f.execute("input.selectRight"); assert.deepEqual(selection(f.control).slice(0, 2), [2, 2])
    await f.execute("input.selectRight"); assert.deepEqual(selection(f.control), [2, 3, "forward"])
  } finally { f.dispose() }
})
test("word movement and word deletion skip punctuation/space using real Segmenter boundaries", async () => {
  const f = fixture("alpha, beta gamma"); try {
    await f.execute("input.wordRight"); assert.equal(f.control.selectionStart, 5)
    await f.execute("input.wordRight"); assert.equal(f.control.selectionStart, 11)
    await f.execute("input.wordLeft"); assert.equal(f.control.selectionStart, 7)
    await f.execute("input.deleteWordRight"); assert.equal(f.control.value, "alpha,  gamma")
  } finally { f.dispose() }
})
test("line and document boundaries differ and preserve selection anchor", async () => {
  const f = fixture("abc\ndef\nghi"); f.control.tagName = "TEXTAREA"
  try {
    f.control.setSelectionRange(5, 5); await f.execute("input.home"); assert.equal(f.control.selectionStart, 4)
    await f.execute("input.end"); assert.equal(f.control.selectionStart, 7)
    await f.execute("input.selectHome"); assert.deepEqual(selection(f.control), [4, 7, "backward"])
    await f.execute("input.documentStart"); assert.equal(f.control.selectionStart, 0)
    await f.execute("input.documentEnd"); assert.equal(f.control.selectionStart, 11)
    await f.execute("text.selectAll"); assert.deepEqual(selection(f.control).slice(0, 2), [0, 11])
  } finally { f.dispose() }
})
test("hard-line vertical movement retains desired grapheme column across a short line", async () => {
  const f = fixture("abcdef\nx\nabcdef"); f.control.tagName = "TEXTAREA"
  try {
    f.control.setSelectionRange(5, 5); await f.execute("input.down"); assert.equal(f.control.selectionStart, 8)
    await f.execute("input.down"); assert.equal(f.control.selectionStart, 14)
    await f.execute("input.up"); assert.equal(f.control.selectionStart, 8)
    await f.execute("input.up"); assert.equal(f.control.selectionStart, 5)
  } finally { f.dispose() }
})
test("readonly allows selection/copy while all mutation and business confirmation are disabled", async () => {
  const native: NativeInputEdit[] = []; const f = fixture("readonly", { nativeEdit: id => { native.push(id) } }); f.control.readOnly = true
  try {
    for (const id of ["text.cut", "text.paste", "text.undo", "input.deletePrevious", "input.confirm"]) assert.equal(f.enabled(id), false, id)
    await f.execute("text.selectAll"); assert.equal(f.enabled("text.copy"), true); await f.execute("text.copy"); assert.deepEqual(native, ["text.copy"])
  } finally { f.dispose() }
})
test("password never exports copy/cut but keeps protected navigation and paste", async () => {
  const native: NativeInputEdit[] = []; const f = fixture("secret", { nativeEdit: id => { native.push(id) } }); f.control.type = "password"; f.control.setSelectionRange(0, 6)
  try {
    assert.equal(f.enabled("text.copy"), false); assert.equal(await f.execute("text.cut"), false)
    assert.equal(await f.execute("text.pastePlain"), true); assert.deepEqual(native, ["text.pastePlain"])
    assert.equal(await f.execute("input.home"), true)
  } finally { f.dispose() }
})
test("disabled/excluded/email/number/nonselection/detached controls are not accepted", async () => {
  for (const alter of [(c: Control) => { c.disabled = true }, (c: Control) => { c.excluded = true }, (c: Control) => { c.type = "email" }, (c: Control) => { c.type = "number" }, (c: Control) => { c.selectionStart = null }, (c: Control) => { c.isConnected = false }]) {
    const f = fixture("untouched"); try { alter(f.control); assert.equal(await f.execute("input.left"), false); assert.equal(f.control.value, "untouched") } finally { f.dispose() }
  }
})
test("custom accepts predicate excludes a component-owned input without fallback", async () => {
  const f = fixture("owned", { acceptControl: () => false }); try { assert.equal(await f.execute("text.selectAll"), false) } finally { f.dispose() }
})
test("captured input command refuses a different focused input and never edits background input", async () => {
  const f = fixture("background"); try {
    const command = f.bus.capture("input.deleteNext", f.control as unknown as HTMLElement); assert.ok(command)
    const other = new Control(f.document, "foreground"); other.focus(); assert.equal(await command(), false); assert.equal(f.control.value, "background"); assert.equal(other.value, "foreground")
  } finally { f.dispose() }
})
test("composition blocks all commands until compositionend and dispose unregisters/listener state", async () => {
  const f = fixture("漢字"); try {
    composition(f.document, f.control, "compositionstart")
    assert.equal(f.enabled("input.right"), false); assert.equal(await f.execute("text.selectAll"), false)
    composition(f.document, f.control, "compositionend"); assert.equal(await f.execute("input.right"), true)
  } finally { f.dispose() }
  assert.equal(await f.execute("input.left"), false)
})
test("deletion uses native undo preserving operation and failed native edit restores original selection", async () => {
  const f = fixture("abcdef"); try {
    f.control.setSelectionRange(3, 3); f.document.failEdit = true
    await assert.rejects(f.execute("input.deletePrevious")); assert.equal(f.control.value, "abcdef"); assert.deepEqual(selection(f.control).slice(0, 2), [3, 3])
    assert.deepEqual(f.document.calls, ["delete"])
  } finally { f.dispose() }
})
test("confirm/cancel require control-owner callbacks and are not generic submit/blur/key replay", async () => {
  const absent = fixture("draft"); try { assert.equal(absent.enabled("input.confirm"), false); assert.equal(absent.enabled("input.cancel"), false) } finally { absent.dispose() }
  const called: string[] = []; const f = fixture("draft", { actions: () => ({ confirm() { called.push("confirm") }, cancel() { called.push("cancel") } }) })
  try { await f.execute("input.confirm"); await f.execute("input.cancel"); assert.deepEqual(called, ["confirm", "cancel"]); assert.deepEqual(f.document.calls, []); assert.equal(f.control.value, "draft") } finally { f.dispose() }
})
test("shared native undo/redo/clipboard invoke the narrow injected operation exactly once", async () => {
  const calls: NativeInputEdit[] = []; const targets: unknown[] = []; const f = fixture("text", { nativeEdit: (id, control) => { calls.push(id); targets.push(control) } }); f.control.setSelectionRange(0, 4)
  try {
    for (const id of ["text.undo", "text.redo", "text.copy", "text.cut", "text.paste", "text.pastePlain"]) assert.equal(await f.execute(id), true)
    assert.deepEqual(calls, ["text.undo", "text.redo", "text.copy", "text.cut", "text.paste", "text.pastePlain"])
    assert.equal(targets.length, 6); assert.ok(targets.every(target => target === f.control))
  } finally { f.dispose() }
})

test("single-line vertical navigation reaches its start/end and an initial empty hard line remains addressable", async () => {
  const single = fixture("abcdef"); try {
    single.control.setSelectionRange(3, 3); await single.execute("input.up"); assert.equal(single.control.selectionStart, 0)
    await single.execute("input.down"); assert.equal(single.control.selectionStart, 6)
  } finally { single.dispose() }
  const multiline = fixture("\nabc"); multiline.control.tagName = "TEXTAREA"
  try { await multiline.execute("input.home"); assert.equal(multiline.control.selectionStart, 0); await multiline.execute("input.down"); assert.equal(multiline.control.selectionStart, 1) } finally { multiline.dispose() }
})

test("a focus callback making the input readonly cannot permit an already-enabled native mutation", async () => {
  const native: NativeInputEdit[] = []; const f = fixture("protected", { nativeEdit: id => { native.push(id) } })
  try {
    const focus = f.control.focus.bind(f.control); f.control.focus = () => { focus(); f.control.readOnly = true }
    await assert.rejects(f.execute("text.paste")); assert.deepEqual(native, []); assert.equal(f.control.value, "protected")
  } finally { f.dispose() }
})

test("word expansion preserves the fixed anchor and either direction can delete a whole requested word", async () => {
  const f = fixture("alpha beta"); try {
    f.control.setSelectionRange(6, 6); await f.execute("input.selectWordRight"); assert.deepEqual(selection(f.control), [6, 10, "forward"])
    await f.execute("input.selectWordLeft"); assert.deepEqual(selection(f.control).slice(0, 2), [6, 6])
    await f.execute("input.selectWordLeft"); assert.deepEqual(selection(f.control), [0, 6, "backward"])
    f.control.setSelectionRange(6, 6); await f.execute("input.deleteWordLeft"); assert.equal(f.control.value, "beta")
    f.control.setSelectionRange(0, 0); await f.execute("input.deleteNext"); assert.equal(f.control.value, "eta")
  } finally { f.dispose() }
})

test("unsupported native edit operations remain unavailable and pastePlain requires an explicit native bridge", async () => {
  const f = fixture("safe"); f.control.setSelectionRange(0, 4)
  try {
    assert.equal(f.enabled("text.pastePlain"), false)
    f.document.supported = false
    for (const id of ["text.undo", "text.redo", "text.copy", "text.cut", "text.paste", "input.deleteNext"]) assert.equal(f.enabled(id), false, id)
    assert.equal(await f.execute("input.left"), true); assert.deepEqual(f.document.calls, []); assert.equal(f.control.value, "safe")
  } finally { f.dispose() }
})

test("a menu may retain its original input selection, then the command restores only that input before native editing", async () => {
  const native: NativeInputEdit[] = []; const f = fixture("selection", { nativeEdit: id => { assert.equal(f.document.activeElement, f.control); native.push(id) } })
  try {
    f.control.setSelectionRange(1, 5, "backward")
    const command = f.bus.capture("text.copy", f.control as unknown as HTMLElement); assert.ok(command)
    const menu = new Control(f.document); menu.tagName = "BUTTON"; menu.closest = selector => selector.includes('[role="menu"]') ? menu : null; menu.focus()
    assert.equal(await command(), true); assert.deepEqual(native, ["text.copy"]); assert.deepEqual(selection(f.control), [1, 5, "backward"])
  } finally { f.dispose() }
})
test("Monaco find and comment ViewZone inputs accept ordinary editing without operating the manuscript surface", async () => {
  for (const kind of ["find", "comment"] as const) {
    const targets: unknown[] = [], f = fixture("search or comment", { nativeEdit: (_id, control) => { targets.push(control) } })
    f.control.monaco = true; f.control.markdown = true
    if (kind === "comment") f.control.tagName = "TEXTAREA"
    try {
      assert.equal(await f.execute("text.selectAll"), true, kind)
      assert.deepEqual(selection(f.control).slice(0, 2), [0, f.control.value.length])
      assert.equal(await f.execute("text.pastePlain"), true, kind)
      assert.deepEqual(targets, [f.control]); assert.deepEqual(f.document.calls, [])
    } finally { f.dispose() }
  }
})
test("actual Monaco text surfaces, composer and recording controls remain excluded", async () => {
  for (const mode of ["inputarea", "native-edit-context", "ime-text-area", "composer", "recording"] as const) {
    const targets: unknown[] = [], f = fixture("owned text", { nativeEdit: (_id, control) => { targets.push(control) } })
    f.control.monaco = mode === "inputarea" || mode === "native-edit-context" || mode === "ime-text-area"
    f.control.nativeSurface = mode === "inputarea"; f.control.nativeEditContext = mode === "native-edit-context"
    f.control.imeSurface = mode === "ime-text-area"
    f.control.composer = mode === "composer"; f.control.excluded = mode === "recording"
    try {
      assert.equal(await f.execute("text.selectAll"), false, mode)
      assert.equal(await f.execute("text.pastePlain"), false, mode)
      assert.equal(await f.execute("input.deleteNext"), false, mode)
      assert.deepEqual(targets, []); assert.deepEqual(f.document.calls, []); assert.equal(f.control.value, "owned text")
    } finally { f.dispose() }
  }
})
